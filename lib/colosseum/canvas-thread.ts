// Comment threads on a channel's canvas. A thread is a `canvas_thread` row (where
// it sits) plus its comments, which are `comment` rows with `thread_id` set, so
// the length cap, mentions, notifications and delete rule are the block
// comments' own.
//
// Who may do what:
// - read a channel's threads: anyone who can read the channel, signed out
//   included, same as the canvas itself;
// - start a thread or reply: anyone signed in who can read the channel, so a
//   read-only viewer of the canvas can comment;
// - delete a comment: its author, or anyone who manages the channel.
//
// Every write publishes a realtime event, and the canvas server passes it on to
// everyone viewing the channel's canvas. Pinning and freeing threads as their
// elements come and go is the canvas server's (lib/realtime/canvas-threads.ts).

import { asc, count, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { canvasThread, comment, owner } from "@/lib/db/schema";
import type { CanvasThread, ThreadComment } from "@/lib/realtime/canvas-threads";
import { publishRealtime } from "@/lib/realtime/events";
import {
  canManageChannel,
  canReadChannel,
  channelReaders,
  getChannel,
  resolveChannelViewer,
  type Channel,
} from "./channel";
import { mentionedUsers, validateCommentBody } from "./comment";
import { createNotification } from "./notification";
import { ownerRecipients } from "./owner";

export type { CanvasThread, ThreadComment };

export type CanvasThreadWithComments = CanvasThread & { comments: ThreadComment[] };

// Where a new thread goes. On an element: its Yjs id, the offset from the
// element's (x, y), and the world position that makes right now (the fallback
// if the element is gone before the canvas server sees the thread). On a bare
// point: just the position.
export type ThreadAnchor =
  | { elementId: string; offsetX: number; offsetY: number; x: number; y: number }
  | { x: number; y: number };

// Element ids are client-generated map keys; anything longer is not one.
const MAX_ELEMENT_ID_LENGTH = 128;

// Past this, a coordinate is a bug or an attack, not a place on a canvas.
const MAX_COORDINATE = 1e9;

const NOT_FOUND = "Not found.";

function coordinate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new Error("Invalid thread position.");
  }
  return value;
}

function anchorValues(anchor: ThreadAnchor) {
  const x = coordinate(anchor.x);
  const y = coordinate(anchor.y);
  if (!("elementId" in anchor)) {
    return { element_id: null, offset_x: null, offset_y: null, x, y };
  }
  const id = anchor.elementId;
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ELEMENT_ID_LENGTH) {
    throw new Error("Invalid thread position.");
  }
  return {
    element_id: id,
    offset_x: coordinate(anchor.offsetX),
    offset_y: coordinate(anchor.offsetY),
    x,
    y,
  };
}

// The channel, if `userId` (null when signed out) may read it. Throws the
// same "Not found." for a missing channel and an unreadable one.
async function readableChannel(channelId: number, userId: string | null): Promise<Channel> {
  const channel = Number.isSafeInteger(channelId) ? await getChannel(channelId) : null;
  if (!channel || !canReadChannel(channel, await resolveChannelViewer(channel, userId))) {
    throw new Error(NOT_FOUND);
  }
  return channel;
}

type ThreadRow = typeof canvasThread.$inferSelect;
type CommentRow = typeof comment.$inferSelect;

function toThreadComment(
  row: CommentRow,
  thread_id: number,
  handle: string,
  avatar_url: string | null,
): ThreadComment {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    thread_id,
    author_id: row.author_id,
    body: row.body,
    author_handle: handle,
    author_avatar_url: avatar_url ?? undefined,
  };
}

function toThread(
  row: ThreadRow,
  commentCount: number,
  starter: ThreadComment | null,
): CanvasThread {
  return {
    id: row.id,
    channel_id: row.channel_id,
    element_id: row.element_id,
    offset_x: row.offset_x,
    offset_y: row.offset_y,
    x: row.x,
    y: row.y,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    reply_count: Math.max(0, commentCount - 1),
    starter,
  };
}

// Comments of the given threads, oldest first, with author display info.
async function threadComments(threadIds: number[]): Promise<ThreadComment[]> {
  if (threadIds.length === 0) return [];
  const rows = await db
    .select({ c: comment, handle: owner.handle, avatar_url: owner.avatar_url })
    .from(comment)
    .innerJoin(owner, eq(owner.user_id, comment.author_id))
    .where(inArray(comment.thread_id, threadIds))
    .orderBy(asc(comment.created_at), asc(comment.id));
  return rows.map(({ c, handle, avatar_url }) =>
    toThreadComment(c, c.thread_id!, handle, avatar_url),
  );
}

