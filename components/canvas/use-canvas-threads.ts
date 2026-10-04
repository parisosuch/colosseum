"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Point } from "@/lib/canvas/camera";
import {
  applyThreadEvent,
  countsInDoubt,
  currentAnchor,
  EMPTY_THREADS,
  forgetGone,
  isKnownThreadEvent,
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
import type {
  CanvasThread,
  ThreadChannelEvent,
  ThreadComment,
} from "@/lib/realtime/canvas-threads";
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
  // Signed in with a profile: may start threads and reply. Read-only viewers
  // included.
  canComment: boolean;
  // Signed in but hasn't set up a profile yet, which commenting needs.
  needsProfile: boolean;
  canDelete: (comment: ThreadComment) => boolean;
  // `opener` is what opened it (a pin, a Comments panel row), which gets
  // focus back when it closes.
  open: (id: number, opener?: HTMLElement | null) => void;
  // A press on the board closes without moving focus off the board.
  close: (opts?: { returnFocus?: boolean }) => void;
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
  hasProfile,
  canManage,
}: {
  store: CanvasStore;
  channelId: number;
  viewerId: string | null;
  // The viewer has a profile (handle, avatar): the server won't take a comment
  // without one.
  hasProfile: boolean;
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
  const canComment = !!viewerId && hasProfile;

  // Live events that arrive while a request is on its way, so its response
  // can be merged with them instead of replacing them. `windows` holds where
  // each request in flight started in the log.
  const log = useRef<{ seq: number; event: ThreadChannelEvent }[]>([]);
  const seq = useRef(0);
  const windows = useRef<number[]>([]);
  const beginWindow = useCallback(() => {
    windows.current.push(seq.current);
    return seq.current;
  }, []);
  const endWindow = useCallback((start: number): ThreadChannelEvent[] => {
    const i = windows.current.indexOf(start);
    if (i >= 0) windows.current.splice(i, 1);
    const during = log.current.filter((e) => e.seq > start).map((e) => e.event);
    const oldest = windows.current.length ? Math.min(...windows.current) : seq.current;
    log.current = log.current.filter((e) => e.seq > oldest);
    return during;
  }, []);

  // One thread with its comments. `quiet` for a background refresh, which
  // doesn't close the thread or say anything when it fails.
  const fetchThread = useCallback(
    (id: number, quiet = false) => {
      const start = beginWindow();
      getCanvasThreadAction(id)
        .then((thread) => {
          const during = endWindow(start);
          setState((s) => loadThread(s, thread, during));
        })
        .catch((err) => {
          endWindow(start);
          console.error(err);
          if (quiet) return;
          if (openRef.current === id) setOpenId(null);
          toast.error("Couldn't open that thread. It may have been deleted.");
        });
    },
    [beginWindow, endWindow],
  );

  // The list, on the first connection and again after every reconnect, since
  // events sent while the socket was down are gone. Comments loaded before
  // are dropped with the old list, so the open thread is fetched again, and
  // so is any thread a comment event came for while the list was on its way.
  const loads = useRef(0);
  useEffect(() => {
    if (status !== "connected") return;
    const id = ++loads.current;
    const start = beginWindow();
    listCanvasThreadsAction(channelId)
      .then((list) => {
        const during = endWindow(start);
        if (loads.current !== id) return;
        setState((s) => loadThreads(s, list, during));
        setLoaded(true);
        const again = new Set(countsInDoubt(during));
        if (openRef.current !== null) again.add(openRef.current);
        for (const threadId of again) fetchThread(threadId, threadId !== openRef.current);
      })
      .catch((err) => {
        endWindow(start);
        console.error(err);
        if (loads.current === id) setLoaded(true);
      });
  }, [status, channelId, beginWindow, endWindow, fetchThread]);

  // Live events from the canvas socket.
  useEffect(
    () =>
      store.onChannelEvent((event) => {
        // Sessions, block events, and any type this client doesn't know yet.
        if (!isKnownThreadEvent(event)) return;
        seq.current++;
        if (windows.current.length) log.current.push({ seq: seq.current, event });
        setState((s) => applyThreadEvent(s, event));
        if (event.type === "thread.deleted" && event.threadId === openRef.current) {
          setOpenId(null);
          // Someone else's delete; this viewer's own closes it quietly.
          if (!deleting.current.has(event.threadId)) toast("That thread was deleted.");
        }
      }),
    [store],
  );

  // Where focus goes back to when the open thread closes: what opened it, or
  // its pin, or the board when the pin is gone too.
  const opener = useRef<{ id: number; el: HTMLElement | null } | null>(null);
  const restoreFocus = useCallback(() => {
    const from = opener.current;
    opener.current = null;
    if (!from) return;
    // After the popover unmounts, or focus would land back inside it.
    requestAnimationFrame(() => {
      const target =
        (from.el?.isConnected ? from.el : null) ??
        document.querySelector<HTMLElement>(`[data-canvas-pin][data-thread="${from.id}"]`) ??
        document.querySelector<HTMLElement>('[aria-roledescription="canvas"]');
      target?.focus({ preventScroll: true });
    });
  }, []);

  const open = useCallback(
    (id: number, from: HTMLElement | null = null) => {
      setDraft(null);
      setOpenId(id);
      opener.current = { id, el: from };
      // Fresh each time: replies sent while it was closed are in the count
      // but not in a list loaded earlier.
      fetchThread(id);
    },
    [fetchThread],
  );

  const close = useCallback(
    ({ returnFocus = true }: { returnFocus?: boolean } = {}) => {
      setOpenId(null);
      setDraft(null);
      if (returnFocus) restoreFocus();
      else opener.current = null;
    },
    [restoreFocus],
  );

  // Closed some other way (deleted, by this viewer or anyone): focus can't
  // stay in a popover that's gone.
  useEffect(() => {
    if (openId === null && opener.current) restoreFocus();
  }, [openId, restoreFocus]);

  const startDraft = useCallback(
    (at: Point) => {
      if (!canComment) return;
      opener.current = null;
      setOpenId(null);
      setDraft(threadAnchorAt(elementsOf(store.doc), store.hitContext(), at, store.camera.z));
    },
    [store, canComment],
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
        opener.current = { id: thread.id, el: null };
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
        if (!isStarter) {
          setState((s) => forgetGone(s, comment.id));
          fetchThread(threadId);
        }
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
    canComment,
    needsProfile: !!viewerId && !hasProfile,
    canDelete,
    open,
    close,
    startDraft,
    submitDraft,
    reply,
    remove,
  };
}
