import { afterEach, beforeAll, expect, test } from "bun:test";

import { desc, eq } from "drizzle-orm";

import { BLOCKS, CHANNELS, seed, USERS } from "@/scripts/seed";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/schema";
import { getUserChannels } from "./channel";
import { addChannelColumn, deleteColumn, searchColumns } from "./column";
import { createComment, deleteComment } from "./comment";
import {
  createNotification,
  EMAIL_QUIET_PERIOD_MINUTES,
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "./notification";

let channelId: number;
// Bob's public channel, used as the host a connect lands in.
let bobChannelId: number;
let blockId: number;

beforeAll(async () => {
  await seed();
  const channels = await getUserChannels(USERS.alice.id);
  // BLOCKS.alicePublic lives in this channel, so one id covers both the
  // channel-level and block-level cases.
  channelId = channels.find((c) => c.title === CHANNELS.aliceDesign.title)!.id;
  const bobChannels = await getUserChannels(USERS.bob.id);
  bobChannelId = bobChannels.find((c) => c.title === CHANNELS.bobPhoto.title)!.id;
  const [hit] = await searchColumns(USERS.alice.id, BLOCKS.alicePublic);
  blockId = hit.id;
});

afterEach(async () => {
  await db.delete(notification);
});

// A notification is emailed only when it's outside the quiet period, and the
// send is recorded on the row. No mail provider is configured under test, so
// sendEmail no-ops — `email_sent_at` is what says the send was attempted.
async function emailSentAt(notificationId: number): Promise<Date | null> {
  const [row] = await db
    .select({ at: notification.email_sent_at })
    .from(notification)
    .where(eq(notification.id, notificationId));
  return row?.at ?? null;
}

// Newest row by id, so the assertions don't lean on created_at ordering when
// several notifications land in the same instant.
async function lastNotificationId(userId: string): Promise<number> {
  const [row] = await db
    .select({ id: notification.id })
    .from(notification)
    .where(eq(notification.recipient_id, userId))
    .orderBy(desc(notification.id))
    .limit(1);
  return row.id;
}

test("createNotification records a row and skips self-notifications", async () => {
  await createNotification({
    recipient_id: USERS.bob.id,
    actor_id: USERS.alice.id,
    type: "member",
    channel_id: channelId,
  });
  // Actor === recipient is a no-op.
  await createNotification({
    recipient_id: USERS.alice.id,
    actor_id: USERS.alice.id,
    type: "member",
    channel_id: channelId,
  });
  expect(await unreadNotificationCount(USERS.bob.id)).toBe(1);
  expect(await unreadNotificationCount(USERS.alice.id)).toBe(0);
});

test("listNotifications resolves actor, message, and a deep link", async () => {
  await createNotification({
    recipient_id: USERS.bob.id,
    actor_id: USERS.alice.id,
    type: "member",
    channel_id: channelId,
  });
  const items = await listNotifications(USERS.bob.id);
  expect(items).toHaveLength(1);
  expect(items[0].actor_handle).toBe(USERS.alice.handle);
  expect(items[0].message).toContain(`added you to "${CHANNELS.aliceDesign.title}"`);
  expect(items[0].href).toBe(`/${USERS.alice.handle}/${channelId}`);
  expect(items[0].read).toBe(false);
});

test("a connect links to the host channel and names both channels", async () => {
  // Alice adds bob's channel into her own; bob is told where it landed.
  const added = await addChannelColumn({
    created_by: USERS.alice.id,
    channel_id: channelId,
    linked_channel_id: bobChannelId,
  });
  try {
    await createNotification({
      recipient_id: USERS.bob.id,
      actor_id: USERS.alice.id,
      type: "connect",
      channel_id: channelId,
      column_id: added.id,
    });
    const [item] = await listNotifications(USERS.bob.id);
    expect(item.message).toBe(
      `connected your channel "${CHANNELS.bobPhoto.title}" into "${CHANNELS.aliceDesign.title}"`,
    );
    // Alice's channel, not bob's — that's where his channel now sits.
    expect(item.href).toBe(`/${USERS.alice.handle}/${channelId}`);
  } finally {
    await deleteColumn(added.id);
  }
});

test("a connect into a private host falls back to the recipient's own channel", async () => {
  const channels = await getUserChannels(USERS.alice.id);
  const privateId = channels.find((c) => c.title === CHANNELS.alicePrivate.title)!.id;
  const added = await addChannelColumn({
    created_by: USERS.alice.id,
    channel_id: privateId,
    linked_channel_id: bobChannelId,
  });
  try {
    await createNotification({
      recipient_id: USERS.bob.id,
      actor_id: USERS.alice.id,
      type: "connect",
      channel_id: privateId,
      column_id: added.id,
    });
    const [item] = await listNotifications(USERS.bob.id);
    // Bob can't read alice's private channel, so the link stays somewhere he can.
    expect(item.href).toBe(`/${USERS.bob.handle}/${bobChannelId}`);
  } finally {
    await deleteColumn(added.id);
  }
});

test("a connect recorded before the host was tracked keeps its old message and link", async () => {
  // No column_id: the pre-migration shape, where channel_id was the recipient's
  // own channel. It has to keep rendering what it always did.
  await createNotification({
    recipient_id: USERS.alice.id,
    actor_id: USERS.bob.id,
    type: "connect",
    channel_id: channelId,
  });
  const [item] = await listNotifications(USERS.alice.id);
  expect(item.message).toBe(`connected to your channel "${CHANNELS.aliceDesign.title}"`);
  expect(item.href).toBe(`/${USERS.alice.handle}/${channelId}`);
});

test("a comment notification names the block and quotes the comment", async () => {
  const created = await createComment({
    column_id: blockId,
    author_id: USERS.bob.id,
    body: "  Lovely  \n  framing on this one.  ",
  });
  try {
    await createNotification({
      recipient_id: USERS.alice.id,
      actor_id: USERS.bob.id,
      type: "comment",
      channel_id: channelId,
      column_id: blockId,
      comment_id: created.id,
    });
    const [item] = await listNotifications(USERS.alice.id);
    expect(item.message).toBe(
      `commented on "${BLOCKS.alicePublic}" in "${CHANNELS.aliceDesign.title}"`,
    );
    // Collapsed to one line so it fits a row.
    expect(item.excerpt).toBe("Lovely framing on this one.");
    expect(item.href).toBe(`/${USERS.alice.handle}/${channelId}/${blockId}`);
  } finally {
    await deleteComment(created.id);
  }
});

test("a comment notification with no comment recorded degrades to the old text", async () => {
  await createNotification({
    recipient_id: USERS.alice.id,
    actor_id: USERS.bob.id,
    type: "comment",
    channel_id: channelId,
    column_id: blockId,
  });
  const [item] = await listNotifications(USERS.alice.id);
  expect(item.excerpt).toBeUndefined();
  expect(item.message).toContain(`commented on "${BLOCKS.alicePublic}"`);
});

test("a burst on one block emails once, and a later comment emails again", async () => {
  const notify = () =>
    createNotification({
      recipient_id: USERS.alice.id,
      actor_id: USERS.bob.id,
      type: "comment",
      channel_id: channelId,
      column_id: blockId,
    });

  await notify();
  const first = await lastNotificationId(USERS.alice.id);
  expect(await emailSentAt(first)).not.toBeNull();

  // Second comment on the same block, moments later: recorded, not emailed.
  await notify();
  const second = await lastNotificationId(USERS.alice.id);
  expect(second).not.toBe(first);
  expect(await emailSentAt(second)).toBeNull();

  // A different block is a different subject, so it emails on its own.
  await createNotification({
    recipient_id: USERS.alice.id,
    actor_id: USERS.bob.id,
    type: "comment",
    channel_id: channelId,
  });
  expect(await emailSentAt(await lastNotificationId(USERS.alice.id))).not.toBeNull();

  // Push the emailed row back past the window; the next one emails again.
  await db
    .update(notification)
    .set({ email_sent_at: new Date(Date.now() - (EMAIL_QUIET_PERIOD_MINUTES + 1) * 60_000) })
    .where(eq(notification.id, first));
  await notify();
  expect(await emailSentAt(await lastNotificationId(USERS.alice.id))).not.toBeNull();

  // The badge still counts every event.
  expect(await unreadNotificationCount(USERS.alice.id)).toBe(4);
});

test("markAllNotificationsRead clears the unread count", async () => {
  await createNotification({
    recipient_id: USERS.bob.id,
    actor_id: USERS.alice.id,
    type: "member",
    channel_id: channelId,
  });
  await markAllNotificationsRead(USERS.bob.id);
  expect(await unreadNotificationCount(USERS.bob.id)).toBe(0);
  expect(await listNotifications(USERS.bob.id)).toHaveLength(1);
});
