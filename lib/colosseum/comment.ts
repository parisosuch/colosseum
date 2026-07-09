import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { comment, userProfile } from "@/lib/db/schema";

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
    .select({ c: comment, handle: userProfile.handle, avatar_url: userProfile.avatar_url })
    .from(comment)
    .innerJoin(userProfile, eq(userProfile.user_id, comment.author_id))
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
    .select({ handle: userProfile.handle, avatar_url: userProfile.avatar_url })
    .from(userProfile)
    .where(eq(userProfile.user_id, input.author_id))
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