async function insertThreadComment(input: {
  threadId: number;
  authorId: string;
  body: string;
}): Promise<ThreadComment> {
  const [row] = await db
    .insert(comment)
    .values({ thread_id: input.threadId, author_id: input.authorId, body: input.body })
    .returning();
  return withAuthor(row, input.threadId);
}

async function withAuthor(row: CommentRow, threadId: number): Promise<ThreadComment> {
  const [profile] = await db
    .select({ handle: owner.handle, avatar_url: owner.avatar_url })
    .from(owner)
    .where(eq(owner.user_id, row.author_id))
    .limit(1);
  return toThreadComment(row, threadId, profile.handle, profile.avatar_url);
}

async function getThreadRow(threadId: number): Promise<ThreadRow | null> {
  if (!Number.isSafeInteger(threadId)) return null;
  const [row] = await db.select().from(canvasThread).where(eq(canvasThread.id, threadId)).limit(1);
  return row ?? null;
}

// A channel's threads, oldest first, each with its reply count and starter.
export async function listChannelThreads(
  channelId: number,
  userId: string | null,
): Promise<CanvasThread[]> {
  await readableChannel(channelId, userId);
  const rows = await db
    .select({ t: canvasThread, n: count(comment.id) })
    .from(canvasThread)
    .leftJoin(comment, eq(comment.thread_id, canvasThread.id))
    .where(eq(canvasThread.channel_id, channelId))
    .groupBy(canvasThread.id)
    .orderBy(asc(canvasThread.created_at), asc(canvasThread.id));
  if (rows.length === 0) return [];

  const starters = new Map<number, ThreadComment>();
  const firsts = await db
    .selectDistinctOn([comment.thread_id], {
      c: comment,
      handle: owner.handle,
      avatar_url: owner.avatar_url,
    })
    .from(comment)
    .innerJoin(owner, eq(owner.user_id, comment.author_id))
    .where(
      inArray(
        comment.thread_id,
        rows.map((r) => r.t.id),
      ),
    )
    .orderBy(comment.thread_id, asc(comment.created_at), asc(comment.id));
  for (const { c, handle, avatar_url } of firsts) {
    starters.set(c.thread_id!, toThreadComment(c, c.thread_id!, handle, avatar_url));
  }
  return rows.map(({ t, n }) => toThread(t, Number(n), starters.get(t.id) ?? null));
}

// One thread and all its comments, oldest first. Null-safe the same way as a
// channel: a missing thread and one in an unreadable channel both throw
// "Not found.".
export async function getCanvasThread(
  threadId: number,
  userId: string | null,
): Promise<CanvasThreadWithComments> {
  const row = await getThreadRow(threadId);
  if (!row) throw new Error(NOT_FOUND);
  await readableChannel(row.channel_id, userId);
  const comments = await threadComments([row.id]);
  return { ...toThread(row, comments.length, comments[0] ?? null), comments };
}

// Start a thread with its first comment. Returns it with that comment as the
// starter.
export async function startCanvasThread(input: {
  channelId: number;
  userId: string;
  anchor: ThreadAnchor;
  body: string;
}): Promise<CanvasThread> {
  const channel = await readableChannel(input.channelId, input.userId);
  const body = validateCommentBody(input.body);
  const values = anchorValues(input.anchor);

  const { thread, first } = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(canvasThread)
      .values({ channel_id: channel.id, created_by: input.userId, ...values })
      .returning();
    const [firstRow] = await tx
      .insert(comment)
      .values({ thread_id: row.id, author_id: input.userId, body })
      .returning();
    return { thread: row, first: firstRow };
  });
  const starter = await withAuthor(first, thread.id);
  const created = toThread(thread, 1, starter);

  publishRealtime({ type: "thread.created", channelId: channel.id, thread: created });
  await sendThreadNotices({ channel, threadId: thread.id, comment: starter });
  return created;
}

// Reply in a thread. Returns the new comment.
export async function replyToCanvasThread(input: {
  threadId: number;
  userId: string;
  body: string;
}): Promise<ThreadComment> {
  const thread = await getThreadRow(input.threadId);
  if (!thread) throw new Error(NOT_FOUND);
  const channel = await readableChannel(thread.channel_id, input.userId);
  const body = validateCommentBody(input.body);

  let created: ThreadComment;
  try {
    created = await insertThreadComment({ threadId: thread.id, authorId: input.userId, body });
  } catch (e) {
    // The thread's last comment was deleted, and the thread with it, between
    // the lookup above and this insert.
    if (isForeignKeyViolation(e)) throw new Error(NOT_FOUND, { cause: e });
    throw e;
  }

  publishRealtime({ type: "thread.comment.added", channelId: channel.id, comment: created });
  await sendThreadNotices({ channel, threadId: thread.id, comment: created });
  return created;
}

