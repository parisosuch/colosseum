import { GlobeIcon } from "lucide-react";
import { Metadata } from "next";
import Link from "next/link";

import ColumnComments from "@/components/column-comments";
import { Markdown } from "@/components/markdown";
import YouTubeBlock from "@/components/youtube-block";
import SpotifyBlock from "@/components/spotify-block";
import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Channel, canReadChannel, getChannel } from "@/lib/colosseum/channel";
import { isChannelMember } from "@/lib/colosseum/member";
import { Column, getColumn } from "@/lib/colosseum/column";
import { getScreenshot } from "@/lib/colosseum/screenshot-data";
import { getSessionUser } from "@/lib/auth";
import { spotifyEmbedRef, youtubeIdFromUrl } from "@/lib/utils";

type BlockPageParams = {
  params: Promise<{ handle: string; channel_id: string; block_id: string }>;
};

function blockLabel(column: Column): string {
  if (column.title) return column.title;
  if (column.type === "url") return column.url ?? "Link";
  if (column.type === "text") return "Text column";
  if (column.type === "pdf") return "PDF column";
  if (column.type === "video") return "Video column";
  if (column.type === "youtube") return "YouTube video";
  if (column.type === "spotify") return "Spotify";
  return "Column";
}

// Resolve the block and its channel, enforcing visibility in app code (this
// connection bypasses RLS): a block is visible only when it belongs to the
// channel in the URL and that channel is public or owned by the viewer. Returns
// null for any not-found/hidden case so a private block is never leaked (not
// even its title, via metadata). A private channel is visible to its owner or an
// invited member; public/open channels to anyone.
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
  const user = channel.access === "private" ? await getSessionUser() : null;
  const isMember =
    channel.access === "private" && user ? await isChannelMember(channel.id, user.id) : false;
  if (!canReadChannel(channel, user?.id ?? null, isMember)) {
    return null;
  }
  return { column, channel };
}

export async function generateMetadata({ params }: BlockPageParams): Promise<Metadata> {
  const { channel_id, block_id } = await params;
  const found = await loadVisibleBlock(parseInt(channel_id, 10), parseInt(block_id, 10));
  if (!found) {
    return { title: "Column not found · Colosseum" };
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
        <PageHeader crumbs={[{ label: "column" }]} />
        <p className="text-muted-foreground">This column doesn&apos;t exist.</p>
      </div>
    );
  }

  const { column, channel } = found;
  const viewer = await getSessionUser();

  // URL blocks render their cached screenshot full-size when one exists.
  const screenshot = column.type === "url" && column.url ? await getScreenshot(column.url) : null;

  const screenshotSrc =
    screenshot?.image_url && screenshot.captured_at
      ? `${screenshot.image_url}?v=${encodeURIComponent(screenshot.captured_at)}`
      : (screenshot?.image_url ?? null);

  return (
    <div className="w-full p-6 sm:p-12 flex flex-col gap-8 lg:flex-1 lg:min-h-0 lg:overflow-hidden">
      <PageHeader
        crumbs={[
          { label: handle, href: `/${handle}` },
          { label: channel?.title ?? "channel", href: `/${handle}/${channel_id}` },
          { label: blockLabel(column) },
        ]}
      />

      <div className="flex flex-col lg:flex-row gap-8 lg:flex-1 lg:min-h-0">
        <div className="w-full lg:w-3/4 lg:min-h-0 lg:overflow-y-auto">
          {column.type === "text" ? (
            <Markdown text={column.text ?? ""} className="text-base leading-relaxed" />
          ) : column.type === "image" && column.image ? (
            <img
              src={column.image}
              alt={column.title ?? "Column image"}
              className="w-full rounded-lg"
            />
          ) : column.type === "pdf" && column.image ? (
            <object
              data={column.image}
              type="application/pdf"
              aria-label={column.title ?? "PDF"}
              className="h-[80vh] w-full rounded-lg border"
            >
              <a href={column.image} target="_blank" rel="noreferrer" className="underline">
                Open PDF
              </a>
            </object>
          ) : column.type === "video" && column.image ? (
            <video src={column.image} controls playsInline className="w-full rounded-lg">
              {/* User uploads carry no caption file; empty track satisfies a11y. */}
              <track kind="captions" />
            </video>
          ) : column.type === "youtube" ? (
            <YouTubeBlock id={youtubeIdFromUrl(column.url ?? "") ?? ""} />
          ) : column.type === "spotify" ? (
            <div className="w-full max-w-2xl mx-auto">
              <SpotifyBlock
                type={spotifyEmbedRef(column.url ?? "")?.type ?? ""}
                id={spotifyEmbedRef(column.url ?? "")?.id ?? ""}
                image={column.image}
              />
            </div>
          ) : (
            <a
              href={column.url}
              target="_blank"
              rel="noreferrer"
              className="block w-full max-w-3xl mx-auto"
            >
              <div className="flex flex-row items-center gap-2 border rounded-md px-2 py-1">
                <GlobeIcon className="size-4 shrink-0" />
                <span className="font-mono text-sm break-all">{column.url}</span>
              </div>
              <div className="mt-2 w-full">
                {screenshotSrc ? (
                  <img
                    src={screenshotSrc}
                    alt={column.title ?? "Website screenshot"}
                    className="w-full rounded-md"
                  />
                ) : (
                  <div className="w-full rounded-md border p-4 text-center text-sm text-muted-foreground">
                    No screenshot available
                  </div>
                )}
              </div>
            </a>
          )}
        </div>

        <aside className="w-full lg:w-1/4 flex flex-col gap-4 lg:min-h-0">
          <div className="space-y-4 lg:shrink-0 border rounded-lg p-4">
            <div className="flex flex-col">
              <h2 className="text-label">Title</h2>
              <p>{column.title || <span className="text-muted-foreground">No title</span>}</p>
            </div>
            <div className="flex flex-col">
              <h2 className="text-label">Description</h2>
              <p>
                {column.description || (
                  <span className="text-muted-foreground">No description</span>
                )}
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
            {column.created_by_handle ? (
              <div className="flex flex-col">
                <h2 className="text-label">Created by</h2>
                <Link href={`/${column.created_by_handle}`} className="hover:underline">
                  @{column.created_by_handle}
                </Link>
              </div>
            ) : null}
          </div>
          <div className="border rounded-lg lg:flex-1 lg:min-h-0 lg:overflow-hidden">
            <ColumnComments
              columnId={column.id}
              viewerId={viewer?.id ?? null}
              isOwner={channel.owner_id === viewer?.id}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
