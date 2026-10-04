import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { canvasThread, channel, comment, notification, user } from "@/lib/db/schema";
import { subscribeRealtime, type RealtimeEvent } from "@/lib/realtime/events";
import { BLOCKS, CHANNELS, COMMENTS, GROUP_CHANNELS, GROUPS, seed, USERS } from "@/scripts/seed";
import { deleteCommentFor, listCommentsFor } from "./api-auth";
import {
  checkThreadStartRate,
  deleteCanvasThreadComment,
  getCanvasThread,
  listChannelThreads,
  MISSING_AUTHOR_HANDLE,
  replyToCanvasThread,
  startCanvasThread,
  THREAD_PAGE,
  THREAD_START_LIMIT,
} from "./canvas-thread";
import { createChannel, deleteChannel, getChannel, viewerScope } from "./channel";
import { getColumn, searchColumns } from "./column";
import {
  createCommentWithNotices,
  getColumnComments,
  getCommentAuthorization,
  MAX_COMMENT_LENGTH,
  NO_PROFILE_COMMENT_ERROR,
} from "./comment";
import { listNotifications } from "./notification";

let aliceDesign = 0; // public, alice's: bob reads it but can't add to it
let alicePrivate = 0; // bob can't read it
let bobPhoto = 0; // public, bob's
let blockId = 0; // BLOCKS.alicePublic, in aliceDesign

async function channelId(title: string, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ id: channel.id })
    .from(channel)
    .where(and(eq(channel.title, title), eq(channel.owned_by, ownerId)));
  return row.id;
}

beforeAll(async () => {
  await seed();
  aliceDesign = await channelId(CHANNELS.aliceDesign.title, USERS.alice.ownerId);
  alicePrivate = await channelId(CHANNELS.alicePrivate.title, USERS.alice.ownerId);
  bobPhoto = await channelId(CHANNELS.bobPhoto.title, USERS.bob.ownerId);
  const [hit] = await searchColumns(await viewerScope(USERS.alice.id), BLOCKS.alicePublic);
  blockId = hit.id;
});

afterEach(async () => {
  await db.delete(canvasThread);
});

// Signed in but never onboarded: a `user` row with no `owner` row, so no
// handle. Not a seed fixture because the seed only makes finished accounts.
const NO_PROFILE = {
  id: "10000000-0000-4000-8000-0000000000aa",
  name: "No Profile",
  email: "no-profile@example.test",
};

async function ensureNoProfileUser() {
  await db
    .insert(user)
    .values({ ...NO_PROFILE, emailVerified: true })
    .onConflictDoNothing();
}

afterAll(async () => {
  await db.delete(user).where(eq(user.id, NO_PROFILE.id));
});

const point = { x: 100, y: -40 };
const onElement = { elementId: "el-1", offsetX: 5, offsetY: 6, x: 15, y: 26 };

// The notifications a comment produced, by recipient.
async function noticesFor(commentId: number) {
  const rows = await db
    .select({ recipient_id: notification.recipient_id, type: notification.type })
    .from(notification)
    .where(eq(notification.comment_id, commentId));
  return Object.fromEntries(rows.map((r) => [r.recipient_id, r.type]));
}

function collectEvents(): { events: RealtimeEvent[]; stop: () => void } {
  const events: RealtimeEvent[] = [];
  const stop = subscribeRealtime((e) => events.push(e));
  return { events, stop };
}

async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a rejection");
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test("a comment needs exactly one parent: a block or a thread", async () => {
  const [thread] = await db
    .insert(canvasThread)
    .values({ channel_id: aliceDesign, x: 0, y: 0 })
    .returning();
  const base = { author_id: USERS.alice.id, body: "x" };

  expect(await rejection(db.insert(comment).values(base))).toBeTruthy();
  expect(
    await rejection(
      db.insert(comment).values({ ...base, column_id: blockId, thread_id: thread.id }),
    ),
  ).toBeTruthy();

  const [onBlock] = await db
    .insert(comment)
    .values({ ...base, column_id: blockId })
    .returning();
  const [inThread] = await db
    .insert(comment)
    .values({ ...base, thread_id: thread.id })
    .returning();
  expect(onBlock.thread_id).toBeNull();
  expect(inThread.column_id).toBeNull();
  await db.delete(comment).where(eq(comment.id, onBlock.id));
});

