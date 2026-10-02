import type { Metadata } from "next";

import BlockDetail from "@/components/block-detail";
import PageHeader from "@/components/page-header";
import { ShareProvider } from "@/components/share-context";
import ShareUnavailable from "@/components/share-unavailable";
import { blockLabel, blockPreviewMeta } from "@/lib/colosseum/block-meta";
import { getColumn } from "@/lib/colosseum/column";
import { getScreenshot } from "@/lib/colosseum/screenshot-data";
import { type ResolvedShare, shareColumn, shareCoversBlock } from "@/lib/colosseum/share-link";
import { loadShare, shareOwnerHandle } from "@/lib/colosseum/share-page";

// One block of a shared channel on a page of its own: /s/<token>/<block_id>,
// the share-link counterpart of /handle/channel/block. Any block the link
// covers opens here; anything else is not found.

type ShareBlockParams = { params: Promise<{ token: string; block_id: string }> };

async function sharedBlock(share: ResolvedShare, raw: string) {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) return null;
  const block = await getColumn(id);
  return block && shareCoversBlock(share, block) ? shareColumn(block, share.token) : null;
}

export async function generateMetadata({ params }: ShareBlockParams): Promise<Metadata> {
  const { token, block_id } = await params;
  const share = await loadShare(token);
  const block = share && share !== "limited" ? await sharedBlock(share, block_id) : null;
  if (!share || share === "limited" || !block) {
    return { title: "Colosseum", robots: { index: false, follow: false } };
  }
  const preview = block.type === "url" && block.url ? await getScreenshot(block.url) : null;
  return blockPreviewMeta({
    column: block,
    channel: share.channel,
    handle: await shareOwnerHandle(share.channel.owned_by),
    previewUrl: preview?.image_url ?? null,
    previewDescription: preview?.description ?? null,
    shareUrl: `/s/${token}/${block.id}`,
  });
}

export default async function ShareBlockPage({ params }: ShareBlockParams) {
  const { token, block_id } = await params;
  const share = await loadShare(token);
  if (!share || share === "limited") return <ShareUnavailable limited={share === "limited"} />;

  const block = await sharedBlock(share, block_id);
  if (!block) {
    return (
      <div className="w-full p-6 sm:p-12 space-y-8">
        <PageHeader crumbs={[{ label: "column" }]} />
        <p className="text-muted-foreground">This column doesn&apos;t exist.</p>
      </div>
    );
  }

  const handle = await shareOwnerHandle(share.channel.owned_by);
  // A channel link's blocks lead back to the shared board; a block link has no
  // board to go back to.
  const channelCrumb =
    share.link.block_id == null
      ? { label: share.channel.title, href: `/s/${token}` }
      : { label: share.channel.title };

  return (
    <ShareProvider share={{ token, base: `/s/${token}` }}>
      <BlockDetail
        column={block}
        crumbs={[{ label: handle, href: `/${handle}` }, channelCrumb, { label: blockLabel(block) }]}
        viewerId={null}
        isOwner={false}
      />
    </ShareProvider>
  );
}
