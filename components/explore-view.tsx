import type { ReactNode } from "react";
import Link from "next/link";

import { ACTIVITY_PAGE, groupActivity, type ActivityItem } from "@/lib/colosseum/activity";
import { timeAgo } from "@/lib/utils";
import PageHeader from "@/components/page-header";
import ColumnPreview from "@/components/column-preview";
import { UserProfilePicture } from "@/components/user-profile-picture";
import { ExploreLoadMore } from "@/components/explore-load-more";
import { FeedBlockModal } from "@/components/feed-block-modal";

// The focal card: a large square framing the block/channel/avatar.
const FOCAL_CARD =
  "aspect-square w-full overflow-hidden rounded-lg border bg-card transition-colors group-hover:border-foreground/30";

// Feed cards load their image eagerly until this many rows in; the rest wait
// until they're scrolled near.
const EAGER_FEED_CARDS = 2;

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
      <UserProfilePicture avatarUrl={avatarUrl} handle={handle} size="2xl" />
    </div>
  );
}

// A hover-underlined link and a muted connective word, for the attribution line.
const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="hover:underline">
    {children}
  </Link>
);
const Muted = ({ children }: { children: ReactNode }) => (
  <span className="font-normal text-muted-foreground">{children}</span>
);

// A burst of adds to one channel, as a 2×2 collage instead of one row per
// block. Each tile opens its own block; past four, the last cell becomes a
// "+N" link into the channel.
function ActivityCollage({
  group,
  viewerId,
  priority,
}: {
  group: ActivityItem[];
  viewerId: string | null;
  priority: boolean;
}) {
  const overflow = group.length > 4 ? group.length - 3 : 0;
  const shown = overflow ? group.slice(0, 3) : group;
  const first = group[0];
  const hostHref = `/${first.channelHandle ?? first.handle}/${first.channelId}`;

  return (
    <div className="grid grid-cols-2 gap-3">
      {shown.map((item) => (
        <FeedBlockModal
          key={item.column!.id}
          column={item.column!}
          handle={item.channelHandle ?? item.handle}
          screenshot={item.screenshot}
          aria={`${item.label} in ${item.channelTitle}`}
          viewerId={viewerId}
        >
          <div className={FOCAL_CARD}>
            <ColumnPreview column={item.column!} priority={priority} />
          </div>
        </FeedBlockModal>
      ))}
      {overflow ? (
        <Link
          href={hostHref}
          aria-label={`${overflow} more in ${first.channelTitle}`}
          className="group block w-full"
        >
          <div className={`${FOCAL_CARD} flex items-center justify-center`}>
            <span className="text-heading text-muted-foreground">+{overflow}</span>
          </div>
        </Link>
      ) : null}
    </div>
  );
}