test("deleting a thread takes its comments, and deleting the channel takes its threads", async () => {
  const doomed = await createChannel({
    title: "Threads doomed",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const thread = await startCanvasThread({
    channelId: doomed.id,
    userId: USERS.alice.id,
    anchor: point,
    body: "first",
  });
  await deleteChannel(doomed.id);
  expect(await db.select().from(canvasThread).where(eq(canvasThread.id, thread.id))).toEqual([]);
  expect(await db.select().from(comment).where(eq(comment.thread_id, thread.id))).toEqual([]);
});

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

test("start a thread on a point and on an element, then list them with starters", async () => {
  const free = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.alice.id,
    anchor: point,
    body: "  On empty space.  ",
  });
  expect(free).toMatchObject({
    channel_id: aliceDesign,
    element_id: null,
    offset_x: null,
    offset_y: null,
    x: 100,
    y: -40,
    created_by: USERS.alice.id,
    reply_count: 0,
  });
  expect(free.starter).toMatchObject({
    body: "On empty space.",
    author_handle: USERS.alice.handle,
  });

  const pinned = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.bob.id,
    anchor: onElement,
    body: "On a shape.",
  });
  expect(pinned).toMatchObject({ element_id: "el-1", offset_x: 5, offset_y: 6, x: 15, y: 26 });

  await replyToCanvasThread({ threadId: pinned.id, userId: USERS.alice.id, body: "Reply one" });
  await replyToCanvasThread({ threadId: pinned.id, userId: USERS.bob.id, body: "Reply two" });

  const listed = await listChannelThreads(aliceDesign, USERS.alice.id);
  expect(listed.map((t) => [t.id, t.reply_count, t.starter?.body])).toEqual([
    [free.id, 0, "On empty space."],
    [pinned.id, 2, "On a shape."],
  ]);
  expect(listed[1].starter?.author_handle).toBe(USERS.bob.handle);

  const full = await getCanvasThread(pinned.id, USERS.alice.id);
  expect(full.comments.map((c) => c.body)).toEqual(["On a shape.", "Reply one", "Reply two"]);
  expect(full.reply_count).toBe(2);
  expect(full.comments.every((c) => c.thread_id === pinned.id)).toBe(true);
});

test("a read-only viewer may start threads and reply; a non-reader may do neither", async () => {
  // bob reads alice's public channel but can't add blocks to it.
  const byViewer = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.bob.id,
    anchor: point,
    body: "Viewer here.",
  });
  await replyToCanvasThread({ threadId: byViewer.id, userId: USERS.bob.id, body: "Again." });

  const hidden = await startCanvasThread({
    channelId: alicePrivate,
    userId: USERS.alice.id,
    anchor: point,
    body: "Private thought.",
  });
  expect(
    await rejection(
      startCanvasThread({
        channelId: alicePrivate,
        userId: USERS.bob.id,
        anchor: point,
        body: "Let me in.",
      }),
    ),
  ).toBe("Not found.");
  expect(
    await rejection(replyToCanvasThread({ threadId: hidden.id, userId: USERS.bob.id, body: "Hi" })),
  ).toBe("Not found.");
  expect(await rejection(listChannelThreads(alicePrivate, USERS.bob.id))).toBe("Not found.");
  expect(await rejection(getCanvasThread(hidden.id, USERS.bob.id))).toBe("Not found.");
  expect(await rejection(getCanvasThread(hidden.id, null))).toBe("Not found.");
  expect(await rejection(getCanvasThread(999_999_999, USERS.alice.id))).toBe("Not found.");

  // Signed out still reads a public channel's threads, like its canvas.
  expect((await listChannelThreads(aliceDesign, null)).map((t) => t.id)).toEqual([byViewer.id]);
  expect((await getCanvasThread(byViewer.id, null)).comments).toHaveLength(2);
});

test("bodies are trimmed and capped, and anchors validated", async () => {
  const start = (anchor: unknown, body = "ok") =>
    startCanvasThread({
      channelId: aliceDesign,
      userId: USERS.alice.id,
      anchor: anchor as typeof point,
      body,
    });
  expect(await rejection(start(point, "   "))).toBe("Comment can't be empty.");
  expect(await rejection(start(point, "x".repeat(MAX_COMMENT_LENGTH + 1)))).toContain("too long");
  expect(await rejection(start({ x: Number.NaN, y: 0 }))).toBe("Invalid thread position.");
  expect(await rejection(start({ x: 0, y: 1e12 }))).toBe("Invalid thread position.");
  expect(await rejection(start({ ...onElement, elementId: "" }))).toBe("Invalid thread position.");
  expect(await rejection(start({ ...onElement, offsetX: "5" }))).toBe("Invalid thread position.");
  expect(await listChannelThreads(aliceDesign, USERS.alice.id)).toEqual([]);
});

