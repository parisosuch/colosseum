import { and, desc, eq, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { channelCanvasVersion, owner } from "@/lib/db/schema";
import { getCanvasHistory, type CanvasHistoryApi } from "@/lib/realtime/canvas-history-registry";
import { canManageChannel, getChannel, viewerScope } from "./channel";

// Canvas version history, read and driven on behalf of a channel manager.
// History is managers-only (canManageChannel): viewing it, saving restore
// points and restoring. Everyone else backs out their own edits with undo.
//
// Each exported function takes the acting user's id, already resolved from the
// session by the server action, and checks it first. A channel the caller
// can't manage throws "Not found." whether it exists or not, like
// requireOwnedChannel in actions.ts.
//
// Writes go through the realtime server's history service (server.ts
// registers it), so a restore lands in the open room and its clients see it
// live. With no realtime server in the process (tests, scripts) they work on
// the stored doc instead.

export const MAX_RESTORE_POINT_NAME = 100;
export const CANVAS_VERSION_PAGE = 50;

export type CanvasVersion = {
  id: number;
  // Set for a named restore point, null for an automatic version.
  name: string | null;
  created_at: string;
  // Handle of whoever saved a named restore point.
  created_by: string | null;
  // Handles of who edited the canvas since the previous version, in the order
  // they first edited. Deleted accounts drop out.
  editors: string[];
  // The doc's size in bytes, uncompressed.
  size: number;
};

async function requireManager(userId: string | null, channelId: number): Promise<void> {
  const channel = await getChannel(channelId);
  if (!channel || !userId || !canManageChannel(channel, await viewerScope(userId))) {
    throw new Error("Not found.");
  }
}

async function history(): Promise<CanvasHistoryApi> {
  const live = getCanvasHistory();
  if (live) return live;
  const { storedCanvasHistory } = await import("@/lib/realtime/canvas-history-store");
  return storedCanvasHistory(process.env.DATABASE_URL!);
}

async function selectVersions(
  channelId: number,
  where: { id?: number; before?: number; limit: number },
): Promise<CanvasVersion[]> {
  const v = channelCanvasVersion;
  const rows = await db
    .select({
      id: v.id,
      name: v.name,
      created_at: v.created_at,
      created_by: owner.handle,
      editors: sql<string[]>`array(
        select o.handle
        from unnest(${v.editors}) with ordinality as e(user_id, n)
        join ${owner} o on o.user_id = e.user_id
        order by e.n
      )`,
      // octet_length reads a compressed bytea's raw size from its header
      // without decompressing it.
      size: sql<number>`octet_length(${v.doc})`.mapWith(Number),
    })
    .from(v)
    .leftJoin(owner, eq(owner.user_id, v.created_by))
    .where(
      and(
        eq(v.channel_id, channelId),
        where.id !== undefined ? eq(v.id, where.id) : undefined,
        where.before !== undefined ? lt(v.id, where.before) : undefined,
      ),
    )
    .orderBy(desc(v.id))
    .limit(where.limit);
  return rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
}

async function getVersion(channelId: number, id: number): Promise<CanvasVersion> {
  const [version] = await selectVersions(channelId, { id, limit: 1 });
  if (!version) throw new Error("Not found.");
  return version;
}

// Newest first. Pass the last id of a page as `before` for the next one.
export async function listCanvasVersionsFor(
  userId: string | null,
  channelId: number,
  page: { before?: number; limit?: number } = {},
): Promise<CanvasVersion[]> {
  await requireManager(userId, channelId);
  // Both come from the client as-is; anything but an integer would reach the
  // query and fail there with a raw SQL error.
  const before = page?.before ?? undefined;
  if (before !== undefined && !Number.isSafeInteger(before)) throw new Error("Invalid page.");
  const want = page?.limit ?? CANVAS_VERSION_PAGE;
  if (!Number.isSafeInteger(want)) throw new Error("Invalid page.");
  const limit = Math.min(Math.max(1, want), CANVAS_VERSION_PAGE);
  return selectVersions(channelId, { before, limit });
}

// One version's doc for a read-only preview: a Yjs update, base64-encoded,
// that the client applies to an empty Y.Doc. Block elements for blocks no
// longer in the channel are left out, as a restore would drop them.
export async function getCanvasVersionPreviewFor(
  userId: string | null,
  channelId: number,
  versionId: number,
): Promise<{ version: CanvasVersion; doc: string }> {
  await requireManager(userId, channelId);
  const doc = await (await history()).preview(channelId, versionId);
  if (!doc) throw new Error("Not found.");
  return {
    version: await getVersion(channelId, versionId),
    doc: Buffer.from(doc).toString("base64"),
  };
}

export async function saveCanvasRestorePointFor(
  userId: string | null,
  channelId: number,
  name: string,
): Promise<CanvasVersion> {
  await requireManager(userId, channelId);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Restore point needs a name.");
  if (trimmed.length > MAX_RESTORE_POINT_NAME) {
    throw new Error(`Restore point name is too long (max ${MAX_RESTORE_POINT_NAME} characters).`);
  }
  const id = await (await history()).saveRestorePoint(channelId, trimmed, userId!);
  if (id === null) throw new Error("Not found.");
  return getVersion(channelId, id);
}

// Restore the canvas to a version. The state it replaces is saved first as an
// automatic version, returned as `backup`.
export async function restoreCanvasVersionFor(
  userId: string | null,
  channelId: number,
  versionId: number,
): Promise<{ backup: CanvasVersion; removedElements: number }> {
  await requireManager(userId, channelId);
  const result = await (await history()).restore(channelId, versionId, userId!);
  if (!result) throw new Error("Not found.");
  return {
    backup: await getVersion(channelId, result.backupId),
    removedElements: result.removedElements,
  };
}
