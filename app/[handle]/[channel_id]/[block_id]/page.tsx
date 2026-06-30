import { GlobeIcon } from "lucide-react";
import { Metadata } from "next";
import Link from "next/link";

import BrandLink from "@/components/brand-link";
import { getChannel } from "@/lib/colosseum/channel";
import { Column, getColumn } from "@/lib/colosseum/column";
import { createClient } from "@/lib/supabase/server";

type BlockPageParams = {
  params: Promise<{ handle: string; channel_id: string; block_id: string }>;
};

function blockLabel(column: Column): string {
  if (column.title) return column.title;
  if (column.type === "url") return column.url ?? "Link";
  if (column.type === "text") return "Text block";
  return "Block";
}

export async function generateMetadata({ params }: BlockPageParams): Promise<Metadata> {
  const { block_id } = await params;
  const supabase = await createClient();
  const column = await getColumn(supabase, parseInt(block_id, 10));
  if (!column) {
    return { title: "Block not found · Colosseum" };
  }
  return { title: `${blockLabel(column)} · Colosseum` };
}

export default async function BlockPage({ params }: BlockPageParams) {
  const { handle, channel_id, block_id } = await params;
  const channelId = parseInt(channel_id, 10);

  const supabase = await createClient();

  // RLS hides blocks in private channels from non-owners, so a null result (or
  // a block that belongs to a different channel than the URL claims) is treated
  // as not found rather than leaking its existence.
  const column = await getColumn(supabase, parseInt(block_id, 10));
  const notFound = !column || column.channel_id !== channelId;

  if (notFound) {
    return (
      <div className="w-full p-6 sm:p-12 space-y-8">
        <h1 className="text-4xl">
          <BrandLink /> <span className="font-extralight">/</span> block
        </h1>
        <p className="text-muted-foreground">This block doesn&apos;t exist.</p>
      </div>
    );
  }

  const channel = await getChannel(supabase, channelId);

  // URL blocks render their cached screenshot full-size when one exists.
  let screenshot: { image_url: string | null; captured_at: string | null } | null = null;
  if (column.type === "url" && column.url) {
    const { data } = await supabase
      .from("screenshot")
      .select("image_url, captured_at")
      .eq("url", column.url)
      .maybeSingle();
    screenshot = data;
  }

  const screenshotSrc =
    screenshot?.image_url && screenshot.captured_at
      ? `${screenshot.image_url}?v=${encodeURIComponent(screenshot.captured_at)}`
      : (screenshot?.image_url ?? null);

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <h1 className="text-4xl">
        <BrandLink /> <span className="font-extralight">/</span>{" "}
        <Link
          href={`/${handle}`}
          className="dark:text-white/75 text-black/75 hover:dark:text-white/100 hover:text-black/100"
        >
          {handle}
        </Link>{" "}
        <span className="font-extralight">/</span>{" "}
        <Link
          href={`/${handle}/${channel_id}`}
          className="dark:text-white/75 text-black/75 hover:dark:text-white/100 hover:text-black/100"
        >
          {channel?.title ?? "channel"}
        </Link>{" "}
        <span className="font-extralight">/</span> {blockLabel(column)}
      </h1>

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
            <h2 className="text-sm font-light">Title</h2>
            <p>{column.title || <span className="text-muted-foreground">No title</span>}</p>
          </div>
          <div className="flex flex-col">
            <h2 className="text-sm font-light">Description</h2>
            <p>
              {column.description || <span className="text-muted-foreground">No description</span>}
            </p>
          </div>
          <div className="flex flex-col">
            <h2 className="text-sm font-light">Created</h2>
            <p className="font-mono">{new Date(column.created_at).toDateString()}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