// Delete a thread comment: its author may, and so may anyone who manages the
// channel, the block comments' rule. A comment the caller may do neither to is
// "Not found." so this never confirms one exists. Deleting a thread's last
// comment deletes the thread: a pin with nothing in it is just clutter.
export async function deleteCanvasThreadComment(input: {
  commentId: number;
  userId: string;
}): Promise<{ threadDeleted: boolean }> {
  if (!Number.isSafeInteger(input.commentId)) throw new Error(NOT_FOUND);
  const [target] = await db
    .select({
      author_id: comment.author_id,
      thread_id: canvasThread.id,
      channel_id: canvasThread.channel_id,
    })
    .from(comment)
    .innerJoin(canvasThread, eq(canvasThread.id, comment.thread_id))
    .where(eq(comment.id, input.commentId))
    .limit(1);
  if (!target) throw new Error(NOT_FOUND);

  if (target.author_id !== input.userId) {
    const channel = await getChannel(target.channel_id);
    if (!channel || !canManageChannel(channel, await resolveChannelViewer(channel, input.userId))) {
      throw new Error(NOT_FOUND);
    }
  }

  const threadDeleted = await db.transaction(async (tx) => {
    // Locked so a reply can't land in a thread this is about to delete: the
    // reply's foreign key check waits on this lock, then fails if the thread
    // went, and a reply that got in first is counted below.
    await tx
      .select({ id: canvasThread.id })
      .from(canvasThread)
      .where(eq(canvasThread.id, target.thread_id))
      .for("update");
    await tx.delete(comment).where(eq(comment.id, input.commentId));
    const [{ n }] = await tx
      .select({ n: count() })
      .from(comment)
      .where(eq(comment.thread_id, target.thread_id));
    if (n > 0) return false;
    await tx.delete(canvasThread).where(eq(canvasThread.id, target.thread_id));
    return true;
  });

  publishRealtime(
    threadDeleted
      ? { type: "thread.deleted", channelId: target.channel_id, threadId: target.thread_id }
      : {
          type: "thread.comment.deleted",
          channelId: target.channel_id,
          threadId: target.thread_id,
          commentId: input.commentId,
        },
  );
  return { threadDeleted };
}

// The notices a thread comment owes, after createCommentWithNotices:
// - `comment` to everyone else who has commented in the thread, and to the
//   channel's owner (a group's owners and admins);
// - `mention` to each person @mentioned who isn't already getting a `comment`
//   for it, since two notifications for one comment is noise.
// All of it is filtered to people who can read the channel: a mention resolves
// any handle, and a participant can lose access when the channel goes private.
//
// The notifications carry the channel and the comment and no block; the
// comment is how the feed finds the thread for its link.
async function sendThreadNotices(input: {
  channel: Channel;
  threadId: number;
  comment: ThreadComment;
}): Promise<void> {
  const { channel, comment: created } = input;
  const authorId = created.author_id;

  const participants = await db
    .selectDistinct({ author_id: comment.author_id })
    .from(comment)
    .where(eq(comment.thread_id, input.threadId));
  const owed = new Set([
    ...participants.map((p) => p.author_id),
    ...(await ownerRecipients(channel.owned_by)),
  ]);
  owed.delete(authorId);
  const mentioned = (await mentionedUsers(created.body))
    .map((p) => p.user_id)
    .filter((id) => id !== authorId && !owed.has(id));

  const readers = new Set(await channelReaders(channel, [...owed, ...mentioned]));
  const notice = (recipient_id: string, type: "comment" | "mention") =>
    createNotification({
      recipient_id,
      actor_id: authorId,
      type,
      channel_id: channel.id,
      comment_id: created.id,
    });
  await Promise.all([
    ...[...owed].filter((id) => readers.has(id)).map((id) => notice(id, "comment")),
    ...mentioned.filter((id) => readers.has(id)).map((id) => notice(id, "mention")),
  ]);
}

function isForeignKeyViolation(e: unknown): boolean {
  // Drizzle wraps the driver's error; the Postgres code is on it or its cause.
  const code = (x: unknown) => (x as { code?: string } | null)?.code;
  return code(e) === "23503" || code((e as { cause?: unknown } | null)?.cause) === "23503";
}
