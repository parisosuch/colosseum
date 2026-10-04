"use client";

import Link from "next/link";
import { Ellipsis, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CommentComposer, CommentText } from "@/components/comment-composer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { worldToScreen, type Point } from "@/lib/canvas/camera";
import {
  currentAnchor,
  pinPosition,
  popoverPlacement,
  repliesLabel,
  threadPlace,
  timeAgo,
} from "@/lib/canvas/threads";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import type { CanvasThread, ThreadComment } from "@/lib/realtime/canvas-threads";
import { cn } from "@/lib/utils";
import { IconButton } from "./canvas-chrome";
import type { CanvasStore } from "./canvas-store";
import type { CanvasThreads } from "./use-canvas-threads";
import { useCanvas } from "./use-canvas";

// Pins further than this outside the view aren't drawn.
const CULL_MARGIN = 80;

function initials(handle: string): string {
  return handle.slice(0, 2).toUpperCase();
}

export function ThreadAvatar({
  handle,
  avatarUrl,
  className,
}: {
  handle: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-5", className)} aria-hidden>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className="bg-muted text-[10px]">{initials(handle)}</AvatarFallback>
    </Avatar>
  );
}

// The comment pins, in screen space over the board so they stay one size at
// every zoom, and the open thread beside its pin. Rendered inside the board,
// which leaves presses on anything marked data-canvas-pin or data-canvas-ui to
// them.
export function ThreadLayer({
  store,
  threads,
  nameOf,
  viewer,
  touchOnly,
  channelPath,
  loginHref,
}: {
  store: CanvasStore;
  threads: CanvasThreads;
  // An element's name as the layers panel shows it, for "On …".
  nameOf: (elementId: string) => string | null;
  // The signed-in viewer, whose avatar a pin being placed shows.
  viewer: { handle: string; avatarUrl: string | null } | null;
  // Phones and tablets read threads and don't post (see ThreadPopover).
  touchOnly: boolean;
  channelPath: string;
  loginHref: string;
}) {
  const camera = useCanvas(store, "camera", (s) => s.camera);
  // Positions come from the doc, so any edit can move a pin.
  useCanvas(store, "doc", (s) => s.docState);
  const elements = elementsOf(store.doc);
  // Where each pin was last drawn, for a pinned thread whose element this
  // client has already seen deleted, until the server frees it.
  const last = useRef(new Map<number, Point>());

  const { w, h } = store.viewport;
  const positions = new Map<number, Point>();
  for (const t of threads.state.threads.values()) {
    const at = pinPosition(elements, t, last.current.get(t.id));
    last.current.set(t.id, at);
    positions.set(t.id, at);
  }
  for (const id of last.current.keys()) if (!positions.has(id)) last.current.delete(id);

  const draftAt = threads.draft ? currentAnchor(elements, threads.draft) : null;
  const open = threads.openId !== null ? threads.state.threads.get(threads.openId) : undefined;
  const openAt = open ? positions.get(open.id) : undefined;

  // Escape closes the thread or the pin being placed, wherever focus is,
  // unless a menu or dialog on top of it takes the key first. The comment box
  // marks the Escapes it uses itself (closing its mention list).
  const showing = threads.openId !== null || threads.draft !== null;
  const { close } = threads;
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const above = document.querySelectorAll(
        '[role="alertdialog"], [role="menu"], [role="dialog"]',
      );
      if ([...above].some((d) => !d.closest("[data-canvas-ui]"))) return;
      e.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showing, close]);

  const visible = (p: Point) =>
    p.x > -CULL_MARGIN && p.y > -CULL_MARGIN && p.x < w + CULL_MARGIN && p.y < h + CULL_MARGIN;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {[...threads.state.threads.values()].map((t) => {
        const s = worldToScreen(camera, positions.get(t.id)!);
        if (!visible(s) && t.id !== threads.openId) return null;
        return (
          <Pin
            key={t.id}
            at={s}
            thread={t}
            active={t.id === threads.openId}
            onClick={() => (t.id === threads.openId ? threads.close() : threads.open(t.id))}
          />
        );
      })}
      {draftAt && viewer ? (
        <Pin at={worldToScreen(camera, draftAt)} active draftOf={viewer} onClick={threads.close} />
      ) : null}

      {open && openAt ? (
        <Popover store={store} pin={worldToScreen(camera, openAt)} touchOnly={touchOnly}>
          <ThreadPopover
            key={open.id}
            thread={open}
            threads={threads}
            place={threadPlace(open, nameOf)}
            readOnly={touchOnly}
            channelPath={channelPath}
            loginHref={loginHref}
          />
        </Popover>
      ) : draftAt && threads.draft ? (
        <Popover store={store} pin={worldToScreen(camera, draftAt)} touchOnly={touchOnly}>
          <DraftPopover
            threads={threads}
            place={threadPlace(
              { element_id: "elementId" in threads.draft ? threads.draft.elementId : null },
              nameOf,
            )}
          />
        </Popover>
      ) : null}
    </div>
  );
}

