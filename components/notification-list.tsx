"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AtSign, Bell, CheckCheck, Link2, MessageSquare, UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  listNotificationsAction,
  markNotificationReadAction,
  markNotificationsReadAction,
} from "@/lib/colosseum/actions";
import type { NotificationItem, NotificationType } from "@/lib/colosseum/notification";
import { cn, timeAgo } from "@/lib/utils";
import { GradientSpin } from "@/components/gradient-spin";
import { Button } from "@/components/ui/button";
import { UserProfilePicture } from "@/components/user-profile-picture";

const ICON: Record<NotificationType, typeof MessageSquare> = {
  comment: MessageSquare,
  mention: AtSign,
  connect: Link2,
  member: UserPlus,
};

type Filter = "all" | "unread";

// Calendar-day buckets so the list reads as a timeline, newest first. Items
// arrive newest-first, so buckets come out contiguous and in order.
function bucketLabel(iso: string): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(new Date(iso))) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  if (days < 30) return "This month";
  return "Older";
}

function groupByBucket(items: NotificationItem[]): [string, NotificationItem[]][] {
  const out: [string, NotificationItem[]][] = [];
  for (const n of items) {
    const label = bucketLabel(n.created_at);
    const last = out[out.length - 1];
    if (last && last[0] === label) last[1].push(n);
    else out.push([label, [n]]);
  }
  return out;
}

function Row({ n, onOpen }: { n: NotificationItem; onOpen: () => void }) {
  const Icon = ICON[n.type];
  return (
    <li
      className={cn(
        "transition-colors",
        n.read ? "hover:bg-muted/50" : "bg-primary/[0.04] hover:bg-primary/[0.08]",
      )}
    >
      {/* Opening the notification is what marks it read — the same click that
          navigates, so nothing is asked of the user beyond reading it. */}
      <Link href={n.href} onClick={onOpen} className="flex items-start gap-3 px-4 py-3">
        <div className="relative shrink-0">
          <UserProfilePicture avatarUrl={n.actor_avatar_url} handle={n.actor_handle} size="md" />
          {n.read ? null : (
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm leading-snug",
              n.read ? "text-muted-foreground" : "text-foreground",
            )}
          >
            <span className="font-semibold text-foreground">@{n.actor_handle}</span> {n.message}
          </p>
          {n.excerpt ? (
            <p className="mt-1 line-clamp-2 border-l-2 pl-2 text-sm text-muted-foreground">
              {n.excerpt}
            </p>
          ) : null}
          <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
            <Icon className="size-3.5 shrink-0" />
            <span className="text-xs tabular-nums">{timeAgo(new Date(n.created_at))}</span>
          </div>
        </div>
        {n.thumbnail_url ? (
          <img
            src={`${n.thumbnail_url}?thumb`}
            alt=""
            className="size-10 shrink-0 rounded-md border object-cover"
          />
        ) : null}
      </Link>
    </li>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-20 text-center">
      <Bell className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">
          {filter === "unread" ? "You're all caught up" : "No notifications yet"}
        </p>
        <p className="text-caption">
          {filter === "unread"
            ? "New unread notifications will appear here."
            : "Comments, mentions, and channel activity will show up here."}
        </p>
      </div>
    </div>
  );
}

// One filter's own run of pages. Unread is paged server-side rather than
// sifting whatever the full list has loaded, so it can reach an unread
// notification that sits a thousand rows down.
type Feed = { items: NotificationItem[]; hasMore: boolean };

