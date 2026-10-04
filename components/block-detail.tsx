import { GlobeIcon } from "lucide-react";
import Link from "next/link";

import ColumnComments from "@/components/column-comments";
import { Markdown } from "@/components/markdown";
import YouTubeBlock from "@/components/youtube-block";
import SpotifyBlock from "@/components/spotify-block";
import YouTubeChannelBlock from "@/components/youtube-channel-block";
import GitHubBlock from "@/components/github-block";
import InstagramBlock from "@/components/instagram-block";
import LinkPreviewEmpty from "@/components/link-preview-empty";
import PageHeader, { type Crumb } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import type { Column } from "@/lib/colosseum/column";
import { getScreenshot } from "@/lib/colosseum/screenshot-data";
import { screenshotSrc, spotifyEmbedRef, youtubeIdFromUrl } from "@/lib/utils";

// A block on a page of its own: the content, then an aside with its fields and
// comments. Rendered by the block permalink (/handle/channel/block) and by a
// share link's block pages, which differ in their breadcrumbs and in who may
// moderate the comments. Access is the caller's to check.
export default async function BlockDetail({
  column,
  crumbs,
  viewerId,
  isOwner,
}: {
  column: Column;
  crumbs: Crumb[];
  viewerId: string | null;
  // Manages the block's channel, which lets them delete any comment.
  isOwner: boolean;
}) {
  // URL blocks render their cached screenshot full-size when one exists.
  const screenshot = column.type === "url" && column.url ? await getScreenshot(column.url) : null;

  const imageSrc = screenshotSrc(screenshot?.image_url, screenshot?.captured_at);

  return (
    <div className="w-full p-6 sm:p-12 flex flex-col gap-8 lg:flex-1 lg:min-h-0 lg:overflow-hidden">
      <PageHeader crumbs={crumbs} />

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
          ) : column.type === "youtube_channel" ? (
            <div className="w-full max-w-xl mx-auto">
              <YouTubeChannelBlock
                url={column.url ?? ""}
                title={column.title ?? "YouTube channel"}
                description={column.description ?? undefined}
                image={column.image}
              />
            </div>
          ) : column.type === "github" ? (
            <div className="w-full max-w-xl mx-auto">
              <GitHubBlock
                url={column.url ?? ""}
                title={column.title ?? "GitHub"}
                description={column.description ?? undefined}
                image={column.image}
                language={column.text ?? undefined}
              />
            </div>
          ) : column.type === "instagram" ? (
            <div className="w-full max-w-xl mx-auto">
              <InstagramBlock
                url={column.url ?? ""}
                title={column.title ?? "Instagram"}
                description={column.description ?? undefined}
                image={column.image}
              />
            </div>
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
                {imageSrc ? (
                  <img
                    src={imageSrc}
                    alt={column.title ?? "Website screenshot"}
                    className="w-full rounded-md"
                  />
                ) : (
                  <LinkPreviewEmpty url={column.url} />
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
            <ColumnComments columnId={column.id} viewerId={viewerId} isOwner={isOwner} />
          </div>
        </aside>
      </div>
    </div>
  );
}
