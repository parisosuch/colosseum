// Decodes one frame out of a stored video, which is what a video block's grid
// card renders instead of the video itself (see ensureThumbnail in ./blob.ts).
//
// ffmpeg does the decoding. It is deliberately not a bun dependency: the Docker
// image installs Debian's package, and a self-hoster running outside the image
// needs `ffmpeg` on PATH (or FFMPEG_PATH pointing at a build). Every path here
// reports "no frame" rather than throwing something a caller must special-case,
// because a deployment without ffmpeg still has to serve video blocks — it just
// serves them without a poster.

import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Resolved per call, not at import, so the availability probe below and the
// extraction agree even when a test points them somewhere else.
function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

// One frame out of a file capped at 100MB is sub-second work. Anything near
// this bound is a pathological input, and it is holding an upload (or a media
// request) open while it runs.
const FFMPEG_TIMEOUT_MS = 20_000;

// A frame at t=0 is often black — fades, leaders, a dark first key frame — so
// prefer one a second in, and fall back to the very first frame for a video
// shorter than that.
const SEEK_SECONDS = [1, 0];

// Enough of ffmpeg's complaint to be useful in a log line, bounded so a chatty
// failure can't accumulate megabytes in memory.
const MAX_STDERR = 2000;

// The container extension ffmpeg sees. It sniffs the actual format, so this is
// only a hint — but a wrong or missing extension makes some demuxers guess
// worse, and it costs nothing to get it right.
const EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/ogg": ".ogv",
};

type Run = { code: number | null; stdout: Buffer; stderr: string };

// Spawn, buffer stdout, and always settle: a child that never exits is killed
// at FFMPEG_TIMEOUT_MS, and a missing binary rejects with ENOENT from `error`.
function run(bin: string, args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(stdout), stderr: stderr.slice(0, MAX_STDERR) });
    });
  });
}

// Answered once per binary and kept, because the answer can't change without a
// restart and the callers ask on every un-postered video. Memoizing the promise
// (not the result) also collapses a burst of concurrent first calls into one
// spawn.
const availability = new Map<string, Promise<boolean>>();

// Whether a usable ffmpeg is on this machine. Callers check it *before*
// downloading the source bytes — pulling 100MB out of S3 to then discover there
// is no decoder is the one cost worth avoiding.
export function ffmpegAvailable(): Promise<boolean> {
  const bin = ffmpegBin();
  let probe = availability.get(bin);
  if (!probe) {
    probe = run(bin, ["-version"])
      .then((res) => res.code === 0)
      .catch(() => false);
    availability.set(bin, probe);
  }
  return probe;
}

// A PNG of one frame from `data`. Throws when ffmpeg is absent or the file has
// no decodable video stream, so callers fall back to no poster at all.
export async function extractVideoFrame(data: Buffer, mime: string): Promise<Buffer> {
  if (!(await ffmpegAvailable())) {
    throw new Error("ffmpeg is not available");
  }
  // The bytes go to a temp file because seeking is the whole point: an mp4 with
  // its moov atom at the end can't be demuxed from a pipe at all, and `-ss` on
  // a pipe would have to decode from the start to reach the seek point.
  const dir = await mkdtemp(path.join(tmpdir(), "colosseum-frame-"));
  const src = path.join(dir, `source${EXTENSIONS[mime] ?? ""}`);
  try {
    await writeFile(src, data);
    let failure = "";
    for (const seek of SEEK_SECONDS) {
      // `-ss` before `-i` is an input seek (jump, then decode one frame),
      // which is what keeps this off the O(duration) path.
      const res = await run(ffmpegBin(), [
        "-loglevel",
        "error",
        "-nostdin",
        "-ss",
        String(seek),
        "-i",
        src,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-",
      ]);
      // A seek past the end exits 0 with nothing on stdout, which is why the
      // byte count is checked too and not just the status.
      if (res.code === 0 && res.stdout.length > 0) {
        return res.stdout;
      }
      failure = res.stderr.trim() || `ffmpeg exited ${res.code}`;
    }
    throw new Error(`no decodable frame: ${failure}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
