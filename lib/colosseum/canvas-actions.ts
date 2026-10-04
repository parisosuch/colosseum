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
import { viewerScope } from "./viewer";

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

// The placed blocks the canvas needs to draw, by column id.
export async function getCanvasBlocksAction(channelId: number, ids: number[]): Promise<Column[]> {
  const viewer = await readableViewer(channelId);
  return getChannelColumnsByIds(channelId, ids, viewer);
}

// One page of the sidebar. The first page (no cursor) also carries how many
// blocks match in all, for the "N not on the canvas" line.
export async function getUnplacedBlocksAction(
  channelId: number,
  query: UnplacedQuery,
): Promise<{ columns: Column[]; count: number | null }> {
  const viewer = await readableViewer(channelId);
  const [columns, count] = await Promise.all([
    getUnplacedColumns(channelId, query, viewer),
    query.before == null
      ? countUnplacedColumns(channelId, { placed: query.placed, search: query.search })
      : Promise.resolve(null),
  ]);
  return { columns, count };
}