// Sync on purpose: an async component here renders through an async boundary,
// and flex `gap` won't apply between such siblings. The async work (the URL
// screenshot fetch) lives in the nested ColumnPreview, which is fine.
export function ActivityRow({
  group,
  viewerId,
  priority = false,
}: {
  // One feed row: a single item, or a run of adds by the same person to the
  // same channel (see groupActivity), rendered as a collage.
  group: ActivityItem[];
  viewerId: string | null;
  // Set for the first rows of the initial feed; pages appended by load-more are
  // below the fold by definition and leave it off.
  priority?: boolean;
}) {
  const item = group[0];
  const grouped = group.length > 1;
  const isChannelColumn = item.kind === "block" && item.column?.type === "channel";
  const linked = item.column?.linked_channel;

  const userHref = `/${item.handle}`;
  // The channel it was added to / created. Channels live under their owner, so
  // this is the owner's handle — the actor may be a member who added to it.
  const hostHref = `/${item.channelHandle ?? item.handle}/${item.channelId}`;
  const linkedHref = linked ? `/${linked.handle}/${item.column!.linked_channel_id}` : hostHref;

  // Focal element, where it links, and its aria.
  let focal: ReactNode;
  let focalHref: string;
  let focalAria: string;
  if (item.kind === "user") {
    focal = <UserFocal handle={item.handle} avatarUrl={item.avatarUrl} />;
    focalHref = userHref;
    focalAria = `@${item.handle}'s profile`;
  } else if (isChannelColumn) {
    focal = <ChannelFocal title={linked?.title ?? "Channel"} description={linked?.description} />;
    focalHref = linkedHref;
    focalAria = `Channel ${linked?.title ?? ""}`;
  } else if (item.kind === "block") {
    focal = <ColumnPreview column={item.column!} priority={priority} />;
    focalHref = `${hostHref}/${item.column!.id}`;
    focalAria = `${item.label} in ${item.channelTitle}`;
  } else {
    focal = <ChannelFocal title={item.channelTitle!} description={item.channelDescription} />;
    focalHref = hostHref;
    focalAria = `Channel ${item.channelTitle}`;
  }

  // Only a plain block opens the modal; everything else navigates.
  const opensModal = !grouped && item.kind === "block" && !isChannelColumn;

  // Attribution, with every named channel/user resolving as its own link. The
  // actor's avatar sits inline right before their handle.
  const handleLink = (
    <A href={userHref}>
      <span className="whitespace-nowrap">
        {/* inline-block + align-middle centers the avatar on the text line
            without disturbing the surrounding baseline; the handle stays plain
            inline text so it sits on the same baseline as the other words. */}
        <span className="mr-1.5 inline-block align-middle">
          <UserProfilePicture avatarUrl={item.avatarUrl} handle={item.handle} size="sm" />
        </span>
        @{item.handle}
      </span>
    </A>
  );
  let attribution: ReactNode;
  if (item.kind === "user") {
    attribution = (
      <>
        {handleLink} <Muted>joined</Muted>
      </>
    );
  } else if (isChannelColumn) {
    attribution = (
      <>
        {handleLink} <Muted>connected</Muted>{" "}
        <A href={linkedHref}>{linked?.title ?? "a channel"}</A> <Muted>to</Muted>{" "}
        <A href={hostHref}>{item.channelTitle}</A>
      </>
    );
  } else if (item.kind === "block") {
    attribution = (
      <>
        {handleLink} <Muted>added {grouped ? `${group.length} items ` : ""}to</Muted>{" "}
        <A href={hostHref}>{item.channelTitle}</A>
      </>
    );
  } else {
    attribution = (
      <>
        {handleLink} <Muted>created</Muted> <A href={hostHref}>{item.channelTitle}</A>
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      {/* Attribution leads, in the serif section-title style. Plain inline text
          so the handle and connective words share one baseline; the avatar is
          the only non-text element and floats centered via align-middle. */}
      <div className="flex flex-col items-center justify-center gap-1 text-center">
        <p className="text-title">{attribution}</p>
        <p className="text-caption">{timeAgo(new Date(item.at))}</p>
      </div>
      {/* The focal point: a plain block opens the shared modal (like the channel
          view); a channel-column, created channel, or member navigates. */}
      {grouped ? (
        <ActivityCollage group={group} viewerId={viewerId} priority={priority} />
      ) : opensModal ? (
        <FeedBlockModal
          column={item.column!}
          handle={item.channelHandle ?? item.handle}
          screenshot={item.screenshot}
          aria={focalAria}
          viewerId={viewerId}
        >
          <div className={FOCAL_CARD}>{focal}</div>
        </FeedBlockModal>
      ) : (
        <Link href={focalHref} aria-label={focalAria} className="group block w-full">
          <div className={FOCAL_CARD}>{focal}</div>
        </Link>
      )}
      {/* A block's own title, shown under its card when it has one. */}
      {!grouped && item.kind === "block" && item.column?.title ? (
        <p className="-mt-2 text-center text-sm font-medium">{item.column.title}</p>
      ) : null}
    </div>
  );
}

// The Explore page: a feed of recent public activity across the whole invite-
// connected network, each item showing the block or channel as the focal point.
export default function ExploreView({
  activity,
  viewerId,
}: {
  activity: ActivityItem[];
  viewerId: string | null;
}) {
  return (
    <div className="w-full flex-1 p-6 sm:p-12 space-y-8">
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
          {groupActivity(activity).map((group, i) => (
            <ActivityRow
              key={activityKey(group[0])}
              group={group}
              viewerId={viewerId}
              // Feed cards are full-width and stacked, so only the top couple
              // are ever on screen at load.
              priority={i < EAGER_FEED_CARDS}
            />
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
