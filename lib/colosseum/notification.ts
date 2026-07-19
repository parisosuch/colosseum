import "server-only";

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { channel, notification, user, userProfile } from "@/lib/db/schema";
import { renderEmail, sendEmail } from "@/lib/email";
import { logError } from "@/lib/log";

export const NOTIFICATION_PAGE = 30;

export type NotificationType = "comment" | "mention" | "connect" | "member";

export type NotificationItem = {
  id: number;
  type: NotificationType;
  created_at: string;
  read: boolean;
  actor_handle: string;
  actor_avatar_url?: string;
  // Rendered attribution ("commented on your block") and a link to the subject.
  message: string;
  href: string;
};

type NotificationRow = typeof notification.$inferSelect;

// What the actor did, from the recipient's point of view. The actor's handle is
// shown separately, so this is only the predicate.
function messageFor(type: NotificationType, channelTitle: string | null): string {
  const title = channelTitle ? `"${channelTitle}"` : "a channel";
  switch (type) {
    case "comment":
      return "commented on your block";
    case "mention":
      return "mentioned you in a comment";
    case "connect":
      return `connected to your channel ${title}`;
    case "member":
      return `added you to ${title}`;
  }
}

// Deep link to the subject. Blocks live under the channel owner's handle; a
// notification without a resolvable channel falls back to the home page.
function hrefFor(
  ownerHandle: string | null,
  channelId: number | null,
  columnId: number | null,
): string {
  if (!ownerHandle || channelId === null) return "/";
  return columnId !== null
    ? `/${ownerHandle}/${channelId}/${columnId}`
    : `/${ownerHandle}/${channelId}`;
}

// Best-effort email for a freshly created notification. Sends only when the
// recipient has this notification type's email toggle on (default) and a
// provider is configured (sendEmail no-ops otherwise). Never throws.
async function emailNotification(n: NotificationRow): Promise<void> {
  const actor = alias(userProfile, "actor_profile");
  const recipient = alias(userProfile, "recipient_profile");
  const owner = alias(userProfile, "owner_profile");
  const [row] = await db
    .select({
      email: user.email,
      prefs: recipient.email_notifications,
      actor_handle: actor.handle,
      channel_title: channel.title,
      owner_handle: owner.handle,
    })
    .from(user)
    .innerJoin(recipient, eq(recipient.user_id, user.id))
    .innerJoin(actor, eq(actor.user_id, n.actor_id))
    .leftJoin(channel, eq(channel.id, n.channel_id))
    .leftJoin(owner, eq(owner.user_id, channel.owner_id))
    .where(eq(user.id, n.recipient_id))
    .limit(1);
  if (!row || !row.prefs[n.type]) return;

  const message = `@${row.actor_handle} ${messageFor(n.type, row.channel_title)}`;
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const { html, text } = renderEmail({
    heading: "New on Colosseum",
    body: message,
    buttonLabel: "View",
    buttonUrl: base + hrefFor(row.owner_handle, n.channel_id, n.column_id),
    footnote: "Turn these off anytime in your Colosseum settings.",
  });
  await sendEmail({ to: row.email, subject: message, text, html });
}

// Record a notification and (best-effort) email it. Self-notifications are
// skipped. Notifications are never allowed to break the action that triggered
// them, so all failures are swallowed and logged.
export async function createNotification(input: {
  recipient_id: string;
  actor_id: string;
  type: NotificationType;
  channel_id: number;
  column_id?: number;
}): Promise<void> {
  if (input.recipient_id === input.actor_id) return;
  try {
    const [row] = await db
      .insert(notification)
      .values({
        recipient_id: input.recipient_id,
        actor_id: input.actor_id,
        type: input.type,
        channel_id: input.channel_id,
        column_id: input.column_id ?? null,
      })
      .returning();
    await emailNotification(row);
  } catch (e) {
    logError("notification", "Failed to create notification", e);
  }
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(notification)
    .where(and(eq(notification.recipient_id, userId), isNull(notification.read_at)));
  return Number(row?.n ?? 0);
}

// One page of the recipient's notifications, newest first. `before` is a
// created_at ISO cursor for load-more.
export async function listNotifications(
  userId: string,
  before?: string,
): Promise<NotificationItem[]> {
  const actor = alias(userProfile, "actor_profile");
  const owner = alias(userProfile, "owner_profile");
  const rows = await db
    .select({
      n: notification,
      actor_handle: actor.handle,
      actor_avatar_url: actor.avatar_url,
      channel_title: channel.title,
      owner_handle: owner.handle,
    })
    .from(notification)
    .innerJoin(actor, eq(actor.user_id, notification.actor_id))
    .leftJoin(channel, eq(channel.id, notification.channel_id))
    .leftJoin(owner, eq(owner.user_id, channel.owner_id))
    .where(
      and(
        eq(notification.recipient_id, userId),
        before ? lt(notification.created_at, new Date(before)) : undefined,
      ),
    )
    .orderBy(desc(notification.created_at))
    .limit(NOTIFICATION_PAGE);

  return rows.map(({ n, actor_handle, actor_avatar_url, channel_title, owner_handle }) => ({
    id: n.id,
    type: n.type,
    created_at: n.created_at.toISOString(),
    read: n.read_at !== null,
    actor_handle,
    actor_avatar_url: actor_avatar_url ?? undefined,
    message: messageFor(n.type, channel_title),
    href: hrefFor(owner_handle, n.channel_id, n.column_id),
  }));
}

// Mark every unread notification read. Returns nothing; the bell/count refresh
// on the next load.
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(notification)
    .set({ read_at: new Date() })
    .where(and(eq(notification.recipient_id, userId), isNull(notification.read_at)));
}
