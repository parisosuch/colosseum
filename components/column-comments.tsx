"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import type { Comment } from "@/lib/colosseum/comment";
import {
  createCommentAction,
  deleteCommentAction,
  getColumnCommentsAction,
} from "@/lib/colosseum/actions";
import { fetchComments, peekComments, writeComments } from "@/lib/comment-cache";
import { useShare } from "@/components/share-context";
import { cn } from "@/lib/utils";
import { CommentComposer, CommentText } from "@/components/comment-composer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserProfilePicture } from "@/components/user-profile-picture";

const formatCommentTime = (createdAt: string) => {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  const absolute = created.toLocaleString();

  if (diffMins < 1) return { relative: "Just now", absolute };
  if (diffMins < 60) return { relative: `${diffMins}m ago`, absolute };
  if (diffHours < 24) return { relative: `${diffHours}h ago`, absolute };

  return { relative: created.toLocaleDateString(), absolute };
};

type ColumnCommentsProps = {
  columnId: number;
  // The signed-in viewer, or null when signed out (read-only).
  viewerId: string | null;
  // Whether the viewer owns the block's channel (may delete any comment).
  isOwner: boolean;
};

export default function ColumnComments({ columnId, viewerId, isOwner }: ColumnCommentsProps) {
  // null while the initial fetch is in flight; [] once loaded and empty. Seeded
  // from the client-side cache so stepping between blocks paints the thread
  // straight away instead of flashing "Loading…" every time. Always null on the
  // server (the cache is browser-only), so the permalink page's HTML and its
  // hydration agree.
  const share = useShare();
  const [comments, setComments] = useState<Comment[] | null>(() => peekComments(columnId));
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Mobile accordion: collapsed until tapped. Ignored on desktop (always shown).
  const [open, setOpen] = useState(false);

  // Keyed by block id in the modal, so this remounts per block. Show whatever
  // the cache has for this block (null when it has nothing, which is the
  // "Loading…" state), then revalidate underneath — a comment posted from
  // another session shows up within one view. The cache skips the request for
  // an entry inside its freshness window and shares one already in flight, so
  // arriving on a block a neighbour prefetch just warmed costs nothing.
  useEffect(() => {
    let active = true;
    setComments(peekComments(columnId));
    fetchComments(columnId, (id) => getColumnCommentsAction(id, share?.token))
      .then((c) => active && setComments(c))
      .catch(() => active && setComments((prev) => prev ?? []));
    return () => {
      active = false;
    };
  }, [columnId, share?.token]);

  // Keep the thread pinned to the newest (bottom) — on load, after a post, and
  // when the mobile accordion expands (the list is display:none until then). A
  // plain scroll container (not flex-col-reverse, which has a Chromium bug where
  // you can't wheel-scroll up to older content) placed at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments, open]);

  const post = async () => {
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const created = await createCommentAction(columnId, trimmed);
      // Write through, so reopening this block doesn't flash the thread as it
      // was before the post.
      const next = [...(comments ?? []), created];
      setComments(next);
      writeComments(columnId, next);
      setBody("");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't post that comment. Please try again.");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: number) => {
    const previous = comments ?? [];
    const next = previous.filter((c) => c.id !== id);
    setComments(next);
    writeComments(columnId, next);
    try {
      await deleteCommentAction(id);
    } catch (e) {
      console.error(e);
      setComments(previous);
      writeComments(columnId, previous);
      toast.error("Couldn't delete that comment. Please try again.");
    }
  };

  return (
    <div className="flex h-full flex-col min-h-0 p-3">
      {/* Header doubles as the mobile accordion toggle; inert on desktop. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex shrink-0 items-center justify-between text-label md:pointer-events-none"
      >
        <span>Comments{comments && comments.length > 0 ? ` (${comments.length})` : ""}</span>
        <ChevronDown
          className={cn("size-4 transition-transform md:hidden", open && "rotate-180")}
        />
      </button>

      {/* Collapsed on mobile until the header is tapped; always open on desktop. */}
      <div className={cn(open ? "flex" : "hidden", "mt-3 min-h-0 flex-1 flex-col md:flex")}>
        {/* Oldest→newest, top→bottom; scrolled to the bottom on load/open/post
            so the newest shows first and you scroll up for history. */}
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto max-h-[50vh] md:max-h-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {comments === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="flex gap-2">
                <UserProfilePicture
                  avatarUrl={c.author_avatar_url}
                  handle={c.author_handle}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/${c.author_handle}`}
                      className="text-xs font-medium hover:underline"
                    >
                      @{c.author_handle}
                    </Link>
                    {(() => {
                      const { relative, absolute } = formatCommentTime(c.created_at);
                      return (
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger asChild>
                            <span className="font-mono text-xs text-muted-foreground cursor-default">
                              {relative}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{absolute}</TooltipContent>
                        </Tooltip>
                      );
                    })()}
                    {viewerId && (isOwner || viewerId === c.author_id) ? (
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        className="ml-auto text-xs text-muted-foreground hover:text-destructive-text"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <CommentText body={c.body} />
                </div>
              </div>
            ))
          )}
        </div>

        {viewerId ? (
          <CommentComposer
            className="mt-3 shrink-0"
            value={body}
            onChange={setBody}
            onSubmit={post}
            busy={posting}
          />
        ) : null}
      </div>
    </div>
  );
}
