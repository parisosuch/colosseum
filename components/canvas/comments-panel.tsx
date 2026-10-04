"use client";

import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { repliesLabel, threadPlace, timeAgo } from "@/lib/canvas/threads";
import { cn } from "@/lib/utils";
import { IconButton } from "./canvas-chrome";
import { ThreadAvatar } from "./thread-layer";
import type { CanvasThreads } from "./use-canvas-threads";

// The top-right island's comments button.
export function CommentsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton
      label="Comments"
      aria-pressed={open}
      aria-expanded={open}
      onClick={onToggle}
      className={open ? "bg-secondary shadow-sm hover:bg-secondary/80" : undefined}
    >
      <MessageCircle />
    </IconButton>
  );
}

// Every thread on the canvas, newest first. Picking one centres the board on
// its pin and opens it.
export function CommentsPanel({
  threads,
  nameOf,
  onPick,
}: {
  threads: CanvasThreads;
  nameOf: (elementId: string) => string | null;
  // `row` is the row picked, which gets focus back when the thread closes.
  onPick: (threadId: number, row: HTMLElement) => void;
}) {
  const now = new Date();
  const count = threads.list.length;
  return (
    <aside
      aria-label="Comments"
      className="flex max-h-full w-72 flex-col gap-2 rounded-lg border bg-background p-4 shadow-md"
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Comments</h2>
        {threads.loaded && count > 0 ? (
          <span className="text-caption">{count === 1 ? "1 thread" : `${count} threads`}</span>
        ) : null}
      </div>
      <div className="-mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto px-1">
        {!threads.loaded ? (
          <div className="flex flex-col gap-2" role="status">
            <span className="sr-only">Loading comments</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[5.5rem] w-full" />
            ))}
          </div>
        ) : count === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="No comments yet"
            description={
              threads.canComment
                ? "Pick the comment tool (C) and click a block, a drawing or an empty spot."
                : threads.needsProfile
                  ? "Set up your profile to start a thread on this canvas."
                  : "Log in to start a thread on this canvas."
            }
            className="px-4 py-8"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {threads.list.map((t) => {
              const starter = t.starter;
              const selected = t.id === threads.openId;
              return (
                <li key={t.id}>
                  <Button
                    variant="ghost"
                    aria-current={selected ? "true" : undefined}
                    onClick={(e) => onPick(t.id, e.currentTarget)}
                    className={cn(
                      "h-auto w-full flex-col items-start justify-start gap-1 whitespace-normal p-3 text-left font-normal",
                      selected && "bg-accent",
                    )}
                  >
                    <span className="flex w-full min-w-0 items-center gap-2">
                      <ThreadAvatar
                        handle={starter?.author_handle ?? "?"}
                        avatarUrl={starter?.author_avatar_url}
                      />
                      <span className="truncate text-sm font-medium">
                        @{starter?.author_handle ?? "deleted"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(new Date(t.created_at), now)}
                      </span>
                    </span>
                    <span className="line-clamp-2 w-full break-words text-sm">
                      {starter?.body ?? ""}
                    </span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {threadPlace(t, nameOf)} · {repliesLabel(t.reply_count)}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