test("threads page by id, oldest first", async () => {
  const ids: number[] = [];
  for (const body of ["one", "two", "three"]) {
    const t = await startCanvasThread({
      channelId: aliceDesign,
      userId: USERS.alice.id,
      anchor: point,
      body,
    });
    ids.push(t.id);
  }
  const page = (p?: object) =>
    listChannelThreads(aliceDesign, USERS.alice.id, p).then((ts) => ts.map((t) => t.id));

  // No page asked for is the whole list, which is what the canvas loads.
  expect(await page()).toEqual(ids);
  expect(await page({ limit: 2 })).toEqual(ids.slice(0, 2));
  expect(await page({ after: ids[1], limit: 2 })).toEqual([ids[2]]);
  expect(await page({ after: ids[2] })).toEqual([]);
  expect(await page({ limit: THREAD_PAGE * 10 })).toEqual(ids);
  expect(await page({ after: null })).toEqual(ids);

  expect(await rejection(page({ after: Number.NaN }))).toBe("Invalid page.");
  expect(await rejection(page({ after: "1" }))).toBe("Invalid page.");
  expect(await rejection(page({ limit: Number.NaN }))).toBe("Invalid page.");
});

test("starting threads is rate limited per person, and the window resets", () => {
  const { limit, windowMs } = THREAD_START_LIMIT;
  // Keys of their own, so this never shares a window with a real user's.
  const who = `rate-test-${Date.now()}`;
  const now = 1_000_000;
  for (let i = 0; i < limit; i++) checkThreadStartRate(who, now);
  expect(() => checkThreadStartRate(who, now)).toThrow(/too quickly/);
  // Someone else isn't held up by it.
  expect(() => checkThreadStartRate(`${who}-other`, now)).not.toThrow();
  expect(() => checkThreadStartRate(who, now + windowMs)).not.toThrow();
});

// ---------------------------------------------------------------------------
// Authors without a profile
// ---------------------------------------------------------------------------

test("someone without a profile can't start a thread, reply or comment, and nothing is written", async () => {
  await ensureNoProfileUser();
  const thread = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.alice.id,
    anchor: point,
    body: "Open to all.",
  });
  const before = await db.select({ id: comment.id }).from(comment);

  expect(
    await rejection(
      startCanvasThread({
        channelId: aliceDesign,
        userId: NO_PROFILE.id,
        anchor: point,
        body: "Hello?",
      }),
    ),
  ).toBe(NO_PROFILE_COMMENT_ERROR);
  expect(
    await rejection(
      replyToCanvasThread({ threadId: thread.id, userId: NO_PROFILE.id, body: "Hi" }),
    ),
  ).toBe(NO_PROFILE_COMMENT_ERROR);

  const column = (await getColumn(blockId))!;
  const ch = (await getChannel(aliceDesign))!;
  expect(
    await rejection(
      createCommentWithNotices({ column, channel: ch, authorId: NO_PROFILE.id, body: "Hi" }),
    ),
  ).toBe(NO_PROFILE_COMMENT_ERROR);

  expect((await listChannelThreads(aliceDesign, USERS.alice.id)).map((t) => t.id)).toEqual([
    thread.id,
  ]);
  expect(await db.select({ id: comment.id }).from(comment)).toHaveLength(before.length);
});