function Pin({
  at,
  thread,
  draftOf,
  active,
  onClick,
}: {
  at: Point;
  thread?: CanvasThread;
  // A pin being placed: the viewer's avatar and no count yet.
  draftOf?: { handle: string; avatarUrl: string | null };
  active: boolean;
  onClick: () => void;
}) {
  const handle = thread?.starter?.author_handle ?? draftOf?.handle ?? "";
  const avatarUrl = thread?.starter?.author_avatar_url ?? draftOf?.avatarUrl;
  const label = thread
    ? `Thread by @${handle}, ${repliesLabel(thread.reply_count)}`
    : "New comment";
  return (
    <button
      type="button"
      data-canvas-pin
      aria-label={label}
      aria-expanded={active}
      onClick={onClick}
      // The point is the bottom-left corner, the one that isn't rounded.
      style={{ transform: `translate(${at.x}px, ${at.y}px) translateY(-100%)` }}
      className={cn(
        "focus-ring pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 rounded-full rounded-bl-sm border py-1 pl-1 shadow transition-colors duration-micro ease-out",
        thread ? "pr-2" : "pr-1",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-foreground hover:bg-accent",
      )}
    >
      <ThreadAvatar handle={handle} avatarUrl={avatarUrl} className="text-foreground" />
      {thread ? (
        <span className="text-xs font-medium tabular-nums leading-4">{thread.reply_count}</span>
      ) : null}
    </button>
  );
}

