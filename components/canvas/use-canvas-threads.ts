"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Point } from "@/lib/canvas/camera";
import {
  applyThreadEvent,
  currentAnchor,
  EMPTY_THREADS,
  loadThread,
  loadThreads,
  threadAnchorAt,
  threadsNewestFirst,
  type NewThreadAnchor,
  type ThreadsState,
} from "@/lib/canvas/threads";
import {
  deleteCanvasThreadCommentAction,
  getCanvasThreadAction,
  listCanvasThreadsAction,
  replyToCanvasThreadAction,
  startCanvasThreadAction,
} from "@/lib/colosseum/canvas-thread-actions";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import type { CanvasThread, ThreadComment } from "@/lib/realtime/canvas-threads";
import type { CanvasStore } from "./canvas-store";
import { useCanvas } from "./use-canvas";

export type CanvasThreads = {
  state: ThreadsState;
  // Newest first, for the comments panel.
  list: CanvasThread[];
  // The first list has arrived.
  loaded: boolean;
  // The thread shown in the popover, and the pin being placed before its first
  // comment exists.
  openId: number | null;
  draft: NewThreadAnchor | null;
  // Signed in: may start threads and reply. Read-only viewers included.
  canComment: boolean;
  canDelete: (comment: ThreadComment) => boolean;
  open: (id: number) => void;
  close: () => void;
  // The comment tool's click, in world space.
  startDraft: (at: Point) => void;
  submitDraft: (body: string) => Promise<boolean>;
  reply: (threadId: number, body: string) => Promise<boolean>;
  // Deleting the first comment deletes the thread; the caller confirms that.
  remove: (comment: ThreadComment, isStarter: boolean) => Promise<void>;
};

// The canvas's comment threads: the list, kept live from the canvas socket,
// the open thread and its comments, and the writes. Everyone who can see the
// canvas gets the list; signed-in viewers can write.
export function useCanvasThreads({
  store,
  channelId,
  viewerId,
  canManage,
}: {
  store: CanvasStore;
  channelId: number;
  viewerId: string | null;
  // May delete anyone's comment (the channel's managers).
  canManage: boolean;
}): CanvasThreads {
  const [state, setState] = useState<ThreadsState>(EMPTY_THREADS);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState<NewThreadAnchor | null>(null);
  const openRef = useRef<number | null>(null);
  openRef.current = openId;
  // Threads this viewer is deleting.
  const deleting = useRef(new Set<number>());
  const status = useCanvas(store, "connection", (s) => s.connection.status);

  // The list, on the first connection and again after every reconnect, since
  // events sent while the socket was down are gone.
  const loads = useRef(0);
  useEffect(() => {
    if (status !== "connected") return;
    const id = ++loads.current;
    listCanvasThreadsAction(channelId)
      .then((list) => {
        if (loads.current !== id) return;
        setState((s) => loadThreads(s, list));
        setLoaded(true);
      })
      .catch((err) => {
        console.error(err);
        if (loads.current === id) setLoaded(true);
      });
  }, [status, channelId]);

  // Live events from the canvas socket.
  useEffect(
    () =>
      store.onChannelEvent((event) => {
        if (event.type === "session" || event.type === "block.added") return;
        if (event.type === "block.removed") return;
        setState((s) => applyThreadEvent(s, event));
        if (event.type === "thread.deleted" && event.threadId === openRef.current) {
          setOpenId(null);
          // Someone else's delete; this viewer's own closes it quietly.
          if (!deleting.current.has(event.threadId)) toast("That thread was deleted.");
        }
      }),
    [store],
  );

  const fetchThread = useCallback((id: number) => {
    getCanvasThreadAction(id)
      .then((thread) => setState((s) => loadThread(s, thread)))
      .catch((err) => {
        console.error(err);
        if (openRef.current === id) setOpenId(null);
        toast.error("Couldn't open that thread. It may have been deleted.");
      });
  }, []);

  const open = useCallback(
    (id: number) => {
      setDraft(null);
      setOpenId(id);
      // Fresh each time: replies sent while it was closed are in the count
      // but not in a list loaded earlier.
      fetchThread(id);
    },
    [fetchThread],
  );

  const close = useCallback(() => {
    setOpenId(null);
    setDraft(null);
  }, []);

  const startDraft = useCallback(
    (at: Point) => {
      if (!viewerId) return;
      setOpenId(null);
      setDraft(threadAnchorAt(elementsOf(store.doc), store.hitContext(), at, store.camera.z));
    },
    [store, viewerId],
  );

  const submitDraft = useCallback(
    async (body: string) => {
      if (!draft) return false;
      try {
        const thread = await startCanvasThreadAction(
          channelId,
          currentAnchor(elementsOf(store.doc), draft),
          body,
        );
        setState((s) =>
          loadThread(applyThreadEvent(s, { type: "thread.created", thread }), {
            ...thread,
            comments: thread.starter ? [thread.starter] : [],
          }),
        );
        setDraft(null);
        setOpenId(thread.id);
        return true;
      } catch (err) {
        console.error(err);
        toast.error("Couldn't post that comment. Please try again.");
        return false;
      }
    },
    [channelId, draft, store],
  );

  const reply = useCallback(async (threadId: number, body: string) => {
    try {
      const comment = await replyToCanvasThreadAction(threadId, body);
      setState((s) => applyThreadEvent(s, { type: "thread.comment.added", comment }));
      return true;
    } catch (err) {
      console.error(err);
      toast.error("Couldn't post that reply. Please try again.");
      return false;
    }
  }, []);

  const remove = useCallback(
    async (comment: ThreadComment, isStarter: boolean) => {
      const threadId = comment.thread_id;
      if (!isStarter) {
        setState((s) =>
          applyThreadEvent(s, { type: "thread.comment.deleted", threadId, commentId: comment.id }),
        );
      }
      if (isStarter) deleting.current.add(threadId);
      try {
        await deleteCanvasThreadCommentAction(comment.id);
        if (isStarter) {
          setState((s) => applyThreadEvent(s, { type: "thread.deleted", threadId }));
          if (openRef.current === threadId) setOpenId(null);
        }
      } catch (err) {
        console.error(err);
        toast.error("Couldn't delete that comment. Please try again.");
        if (!isStarter) fetchThread(threadId);
      } finally {
        deleting.current.delete(threadId);
      }
    },
    [fetchThread],
  );

  const canDelete = useCallback(
    (comment: ThreadComment) => !!viewerId && (canManage || comment.author_id === viewerId),
    [viewerId, canManage],
  );

  const list = useMemo(() => threadsNewestFirst(state), [state]);

  return {
    state,
    list,
    loaded,
    openId,
    draft,
    canComment: !!viewerId,
    canDelete,
    open,
    close,
    startDraft,
    submitDraft,
    reply,
    remove,
  };
}
