import { GlobeIcon } from "lucide-react";
import { Metadata } from "next";

import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Channel, getChannel } from "@/lib/colosseum/channel";
import { Column, getColumn } from "@/lib/colosseum/column";
import { getScreenshot } from "@/lib/colosseum/screenshot-data";
import { getSessionUser } from "@/lib/auth";

type BlockPageParams = {
  params: Promise<{ handle: string; channel_id: string; block_id: string }>;
};

function blockLabel(column: Column): string {
  if (column.title) return column.title;
  if (column.type === "url") return column.url ?? "Link";
  if (column.type === "text") return "Text block";
  return "Block";
}

// Resolve the block and its channel, enforcing visibility in app code (this
// connection bypasses RLS): a block is visible only when it belongs to the
// channel in the URL and that channel is public or owned by the viewer. Returns
// null for any not-found/hidden case so a private block is never leaked (not
// even its title, via metadata).
async function loadVisibleBlock(
  channelId: number,
  blockId: number,
): Promise<{ column: Column; channel: Channel } | null> {
  const column = await getColumn(blockId);
  if (!column || column.channel_id !== channelId) {
    return null;
  }
  const channel = await getChannel(channelId);
  if (!channel) {
    return null;
  }
  if (channel.private) {
    const user = await getSessionUser();
    if (!user || user.id !== channel.owner_id) {
      return null;
    }
  }
  return { column, channel };
}

export async function generateMetadata({ params }: BlockPageParams): Promise<Metadata> {
  const { channel_id, block_id } = await params;
  const found = await loadVisibleBlock(parseInt(channel_id, 10), parseInt(block_id, 10));
  if (!found) {
    return { title: "Block not found · Colosseum" };
  }
  return { title: `${blockLabel(found.column)} · Colosseum` };
}

export default async function BlockPage({ params }: BlockPageParams) {
  const { handle, channel_id, block_id } = await params;
  const channelId = parseInt(channel_id, 10);

  const found = await loadVisibleBlock(channelId, parseInt(block_id, 10));

  if (!found) {
    return (
      <div className="w-full p-6 sm:p-12 space-y-8">
        <PageHeader crumbs={[{ label: "block" }]} />
        <p className="text-muted-foreground">This block doesn&apos;t exist.</p>
      </div>
    );
  }

  const { column, channel } = found;

  // URL blocks render their cached screenshot full-size when one exists.
  const screenshot = column.type === "url" && column.url ? await getScreenshot(column.url) : null;

  const screenshotSrc =
    screenshot?.image_url && screenshot.captured_at
      ? `${screenshot.image_url}?v=${encodeURIComponent(screenshot.captured_at)}`
      : (screenshot?.image_url ?? null);

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <PageHeader
        crumbs={[
          { label: handle, href: `/${handle}` },
          { label: channel?.title ?? "channel", href: `/${handle}/${channel_id}` },
          { label: blockLabel(column) },
        ]}
      />

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-3/4">
          {column.type === "text" ? (
            <p className="whitespace-pre-wrap text-lg leading-relaxed">{column.text}</p>
          ) : column.type === "image" && column.image ? (
            <img
              src={column.image}
              alt={column.title ?? "Block image"}
              className="w-full rounded-lg"
            />
          ) : (
            <div className="space-y-3">
              <a
                href={column.url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-row space-x-2 items-center border rounded-md px-2 py-1 w-fit"
              >
                <GlobeIcon className="size-4" />
                <span className="font-mono break-all">{column.url}</span>
              </a>
              {screenshotSrc ? (
                <img
                  src={screenshotSrc}
                  alt={column.title ?? "Website screenshot"}
                  className="w-full rounded-lg border"
                />
              ) : (
                <div className="w-full rounded-md border p-4 text-center text-sm text-muted-foreground">
                  No screenshot available
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="w-full lg:w-1/4 space-y-4">
          <div className="flex flex-col">
            <h2 className="text-label">Title</h2>
            <p>{column.title || <span className="text-muted-foreground">No title</span>}</p>
          </div>
          <div className="flex flex-col">
            <h2 className="text-label">Description</h2>
            <p>
              {column.description || <span className="text-muted-foreground">No description</span>}
            </p>
          </div>
          {column.tags.length > 0 ? (
            <div className="flex flex-col">
              <h2 className="text-label">Tags</h2>
              <div className="flex flex-wrap gap-1 pt-1">
                {column.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    #{tag}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-col">
            <h2 className="text-label">Created</h2>
            <p className="font-mono">{new Date(column.created_at).toDateString()}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
