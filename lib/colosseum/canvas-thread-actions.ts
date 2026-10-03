"use server";

// Server actions for canvas comment threads. Each resolves the caller from the
// Better Auth session and hands it to ./canvas-thread, which holds the rules:
// readers of the channel see threads, signed-in readers post, authors and
// channel managers delete. Kept apart from ./actions so the canvas work doesn't
// all land in one file.

import { getSessionUser } from "@/lib/auth";
import {
  deleteCanvasThreadComment,
  getCanvasThread,
  listChannelThreads,
  replyToCanvasThread,
  startCanvasThread,
  type CanvasThread,
  type CanvasThreadWithComments,
  type ThreadAnchor,
  type ThreadComment,
} from "./canvas-thread";

async function currentUserId(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.id ?? null;
}

async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Not authenticated.");
  return userId;
}

export async function listCanvasThreadsAction(channelId: number): Promise<CanvasThread[]> {
  return listChannelThreads(channelId, await currentUserId());
}

export async function getCanvasThreadAction(threadId: number): Promise<CanvasThreadWithComments> {
  return getCanvasThread(threadId, await currentUserId());
}

export async function startCanvasThreadAction(
  channelId: number,
  anchor: ThreadAnchor,
  body: string,
): Promise<CanvasThread> {
  const userId = await requireUserId();
  return startCanvasThread({ channelId, userId, anchor, body });
}

export async function replyToCanvasThreadAction(
  threadId: number,
  body: string,
): Promise<ThreadComment> {
  const userId = await requireUserId();
  return replyToCanvasThread({ threadId, userId, body });
}

export async function deleteCanvasThreadCommentAction(
  commentId: number,
): Promise<{ threadDeleted: boolean }> {
  const userId = await requireUserId();
  return deleteCanvasThreadComment({ commentId, userId });
}
