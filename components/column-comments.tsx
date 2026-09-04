"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import type { Comment } from "@/lib/colosseum/comment";
import { activeMention, parseMentions } from "@/lib/colosseum/mentions";
import type { ProfileSearchResult } from "@/lib/colosseum/user";
import {
  createCommentAction,
  deleteCommentAction,
  getColumnCommentsAction,
  searchProfilesAction,
} from "@/lib/colosseum/actions";
import { fetchComments, peekComments, writeComments } from "@/lib/comment-cache";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserProfilePicture } from "@/components/user-profile-picture";

// Mirrors MAX_COMMENT_LENGTH in lib/colosseum/comment.ts; kept as a literal so
// this client file never imports the server-only module. The action re-validates.
const MAX_COMMENT_LENGTH = 2000;

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
  const [comments, setComments] = useState<Comment[] | null>(() => peekComments(columnId));
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // @-mention autocomplete: the fragment being typed, matching profiles, and the
  // highlighted row. `mention` is null unless the caret sits inside an `@…`.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionResults, setMentionResults] = useState<ProfileSearchResult[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOpen = mention !== null && mentionResults.length > 0;
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
    fetchComments(columnId, getColumnCommentsAction)
      .then((c) => active && setComments(c))
      .catch(() => active && setComments((prev) => prev ?? []));
    return () => {
      active = false;
    };
  }, [columnId]);

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

  // Profile lookup for the active mention fragment, fired on every keystroke for
  // instant feedback (skips the empty "just typed @" case so we don't dump every
  // user). The `active` guard drops a stale response so out-of-order results
  // can't clobber a newer query.
  const query = mention?.query ?? "";
  useEffect(() => {
    if (query.length < 1) {
      setMentionResults([]);
      return;
    }
    let active = true;
    searchProfilesAction(query)
      .then((r) => active && setMentionResults(r.slice(0, 6)))
      .catch(() => active && setMentionResults([]));
    return () => {
      active = false;
    };
  }, [query]);

  useEffect(() => setMentionIndex(0), [mentionResults]);

  // Recompute the active mention from the textarea's current value + caret.
  const syncMention = (el: HTMLTextAreaElement) => {
    setMention(activeMention(el.value, el.selectionStart ?? el.value.length));
  };

  // Replace the `@fragment` at the caret with the chosen handle + a trailing
  // space, then restore focus and caret after it.
  const acceptMention = (handle: string) => {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, mention.start);
    const insert = `@${handle} `;
    setBody(before + insert + body.slice(caret));
    setMention(null);
    setMentionResults([]);
    const pos = before.length + insert.length;
    requestAnimationFrame(() => {
      const t = textareaRef.current;
      if (t) {
        t.focus();
        t.setSelectionRange(pos, pos);
      }
    });
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
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {parseMentions(c.body).map((seg) =>
                      seg.type === "mention" ? (
                        <Link
                          key={seg.start}
                          href={`/${seg.handle}`}
                          className="font-semibold hover:underline"
                        >
                          {seg.raw}
                        </Link>
                      ) : (
                        <span key={seg.start}>{seg.value}</span>
                      ),
                    )}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {viewerId ? (
          <div className="mt-3 shrink-0 space-y-2">
            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={body}
                maxLength={MAX_COMMENT_LENGTH}
                placeholder="Add a comment…"
                rows={2}
                // Enter posts; Shift+Enter adds a newline. While the @-mention
                // list is open, arrows/Tab/Enter/Escape drive it instead.
                className="resize-none text-sm [field-sizing:content]"
                onChange={(e) => {
                  setBody(e.target.value);
                  syncMention(e.target);
                }}
                onClick={(e) => syncMention(e.currentTarget)}
                onKeyUp={(e) => {
                  if (
                    mentionOpen &&
                    ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key)
                  ) {
                    return;
                  }
                  syncMention(e.currentTarget);
                }}
                // Delay so a mousedown on a suggestion still registers before close.
                onBlur={() => setTimeout(() => setMention(null), 120)}
                onKeyDown={(e) => {
                  if (mentionOpen) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((i) => (i + 1) % mentionResults.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex(
                        (i) => (i - 1 + mentionResults.length) % mentionResults.length,
                      );
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      acceptMention(mentionResults[mentionIndex].handle);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setMention(null);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    post();
                  }
                }}
              />
              {mentionOpen ? (
                // Opens upward — the composer is pinned to the bottom of the panel.
                <ul className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                  {mentionResults.map((p, i) => (
                    <li key={p.handle}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          acceptMention(p.handle);
                        }}
                        onMouseEnter={() => setMentionIndex(i)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
                          i === mentionIndex ? "bg-accent" : "",
                        )}
                      >
                        <UserProfilePicture avatarUrl={p.avatar_url} handle={p.handle} size="xs" />
                        <span className="truncate">@{p.handle}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={!body.trim() || posting} onClick={post}>
                Comment
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
