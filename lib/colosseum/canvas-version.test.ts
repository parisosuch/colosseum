import { beforeAll, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { db } from "@/lib/db";
import { channelCanvas, channelCanvasVersion } from "@/lib/db/schema";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import { GROUPS, seed, USERS } from "@/scripts/seed";
import {
  getCanvasVersionPreviewFor,
  listCanvasVersionsFor,
  MAX_RESTORE_POINT_NAME,
  restoreCanvasVersionFor,
  saveCanvasRestorePointFor,
} from "./canvas-version";
import { createChannel } from "./channel";
import { setGroupRole } from "./group";

// No realtime server runs under `bun test`, so these exercise the stored-doc
// path. The live-room path is covered in lib/realtime/canvas-history.test.ts.

beforeAll(async () => {
  await seed();
});

function docWith(...ids: string[]): Uint8Array {
  const doc = new Y.Doc();
  for (const id of ids) {
    const el = new Y.Map<unknown>();
    el.set("type", "rect");
    el.set("x", 0);
    elementsOf(doc).set(id, el);
  }
  return Y.encodeStateAsUpdate(doc);
}

function idsOf(state: Uint8Array): string[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return [...elementsOf(doc).keys()].sort();
}

async function setCanvas(channelId: number, state: Uint8Array) {
  await db
    .insert(channelCanvas)
    .values({ channel_id: channelId, doc: state })
    .onConflictDoUpdate({ target: channelCanvas.channel_id, set: { doc: state } });
}

// Each action's error message, or "ok".
async function outcomes(calls: Record<string, () => Promise<unknown>>) {
  const out: Record<string, string> = {};
  for (const [name, call] of Object.entries(calls)) {
    out[name] = await call().then(
      () => "ok",
      (err: Error) => err.message,
    );
  }
  return out;
}

const REFUSED = {
  list: "Not found.",
  preview: "Not found.",
  save: "Not found.",
  restore: "Not found.",
};

let seq = 0;
async function channelOf(ownedBy: string, access: "open" | "public" | "private" = "open") {
  return createChannel({ title: `Versioned ${++seq}`, access, owned_by: ownedBy });
}

// Every action, called as `userId` on `channelId`.
function everyAction(userId: string | null, channelId: number, versionId: number) {
  return {
    list: () => listCanvasVersionsFor(userId, channelId),
    preview: () => getCanvasVersionPreviewFor(userId, channelId, versionId),
    save: () => saveCanvasRestorePointFor(userId, channelId, "Checkpoint"),
    restore: () => restoreCanvasVersionFor(userId, channelId, versionId),
  };
}

test("only a channel manager can list, preview, save or restore", async () => {
  const open = await channelOf(USERS.alice.ownerId, "open");
  await setCanvas(open.id, docWith("a"));
  const point = await saveCanvasRestorePointFor(USERS.alice.id, open.id, "Start");

  // Bob can edit an open channel's canvas, but its history is alice's.
  expect(await outcomes(everyAction(USERS.bob.id, open.id, point.id))).toEqual(REFUSED);
  expect(await outcomes(everyAction(null, open.id, point.id))).toEqual(REFUSED);
  // A channel that doesn't exist looks the same as one you can't manage.
  expect(await outcomes(everyAction(USERS.alice.id, 2 ** 40, point.id))).toEqual(REFUSED);

  const asOwner = everyAction(USERS.alice.id, open.id, point.id);
  expect((await asOwner.list()).length).toBe(1);
  expect(idsOf(Buffer.from((await asOwner.preview()).doc, "base64"))).toEqual(["a"]);
  expect((await asOwner.save()).name).toBe("Checkpoint");
  expect((await asOwner.restore()).backup.name).toBeNull();
  // The refused calls wrote nothing.
  expect((await asOwner.list()).length).toBe(3);
});

test("in a group's channel, admins manage history and plain members don't", async () => {
  const ch = await channelOf(GROUPS.studio.id, "public");
  await setCanvas(ch.id, docWith("a"));
  const point = await saveCanvasRestorePointFor(USERS.alice.id, ch.id, "Group start");

  expect(await outcomes(everyAction(USERS.bob.id, ch.id, point.id))).toEqual(REFUSED);

  await setGroupRole(GROUPS.studio.id, USERS.bob.id, "admin");
  try {
    const asAdmin = everyAction(USERS.bob.id, ch.id, point.id);
    expect((await asAdmin.list()).length).toBe(1);
    await asAdmin.preview();
    expect((await asAdmin.save()).created_by).toBe(USERS.bob.handle);
    await asAdmin.restore();
  } finally {
    await setGroupRole(GROUPS.studio.id, USERS.bob.id, "member");
  }
});

test("a version id from another channel is not found", async () => {
  const mine = await channelOf(USERS.alice.ownerId);
  const other = await channelOf(USERS.alice.ownerId);
  await setCanvas(mine.id, docWith("a"));
  const point = await saveCanvasRestorePointFor(USERS.alice.id, mine.id, "Mine");
  await expect(getCanvasVersionPreviewFor(USERS.alice.id, other.id, point.id)).rejects.toThrow(
    "Not found.",
  );
  await expect(restoreCanvasVersionFor(USERS.alice.id, other.id, point.id)).rejects.toThrow(
    "Not found.",
  );
});

test("versions list newest first with handles, editors and size, and page by id", async () => {
  const ch = await channelOf(USERS.alice.ownerId);
  const state = docWith("a", "b");
  const insert = (values: Partial<typeof channelCanvasVersion.$inferInsert>) =>
    db
      .insert(channelCanvasVersion)
      .values({ channel_id: ch.id, doc: state, editors: [], ...values })
      .returning({ id: channelCanvasVersion.id })
      .then(([r]) => r.id);

  const first = await insert({
    // Bob first, then alice, then someone whose account is gone.
    editors: [USERS.bob.id, USERS.alice.id, "99999999-9999-4999-8999-999999999999"],
  });
  const second = await insert({ name: "Named", created_by: USERS.alice.id });
  const third = await insert({});

  const all = await listCanvasVersionsFor(USERS.alice.id, ch.id);
  expect(all.map((v) => v.id)).toEqual([third, second, first]);
  expect(all[2]).toMatchObject({
    name: null,
    created_by: null,
    editors: [USERS.bob.handle, USERS.alice.handle],
    size: state.byteLength,
  });
  expect(all[1]).toMatchObject({ name: "Named", created_by: USERS.alice.handle, editors: [] });
  expect(typeof all[0].created_at).toBe("string");

  const page = await listCanvasVersionsFor(USERS.alice.id, ch.id, { before: second, limit: 5 });
  expect(page.map((v) => v.id)).toEqual([first]);
  const one = await listCanvasVersionsFor(USERS.alice.id, ch.id, { limit: 1 });
  expect(one.map((v) => v.id)).toEqual([third]);
});

test("a restore point needs a name of reasonable length", async () => {
  const ch = await channelOf(USERS.alice.ownerId);
  await expect(saveCanvasRestorePointFor(USERS.alice.id, ch.id, "   ")).rejects.toThrow(
    "needs a name",
  );
  await expect(
    saveCanvasRestorePointFor(USERS.alice.id, ch.id, "x".repeat(MAX_RESTORE_POINT_NAME + 1)),
  ).rejects.toThrow("too long");
  const ok = await saveCanvasRestorePointFor(USERS.alice.id, ch.id, "  Before the workshop  ");
  expect(ok.name).toBe("Before the workshop");
  expect(ok.created_by).toBe(USERS.alice.handle);
});

test("restore rewrites the stored canvas and keeps what it replaced", async () => {
  const ch = await channelOf(USERS.alice.ownerId);
  await setCanvas(ch.id, docWith("before"));
  const point = await saveCanvasRestorePointFor(USERS.alice.id, ch.id, "Good");

  // Rebuild the canvas from the stored doc so the change is a real edit on it.
  const [row] = await db.select().from(channelCanvas).where(eq(channelCanvas.channel_id, ch.id));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.doc);
  elementsOf(doc).delete("before");
  elementsOf(doc).set("after", new Y.Map());
  await setCanvas(ch.id, Y.encodeStateAsUpdate(doc));

  const { backup, removedElements } = await restoreCanvasVersionFor(
    USERS.alice.id,
    ch.id,
    point.id,
  );
  expect(removedElements).toBe(1);
  const [restored] = await db
    .select()
    .from(channelCanvas)
    .where(eq(channelCanvas.channel_id, ch.id));
  expect(idsOf(restored.doc)).toEqual(["before"]);
  const preview = await getCanvasVersionPreviewFor(USERS.alice.id, ch.id, backup.id);
  expect(idsOf(Buffer.from(preview.doc, "base64"))).toEqual(["after"]);
  expect(preview.version.id).toBe(backup.id);
});
