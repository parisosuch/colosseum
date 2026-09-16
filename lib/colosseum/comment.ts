import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { comment, owner } from "@/lib/db/schema";
import { parseMentions } from "./mentions";
import { channelReaders, type Channel } from "./channel";
import type { Column } from "./column";
import { createNotification } from "./notification";
import { getPublicUserProfile } from "./user";

// Longest comment we accept. Generous for a note; a hard cap so the column
// can't be used to store arbitrarily large blobs.
export const MAX_COMMENT_LENGTH = 2000;

export type Comment = {
  id: number;
  created_at: string;
  column_id: number;
  author_id: string;
  body: string;
  // Resolved author display info, joined from the profile.
  author_handle: string;
  author_avatar_url?: string;
};

type CommentRow = typeof comment.$inferSelect;
function toComment(row: CommentRow, handle: string, avatar_url: string | null): Comment {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    column_id: row.column_id,
    author_id: row.author_id,
    body: row.body,
    author_handle: handle,
    author_avatar_url: avatar_url ?? undefined,
  };
}

// A block's comment thread, oldest first, each carrying its author's handle and
// avatar for display. Callers authorize read access to the block's channel
// first (this connection bypasses RLS).
export async function getColumnComments(column_id: number): Promise<Comment[]> {
  if (!Number.isFinite(column_id)) {
    return [];
  }
  const rows = await db
    .select({ c: comment, handle: owner.handle, avatar_url: owner.avatar_url })
    .from(comment)
    .innerJoin(owner, eq(owner.user_id, comment.author_id))
    .where(eq(comment.column_id, column_id))
    .orderBy(asc(comment.created_at));
  return rows.map(({ c, handle, avatar_url }) => toComment(c, handle, avatar_url));
}

// Post a comment. Returns it with the author's display info resolved. Callers
// authorize (authenticated + can read the block) first.
export async function createComment(input: {
  column_id: number;
  author_id: string;
  body: string;
}): Promise<Comment> {
  const [row] = await db.insert(comment).values(input).returning();
  const [profile] = await db
    .select({ handle: owner.handle, avatar_url: owner.avatar_url })
    .from(owner)
    .where(eq(owner.user_id, input.author_id))
    .limit(1);
  return toComment(row, profile.handle, profile.avatar_url);
}

// Just the fields needed to authorize a delete (author, and the block it hangs
// off so the channel owner can be checked). Null when it doesn't exist.
export async function getCommentAuthorization(
  comment_id: number,
): Promise<{ author_id: string; column_id: number } | null> {
  if (!Number.isFinite(comment_id)) {
    return null;
  }
  const [row] = await db
    .select({ author_id: comment.author_id, column_id: comment.column_id })
    .from(comment)
    .where(eq(comment.id, comment_id))
    .limit(1);
  return row ?? null;
}

export async function deleteComment(comment_id: number): Promise<void> {
  await db.delete(comment).where(eq(comment.id, comment_id));
}

// Post a comment and send the notices it owes: one to the block's author, and
// one to each handle @mentioned in it. Shared by the web action and the API,
// which authorize the read differently but owe the same notices.
//
// Both lists are filtered to people who can actually read the channel. A
// mention resolves any handle whether or not they're a member, so without that
// filter, mentioning a stranger from a private channel would hand them its
// contents — the notification names the block and its channel and quotes the
// comment. A block's author can lose access too, when an open channel is later
// made private. Privacy runs in both directions.
//
// The author is excluded from the mention list: they already get the comment
// notification, and two for one comment is noise.
//
// Authorization is the caller's: they must be able to read the block.
export async function createCommentWithNotices(input: {
  column: Column;
  channel: Channel;
  authorId: string;
  body: string;
}): Promise<Comment> {
  const trimmed = input.body.trim();
  if (!trimmed) throw new Error("Comment can't be empty.");
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment is too long (max ${MAX_COMMENT_LENGTH} characters).`);
  }

  const created = await createComment({
    column_id: input.column.id,
    author_id: input.authorId,
    body: trimmed,
  });

  const handles = [
    ...new Set(parseMentions(trimmed).flatMap((s) => (s.type === "mention" ? [s.handle] : []))),
  ];
  const mentioned = (await Promise.all(handles.map((h) => getPublicUserProfile(h)))).filter(
    (p): p is NonNullable<typeof p> => p !== null && p.user_id !== input.column.created_by,
  );
  const readers = new Set(
    await channelReaders(input.channel, [
      input.column.created_by,
      ...mentioned.map((p) => p.user_id),
    ]),
  );

  const notice = (recipient_id: string, type: "comment" | "mention") =>
    createNotification({
      recipient_id,
      actor_id: input.authorId,
      type,
      channel_id: input.column.channel_id,
      column_id: input.column.id,
      comment_id: created.id,
    });

  if (readers.has(input.column.created_by)) {
    await notice(input.column.created_by, "comment");
  }
  await Promise.all(
    mentioned.filter((p) => readers.has(p.user_id)).map((p) => notice(p.user_id, "mention")),
  );
  return created;
}