// Rows written before the check above: a thread whose comments have no owner
// row behind them. They list under a placeholder handle so the channel's
// manager can find the pin and delete it.
test("a thread by an author without a profile still lists, and can be deleted", async () => {
  await ensureNoProfileUser();
  const [orphan] = await db
    .insert(canvasThread)
    .values({ channel_id: aliceDesign, created_by: NO_PROFILE.id, x: 1, y: 2 })
    .returning();
  const [first] = await db
    .insert(comment)
    .values({ thread_id: orphan.id, author_id: NO_PROFILE.id, body: "Lost pin" })
    .returning();
  await replyToCanvasThread({ threadId: orphan.id, userId: USERS.bob.id, body: "Whose?" });

  const [listed] = await listChannelThreads(aliceDesign, USERS.alice.id);
  expect(listed.id).toBe(orphan.id);
  expect(listed.reply_count).toBe(1);
  expect(listed.starter).toMatchObject({ body: "Lost pin", author_handle: MISSING_AUTHOR_HANDLE });

  const full = await getCanvasThread(orphan.id, null);
  expect(full.comments.map((c) => c.author_handle)).toEqual([
    MISSING_AUTHOR_HANDLE,
    USERS.bob.handle,
  ]);

  expect(await deleteCanvasThreadComment({ commentId: first.id, userId: USERS.alice.id })).toEqual({
    threadDeleted: true,
  });
  expect(await listChannelThreads(aliceDesign, USERS.alice.id)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

test("a reply's author or a channel manager may delete it; anyone else gets not found", async () => {
  const thread = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.alice.id,
    anchor: point,
    body: "Owner starts.",
  });
  const byBob = await replyToCanvasThread({
    threadId: thread.id,
    userId: USERS.bob.id,
    body: "B1",
  });
  const byBob2 = await replyToCanvasThread({
    threadId: thread.id,
    userId: USERS.bob.id,
    body: "B2",
  });

  // bob may delete his own reply, but not the owner's starter.
  expect(await deleteCanvasThreadComment({ commentId: byBob.id, userId: USERS.bob.id })).toEqual({
    threadDeleted: false,
  });
  expect(
    await rejection(
      deleteCanvasThreadComment({ commentId: thread.starter!.id, userId: USERS.bob.id }),
    ),
  ).toBe("Not found.");

  // alice manages the channel, so she may delete bob's.
  expect(await deleteCanvasThreadComment({ commentId: byBob2.id, userId: USERS.alice.id })).toEqual(
    { threadDeleted: false },
  );

  expect(
    await rejection(deleteCanvasThreadComment({ commentId: 999_999_999, userId: USERS.alice.id })),
  ).toBe("Not found.");
  expect((await getCanvasThread(thread.id, USERS.alice.id)).comments).toHaveLength(1);
});

test("deleting a reply removes it; deleting the starter deletes the thread and its replies", async () => {
  const { events, stop } = collectEvents();
  try {
    const thread = await startCanvasThread({
      channelId: aliceDesign,
      userId: USERS.bob.id,
      anchor: point,
      body: "Short-lived.",
    });
    const kept = await replyToCanvasThread({
      threadId: thread.id,
      userId: USERS.alice.id,
      body: "Alice's reply.",
    });
    const removed = await replyToCanvasThread({
      threadId: thread.id,
      userId: USERS.bob.id,
      body: "Bob's reply.",
    });

    expect(
      await deleteCanvasThreadComment({ commentId: removed.id, userId: USERS.bob.id }),
    ).toEqual({ threadDeleted: false });
    const after = await getCanvasThread(thread.id, USERS.bob.id);
    expect(after.comments.map((c) => c.id)).toEqual([thread.starter!.id, kept.id]);

    // bob started it, so deleting his starter takes alice's reply too.
    expect(
      await deleteCanvasThreadComment({ commentId: thread.starter!.id, userId: USERS.bob.id }),
    ).toEqual({ threadDeleted: true });
    expect(await rejection(getCanvasThread(thread.id, USERS.bob.id))).toBe("Not found.");
    expect(await db.select().from(comment).where(eq(comment.thread_id, thread.id))).toEqual([]);
    expect(
      await rejection(
        replyToCanvasThread({ threadId: thread.id, userId: USERS.bob.id, body: "?" }),
      ),
    ).toBe("Not found.");

    expect(events.map((e) => e.type)).toEqual([
      "thread.created",
      "thread.comment.added",
      "thread.comment.added",
      "thread.comment.deleted",
      "thread.deleted",
    ]);
    expect(events.every((e) => e.channelId === aliceDesign)).toBe(true);
    expect(events[3]).toMatchObject({ threadId: thread.id, commentId: removed.id });
    expect(events[4]).toMatchObject({ threadId: thread.id });
  } finally {
    stop();
  }
});

test("a channel manager may delete someone else's starter, which deletes the thread", async () => {
  const thread = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.bob.id,
    anchor: point,
    body: "Bob's thread.",
  });
  expect(
    await deleteCanvasThreadComment({ commentId: thread.starter!.id, userId: USERS.alice.id }),
  ).toEqual({ threadDeleted: true });
  expect(await listChannelThreads(aliceDesign, USERS.alice.id)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Readers of comment.column_id, for both kinds of comment
// ---------------------------------------------------------------------------

test("block comment reads and deletes never see a thread comment", async () => {
  const thread = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.bob.id,
    anchor: point,
    body: "Not on a block.",
  });
  const threadCommentId = thread.starter!.id;

  // The block's own thread is just the seeded two.
  expect((await getColumnComments(blockId)).map((c) => c.body)).toEqual([
    COMMENTS.byAlice,
    COMMENTS.byBob,
  ]);
  const listed = await listCommentsFor(blockId, USERS.alice.id);
  expect((listed as { body: string }[]).map((c) => c.body)).toEqual([
    COMMENTS.byAlice,
    COMMENTS.byBob,
  ]);

  // Delete authorization (web action, REST and MCP all start here) treats a
  // thread comment as missing, so a block path can't look up a null block.
  expect(await getCommentAuthorization(threadCommentId)).toBeNull();
  const denied = await deleteCommentFor(threadCommentId, USERS.bob.id);
  expect(denied).toBeInstanceOf(NextResponse);
  expect((denied as NextResponse).status).toBe(404);
  expect((await getCanvasThread(thread.id, USERS.bob.id)).comments).toHaveLength(1);

  // A block comment still authorizes as before.
  const [first] = await getColumnComments(blockId);
  expect(await getCommentAuthorization(first.id)).toEqual({
    author_id: USERS.alice.id,
    column_id: blockId,
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test("a new thread notifies the channel owner, linking to the thread", async () => {
  const thread = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.bob.id,
    anchor: onElement,
    body: "Owner should hear about this.",
  });
  expect(await noticesFor(thread.starter!.id)).toEqual({ [USERS.alice.id]: "comment" });

  const [row] = await db
    .select()
    .from(notification)
    .where(eq(notification.comment_id, thread.starter!.id));
  expect(row).toMatchObject({
    channel_id: aliceDesign,
    column_id: null,
    group_id: null,
    thread_id: thread.id,
  });

  const [item] = await listNotifications(USERS.alice.id);
  expect(item.href).toBe(`/${USERS.alice.handle}/${aliceDesign}?thread=${thread.id}`);
  expect(item.message).toBe(`commented on the canvas of "${CHANNELS.aliceDesign.title}"`);
  expect(item.excerpt).toBe("Owner should hear about this.");
  expect(item.thumbnail_url).toBeUndefined();
});

test("a reply notifies the thread's participants and the owner, not the replier", async () => {
  const thread = await startCanvasThread({
    channelId: bobPhoto,
    userId: USERS.alice.id,
    anchor: point,
    body: "Alice starts on bob's canvas.",
  });
  // bob owns the channel.
  expect(await noticesFor(thread.starter!.id)).toEqual({ [USERS.bob.id]: "comment" });

  // bob replies: alice took part, so she hears; bob doesn't hear about himself.
  const reply = await replyToCanvasThread({
    threadId: thread.id,
    userId: USERS.bob.id,
    body: "Bob answers.",
  });
  expect(await noticesFor(reply.id)).toEqual({ [USERS.alice.id]: "comment" });

  // Mentioning someone who already gets a comment notice doesn't add a second.
  const again = await replyToCanvasThread({
    threadId: thread.id,
    userId: USERS.bob.id,
    body: "Right, @alice?",
  });
  expect(await noticesFor(again.id)).toEqual({ [USERS.alice.id]: "comment" });
});

test("a mention notifies a reader who isn't in the thread, and skips a non-reader", async () => {
  // bob isn't in this thread and doesn't own the channel: a mention is his only way in.
  const thread = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.alice.id,
    anchor: point,
    body: "Hey @bob, look.",
  });
  expect(await noticesFor(thread.starter!.id)).toEqual({ [USERS.bob.id]: "mention" });
  const [item] = await listNotifications(USERS.bob.id);
  expect(item.message).toBe(`mentioned you on the canvas of "${CHANNELS.aliceDesign.title}"`);
  expect(item.href).toBe(`/${USERS.alice.handle}/${aliceDesign}?thread=${thread.id}`);

  // bob can't read alice's private channel, so mentioning him there sends nothing.
  const hidden = await startCanvasThread({
    channelId: alicePrivate,
    userId: USERS.alice.id,
    anchor: point,
    body: "Hey @bob, secret.",
  });
  expect(await noticesFor(hidden.starter!.id)).toEqual({});
});

