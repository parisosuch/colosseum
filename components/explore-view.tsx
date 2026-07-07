import Link from "next/link";
import { LayersIcon } from "lucide-react";

import type { ActivityItem } from "@/lib/colosseum/activity";
import { timeAgo } from "@/lib/utils";
import PageHeader from "@/components/page-header";
import ColumnPreview from "@/components/column-preview";

// A big centered channel card, for a "created a channel" item.
function ChannelFocal({ title }: { title: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
      <LayersIcon className="size-8 text-muted-foreground" />
      <span className="font-medium">{title}</span>
      <span className="text-caption">new channel</span>
    </div>
  );
}

// Sync on purpose: an async component here renders through an async boundary,
// and flex `gap` won't apply between such siblings. The async work (the URL
// screenshot fetch) lives in the nested ColumnPreview, which is fine.
function ActivityRow({ item }: { item: ActivityItem }) {
  const isBlock = item.kind === "block";
  const userHref = `/${item.handle}`;
  const channelHref = `/${item.handle}/${item.channelId}`;
  const focalHref = isBlock ? `/${item.handle}/${item.channelId}/${item.column!.id}` : channelHref;
  const focalAria = isBlock
    ? `${item.label} in ${item.channelTitle}`
    : `Channel ${item.channelTitle}`;

  // Separate links (no single parent anchor — nested <a> is invalid): the
  // handle goes to the profile, the channel title to the channel, and the
  // focal preview to the block (or channel).
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      {/* Attribution leads, in the serif section-title style. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-title">
          <Link href={userHref} className="hover:underline">
            @{item.handle}
          </Link>{" "}
          <span className="font-normal text-muted-foreground">
            {isBlock ? "added to" : "created"}
          </span>{" "}
          <Link href={channelHref} className="hover:underline">
            {item.channelTitle}
          </Link>
        </p>
        <p className="text-caption">{timeAgo(new Date(item.at))}</p>
      </div>
      {/* The block/channel itself is the focal point: large, centered. */}
      <Link href={focalHref} aria-label={focalAria} className="group block w-full">
        <div className="aspect-square w-full overflow-hidden rounded-lg border bg-card transition-colors group-hover:border-foreground/30">
          {isBlock ? (
            <ColumnPreview column={item.column!} />
          ) : (
            <ChannelFocal title={item.channelTitle} />
          )}
        </div>
      </Link>
    </div>
  );
}

// The Explore page: a feed of recent public activity across the whole invite-
// connected network, each item showing the block or channel as the focal point.
export default function ExploreView({ activity }: { activity: ActivityItem[] }) {
  return (
    <div className="w-full flex-1 min-h-0 overflow-y-auto p-6 sm:p-12 space-y-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <PageHeader crumbs={[{ label: "Explore" }]} />
      <div className="space-y-1">
        <p className="text-muted-foreground">Recent activity from across Colosseum.</p>
      </div>

      {activity.length === 0 ? (
        <p className="text-muted-foreground">No activity yet.</p>
      ) : (
        // gap on the flex container spaces the items reliably (margins on the
        // children don't in a centered column).
        <div className="flex flex-col items-center gap-16">
          {activity.map((item) => (
            <ActivityRow
              key={`${item.kind}-${item.channelId}-${item.column?.id ?? "c"}`}
              item={item}
            />
          ))}
        </div>
      )}
    </div>
  );
}
