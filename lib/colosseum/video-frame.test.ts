// The video poster path, end to end: frame extraction here, and the two
// ensureThumbnail branches in ./blob.ts that depend on it. They share one stub
// ffmpeg, so they live together rather than split across this file and
// thumbnail.test.ts (which stays about images).
//
// ffmpeg is a runtime dependency of the deployment, not of the test suite, so
// the tests drive a shell script standing in for it via FFMPEG_PATH. That is
// also the only way to exercise the "no ffmpeg installed" branch on a machine
// that does have it.

import { afterEach, beforeAll, expect, test } from "bun:test";

import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { seed, USERS } from "@/scripts/seed";
import {
  blobKey,
  createMedia,
  ensureThumbnail,
  getMedia,
  mediaIdFromUrl,
  putBlob,
  thumbKey,
} from "./blob";
import { deleteObject, getBytes, objectExists } from "./storage";
import { extractVideoFrame, ffmpegAvailable } from "./video-frame";

beforeAll(async () => {
  await seed();
});

const originalPath = process.env.FFMPEG_PATH;

afterEach(() => {
  if (originalPath === undefined) {
    delete process.env.FFMPEG_PATH;
  } else {
    process.env.FFMPEG_PATH = originalPath;
  }
});

// Write an executable stub at a fresh path and point FFMPEG_PATH at it. A fresh
// path per stub matters: ffmpegAvailable memoizes its answer per binary, so two
// stubs sharing a path would share one probe.
async function useStub(body: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "colosseum-ffmpeg-stub-"));
  const bin = path.join(dir, "ffmpeg");
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  process.env.FFMPEG_PATH = bin;
  return bin;
}

// `-version` answers the probe; everything else is an extraction call.
const PROBE = `if [ "$1" = "-version" ]; then echo "ffmpeg version stub"; exit 0; fi`;

async function framePng(width = 1280, height = 720): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "colosseum-frame-fixture-"));
  const file = path.join(dir, "frame.png");
  await writeFile(
    file,
    await sharp({ create: { width, height, channels: 3, background: "purple" } })
      .png()
      .toBuffer(),
  );
  return file;
}

test("ffmpegAvailable is false when the binary isn't there", async () => {
  process.env.FFMPEG_PATH = path.join(tmpdir(), "colosseum-no-such-ffmpeg");
  expect(await ffmpegAvailable()).toBe(false);
});

test("extractVideoFrame returns what ffmpeg wrote to stdout", async () => {
  const png = await framePng();
  await useStub(`${PROBE}\ncat "${png}"`);

  const frame = await extractVideoFrame(Buffer.from("pretend-mp4"), "video/mp4");
  expect((await sharp(frame).metadata()).format).toBe("png");
});

// A video shorter than the preferred seek exits 0 with an empty stdout, which
// is why the seek is retried at 0 — and why a zero-byte result can't be taken
// as success.
test("extractVideoFrame falls back to the first frame when the seek is past the end", async () => {
  const png = await framePng();
  // Args are `-loglevel error -nostdin -ss <seek> …`, so the seek is $5: emit
  // nothing for the 1s attempt, the frame for the retry at 0.
  await useStub([PROBE, `if [ "$5" = "1" ]; then exit 0; fi`, `cat "${png}"`].join("\n"));

  const frame = await extractVideoFrame(Buffer.from("pretend-mp4"), "video/mp4");
  expect((await sharp(frame).metadata()).format).toBe("png");
});

test("extractVideoFrame throws when ffmpeg can't decode the file", async () => {
  await useStub(
    [PROBE, `echo "Invalid data found when processing input" >&2`, `exit 1`].join("\n"),
  );

  await expect(extractVideoFrame(Buffer.from("not-a-video"), "video/mp4")).rejects.toThrow(
    /Invalid data found/,
  );
});

test("extractVideoFrame throws rather than spawning when ffmpeg is missing", async () => {
  process.env.FFMPEG_PATH = path.join(tmpdir(), "colosseum-still-no-ffmpeg");
  await expect(extractVideoFrame(Buffer.from("pretend-mp4"), "video/mp4")).rejects.toThrow(
    /ffmpeg is not available/,
  );
});

// The poster is stored under the same key, and marked with the same column, as
// an image thumbnail — so `?thumb` on a video media id serves it with no extra
// lookup, and the card can be a plain <img>.
test("ensureThumbnail stores a video's poster frame as the blob's webp thumbnail", async () => {
  const png = await framePng();
  await useStub(`${PROBE}\ncat "${png}"`);

  const sha = await putBlob(Buffer.from("pretend-mp4-bytes"), "video/mp4", USERS.alice.id);
  const url = await createMedia(sha, USERS.alice.id, "public");
  const id = mediaIdFromUrl(url)!;

  try {
    expect((await getMedia(id))!.has_thumbnail).toBe(false);

    expect(await ensureThumbnail(sha, "video/mp4")).toBe(thumbKey(sha));
    const meta = await sharp((await getBytes(thumbKey(sha)))!).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(600);
    expect((await getMedia(id))!.has_thumbnail).toBe(true);
  } finally {
    await deleteObject(blobKey(sha));
    await deleteObject(thumbKey(sha));
  }
});

// Without ffmpeg there is no poster, and the caller has to hear about it
// before the source bytes are pulled — a 100MB download to then find no decoder
// is the cost the check exists to avoid. Deleting the object first is how that
// ordering is observable: reaching the download would fail with "not found".
test("ensureThumbnail gives up on a video before downloading it when ffmpeg is missing", async () => {
  process.env.FFMPEG_PATH = path.join(tmpdir(), "colosseum-absent-ffmpeg");

  const sha = await putBlob(Buffer.from("pretend-mov-bytes"), "video/quicktime", USERS.alice.id);
  const url = await createMedia(sha, USERS.alice.id, "public");
  const id = mediaIdFromUrl(url)!;
  await deleteObject(blobKey(sha));

  await expect(ensureThumbnail(sha, "video/quicktime")).rejects.toThrow(/ffmpeg is not available/);
  // Nothing written, nothing marked: the serving route keeps taking the lazy
  // path, and the card keeps falling back, until ffmpeg shows up.
  expect(await objectExists(thumbKey(sha))).toBe(false);
  expect((await getMedia(id))!.has_thumbnail).toBe(false);
});