test("a canvas notification keeps its thread link after its comment is deleted", async () => {
  const thread = await startCanvasThread({
    channelId: aliceDesign,
    userId: USERS.alice.id,
    anchor: point,
    body: "Alice asks.",
  });
  const reply = await replyToCanvasThread({
    threadId: thread.id,
    userId: USERS.bob.id,
    body: "Bob answers, then thinks better of it.",
  });
  await deleteCanvasThreadComment({ commentId: reply.id, userId: USERS.bob.id });

  const [item] = await listNotifications(USERS.alice.id);
  expect(item.excerpt).toBeUndefined();
  expect(item.message).toBe(`commented on the canvas of "${CHANNELS.aliceDesign.title}"`);
  expect(item.href).toBe(`/${USERS.alice.handle}/${aliceDesign}?thread=${thread.id}`);

  // Deleting the thread takes its notifications with it.
  await deleteCanvasThreadComment({ commentId: thread.starter!.id, userId: USERS.alice.id });
  expect(await db.select().from(notification).where(eq(notification.thread_id, thread.id))).toEqual(
    [],
  );
});

test("a new thread notifies every member of the channel; a reply only the thread and owner", async () => {
  // bobGroup is bob's private channel with alice as a member.
  const bobGroup = await channelId(CHANNELS.bobGroup.title, USERS.bob.ownerId);
  const started = await startCanvasThread({
    channelId: bobGroup,
    userId: USERS.bob.id,
    anchor: point,
    body: "Owner starts, member hears.",
  });
  expect(await noticesFor(started.starter!.id)).toEqual({ [USERS.alice.id]: "comment" });

  // The studio group owns this one: alice owns the group, bob is a plain member.
  const studio = await channelId(GROUP_CHANNELS.studioPublic.title, GROUPS.studio.id);
  const groupThread = await startCanvasThread({
    channelId: studio,
    userId: USERS.alice.id,
    anchor: point,
    body: "To the whole group.",
  });
  expect(await noticesFor(groupThread.starter!.id)).toEqual({ [USERS.bob.id]: "comment" });

  // A reply goes to participants and the group's managers. alice is both, and
  // the author, so plain member bob hears nothing this time.
  const reply = await replyToCanvasThread({
    threadId: groupThread.id,
    userId: USERS.alice.id,
    body: "Following up.",
  });
  expect(await noticesFor(reply.id)).toEqual({});
});

