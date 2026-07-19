import { afterEach, beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/schema";
import { getUserChannels } from "./channel";
import {
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "./notification";

let channelId: number;

beforeAll(async () => {
  await seed();
  const channels = await getUserChannels(USERS.alice.id);
  channelId = channels[0].id;
});

afterEach(async () => {
  await db.delete(notification);
});

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
    type: "connect",
    channel_id: channelId,
  });
  const items = await listNotifications(USERS.bob.id);
  expect(items).toHaveLength(1);
  expect(items[0].actor_handle).toBe(USERS.alice.handle);
  expect(items[0].message).toContain("connected to your channel");
  expect(items[0].href).toBe(`/${USERS.alice.handle}/${channelId}`);
  expect(items[0].read).toBe(false);
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
