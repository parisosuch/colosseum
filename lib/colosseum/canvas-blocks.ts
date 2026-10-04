import "server-only";

// Block reads for the canvas page: the blocks its elements point at, and the
// unplaced-blocks sidebar. Callers authorize the channel first, like every
// other channel-scoped read here (see getChannelColumns).

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { channelCanvas, column } from "@/lib/db/schema";
import { columnFilters, toColumn, withCreators, withLinkedChannels, type Column } from "./column";
import { SIGNED_OUT, type ViewerScope } from "./viewer";

// More than any one request should ask for. The canvas batches its own lookups
// below this.
export const MAX_IDS = 1000;
export const MAX_UNPLACED_PAGE = 100;

// Whether the channel's canvas has anything on it, without loading the doc:
// the realtime server stores the flag with every save. A channel nobody has
// edited has no row, and a canvas emptied after editing keeps its row with the
// flag false.
export async function channelCanvasHasElements(channelId: number): Promise<boolean> {
  const [row] = await db
    .select({ hasElements: channelCanvas.has_elements })
    .from(channelCanvas)
    .where(eq(channelCanvas.channel_id, channelId))
    .limit(1);
  return row?.hasElements === true;
}

// Whether the channel page shows the canvas button. Editors always get it, to
// start a canvas. Everyone else gets it only when there's something on the
// canvas; an empty one isn't worth loading.
export async function showsCanvasButton(
  channelId: number,
  canContribute: boolean,
): Promise<boolean> {
  return canContribute || channelCanvasHasElements(channelId);
}

// Positive integer ids, once each. Anything else can't be a column id.
function validIds(ids: readonly number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function cleanIds(ids: readonly number[]): number[] {
  return validIds(ids).slice(0, MAX_IDS);
}

// The blocks with these ids that are in this channel. A canvas element can name
// any column id (the server doesn't validate elements), so the channel scope is
// what keeps one canvas from reading another channel's blocks. Ids that miss
// are simply absent.
export async function getChannelColumnsByIds(
  channelId: number,
  ids: readonly number[],
  viewer: ViewerScope = SIGNED_OUT,
): Promise<Column[]> {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return [];
  const rows = await db
    .select()
    .from(column)
    .where(and(eq(column.channel_id, channelId), inArray(column.id, wanted)));
  return withCreators(
    await withLinkedChannels(
      rows.map((r) => toColumn(r)),
      viewer,
    ),
  );
}

export type UnplacedQuery = {
  // Column ids already on the canvas, every one of them: there is no cap, since
  // a block left out would be listed as unplaced.
  placed: readonly number[];
  search?: string;
  // The id of the last block on the previous page.
  before?: number | null;
  limit?: number;
};

// The placed ids go to Postgres as one array parameter rather than one
// parameter each (drizzle's notInArray), so any number of them fits in a query.
// They're validated integers, so the array literal is safe to build.
function unplacedFilters(channelId: number, query: UnplacedQuery) {
  const placed = Array.isArray(query.placed) ? validIds(query.placed) : [];
  const filters = columnFilters(channelId, { search: query.search });
  if (placed.length > 0) {
    filters.push(sql`${column.id} <> all(${`{${placed.join(",")}}`}::bigint[])`);
  }
  return filters;
}

// One page of the channel's blocks that aren't on the canvas, newest first by
// id. Paged by cursor rather than offset: placing a block from the sidebar
// takes it out of the set, which would shift every later offset by one and
// skip a block. The id is the cursor because it is unique and increases with
// creation; created_at has microseconds that a JS Date can't carry back.
export async function getUnplacedColumns(
  channelId: number,
  query: UnplacedQuery,
  viewer: ViewerScope = SIGNED_OUT,
): Promise<Column[]> {
  const limit = Math.min(Math.max(1, query.limit ?? 40), MAX_UNPLACED_PAGE);
  const filters = unplacedFilters(channelId, query);
  if (query.before != null && Number.isSafeInteger(query.before)) {
    filters.push(lt(column.id, query.before));
  }
  const rows = await db
    .select()
    .from(column)
    .where(and(...filters))
    .orderBy(desc(column.id))
    .limit(limit);
  return withCreators(
    await withLinkedChannels(
      rows.map((r) => toColumn(r)),
      viewer,
    ),
  );
}

export async function countUnplacedColumns(
  channelId: number,
  query: Omit<UnplacedQuery, "before" | "limit">,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(column)
    .where(and(...unplacedFilters(channelId, query)));
  return row?.count ?? 0;
}
