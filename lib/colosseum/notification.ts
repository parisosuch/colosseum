import "server-only";

import { cache } from "react";
import { and, desc, eq, gt, isNull, lt, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import {
  channel,
  column,
  comment,
  notification,
  user,
  userProfile,
  type EmailNotificationPrefs,
} from "@/lib/db/schema";
import { renderEmail, sendEmail } from "@/lib/email";
import { logError } from "@/lib/log";

import { blockLabel } from "./activity";

export const NOTIFICATION_PAGE = 30;

// One email per (recipient, type, channel, block) inside this window. A burst of
// comments on one block announces itself once; the in-app rows and the unread
// badge still fire per event, and the per-type toggles still apply.
export const EMAIL_QUIET_PERIOD_MINUTES = 15;

// How much of a comment body rides along in the row and the email.
const EXCERPT_LENGTH = 140;

// Block and channel titles are user-written and unvalidated for length, and a
// rendered message becomes an email subject line, so they're capped too. For a
// connect the host title comes from the actor, not the recipient.
const TITLE_LENGTH = 80;

export type NotificationType = "comment" | "mention" | "connect" | "member";

export type NotificationItem = {
  id: number;
  type: NotificationType;
  created_at: string;
  read: boolean;
  actor_handle: string;
  actor_avatar_url?: string;
  // Rendered attribution ("commented on ...") and a link to the subject.
  message: string;
  href: string;
  // The start of the comment body, for comment/mention. Absent on rows created
  // before notifications recorded which comment triggered them.
  excerpt?: string;
  // The subject block's image, for a thumbnail beside the actor's avatar.
  thumbnail_url?: string;
};

type NotificationRow = typeof notification.$inferSelect;

// One notification joined to everything needed to render it: the actor, the
// channel it points at and that channel's owner, the subject block, the linked
// channel behind a `channel` block, the comment body, and the recipient's own
// address and email toggles.
type JoinedNotification = {
  n: NotificationRow;
  actor_handle: string;
  actor_avatar_url: string | null;
  recipient_email: string | null;
  recipient_prefs: EmailNotificationPrefs | null;
  channel_title: string | null;
  channel_access: string | null;
  owner_handle: string | null;
  block_type: string | null;
  block_title: string | null;
  block_url: string | null;
  block_text: string | null;
  block_image: string | null;
  linked_channel_id: number | null;
  linked_channel_title: string | null;
  linked_owner_handle: string | null;
  comment_body: string | null;
};

// Every read of a notification needs the same joins, so both the feed and the
// outbound email share one query and differ only in their filter.
async function joinNotifications(
  where: SQL | undefined,
  limit: number,
): Promise<JoinedNotification[]> {
  const actor = alias(userProfile, "actor_profile");
  const recipient = alias(userProfile, "recipient_profile");
  const owner = alias(userProfile, "owner_profile");
  const linkedChannel = alias(channel, "linked_channel");
  const linkedOwner = alias(userProfile, "linked_owner_profile");
  return db
    .select({
      n: notification,
      actor_handle: actor.handle,
      actor_avatar_url: actor.avatar_url,
      recipient_email: user.email,
      recipient_prefs: recipient.email_notifications,
      channel_title: channel.title,
      channel_access: channel.access,
      owner_handle: owner.handle,
      block_type: column.type,
      block_title: column.title,
      block_url: column.url,
      block_text: column.text,
      block_image: column.image,
      linked_channel_id: linkedChannel.id,
      linked_channel_title: linkedChannel.title,
      linked_owner_handle: linkedOwner.handle,
      comment_body: comment.body,
    })
    .from(notification)
    .innerJoin(actor, eq(actor.user_id, notification.actor_id))
    .leftJoin(user, eq(user.id, notification.recipient_id))
    .leftJoin(recipient, eq(recipient.user_id, notification.recipient_id))
    .leftJoin(channel, eq(channel.id, notification.channel_id))
    .leftJoin(owner, eq(owner.user_id, channel.owner_id))
    .leftJoin(column, eq(column.id, notification.column_id))
    .leftJoin(linkedChannel, eq(linkedChannel.id, column.linked_channel_id))
    .leftJoin(linkedOwner, eq(linkedOwner.user_id, linkedChannel.owner_id))
    .leftJoin(comment, eq(comment.id, notification.comment_id))
    .where(where)
    .orderBy(desc(notification.created_at))
    .limit(limit);
}

// Cut to `max` characters, counting by code point rather than UTF-16 unit so an
// emoji straddling the boundary isn't split into a lone surrogate.
function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max).join("").trimEnd()}…` : s;
}

function quoted(title: string | null): string {
  return title ? `"${truncate(title, TITLE_LENGTH)}"` : "a channel";
}

// The subject block's display name, or null when the notification doesn't point
// at one (or the block predates the join, e.g. a `connect` row's channel block).
function subjectBlock(r: JoinedNotification): string | null {
  if (!r.block_type) return null;
  return blockLabel({
    type: r.block_type,
    title: r.block_title,
    url: r.block_url,
    text: r.block_text,
  });
}

// A `connect` notification is in the old shape when it has no column: those rows
// recorded the recipient's own channel in `channel_id` rather than the host, so
// they keep rendering the message and link they always did.
function isLegacyConnect(r: JoinedNotification): boolean {
  return r.n.type === "connect" && r.n.column_id === null;
}

// Adding a channel column only requires the *linked* channel to be public, so
// someone can file the recipient's channel inside a private channel of their
// own. The recipient is told their channel was used; the host is neither named
// nor linked, because they can't read it.
function hasPrivateHost(r: JoinedNotification): boolean {
  return r.n.type === "connect" && !isLegacyConnect(r) && r.channel_access === "private";
}

// What the actor did, from the recipient's point of view. The actor's handle is
// shown separately, so this is only the predicate.
function messageFor(r: JoinedNotification): string {
  const inChannel = r.channel_title ? ` in ${quoted(r.channel_title)}` : "";
  const block = subjectBlock(r);
  switch (r.n.type) {
    case "comment":
      return block ? `commented on ${quoted(block)}${inChannel}` : "commented on your block";
    case "mention":
      return block ? `mentioned you on ${quoted(block)}${inChannel}` : "mentioned you in a comment";
    case "connect": {
      if (isLegacyConnect(r)) return `connected to your channel ${quoted(r.channel_title)}`;
      const yours = quoted(r.linked_channel_title);
      return hasPrivateHost(r)
        ? `connected your channel ${yours} into a private channel`
        : `connected your channel ${yours} into ${quoted(r.channel_title)}`;
    }
    case "member":
      return `added you to ${quoted(r.channel_title)}`;
  }
}

// Deep link to the subject. Blocks live under the channel owner's handle; a
// notification without a resolvable channel falls back to the home page.
function hrefFor(r: JoinedNotification): string {
  // A connect lands on the host channel, where the recipient's channel now sits
  // as a column. A private host would put the recipient on a not-found page, so
  // those fall back to the recipient's own channel — where the notification used
  // to point, and somewhere they can always read.
  if (r.n.type === "connect" && !isLegacyConnect(r)) {
    if (hasPrivateHost(r)) {
      return r.linked_owner_handle && r.linked_channel_id !== null
        ? `/${r.linked_owner_handle}/${r.linked_channel_id}`
        : "/";
    }
    return r.owner_handle ? `/${r.owner_handle}/${r.n.channel_id}` : "/";
  }
  if (!r.owner_handle) return "/";
  return r.n.column_id !== null
    ? `/${r.owner_handle}/${r.n.channel_id}/${r.n.column_id}`
    : `/${r.owner_handle}/${r.n.channel_id}`;
}

// The head of a comment body, collapsed to one line so it fits a row and an
// email subject's worth of space.
function excerptFor(r: JoinedNotification): string | undefined {
  if (!r.comment_body) return undefined;
  const flat = r.comment_body.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return truncate(flat, EXCERPT_LENGTH);
}

function toItem(r: JoinedNotification): NotificationItem {
  return {
    id: r.n.id,
    type: r.n.type,
    created_at: r.n.created_at.toISOString(),
    read: r.n.read_at !== null,
    actor_handle: r.actor_handle,
    actor_avatar_url: r.actor_avatar_url ?? undefined,
    message: messageFor(r),
    href: hrefFor(r),
    excerpt: excerptFor(r),
    // Only image blocks have a thumbnail to serve; pdf/video reuse the same
    // field for a file the grid renders a placeholder for.
    thumbnail_url: r.block_type === "image" ? (r.block_image ?? undefined) : undefined,
  };
}

// True when this subject was already emailed inside the quiet period, so a burst
// of activity on one block doesn't send an email per event. Anchored on rows
// that actually went out (`email_sent_at`), not on rows that merely exist —
// otherwise sustained activity would suppress every email after the first.
async function inEmailQuietPeriod(n: NotificationRow): Promise<boolean> {
  const since = new Date(n.created_at.getTime() - EMAIL_QUIET_PERIOD_MINUTES * 60_000);
  const [row] = await db
    .select({ id: notification.id })
    .from(notification)
    .where(
      and(
        eq(notification.recipient_id, n.recipient_id),
        eq(notification.type, n.type),
        eq(notification.channel_id, n.channel_id),
        // A null column_id (channel-level notifications) matches another null.
        sql`${notification.column_id} IS NOT DISTINCT FROM ${n.column_id}`,
        lt(notification.id, n.id),
        gt(notification.email_sent_at, since),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// Best-effort email for a freshly created notification. Sends only when the
// recipient has this notification type's email toggle on (default), the subject
// is outside the quiet period, and a provider is configured (sendEmail no-ops
// otherwise). Returns whether it went out. Never throws.
async function emailNotification(n: NotificationRow): Promise<boolean> {
  const [row] = await joinNotifications(eq(notification.id, n.id), 1);
  if (!row || !row.recipient_email || !row.recipient_prefs?.[n.type]) return false;
  if (await inEmailQuietPeriod(n)) return false;

  const message = `@${row.actor_handle} ${messageFor(row)}`;
  const excerpt = excerptFor(row);
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const { html, text } = renderEmail({
    heading: "New on Colosseum",
    // The excerpt is user-written; renderEmail escapes what it interpolates.
    body: excerpt ? `${message}\n\n“${excerpt}”` : message,
    // Mirrors hrefFor: only a non-connect row with a block lands on one.
    buttonLabel: n.type !== "connect" && n.column_id !== null ? "View block" : "View channel",
    buttonUrl: base + hrefFor(row),
    footnote: "Turn these off anytime in your Colosseum settings.",
  });
  // The subject names what happened; the body carries the quote.
  await sendEmail({ to: row.recipient_email, subject: message, text, html });
  return true;
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
  comment_id?: number;
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
        comment_id: input.comment_id ?? null,
      })
      .returning();
    if (await emailNotification(row)) {
      await db
        .update(notification)
        .set({ email_sent_at: new Date() })
        .where(eq(notification.id, row.id));
    }
  } catch (e) {
    logError("notification", "Failed to create notification", e);
  }
}

// Cached per request: the top nav and the mobile bottom bar each badge the
// bell, and both render in the root layout on every route.
export const unreadNotificationCount = cache(async (userId: string): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(notification)
    .where(and(eq(notification.recipient_id, userId), isNull(notification.read_at)));
  return Number(row?.n ?? 0);
});

// One page of the recipient's notifications, newest first. `before` is a
// created_at ISO cursor for load-more. `unreadOnly` pages the unread rows on
// their own, so the Unread filter reaches every unread notification rather than
// whichever ones happen to sit in the pages the full list has loaded.
export async function listNotifications(
  userId: string,
  before?: string,
  options?: { unreadOnly?: boolean },
): Promise<NotificationItem[]> {
  const rows = await joinNotifications(
    and(
      eq(notification.recipient_id, userId),
      before ? lt(notification.created_at, new Date(before)) : undefined,
      options?.unreadOnly ? isNull(notification.read_at) : undefined,
    ),
    NOTIFICATION_PAGE,
  );
  return rows.map(toItem);
}

// Mark one notification read, on opening it. Scoped to the recipient so an id
// from someone else's feed matches nothing, and to unread rows so a re-open
// doesn't move the timestamp.
export async function markNotificationRead(userId: string, notificationId: number): Promise<void> {
  await db
    .update(notification)
    .set({ read_at: new Date() })
    .where(
      and(
        eq(notification.id, notificationId),
        eq(notification.recipient_id, userId),
        isNull(notification.read_at),
      ),
    );
}

// Mark every unread notification read. Returns nothing; the bell/count refresh
// on the next load.
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(notification)
    .set({ read_at: new Date() })
    .where(and(eq(notification.recipient_id, userId), isNull(notification.read_at)));
}
