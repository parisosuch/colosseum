import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ChannelBoard from "@/components/channel-board";
import { PAGE_SIZE } from "@/lib/pagination";
import {
  canContributeChannel,
  canReadChannel,
  getChannel,
  getUserChannels,
} from "@/lib/colosseum/channel";
import { isChannelMember, listChannelMembers } from "@/lib/colosseum/member";
import { getPublicUserProfile } from "@/lib/colosseum/user";
import { channelPreviewMeta } from "@/lib/colosseum/channel-meta";
import { blockPreviewMeta } from "@/lib/colosseum/block-meta";
import { loadVisibleBlock } from "@/lib/colosseum/block-access";
import { getChannelColumnCount, getChannelColumns } from "@/lib/colosseum/column";
import {
  type ColumnScreenshot,
  getScreenshot,
  getScreenshotsForUrls,
} from "@/lib/colosseum/screenshot-data";
import { getSessionUser } from "@/lib/auth";

type ChannelPageParams = {
  params: Promise<{ handle: string; channel_id: string }>;
  // `?block=<id>` deep-links a block's modal open on top of the board. Shared
  // links use this form, so the channel is still there when the modal closes.
  searchParams: Promise<{ block?: string }>;
};

// The `?block=` id, or null when absent/malformed.
function deepLinkedBlockId(block: string | undefined): number | null {
  if (!block) return null;
  const id = parseInt(block, 10);
  return Number.isNaN(id) ? null : id;
}

// How many of a channel's newest blocks the share card looks through for a
// picture. Deep enough that a run of text blocks at the top doesn't cost the
// channel its card, shallow enough to stay one small query on a crawler's
// request.
const CARD_IMAGE_SCAN = 12;

// Rich link preview for a shared channel URL. Public channels only; the helper
// returns generic metadata for private/missing ones so nothing leaks.
export async function generateMetadata({
  params,
  searchParams,
}: ChannelPageParams): Promise<Metadata> {
  const { handle, channel_id } = await params;
  const id = parseInt(channel_id, 10);

  // A deep link shares one block, so it gets that block's card rather than the
  // channel's. loadVisibleBlock gates it, so a private block never leaks a
  // title here; an unreadable or bogus id just falls through to channel meta.
  const blockId = deepLinkedBlockId((await searchParams).block);
  if (blockId != null) {
    const found = await loadVisibleBlock(id, blockId);
    if (found) {
      const preview =
        found.column.type === "url" && found.column.url
          ? await getScreenshot(found.column.url)
          : null;
      return blockPreviewMeta({
        column: found.column,
        channel: found.channel,
        handle,
        previewUrl: preview?.image_url ?? null,
        previewDescription: preview?.description ?? null,
      });
    }
  }

  const channel = Number.isNaN(id) ? null : await getChannel(id);
  // Show what's in the channel. A block's own picture comes first — an image,
  // an Instagram post, a video's poster frame. A channel built out of links has
  // none of those, so fall back to the newest cached screenshot among its URL
  // blocks, which is the picture a visitor actually sees on those cards. Only
  // when the newest few blocks offer neither does this fall through to the site
  // card. Asked only on a public channel: a private one gets generic metadata
  // anyway, so the queries would answer nothing.
  let imageUrl: string | null = null;
  if (channel && !channel.private) {
    const recent = await getChannelColumns(channel.id, { limit: CARD_IMAGE_SCAN });
    imageUrl = recent.find((c) => c.image)?.image ?? null;

    if (!imageUrl) {
      const urls = recent.filter((c) => c.type === "url" && c.url).map((c) => c.url!);
      const shots = await getScreenshotsForUrls(urls);
      // Walk `urls`, not the map: it keeps the channel's own order, so the
      // newest block with a captured screenshot wins rather than whichever the
      // lookup happened to return first.
      imageUrl = urls.map((u) => shots.get(u)?.image_url).find(Boolean) ?? null;
    }
  }
  return channelPreviewMeta(channel, handle, imageUrl);
}

