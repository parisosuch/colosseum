import { afterEach, beforeAll, expect, test } from "bun:test";

import { desc, eq } from "drizzle-orm";

import { BLOCKS, CHANNELS, seed, USERS } from "@/scripts/seed";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/schema";
import { createChannel, deleteChannel, getUserChannels } from "./channel";
import { addChannelColumn, deleteColumn, getChannelColumns, searchColumns } from "./column";
import { createComment, deleteComment } from "./comment";
import {
  createNotification,
  EMAIL_QUIET_PERIOD_MINUTES,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "./notification";

let channelId: number;
// Bob's public channel, used as the host a connect lands in.
let bobChannelId: number;
let blockId: number;
// A second block in the same channel, so the quiet period can be shown to be
// per-block rather than per-channel.
let otherBlockId: number;

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
  otherBlockId = (await getChannelColumns(channelId)).find((c) => c.id !== blockId)!.id;
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

// A private host no longer produces a notification at all, but the migration
// can repoint an older connect row onto one, so the rendering still has to keep
// the host out of the message and the link.
test("a connect into a private host names neither the host nor links to it", async () => {
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
    // And it is never named — bob learns his channel was used, not what it was
    // filed under.
    expect(item.message).not.toContain(CHANNELS.alicePrivate.title);
    expect(item.message).toBe(
      `connected your channel "${CHANNELS.bobPhoto.title}" into a private channel`,
    );
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
    column_id: otherBlockId,
  });
  expect(await emailSentAt(await lastNotificationId(USERS.alice.id))).not.toBeNull();

  // And a channel-level row (no block at all) is a subject of its own too — the
  // null column_id matches only another null.
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
  expect(await unreadNotificationCount(USERS.alice.id)).toBe(5);
});

test("deleting a comment keeps the notification and its quiet-period anchor", async () => {
  const created = await createComment({
    column_id: blockId,
    author_id: USERS.bob.id,
    body: "Typo here, reposting.",
  });
  await createNotification({
    recipient_id: USERS.alice.id,
    actor_id: USERS.bob.id,
    type: "comment",
    channel_id: channelId,
    column_id: blockId,
    comment_id: created.id,
  });
  const first = await lastNotificationId(USERS.alice.id);
  expect(await emailSentAt(first)).not.toBeNull();

  // The comment goes away; the notification does not. It loses its quote and
  // degrades to the one-line text, and it still anchors the quiet period — so
  // delete-and-repost can't email the recipient a second time.
  await deleteComment(created.id);
  expect(await unreadNotificationCount(USERS.alice.id)).toBe(1);
  const [item] = await listNotifications(USERS.alice.id);
  expect(item.excerpt).toBeUndefined();
  expect(item.message).toContain(`commented on "${BLOCKS.alicePublic}"`);
  expect(await emailSentAt(first)).not.toBeNull();

  const repost = await createComment({
    column_id: blockId,
    author_id: USERS.bob.id,
    body: "Typo fixed, reposting.",
  });
  try {
    await createNotification({
      recipient_id: USERS.alice.id,
      actor_id: USERS.bob.id,
      type: "comment",
      channel_id: channelId,
      column_id: blockId,
      comment_id: repost.id,
    });
    expect(await emailSentAt(await lastNotificationId(USERS.alice.id))).toBeNull();
  } finally {
    await deleteComment(repost.id);
  }
});

test("a long title is capped in the rendered message", async () => {
  // Channel titles aren't length-validated anywhere, and the message doubles as
  // an email subject, so an unbounded title can't ride into one.
  const host = await createChannel({
    title: "x".repeat(300),
    access: "public",
    owner_id: USERS.bob.id,
  });
  try {
    await createNotification({
      recipient_id: USERS.alice.id,
      actor_id: USERS.bob.id,
      type: "member",
      channel_id: host.id,
    });
    const [item] = await listNotifications(USERS.alice.id);
    expect(item.message.length).toBeLessThan(120);
    expect(item.message).toContain("…");
  } finally {
    await deleteChannel(host.id);
  }
});

test("an excerpt cut mid-emoji doesn't leave a broken character", async () => {
  // 139 characters, then an astral emoji straddling the 140-unit boundary.
  const created = await createComment({
    column_id: blockId,
    author_id: USERS.bob.id,
    body: `${"a".repeat(139)}🙂 and more after the cut`,
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
    expect(item.excerpt).toBe(`${"a".repeat(139)}🙂…`);
    // No lone surrogate survived the slice.
    expect(item.excerpt).not.toContain("�");
    expect(
      [...item.excerpt!].every((c) => c.codePointAt(0)! < 0xd800 || c.codePointAt(0)! > 0xdfff),
    ).toBe(true);
  } finally {
    await deleteComment(created.id);
  }
});

test("markNotificationRead clears one row, and only for its recipient", async () => {
  const notify = (channel: number) =>
    createNotification({
      recipient_id: USERS.bob.id,
      actor_id: USERS.alice.id,
      type: "member",
      channel_id: channel,
    });
  await notify(channelId);
  await notify(bobChannelId);
  expect(await unreadNotificationCount(USERS.bob.id)).toBe(2);

  const [newest] = await listNotifications(USERS.bob.id);
  await markNotificationRead(USERS.bob.id, newest.id);
  expect(await unreadNotificationCount(USERS.bob.id)).toBe(1);

  // The row stays in the feed, read; only the unread page drops it.
  expect(await listNotifications(USERS.bob.id)).toHaveLength(2);
  const unread = await listNotifications(USERS.bob.id, undefined, { unreadOnly: true });
  expect(unread).toHaveLength(1);
  expect(unread[0].id).not.toBe(newest.id);

  // Someone else's id doesn't reach it, so a stray id marks nothing.
  await markNotificationRead(USERS.alice.id, unread[0].id);
  expect(await unreadNotificationCount(USERS.bob.id)).toBe(1);
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
