import Link from "next/link";
import { LayersIcon, PlusIcon } from "lucide-react";

import type { ActivityItem } from "@/lib/colosseum/activity";
import { timeAgo } from "@/lib/utils";
import PageHeader from "@/components/page-header";

function ActivityRow({ item }: { item: ActivityItem }) {
  const href =
    item.kind === "block"
      ? `/${item.handle}/${item.channelId}/${item.blockId}`
      : `/${item.handle}/${item.channelId}`;

  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
    >
      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border text-muted-foreground">
        {item.kind === "block" ? (
          <PlusIcon className="size-4" />
        ) : (
          <LayersIcon className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">@{item.handle}</span>{" "}
          {item.kind === "block" ? (
            <>
              added <span className="text-muted-foreground">{item.label}</span> to{" "}
              <span className="font-medium">{item.channelTitle}</span>
            </>
          ) : (
            <>
              created <span className="font-medium">{item.channelTitle}</span>
            </>
          )}
        </p>
      </div>
      <span className="shrink-0 text-caption">{timeAgo(new Date(item.at))}</span>
    </Link>
  );
}

// The Explore page (the app's home for signed-in users): a feed of recent
// public activity across the whole invite-connected network.
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
        <div className="flex flex-col gap-2">
          {activity.map((item) => (
            <ActivityRow
              key={`${item.kind}-${item.channelId}-${item.blockId ?? "c"}`}
              item={item}
            />
          ))}
        </div>
      )}
    </div>
  );
}
