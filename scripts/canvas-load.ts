// Load test for the canvas realtime server: one channel, N editors and M
// read-only viewers on stock y-websocket clients, against the canvas server in
// a child process whose CPU and memory are sampled from /proc.
//
//   bun scripts/canvas-load.ts [--editors 10] [--viewers 50] [--seconds 60] [--cursor-hz 20]
//
// The server child runs createCanvasServer exactly as server.ts does, minus
// Next and Postgres: authorize answers from the query string, and the store
// keeps docs in memory. So the numbers cover sync, awareness fan-out, identity
// stamping and the debounced snapshot encode, not the authorize round trip
// (connect time only) or the Postgres write (once a second at most).
//
// Clients run in their own child processes, five to a process, so they can't
// starve each other or the server of a core. Linux only (/proc).

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline";

import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { elementsOf } from "@/lib/realtime/canvas-doc";
import { createCanvasServer, type CanvasStore } from "@/lib/realtime/canvas-server";
import { MESSAGE_CHANNEL_EVENT } from "@/lib/realtime/protocol";

const CHANNEL = 1;
// A canvas that's been worked on for a while: 300 elements, a third of them
// strokes with points.
const STARTING_ELEMENTS = 300;
const CLIENTS_PER_PROCESS = 5;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

function element(doc: Y.Doc, id: string, i: number) {
  const el = new Y.Map<unknown>();
  el.set("type", i % 3 === 0 ? "stroke" : "rect");
  el.set("x", (i * 37) % 2000);
  el.set("y", (i * 53) % 2000);
  el.set("w", 120);
  el.set("h", 80);
  el.set("z", i);
  if (i % 3 === 0) {
    el.set(
      "points",
      Array.from({ length: 40 }, (_, k) => [k * 3, Math.round(Math.sin(k) * 20)]),
    );
  }
  elementsOf(doc).set(id, el);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// ---------------------------------------------------------------------------
// `serve`: the server.
// ---------------------------------------------------------------------------

function serve() {
  const seedDoc = new Y.Doc();
  for (let i = 0; i < STARTING_ELEMENTS; i++) element(seedDoc, `seed-${i}`, i);
  const docs = new Map<number, Uint8Array>([[CHANNEL, Y.encodeStateAsUpdate(seedDoc)]]);
  const store: CanvasStore = {
    load: async (id) => docs.get(id) ?? null,
    save: async (id, doc) => {
      docs.set(id, doc);
      return "ok";
    },
    columnIds: async () => new Set(),
  };
  const canvas = createCanvasServer({
    store,
    authorize: async (req) => {
      const params = new URL(req.url!, "http://x").searchParams;
      const user = params.get("user");
      return params.get("as") === "write"
        ? { access: "write", userId: user, handle: user, avatarUrl: null }
        : { access: "read", userId: null };
    },
  });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => {
    if (!canvas.handleUpgrade(req, socket, head)) socket.destroy();
  });
  server.listen(0, "127.0.0.1", () => {
    console.log(`PORT ${(server.address() as AddressInfo).port}`);
  });
}

// ---------------------------------------------------------------------------
// `clients`: a handful of editors or viewers. Prints READY once synced, starts
// editing on "go" and prints its stats as JSON on "stop".
// ---------------------------------------------------------------------------

