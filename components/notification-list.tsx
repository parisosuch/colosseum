"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AtSign, Bell, CheckCheck, Link2, MessageSquare, UserPlus } from "lucide-react";

import { listNotificationsAction, markNotificationsReadAction } from "@/lib/colosseum/actions";
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

function Row({ n }: { n: NotificationItem }) {
  const Icon = ICON[n.type];
  return (
    <li
      className={cn(
        "transition-colors",
        n.read ? "hover:bg-muted/50" : "bg-primary/[0.04] hover:bg-primary/[0.08]",
      )}
    >
      <Link href={n.href} className="flex items-start gap-3 px-4 py-3">
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

export default function NotificationList({
  initial,
  pageSize,
}: {
  initial: NotificationItem[];
  pageSize: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length === pageSize);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const unreadCount = items.filter((n) => !n.read).length;
  const shown = filter === "unread" ? items.filter((n) => !n.read) : items;
  const groups = groupByBucket(shown);

  const loadMore = async () => {
    setLoading(true);
    try {
      const next = await listNotificationsAction(items[items.length - 1]?.created_at);
      setItems((cur) => [...cur, ...next]);
      setHasMore(next.length === pageSize);
    } finally {
      setLoading(false);
    }
  };

  // Auto-load the next page as the sentinel nears view — the list keeps filling
  // the viewport as you scroll, no stranded button. Only the full list paginates
  // (Unread filters already-loaded items).
  useEffect(() => {
    if (filter !== "all" || !hasMore || loading) return;
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
  }, [filter, hasMore, loading, items.length]);

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

      {shown.length === 0 ? (
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
                  <Row key={n.id} n={n} />
                ))}
              </ul>
            </section>
          ))}
          {filter === "all" && hasMore ? (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loading ? <GradientSpin cellSize={4} pattern="arrow-down" /> : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  async function markAllRead() {
    setItems((cur) => cur.map((n) => ({ ...n, read: true })));
    await markNotificationsReadAction();
    router.refresh();
  }
}
