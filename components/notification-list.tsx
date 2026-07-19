"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AtSign, Link2, MessageSquare, UserPlus } from "lucide-react";

import { listNotificationsAction, markNotificationsReadAction } from "@/lib/colosseum/actions";
import type { NotificationItem, NotificationType } from "@/lib/colosseum/notification";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserProfilePicture } from "@/components/user-profile-picture";

const ICON: Record<NotificationType, typeof MessageSquare> = {
  comment: MessageSquare,
  mention: AtSign,
  connect: Link2,
  member: UserPlus,
};

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
  const anyUnread = items.some((n) => !n.read);

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

  const markAllRead = async () => {
    setItems((cur) => cur.map((n) => ({ ...n, read: true })));
    await markNotificationsReadAction();
    // Refresh so the nav-bar bell drops its unread badge.
    router.refresh();
  };

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">No notifications yet.</p>;
  }

  return (
    <div className="flex flex-col">
      {anyUnread ? (
        <Button variant="ghost" className="mb-3 self-end" onClick={markAllRead}>
          Mark all read
        </Button>
      ) : null}
      <ul className="flex flex-col divide-y rounded-lg border">
        {items.map((n) => {
          const Icon = ICON[n.type];
          return (
            <li key={n.id} className={n.read ? "" : "bg-primary/5"}>
              <Link href={n.href} className="flex items-center gap-3 p-3">
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-primary"}`}
                />
                {n.read ? null : <span className="sr-only">Unread. </span>}
                <UserProfilePicture
                  avatarUrl={n.actor_avatar_url}
                  handle={n.actor_handle}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${n.read ? "text-muted-foreground" : "font-medium"}`}>
                    <span className="font-semibold text-foreground">@{n.actor_handle}</span>{" "}
                    {n.message}
                  </p>
                  <p className="text-caption">{timeAgo(new Date(n.created_at))}</p>
                </div>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <Button
          variant="secondary"
          className="mt-4 self-center"
          onClick={loadMore}
          disabled={loading}
        >
          {loading ? "Loading..." : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