async function clients() {
  const url = process.argv[3];
  const as = process.argv[4] as "write" | "read";
  const first = Number(process.argv[5]);
  const count = Number(process.argv[6]);
  const cursorHz = Number(process.argv[7]);

  const conns = Array.from({ length: count }, (_, k) => {
    const i = first + k;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(url, String(CHANNEL), doc, {
      params: { as, user: `${as}-${i}` },
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    provider.messageHandlers[MESSAGE_CHANNEL_EVENT] = () => {};
    return { i, doc, provider };
  });
  await Promise.all(
    conns.map(
      ({ provider }) =>
        new Promise<void>((resolve) =>
          provider.synced ? resolve() : provider.once("sync", () => resolve()),
        ),
    ),
  );

  // Edit-to-client latency: editor 0 stamps the wall clock on a probe element
  // and every other client notes when it lands.
  const latencies: number[] = [];
  for (const { doc } of conns) {
    elementsOf(doc).observeDeep(() => {
      const sent = elementsOf(doc).get("probe")?.get("sentAt") as number | undefined;
      if (sent && !(as === "write" && first === 0)) latencies.push(Date.now() - sent);
    });
  }

  const timers: ReturnType<typeof setInterval>[] = [];
  const start = () => {
    if (as !== "write") return;
    // Per editor:
    // - cursor: awareness at --cursor-hz
    // - selection: awareness change every 2s
    // - drag: one element's x/y at 10 Hz, in 2s bursts every 4s
    // - draw: a 40-point stroke every 5s
    for (const { i, doc, provider } of conns) {
      const own = `own-${i}`;
      element(doc, own, i);
      let t = 0;
      timers.push(
        setInterval(() => {
          t++;
          provider.awareness.setLocalStateField("cursor", {
            x: 500 + Math.round(Math.sin(t / 10 + i) * 300),
            y: 500 + Math.round(Math.cos(t / 10 + i) * 300),
          });
        }, 1000 / cursorHz),
        setInterval(() => {
          provider.awareness.setLocalStateField("selection", [`seed-${(t + i) % 300}`]);
        }, 2000),
        setInterval(() => {
          if (Math.floor(Date.now() / 2000) % 2 !== 0) return;
          doc.transact(() => {
            const el = elementsOf(doc).get(own)!;
            el.set("x", (t * 7) % 2000);
            el.set("y", (t * 11) % 2000);
            if (i === 0) {
              let probe = elementsOf(doc).get("probe");
              if (!probe) {
                probe = new Y.Map<unknown>();
                elementsOf(doc).set("probe", probe);
              }
              probe.set("sentAt", Date.now());
            }
          });
        }, 100),
        setInterval(() => element(doc, `stroke-${i}-${t}`, 0), 5000),
      );
    }
  };

  let cpuStart = process.cpuUsage();
  let startedAt = Date.now();
  console.log("READY");
  for await (const line of createInterface({ input: process.stdin })) {
    if (line === "go") {
      cpuStart = process.cpuUsage();
      startedAt = Date.now();
      start();
    } else if (line === "stop") {
      for (const timer of timers) clearInterval(timer);
      const used = process.cpuUsage(cpuStart);
      const seconds = (Date.now() - startedAt) / 1000;
      console.log(
        JSON.stringify({
          cpu: ((used.user + used.system) / 1e6 / seconds) * 100,
          latencies,
          elements: elementsOf(conns[0].doc).size,
          bytes: Y.encodeStateAsUpdate(conns[0].doc).byteLength,
        }),
      );
      for (const { provider } of conns) provider.destroy();
      process.exit(0);
    }
  }
}

// ---------------------------------------------------------------------------
// Default: run it all and sample the server.
// ---------------------------------------------------------------------------

const CLK_TCK = 100;

function cpuTicks(pid: number): number {
  const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
  // utime and stime are fields 14 and 15; this slice starts at field 3.
  return Number(fields[11]) + Number(fields[12]);
}

function rssMb(pid: number): number {
  const line = readFileSync(`/proc/${pid}/status`, "utf8")
    .split("\n")
    .find((l) => l.startsWith("VmRSS:"))!;
  return Number(line.split(/\s+/)[1]) / 1024;
}

async function sample(pid: number, seconds: number) {
  const cpu: number[] = [];
  const rss: number[] = [];
  let ticks = cpuTicks(pid);
  for (let s = 0; s < seconds; s++) {
    await sleep(1000);
    const now = cpuTicks(pid);
    cpu.push(((now - ticks) / CLK_TCK) * 100);
    ticks = now;
    rss.push(rssMb(pid));
  }
  const mean = cpu.reduce((a, b) => a + b, 0) / cpu.length;
  return (
    `CPU mean ${mean.toFixed(1)}% p95 ${percentile(cpu, 95).toFixed(1)}% ` +
    `max ${Math.max(...cpu).toFixed(1)}% of one core | ` +
    `RSS end ${rss.at(-1)!.toFixed(1)} MB max ${Math.max(...rss).toFixed(1)} MB`
  );
}

function lines(child: ChildProcess, onLine: (line: string) => void) {
  createInterface({ input: child.stdout! }).on("line", onLine);
}

async function main() {
  const editors = arg("editors", 10);
  const viewers = arg("viewers", 50);
  const seconds = arg("seconds", 60);
  const cursorHz = arg("cursor-hz", 20);
  const self = [import.meta.path];

  const server = spawn(process.execPath, [...self, "serve"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<number>((resolve) =>
    lines(server, (line) => {
      const match = /^PORT (\d+)/.exec(line);
      if (match) resolve(Number(match[1]));
    }),
  );
  const pid = server.pid!;
  const url = `ws://127.0.0.1:${port}/realtime/canvas`;
  console.log(
    `${editors} editors, ${viewers} viewers, cursors at ${cursorHz} Hz, ${seconds}s under load`,
  );
  console.log(`idle, no clients:      ${await sample(pid, 5)}`);

  const workers: { proc: ChildProcess; ready: Promise<void>; result: Promise<string> }[] = [];
  const launch = (as: "write" | "read", total: number) => {
    for (let first = 0; first < total; first += CLIENTS_PER_PROCESS) {
      const count = Math.min(CLIENTS_PER_PROCESS, total - first);
      const proc = spawn(
        process.execPath,
        [...self, "clients", url, as, String(first), String(count), String(cursorHz)],
        { stdio: ["pipe", "pipe", "inherit"] },
      );
      let ready!: () => void;
      let done!: (s: string) => void;
      const worker = {
        proc,
        ready: new Promise<void>((r) => (ready = r)),
        result: new Promise<string>((r) => (done = r)),
      };
      lines(proc, (line) => (line === "READY" ? ready() : line.startsWith("{") && done(line)));
      workers.push(worker);
    }
  };
  launch("write", editors);
  launch("read", viewers);
  await Promise.all(workers.map((w) => w.ready));
  console.log(`connected, no traffic: ${await sample(pid, 5)}`);

  for (const w of workers) w.proc.stdin!.write("go\n");
  console.log(`under load:            ${await sample(pid, seconds)}`);
  for (const w of workers) w.proc.stdin!.write("stop\n");

  const results = (await Promise.all(workers.map((w) => w.result))).map(
    (r) => JSON.parse(r) as { cpu: number; latencies: number[]; elements: number; bytes: number },
  );
  const latencies = results.flatMap((r) => r.latencies);
  console.log(
    `edit → client latency: p50 ${percentile(latencies, 50)} ms, p95 ${percentile(latencies, 95)} ms, ` +
      `p99 ${percentile(latencies, 99)} ms over ${latencies.length} deliveries`,
  );
  console.log(
    `busiest client process: ${Math.max(...results.map((r) => r.cpu)).toFixed(1)}% of one core`,
  );
  console.log(
    `doc at the end: ${results[0].elements} elements, ${(results[0].bytes / 1024).toFixed(0)} KB encoded`,
  );
  server.kill("SIGTERM");
  process.exit(0);
}

const mode = process.argv[2];
if (mode === "serve") serve();
else if (mode === "clients") await clients();
else await main();
