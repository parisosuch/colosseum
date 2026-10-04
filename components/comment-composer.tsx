"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { searchProfilesAction } from "@/lib/colosseum/actions";
import { activeMention, parseMentions } from "@/lib/colosseum/mentions";
import type { ProfileSearchResult } from "@/lib/colosseum/user";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserProfilePicture } from "@/components/user-profile-picture";

// Mirrors MAX_COMMENT_LENGTH in lib/colosseum/comment.ts; kept as a literal so
// this client file never imports the server-only module. The action re-validates.
export const MAX_COMMENT_LENGTH = 2000;

// The comment box with @-mention autocomplete, shared by block comments and
// canvas threads. Enter posts and Shift+Enter adds a newline. While the
// mention list is open, arrows, Tab, Enter and Escape drive it instead.
export function CommentComposer({
  value,
  onChange,
  onSubmit,
  busy,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  mentions = "above",
  onEscape,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  // A post is in flight: the button waits for it.
  busy: boolean;
  placeholder?: string;
  submitLabel?: string;
  // Which side of the box the mention list opens on: above when the composer
  // sits at the bottom of its panel, below when it's at the top.
  mentions?: "above" | "below";
  // Escape with no mention list open, for a composer in a popover.
  onEscape?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The fragment being typed, matching profiles, and the highlighted row.
  // `mention` is null unless the caret sits inside an `@…`.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [index, setIndex] = useState(0);
  const open = mention !== null && results.length > 0;

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Profile lookup for the active mention fragment, fired on every keystroke for
  // instant feedback (skips the empty "just typed @" case so we don't dump every
  // user). The `active` guard drops a stale response so out-of-order results
  // can't clobber a newer query.
  const query = mention?.query ?? "";
  useEffect(() => {
    if (query.length < 1) {
      setResults([]);
      return;
    }
    let active = true;
    searchProfilesAction(query)
      .then((r) => active && setResults(r.slice(0, 6)))
      .catch(() => active && setResults([]));
    return () => {
      active = false;
    };
  }, [query]);

  useEffect(() => setIndex(0), [results]);

  // Recompute the active mention from the textarea's current value + caret.
  const sync = (el: HTMLTextAreaElement) => {
    setMention(activeMention(el.value, el.selectionStart ?? el.value.length));
  };

  // Replace the `@fragment` at the caret with the chosen handle + a trailing
  // space, then restore focus and caret after it.
  const accept = (handle: string) => {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, mention.start);
    const insert = `@${handle} `;
    onChange(before + insert + value.slice(caret));
    setMention(null);
    setResults([]);
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
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={value}
          maxLength={MAX_COMMENT_LENGTH}
          placeholder={placeholder}
          aria-label={placeholder.replace(/…$/, "")}
          rows={2}
          className="resize-none text-sm [field-sizing:content]"
          onChange={(e) => {
            onChange(e.target.value);
            sync(e.target);
          }}
          onClick={(e) => sync(e.currentTarget)}
          onKeyUp={(e) => {
            if (open && ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key)) {
              return;
            }
            sync(e.currentTarget);
          }}
          // Delay so a mousedown on a suggestion still registers before close.
          onBlur={() => setTimeout(() => setMention(null), 120)}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => (i + 1) % results.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => (i - 1 + results.length) % results.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                accept(results[index].handle);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setMention(null);
                return;
              }
            }
            if (e.key === "Escape" && onEscape) {
              e.preventDefault();
              onEscape();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        {open ? (
          <ul
            className={cn(
              "absolute left-0 right-0 z-50 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md",
              mentions === "above" ? "bottom-full mb-1" : "top-full mt-1",
            )}
          >
            {results.map((p, i) => (
              <li key={p.handle}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(p.handle);
                  }}
                  onMouseEnter={() => setIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
                    i === index ? "bg-accent" : "",
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
        <Button size="sm" disabled={!value.trim() || busy} onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

// A comment's body with its @mentions linked to their profiles.
export function CommentText({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parseMentions(body).map((seg) =>
        seg.type === "mention" ? (
          <Link key={seg.start} href={`/${seg.handle}`} className="font-semibold hover:underline">
            {seg.raw}
          </Link>
        ) : (
          <span key={seg.start}>{seg.value}</span>
        ),
      )}
    </p>
  );
}
