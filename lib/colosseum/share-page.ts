import { cache } from "react";

import { getChannelColumns } from "./column";
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
