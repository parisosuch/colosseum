import { Metadata } from "next";

import BlockDetail from "@/components/block-detail";
import PageHeader from "@/components/page-header";
import { blockLabel, blockPreviewMeta } from "@/lib/colosseum/block-meta";
import { loadVisibleBlock } from "@/lib/colosseum/block-access";
import { canManageChannel, viewerScope } from "@/lib/colosseum/channel";
import { getScreenshot } from "@/lib/colosseum/screenshot-data";
import { getSessionUser } from "@/lib/auth";

type BlockPageParams = {
  params: Promise<{ handle: string; channel_id: string; block_id: string }>;
};

export async function generateMetadata({ params }: BlockPageParams): Promise<Metadata> {
  const { handle, channel_id, block_id } = await params;
  const found = await loadVisibleBlock(parseInt(channel_id, 10), parseInt(block_id, 10));
  if (!found) {
    return { title: "Column not found · Colosseum" };
  }
  // A URL block's card reuses the preview the block itself renders, along with
  // the page description captured beside it.
  const preview =
    found.column.type === "url" && found.column.url ? await getScreenshot(found.column.url) : null;
  return blockPreviewMeta({
    column: found.column,
    channel: found.channel,
    handle,
    previewUrl: preview?.image_url ?? null,
    previewDescription: preview?.description ?? null,
  });
}

export default async function BlockPage({ params }: BlockPageParams) {
  const { handle, channel_id, block_id } = await params;
  const channelId = parseInt(channel_id, 10);

  const found = await loadVisibleBlock(channelId, parseInt(block_id, 10));

  if (!found) {
    return (
      <div className="w-full p-6 sm:p-12 space-y-8">
        <PageHeader crumbs={[{ label: "column" }]} />
        <p className="text-muted-foreground">This column doesn&apos;t exist.</p>
      </div>
    );
  }

  const { column, channel } = found;
  const viewer = await getSessionUser();

  return (
    <BlockDetail
      column={column}
      crumbs={[
        { label: handle, href: `/${handle}` },
        { label: channel?.title ?? "channel", href: `/${handle}/${channel_id}` },
        { label: blockLabel(column) },
      ]}
      viewerId={viewer?.id ?? null}
      isOwner={canManageChannel(channel, await viewerScope(viewer?.id ?? null))}
    />
  );
}