export default function NotificationList({
  initial,
  pageSize,
  unreadCount: initialUnreadCount,
}: {
  initial: NotificationItem[];
  pageSize: number;
  unreadCount: number;
}) {
  const router = useRouter();
  const [feeds, setFeeds] = useState<Record<Filter, Feed>>({
    all: { items: initial, hasMore: initial.length === pageSize },
    // Nothing loaded yet: the first sentinel hit fetches page one, and a user
    // with nothing unread is spared the round trip.
    unread: { items: [], hasMore: initialUnreadCount > 0 },
  });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // The database's count, not the loaded rows': 90 unread behind a 30-row page
  // has to read 90. Moves optimistically as rows are marked read.
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const feed = feeds[filter];
  // The unread page is filtered server-side; this drops the rows marked read
  // since it loaded, so the filter never shows what it says it excludes.
  const shown = filter === "unread" ? feed.items.filter((n) => !n.read) : feed.items;
  const groups = groupByBucket(shown);

  const loadMore = async () => {
    setLoading(true);
    try {
      const cur = feeds[filter];
      const next = await listNotificationsAction(
        cur.items[cur.items.length - 1]?.created_at,
        filter === "unread",
      );
      setFeeds((f) => ({
        ...f,
        [filter]: {
          items: [...f[filter].items, ...next],
          hasMore: next.length === pageSize,
        },
      }));
    } finally {
      setLoading(false);
    }
  };

  // Auto-load the next page as the sentinel nears view — the list keeps filling
  // the viewport as you scroll, no stranded button. Both filters page: an empty
  // Unread view puts the sentinel on screen, which fetches its first page.
  useEffect(() => {
    if (!feed.hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, feed.hasMore, loading, feed.items.length]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading">
          Notifications
          {unreadCount > 0 ? (
            <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">
              {unreadCount} unread
            </span>
          ) : null}
        </h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5 text-sm">
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-3 py-1 capitalize transition-colors",
                  filter === f
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
          {unreadCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              <CheckCheck className="size-4" />
              Mark all read
            </Button>
          ) : null}
        </div>
      </div>

      {/* Empty only once there's nothing left to fetch — "You're all caught up"
          over a page that hasn't loaded yet would be the same lie as counting
          unread from the loaded rows. */}
      {shown.length === 0 && !feed.hasMore ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-8">
          {groups.map(([label, group]) => (
            <section key={label} className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </h3>
              <ul className="divide-y overflow-hidden rounded-xl border">
                {group.map((n) => (
                  <Row key={n.id} n={n} onOpen={() => markRead(n)} />
                ))}
              </ul>
            </section>
          ))}
          {feed.hasMore ? (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {/* The spinner also stands in for the whole list while the first
                  page of a filter is on its way. */}
              {loading || shown.length === 0 ? (
                <GradientSpin cellSize={4} pattern="arrow-down" />
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  // Flip one row's read flag in both feeds, so switching filters doesn't undo
  // what the other one showed.
  function setRead(id: number, read: boolean) {
    const flip = (items: NotificationItem[]) =>
      items.map((n) => (n.id === id ? { ...n, read } : n));
    setFeeds((f) => ({
      all: { ...f.all, items: flip(f.all.items) },
      unread: { ...f.unread, items: flip(f.unread.items) },
    }));
  }

  // The click that opens a notification also marks it read. It runs alongside
  // the navigation, so a failure rolls the row back rather than interrupting
  // with a toast the user has already scrolled away from.
  async function markRead(n: NotificationItem) {
    if (n.read) return;
    setRead(n.id, true);
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await markNotificationReadAction(n.id);
    } catch (e) {
      console.error(e);
      setRead(n.id, false);
      setUnreadCount((c) => c + 1);
    }
  }

  async function markAllRead() {
    const previous = feeds;
    const previousCount = unreadCount;
    setFeeds((f) => ({
      all: { ...f.all, items: f.all.items.map((n) => ({ ...n, read: true })) },
      // Nothing unread is left to page towards.
      unread: { items: f.unread.items.map((n) => ({ ...n, read: true })), hasMore: false },
    }));
    setUnreadCount(0);
    try {
      await markNotificationsReadAction();
      router.refresh();
    } catch (e) {
      console.error(e);
      setFeeds(previous);
      setUnreadCount(previousCount);
      toast.error("Couldn't mark those read. Please try again.");
    }
  }
}
