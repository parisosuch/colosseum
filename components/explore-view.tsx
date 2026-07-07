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

async function ActivityRow({ item }: { item: ActivityItem }) {
  const isBlock = item.kind === "block";
  const href = isBlock
    ? `/${item.handle}/${item.channelId}/${item.column!.id}`
    : `/${item.handle}/${item.channelId}`;
  const aria = isBlock
    ? `@${item.handle} added ${item.label} to ${item.channelTitle}`
    : `@${item.handle} created a channel, ${item.channelTitle}`;

  return (
    <Link
      href={href}
      aria-label={aria}
      className="group mx-auto flex w-full max-w-md flex-col gap-3"
    >
      {/* The block/channel itself is the focal point: large, centered. */}
      <div className="aspect-square w-full overflow-hidden rounded-lg border bg-card transition-colors group-hover:border-foreground/30">
        {isBlock ? (
          <ColumnPreview column={item.column!} />
        ) : (
          <ChannelFocal title={item.channelTitle} />
        )}
      </div>
      <p className="text-center text-caption">
        <span className="font-medium text-foreground">@{item.handle}</span>{" "}
        {isBlock ? "added to" : "created"}{" "}
        <span className="font-medium text-foreground">{item.channelTitle}</span> ·{" "}
        {timeAgo(new Date(item.at))}
      </p>
    </Link>
  );
}

// The Explore page: a feed of recent public activity across the whole invite-
// connected network, each item showing the block or channel as the focal point.
export default function ExploreView({ activity }: { activity: ActivityItem[] }) {
  return (
    <div className="w-full flex-1 min-h-0 overflow-y-auto p-6 sm:p-12 space-y-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <PageHeader crumbs={[{ label: "Explore" }]} />
      <div className="space-y-1">
        <h1 className="text-display">Explore</h1>
        <p className="text-muted-foreground">Recent activity from across Colosseum.</p>
      </div>

      {activity.length === 0 ? (
        <p className="text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="flex flex-col items-center gap-10">
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
