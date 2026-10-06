"use server";

// Server actions for canvas comment threads. Each resolves the caller from the
// Better Auth session and hands it to ./canvas-thread, which holds the rules:
// readers of the channel see threads, signed-in readers post, authors and
// channel managers delete. Kept apart from ./actions so the canvas work doesn't
// all land in one file.

import { getSessionUser } from "@/lib/auth";
import { resolveShareToken, shareCoversChannel } from "./share-link";
import {
  checkThreadStartRate,
  deleteCanvasThreadComment,
  getCanvasThread,
  listChannelThreads,
  replyToCanvasThread,
  startCanvasThread,
  type CanvasThread,
  type CanvasThreadWithComments,
  type ThreadAnchor,
  type ThreadComment,
  type ThreadPage,
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

// A channel share-link token (/s/<token>/canvas) reads threads in place of a
// session. The channel id it opens, or "Not found." for a link that doesn't
// cover the channel.
async function sharedChannel(channelId: number, token: string): Promise<number> {
  const share = await resolveShareToken(token);
  if (!share || !shareCoversChannel(share, channelId)) throw new Error("Not found.");
  return share.channel.id;
}

export async function listCanvasThreadsAction(
  channelId: number,
  page?: ThreadPage,
  share?: string,
): Promise<CanvasThread[]> {
  if (share)
    return listChannelThreads(channelId, null, page, await sharedChannel(channelId, share));
  return listChannelThreads(channelId, await currentUserId(), page);
}

export async function getCanvasThreadAction(
  threadId: number,
  share?: { token: string; channelId: number },
): Promise<CanvasThreadWithComments> {
  if (share) {
    const thread = await getCanvasThread(
      threadId,
      null,
      await sharedChannel(share.channelId, share.token),
    );
    // The thread has to be on the channel the link covers, not just any channel.
    if (thread.channel_id !== share.channelId) throw new Error("Not found.");
    return thread;
  }
  return getCanvasThread(threadId, await currentUserId());
}

export async function startCanvasThreadAction(
  channelId: number,
  anchor: ThreadAnchor,
  body: string,
): Promise<CanvasThread> {
  const userId = await requireUserId();
  checkThreadStartRate(userId);
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