export default async function ChannelPage({ params, searchParams }: ChannelPageParams) {
  const { handle, channel_id } = await params;
  const id = parseInt(channel_id, 10);
  if (Number.isNaN(id)) redirect("/");

  // null = the channel doesn't exist; the visibility check below hides a private
  // channel from anyone but its owner. Don't leak which; redirect. Independent
  // of the session lookup, so resolve both together.
  const [channel, user] = await Promise.all([getChannel(id), getSessionUser()]);
  if (!channel) redirect("/");

  // Membership matters for reading a private channel and for adding to a public
  // or private one; open channels never gate on it. Resolve it once for both the
  // read gate and canContribute below.
  const isMember =
    channel.access !== "open" && user ? await isChannelMember(channel.id, user.id) : false;
  // Private channels are visible only to the owner or a member; hide the rest
  // (redirect, don't leak existence). Public/open are visible to all.
  if (!canReadChannel(channel, user?.id ?? null, isMember)) redirect("/");

  const isOwner = !!user && channel.owner_id === user.id;
  const isAdmin = !!user?.is_admin;
  const canContribute = canContributeChannel(channel, user?.id ?? null, isMember);

  // Server-render the first page of blocks (plus channel-wide count for the
  // meta panel) so the grid paints at first load instead of after a hydrate +
  // server-action round-trip. The client takes over for filtering/paging, and
  // starts on this same sort so the mount doesn't refetch what is already here.
  //
  // "manual" rather than "newest": an arrangement only its author can see is
  // not an arrangement. For a channel nobody has rearranged the two orders are
  // the same list — every block is placed at the head as it is added, and the
  // backfill placed the pre-existing ones newest-first — so this changes what a
  // visitor sees only once the owner has actually moved something.
  const [totalCount, initialColumns] = await Promise.all([
    getChannelColumnCount(id),
    getChannelColumns(id, { sort: "manual", limit: PAGE_SIZE }, user?.id ?? null),
  ]);

  const createdOnLabel = new Date(channel.created_at).toLocaleString("default", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // These four reads are mutually independent, so run them together instead of
  // serializing the round-trips.
  const [initialScreenshots, myChannels, members, ownerProfile] = await Promise.all([
    // Cached previews for the first page's URL blocks, so screenshots render at
    // first paint too. URLs without a cached row are simply absent; the board's
    // hydrate/poll effect fetches those.
    getScreenshotsForUrls(
      initialColumns.filter((c) => c.type === "url" && c.url).map((c) => c.url!),
    ).then((shots) => [...shots.entries()]),
    // The logged-in user's own channels back two pickers: the block modal's
    // "Move" (owner only) and "Connect to channel" (any viewer can nest this channel
    // into one of theirs). Skip the query when signed out.
    user
      ? getUserChannels(user.id).then((cs) =>
          cs.map((c) => ({ id: c.id, title: c.title, private: c.private })),
        )
      : Promise.resolve([] as { id: number; title: string; private: boolean }[]),
    // Collaborators shown on the board itself (not just settings). Only public
    // and private channels have a roster; open channels let anyone add.
    channel.access !== "open" ? listChannelMembers(id) : Promise.resolve([]),
    // Only rendered when the roster is non-empty, but it keys off the route's
    // handle alone — so it joins the batch rather than waiting on `members` to
    // find out whether it was needed. One query on a solo channel beats a whole
    // serialized round-trip on every channel that has members.
    getPublicUserProfile(handle),
  ]);

  // Shown beside the roster, so there's nothing to show without one.
  const ownerAvatarUrl = members.length > 0 ? (ownerProfile?.avatar_url ?? null) : null;

  // Resolve `?block=` server-side so a deep link paints with the modal already
  // open. Passed explicitly rather than left to the board to find in
  // `initialColumns`, because the block may be older than the first page — the
  // channel read above is capped at PAGE_SIZE. Re-gated here (not just in
  // generateMetadata) so a link to a block the viewer can't read opens the
  // channel with no modal instead of erroring.
  const blockId = deepLinkedBlockId((await searchParams).block);
  const deepLinked = blockId == null ? null : await loadVisibleBlock(id, blockId);
  const initialBlock = deepLinked?.column ?? null;
  // getScreenshot returns a row without its url; the board's map is keyed by
  // url and carries it on the value, so reshape rather than widen the type.
  const deepLinkedShot =
    initialBlock?.type === "url" && initialBlock.url ? await getScreenshot(initialBlock.url) : null;
  const initialBlockScreenshot: ColumnScreenshot | null =
    deepLinkedShot && initialBlock?.url
      ? {
          url: initialBlock.url,
          image_url: deepLinkedShot.image_url,
          title: deepLinkedShot.title,
          captured_at: deepLinkedShot.captured_at,
        }
      : null;

  return (
    <ChannelBoard
      channel={channel}
      handle={handle}
      isOwner={isOwner}
      isMember={isMember}
      isAdmin={isAdmin}
      canContribute={canContribute}
      user={user}
      initialCount={totalCount}
      newestAt={initialColumns[0]?.created_at ?? null}
      createdOnLabel={createdOnLabel}
      channels={myChannels}
      members={members}
      ownerAvatarUrl={ownerAvatarUrl}
      initialColumns={initialColumns}
      initialScreenshots={initialScreenshots}
      initialBlock={initialBlock}
      initialBlockScreenshot={initialBlockScreenshot}
    />
  );
}
