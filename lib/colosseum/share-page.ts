import { cache } from "react";

import { type ChannelQuery, parseChannelQuery } from "@/lib/canvas/channel-query";
import { PAGE_SIZE } from "@/lib/pagination";
import { type Column, getChannelColumnCount, getChannelColumns } from "./column";
import { ownerHandles } from "./channel";
import { getScreenshotsForUrls } from "./screenshot-data";
import { type ResolvedShare, resolveShareToken, shareColumn } from "./share-link";
import { SIGNED_OUT } from "./viewer";

// Shared by the /s/<token> pages and their metadata. Cached per request, so the
// page and generateMetadata resolve the token once between them.
export const loadShare = cache(
  async (token: string): Promise<ResolvedShare | null> => resolveShareToken(token),
);

// The handle of whoever owns the shared channel, for breadcrumbs and bylines.
export const shareOwnerHandle = cache(async (ownerId: string): Promise<string> => {
  return (await ownerHandles([ownerId])).get(ownerId) ?? "";
});

// How many of the channel's newest blocks the card looks through for a
// picture; the channel page scans the same depth.
const CARD_IMAGE_SCAN = 12;

// A picture for a shared channel's link preview: the newest block with media of
// its own (through the share's media route, so an unfurling server can fetch
// it), else the newest cached screenshot among its links.
export async function shareChannelCardImage(share: ResolvedShare): Promise<string | null> {
  const recent = await getChannelColumns(share.channel.id, { limit: CARD_IMAGE_SCAN }, SIGNED_OUT);
  const own = recent.find((c) => c.type === "image" && c.image);
  if (own) return shareColumn(own, share.token).image ?? null;
  const urls = recent.filter((c) => c.type === "url" && c.url).map((c) => c.url!);
  const shots = await getScreenshotsForUrls(urls);
  return urls.map((u) => shots.get(u)?.image_url).find(Boolean) ?? null;
}

export type ShareBoardFirstPage = {
  query: ChannelQuery;
  totalCount: number;
  // The first page under `query`, with media through the share.
  initialColumns: Column[];
  // How many blocks match when `query` filters anything, else null.
  filteredCount: number | null;
};

// A shared channel board's first paint under the URL's `?sort=&type=&q=&view=`,
// read the way the channel page reads it but as a signed-out visitor. The board
// writes those params as its controls change, so a reload or a copied link
// lands on the board as it was left.
export async function shareBoardFirstPage(
  share: ResolvedShare,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ShareBoardFirstPage> {
  const id = share.channel.id;
  const query = parseChannelQuery(searchParams);
  const filtered = query.q.trim() !== "" || query.type !== "all";
  const [totalCount, firstPage, filteredCount] = await Promise.all([
    getChannelColumnCount(id),
    getChannelColumns(
      id,
      { sort: query.sort, type: query.type, search: query.q, limit: PAGE_SIZE },
      SIGNED_OUT,
    ),
    filtered
      ? getChannelColumnCount(id, { type: query.type, search: query.q })
      : Promise.resolve(null),
  ]);
  return {
    query,
    totalCount,
    initialColumns: firstPage.map((c) => shareColumn(c, share.token)),
    filteredCount,
  };
}
