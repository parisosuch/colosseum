"use client";

import { useState } from "react";
import Link from "next/link";
import { AtSign, Link2, MessageSquare, UserPlus } from "lucide-react";

import { listNotificationsAction } from "@/lib/colosseum/actions";
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
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length === pageSize);
  const [loading, setLoading] = useState(false);

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

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">No notifications yet.</p>;
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y rounded-lg border">
        {items.map((n) => {
          const Icon = ICON[n.type];
          return (
            <li key={n.id} className={n.read ? "" : "bg-muted/40"}>
              <Link href={n.href} className="flex items-center gap-3 p-3">
                <UserProfilePicture
                  avatarUrl={n.actor_avatar_url}
                  handle={n.actor_handle}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">@{n.actor_handle}</span> {n.message}
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