test("block comment notifications keep their block link and wording", async () => {
  const column = (await getColumn(blockId))!;
  const ch = (await getChannel(aliceDesign))!;
  const created = await createCommentWithNotices({
    column,
    channel: ch,
    authorId: USERS.bob.id,
    body: "Block comment, @alice.",
  });
  expect(await noticesFor(created.id)).toEqual({ [USERS.alice.id]: "comment" });
  const [item] = await listNotifications(USERS.alice.id);
  expect(item.href).toBe(`/${USERS.alice.handle}/${aliceDesign}/${blockId}`);
  expect(item.message).toBe(
    `commented on "${BLOCKS.alicePublic}" in "${CHANNELS.aliceDesign.title}"`,
  );
  await db.delete(comment).where(eq(comment.id, created.id));
});

// Every new thread is a fresh subject for the email quiet period, which is per
// thread, so a burst of new threads would email the whole roster once each.
// For new-thread notices the quiet period is per thread starter instead.
test("a burst of new threads emails each recipient once per starter; replies keep per-thread quiet", async () => {
  async function emailed(commentId: number, recipientId: string): Promise<boolean> {
    const [row] = await db
      .select({ at: notification.email_sent_at })
      .from(notification)
      .where(
        and(eq(notification.comment_id, commentId), eq(notification.recipient_id, recipientId)),
      );
    if (!row) throw new Error("no notification");
    return row.at !== null;
  }
  const start = (body: string) =>
    startCanvasThread({ channelId: aliceDesign, userId: USERS.bob.id, anchor: point, body });

  const one = await start("First of many.");
  const two = await start("Second of many.");
  expect(await emailed(one.starter!.id, USERS.alice.id)).toBe(true);
  expect(await emailed(two.starter!.id, USERS.alice.id)).toBe(false);

  // A reply in the second thread is a reply's notice, quiet per thread: that
  // thread hasn't emailed alice yet, so this one does.
  const reply = await replyToCanvasThread({ threadId: two.id, userId: USERS.bob.id, body: "And." });
  expect(await emailed(reply.id, USERS.alice.id)).toBe(true);
  // Another in the first thread doesn't: that thread emailed her already.
  const again = await replyToCanvasThread({ threadId: one.id, userId: USERS.bob.id, body: "So." });
  expect(await emailed(again.id, USERS.alice.id)).toBe(false);
});
