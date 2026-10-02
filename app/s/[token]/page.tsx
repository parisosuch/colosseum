import type { Metadata } from "next";

import BlockDetail from "@/components/block-detail";
import ChannelBoard from "@/components/channel-board";
import { ShareProvider } from "@/components/share-context";
import ShareUnavailable from "@/components/share-unavailable";
import { PAGE_SIZE } from "@/lib/pagination";
import { blockLabel, blockPreviewMeta } from "@/lib/colosseum/block-meta";
import { channelPreviewMeta } from "@/lib/colosseum/channel-meta";
import { getChannelColumnCount, getChannelColumns, getColumn } from "@/lib/colosseum/column";
import { listChannelMembers } from "@/lib/colosseum/member";
import { getOwnerByHandle } from "@/lib/colosseum/owner";
import {
  type ColumnScreenshot,
  getScreenshot,
  getScreenshotsForUrls,
} from "@/lib/colosseum/screenshot-data";
import { type ResolvedShare, shareColumn, shareCoversBlock } from "@/lib/colosseum/share-link";
import { loadShare, shareChannelCardImage, shareOwnerHandle } from "@/lib/colosseum/share-page";
import { SIGNED_OUT } from "@/lib/colosseum/viewer";

// A share link: /s/<token>. A channel link opens the channel's board read-only,
// every block in it included (`?block=` opens one in the modal, as on the
// channel page). A block link opens that block alone. The link holder needs no
// account; whoever they are signed in as plays no part.

type SharePageParams = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ block?: string }>;
};

const NOT_FOUND_META: Metadata = {
  title: "Colosseum",
  robots: { index: false, follow: false },
};

// The `?block=` block, if the share covers it, as the link holder receives it.
async function deepLinkedBlock(share: ResolvedShare, raw: string | undefined) {
  const id = raw ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(id)) return null;
  const block = await getColumn(id);
  return block && shareCoversBlock(share, block) ? shareColumn(block, share.token) : null;
}

export async function generateMetadata({
  params,
  searchParams,
}: SharePageParams): Promise<Metadata> {
  const { token } = await params;
  const share = await loadShare(token);
  if (!share || share === "limited") return NOT_FOUND_META;
  const handle = await shareOwnerHandle(share.channel.owned_by);

  const block = share.block ?? (await deepLinkedBlock(share, (await searchParams).block)) ?? null;
  if (block) {
    const shown = shareColumn(block, token);
    const preview = shown.type === "url" && shown.url ? await getScreenshot(shown.url) : null;
    return blockPreviewMeta({
      column: shown,
      channel: share.channel,
      handle,
      previewUrl: preview?.image_url ?? null,
      previewDescription: preview?.description ?? null,
      shareUrl: share.block ? `/s/${token}` : `/s/${token}?block=${block.id}`,
    });
  }
  return channelPreviewMeta(
    share.channel,
    handle,
    await shareChannelCardImage(share),
    `/s/${token}`,
  );
}

export default async function SharePage({ params, searchParams }: SharePageParams) {
  const { token } = await params;
  const share = await loadShare(token);
  if (!share || share === "limited") return <ShareUnavailable limited={share === "limited"} />;

  const { channel } = share;
  const handle = await shareOwnerHandle(channel.owned_by);
  const scope = { token, base: `/s/${token}` };

  if (share.block) {
    const block = shareColumn(share.block, token);
    return (
      <ShareProvider share={scope}>
        <BlockDetail
          column={block}
          crumbs={[
            { label: handle, href: `/${handle}` },
            { label: channel.title },
            { label: blockLabel(block) },
          ]}
          viewerId={null}
          isOwner={false}
        />
      </ShareProvider>
    );
  }

  // The channel page's first paint, read as a signed-out visitor would see it
  // (a nested private channel stays a stub) and with media through the share.
  const [totalCount, firstPage, members, ownerProfile] = await Promise.all([
    getChannelColumnCount(channel.id),
    getChannelColumns(channel.id, { sort: "manual", limit: PAGE_SIZE }, SIGNED_OUT),
    channel.access !== "open" ? listChannelMembers(channel.id) : Promise.resolve([]),
    getOwnerByHandle(handle),
  ]);
  const initialColumns = firstPage.map((c) => shareColumn(c, token));
  const initialScreenshots = [
    ...(
      await getScreenshotsForUrls(
        initialColumns.filter((c) => c.type === "url" && c.url).map((c) => c.url!),
      )
    ).entries(),
  ];

  const initialBlock = await deepLinkedBlock(share, (await searchParams).block);
  const shot =
    initialBlock?.type === "url" && initialBlock.url ? await getScreenshot(initialBlock.url) : null;
  const initialBlockScreenshot: ColumnScreenshot | null =
    shot && initialBlock?.url
      ? {
          url: initialBlock.url,
          image_url: shot.image_url,
          title: shot.title,
          captured_at: shot.captured_at,
        }
      : null;

  const createdOnLabel = new Date(channel.created_at).toLocaleString("default", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <ShareProvider share={scope}>
      <ChannelBoard
        channel={channel}
        handle={handle}
        isOwner={false}
        isMember={false}
        isAdmin={false}
        canContribute={false}
        user={null}
        initialCount={totalCount}
        newestAt={initialColumns[0]?.created_at ?? null}
        createdOnLabel={createdOnLabel}
        channels={[]}
        members={members}
        ownerAvatarUrl={members.length > 0 ? (ownerProfile?.avatar_url ?? null) : null}
        initialColumns={initialColumns}
        initialScreenshots={initialScreenshots}
        initialBlock={initialBlock}
        initialBlockScreenshot={initialBlockScreenshot}
      />
    </ShareProvider>
  );
}