// The floating card a thread opens in, beside its pin and inside the part of
// the board the chrome leaves open. On a phone it's a sheet along the bottom.
function Popover({
  store,
  pin,
  touchOnly,
  children,
}: {
  store: CanvasStore;
  pin: Point;
  touchOnly: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 352, h: 200 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { viewport: v, insets: i } = store;
  const area = {
    x: i.left + 8,
    y: i.top + 8,
    w: v.w - i.left - i.right - 16,
    h: v.h - i.top - i.bottom - 16,
  };
  if (touchOnly) {
    return (
      <div
        ref={ref}
        data-canvas-ui
        className="pointer-events-auto absolute inset-x-2 bottom-2 flex max-h-[60%] flex-col rounded-lg border bg-background p-3 shadow-md animate-in fade-in-0 slide-in-from-bottom-2 ![animation-duration:var(--duration-panel)] [animation-timing-function:var(--ease-out)]"
      >
        {children}
      </div>
    );
  }
  const { left, top } = popoverPlacement(pin, size, area);
  return (
    <div
      ref={ref}
      data-canvas-ui
      style={{ left, top, maxHeight: Math.max(160, area.h) }}
      className="pointer-events-auto absolute flex w-[22rem] max-w-[calc(100%-1rem)] flex-col rounded-lg border bg-background p-3 shadow-md animate-in fade-in-0 zoom-in-95 ![animation-duration:var(--duration-ui)] [animation-timing-function:var(--ease-out)]"
    >
      {children}
    </div>
  );
}

function PopoverHeader({
  place,
  onClose,
  menu,
  titleId,
}: {
  place: string;
  onClose: () => void;
  menu?: React.ReactNode;
  titleId: string;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <h2
        id={titleId}
        className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground"
      >
        {place}
      </h2>
      {menu}
      <IconButton label="Close thread" onClick={onClose}>
        <X />
      </IconButton>
    </div>
  );
}

function ThreadPopover({
  thread,
  threads,
  place,
  readOnly,
  channelPath,
  loginHref,
}: {
  thread: CanvasThread;
  threads: CanvasThreads;
  place: string;
  // Phones read threads only.
  readOnly: boolean;
  channelPath: string;
  loginHref: string;
}) {
  const comments = threads.state.comments.get(thread.id);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleId = `thread-${thread.id}-title`;

  // Focus moves into the thread when it opens, so Escape and Tab work from
  // there, and the newest comment is in view.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments?.length]);

  const starter = thread.starter;
  const canDeleteThread = !!starter && threads.canDelete(starter);

  const post = async () => {
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    if (await threads.reply(thread.id, trimmed)) setBody("");
    setPosting(false);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${channelPath}?thread=${thread.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="flex min-h-0 flex-col gap-4 outline-none"
    >
      <PopoverHeader
        place={place}
        titleId={titleId}
        onClose={threads.close}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Thread options">
                <Ellipsis />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copyLink()}>Copy link</DropdownMenuItem>
              {canDeleteThread ? (
                <DropdownMenuItem
                  className="text-destructive-text focus:text-destructive-text"
                  onSelect={() => setConfirming(true)}
                >
                  Delete thread
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div ref={scrollRef} className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">
        {comments === undefined ? (
          <div className="flex flex-col gap-4" role="status">
            <span className="sr-only">Loading the thread</span>
            {Array.from({ length: Math.min(3, thread.reply_count + 1) }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          comments.map((c, i) => (
            <CommentItem
              key={c.id}
              comment={c}
              onDelete={
                threads.canDelete(c) && !readOnly
                  ? () => (i === 0 ? setConfirming(true) : void threads.remove(c, false))
                  : null
              }
            />
          ))
        )}
      </div>

      {readOnly ? (
        <p className="text-caption">Reply from a computer.</p>
      ) : threads.canComment ? (
        <CommentComposer
          className="shrink-0"
          value={body}
          onChange={setBody}
          onSubmit={() => void post()}
          busy={posting}
          placeholder="Reply…"
          submitLabel="Reply"
          onEscape={threads.close}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link href={loginHref} className="underline underline-offset-4">
            Log in
          </Link>{" "}
          to reply.
        </p>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
            <AlertDialogDescription>
              {thread.reply_count > 0
                ? `Its first comment starts the thread, so ${repliesLabel(thread.reply_count)} go with it.`
                : "The pin comes off the canvas for everyone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => (starter ? void threads.remove(starter, true) : undefined)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CommentItem({
  comment,
  onDelete,
}: {
  comment: ThreadComment;
  onDelete: (() => void) | null;
}) {
  const created = new Date(comment.created_at);
  return (
    <article className="flex gap-2">
      <ThreadAvatar
        handle={comment.author_handle}
        avatarUrl={comment.author_avatar_url}
        className="size-6"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/${comment.author_handle}`}
            className="truncate text-xs font-medium hover:underline"
          >
            @{comment.author_handle}
          </Link>
          <time
            dateTime={comment.created_at}
            title={created.toLocaleString()}
            className="shrink-0 font-mono text-xs text-muted-foreground"
          >
            {timeAgo(created, new Date())}
          </time>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="focus-ring ml-auto rounded-sm text-xs text-muted-foreground transition-colors duration-micro hover:text-destructive-text"
            >
              Delete
            </button>
          ) : null}
        </div>
        <CommentText body={comment.body} />
      </div>
    </article>
  );
}

function DraftPopover({ threads, place }: { threads: CanvasThreads; place: string }) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const post = async () => {
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    // On success the draft becomes the thread and this unmounts.
    if (!(await threads.submitDraft(trimmed))) setPosting(false);
  };
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby="thread-draft-title"
      className="flex flex-col gap-4"
    >
      <PopoverHeader place={place} titleId="thread-draft-title" onClose={threads.close} />
      <CommentComposer
        value={body}
        onChange={setBody}
        onSubmit={() => void post()}
        busy={posting}
        mentions="below"
        onEscape={threads.close}
        autoFocus
      />
    </div>
  );
}
