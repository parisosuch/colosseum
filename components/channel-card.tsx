import Link from "next/link";
import type { ReactNode } from "react";

import ColumnPreview from "@/components/column-preview";
import { Badge } from "@/components/ui/badge";
import type { Channel, ProfileChannelEntry } from "@/lib/colosseum/channel";
import { Column, getTopColumnsByChannel } from "@/lib/colosseum/column";
import { getScreenshotsForUrls, type ColumnScreenshot } from "@/lib/colosseum/screenshot-data";

// How many block previews each channel card shows.
export const PREVIEWS_PER_CHANNEL = 5;

// Of those, how many load eagerly on the topmost card.
const EAGER_STRIP_PREVIEWS = 3;

// Grid-card border per access mode: private reads as "restricted" (red), open as
// "collaborative" (emerald), public as neutral.
const CHANNEL_CARD_CLASS = {
  private: "bg-red-500/5 border-red-500/50 hover:border-red-500",
  open: "bg-emerald-500/5 border-emerald-500/50 hover:border-emerald-500",
  public: "border-gray-500/50 hover:border-gray-500",
} as const;

// Previews are fetched once for a whole page of cards (batched) and passed in,
// so this is a plain sync component — no per-card query.
function ChannelColumnsView({
  channel,
  columnCount,
  columns,
  screenshots,
  memberOf,
  priority = false,
}: {
  channel: Channel;
  columnCount: number;
  columns: Column[];
  screenshots: Map<string, ColumnScreenshot>;
  memberOf?: boolean;
  // Set for the topmost channel card, the only one on screen before the viewer
  // scrolls. Its leading previews load eagerly; everything else is lazy.
  priority?: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row gap-8 p-2">
      <div className="flex flex-col justify-center items-center space-y-1 w-full md:w-[250px] md:h-[250px] shrink-0">
        <h2 className="text-heading text-center">{channel.title}</h2>
        {channel.description ? (
          <p className="text-center line-clamp-3 break-words max-w-full">{channel.description}</p>
        ) : null}
        <p className="text-caption">{columnCount} column(s)</p>
        {memberOf ? (
          <Badge variant="secondary" className="font-normal">
            member of
          </Badge>
        ) : null}
      </div>
      <div className="hidden md:flex gap-8 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {columns.map((column, i) => (
          <div
            key={column.id}
            className="border-2 rounded-md w-[200px] h-[200px] sm:w-[250px] sm:h-[250px] shrink-0"
          >
            <ColumnPreview
              column={column}
              screenshot={column.url ? (screenshots.get(column.url) ?? null) : null}
              // The strip scrolls horizontally at 250px a tile, so only the
              // leading few are on screen before the viewer scrolls it.
              priority={priority && i < EAGER_STRIP_PREVIEWS}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export type ChannelCard = { id: number; node: ReactNode };

// Render one page of profile grid cards, keyed by channel id so the (client)
// ChannelsView can place them in whatever order its filter/sort lands on while
// the previews stay server-fetched.
//
// The two queries are batched across the whole page rather than run per card: a
// single windowed top-N fetch for the previews, then one screenshot lookup for
// every url block in them. That batching is why the caller passes a slice —
// running it over every channel a prolific user owns is what makes a profile
// slow, so the page renders `CHANNELS_PAGE` at a time.
export async function buildChannelCards(
  entries: ProfileChannelEntry[],
  viewerId: string | null,
  countById: Map<number, number>,
  priorityFirst = false,
): Promise<ChannelCard[]> {
  if (entries.length === 0) return [];

  const previewsById = await getTopColumnsByChannel(
    entries.map((e) => e.channel.id),
    PREVIEWS_PER_CHANNEL,
    viewerId,
  );
  const previewUrls = [...previewsById.values()]
    .flat()
    .filter((c) => c.type === "url" && c.url)
    .map((c) => c.url!);
  const screenshots = await getScreenshotsForUrls(previewUrls);

  return entries.map(({ channel, handle: ownerHandle, memberOf }, cardIndex) => ({
    id: channel.id,
    // A tweet preview renders its own <a> (avatar/header links), so the card
    // link can't be an ancestor <a> without nesting them (invalid HTML that
    // breaks hydration). Use the "stretched link" pattern: an absolutely
    // positioned <Link> overlay that's a sibling of the previews, not their
    // parent. The previews are non-interactive (pointer-events-none), so the
    // overlay still catches every click while real link semantics are kept.
    node: (
      <div
        key={channel.id}
        className={`relative flex aspect-square items-center justify-center p-4 md:block md:aspect-auto md:p-8 border-2 rounded-lg transition-colors ${CHANNEL_CARD_CLASS[channel.access]}`}
      >
        <ChannelColumnsView
          channel={channel}
          columnCount={countById.get(channel.id) ?? 0}
          columns={previewsById.get(channel.id) ?? []}
          screenshots={screenshots}
          memberOf={memberOf}
          priority={priorityFirst && cardIndex === 0}
        />
        <Link
          href={`/${ownerHandle}/${channel.id}`}
          aria-label={channel.title}
          className="absolute inset-0 rounded-lg"
        />
      </div>
    ),
  }));
}
