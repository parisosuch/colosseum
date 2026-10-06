"use server";

// Server actions for the canvas page's block reads. Anyone who can read the
// channel may call them, signed out included on a public channel; the canvas
// itself decides who may place blocks, through the realtime server.

import { getSessionUser } from "@/lib/auth";
import {
  countUnplacedColumns,
  getChannelColumnsByIds,
  getUnplacedColumns,
  type UnplacedQuery,
} from "./canvas-blocks";
import { canReadChannel, getChannel, resolveChannelViewer } from "./channel";
import type { Column } from "./column";
import { resolveShareToken, shareColumn, shareCoversChannel } from "./share-link";
import { SIGNED_OUT, viewerScope } from "./viewer";

async function readableViewer(channelId: number) {
  const channel = await getChannel(channelId);
  if (!channel) throw new Error("Not found.");
  const user = await getSessionUser();
  const userId = user?.id ?? null;
  if (!canReadChannel(channel, await resolveChannelViewer(channel, userId))) {
    throw new Error("Not found.");
  }
  return viewerScope(userId);
}

// A channel share link stands in for a session on the canvas page it opens
// (/s/<token>/canvas). It has to resolve to a live link that covers the whole
// channel. Link holders read as a signed-out visitor, with media through the
// share route.
async function requireShare(channelId: number, token: string): Promise<void> {
  const share = await resolveShareToken(token);
  if (!share || !shareCoversChannel(share, channelId)) throw new Error("Not found.");
}

// The placed blocks the canvas needs to draw, by column id. `share` is a
// channel share-link token, for the link holder's canvas.
export async function getCanvasBlocksAction(
  channelId: number,
  ids: number[],
  share?: string,
): Promise<Column[]> {
  if (share) {
    await requireShare(channelId, share);
    const columns = await getChannelColumnsByIds(channelId, ids, SIGNED_OUT);
    return columns.map((c) => shareColumn(c, share));
  }
  const viewer = await readableViewer(channelId);
  return getChannelColumnsByIds(channelId, ids, viewer);
}

// One page of the sidebar. The first page (no cursor) also carries how many
// blocks match in all, for the "N not on the canvas" line.
export async function getUnplacedBlocksAction(
  channelId: number,
  query: UnplacedQuery,
  share?: string,
): Promise<{ columns: Column[]; count: number | null }> {
  if (share) await requireShare(channelId, share);
  const viewer = share ? SIGNED_OUT : await readableViewer(channelId);
  const [columns, count] = await Promise.all([
    getUnplacedColumns(channelId, query, viewer),
    query.before == null
      ? countUnplacedColumns(channelId, { placed: query.placed, search: query.search })
      : Promise.resolve(null),
  ]);
  return { columns: share ? columns.map((c) => shareColumn(c, share)) : columns, count };
}
