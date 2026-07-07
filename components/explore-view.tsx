import type { ReactNode } from "react";
import Link from "next/link";

import { ACTIVITY_PAGE, type ActivityItem } from "@/lib/colosseum/activity";
import { timeAgo } from "@/lib/utils";
import PageHeader from "@/components/page-header";
import ColumnPreview from "@/components/column-preview";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ExploreLoadMore } from "@/components/explore-load-more";
import { FeedBlockModal } from "@/components/feed-block-modal";

// The focal card: a large square framing the block/channel/avatar.
const FOCAL_CARD =
  "aspect-square w-full overflow-hidden rounded-lg border bg-card transition-colors group-hover:border-foreground/30";

// Stable, unique key for a feed item (used by the initial list and the
// appended load-more pages).
export function activityKey(item: ActivityItem): string {
  return `${item.kind}-${item.handle}-${item.column?.id ?? item.channelId ?? ""}`;
}

// The focal card for a "created a channel" item: the channel's title and
// description, shown the way a channel normally is (title heading + muted blurb).
function ChannelFocal({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
      <h2 className="text-heading">{title}</h2>
      {description ? (
        <p className="line-clamp-6 break-words text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

// A big centered avatar, for a "user joined" item.
function UserFocal({ handle, avatarUrl }: { handle: string; avatarUrl?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <Avatar className="size-40">
        <AvatarImage src={avatarUrl} alt={`@${handle}`} />
        <AvatarFallback className="text-4xl">{handle.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
    </div>
  );
}

// Sync on purpose: an async component here renders through an async boundary,
// and flex `gap` won't apply between such siblings. The async work (the URL
// screenshot fetch) lives in the nested ColumnPreview, which is fine.
export function ActivityRow({ item }: { item: ActivityItem }) {
  const userHref = `/${item.handle}`;
  const channelHref = `/${item.handle}/${item.channelId}`;

  // Per-kind: the verb, where the focal preview links, and what it shows.
  let verb: string;
  let focalHref: string;
  let focalAria: string;
  let focal: ReactNode;
  if (item.kind === "user") {
    verb = "joined";
    focalHref = userHref;
    focalAria = `@${item.handle}'s profile`;
    focal = <UserFocal handle={item.handle} avatarUrl={item.avatarUrl} />;
  } else if (item.kind === "block") {
    verb = "added to";
    focalHref = `/${item.handle}/${item.channelId}/${item.column!.id}`;
    focalAria = `${item.label} in ${item.channelTitle}`;
    focal = <ColumnPreview column={item.column!} />;
  } else {
    verb = "created";
    focalHref = channelHref;
    focalAria = `Channel ${item.channelTitle}`;
    focal = <ChannelFocal title={item.channelTitle!} description={item.channelDescription} />;
  }

  // Separate links (no single parent anchor — nested <a> is invalid): the
  // handle goes to the profile, the channel title to the channel, and the
  // focal preview to the block/channel/profile.
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      {/* Attribution leads, in the serif section-title style. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-title">
          <Link href={userHref} className="hover:underline">
            @{item.handle}
          </Link>{" "}
          <span className="font-normal text-muted-foreground">{verb}</span>
          {item.kind !== "user" ? (
            <>
              {" "}
              <Link href={channelHref} className="hover:underline">
                {item.channelTitle}
              </Link>
            </>
          ) : null}
        </p>
        <p className="text-caption">{timeAgo(new Date(item.at))}</p>
      </div>
      {/* The block / channel / profile is the focal point: large, centered.
          A block opens the shared modal (like the channel view); a channel or
          member navigates to its page. */}
      {item.kind === "block" ? (
        <FeedBlockModal
          column={item.column!}
          handle={item.handle}
          screenshot={item.screenshot}
          aria={focalAria}
        >
          <div className={FOCAL_CARD}>{focal}</div>
        </FeedBlockModal>
      ) : (
        <Link href={focalHref} aria-label={focalAria} className="group block w-full">
          <div className={FOCAL_CARD}>{focal}</div>
        </Link>
      )}
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
        // children don't in a centered column). Load-more appends its pages as
        // further siblings so they share the same spacing.
        <div className="flex flex-col items-center gap-16">
          {activity.map((item) => (
            <ActivityRow key={activityKey(item)} item={item} />
          ))}
          <ExploreLoadMore
            initialCursor={activity[activity.length - 1].at}
            initialHasMore={activity.length >= ACTIVITY_PAGE}
          />
        </div>
      )}
    </div>
  );
}
