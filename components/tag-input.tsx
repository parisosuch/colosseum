"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge, badgeVariants } from "./ui/badge";
import { Input } from "./ui/input";

// Pill editor for a `#tag` list. Tags are stored bare (no `#`); the `#` is only
// shown. A `+` pill trails the tags (and stands alone when there are none);
// clicking it swaps in an inline input. Enter/comma commit and keep the input
// open for the next tag, blur/Escape close it. Input is sanitized as it's typed
// (see `sanitize`) so tags are always alphanumeric-with-dashes.
export default function TagInput({
  tags,
  onChange,
  disabled,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Tags are alphanumeric-with-dashes: spaces become `-`, everything else is
  // dropped as it's typed. Runs of dashes collapse so "a  b" → "a-b", not
  // "a--b". Leading/trailing dashes are trimmed on commit, not mid-type (so you
  // can still type the `-` between two words).
  const sanitize = (value: string) =>
    value
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .replace(/-+/g, "-");

  const commit = () => {
    const tag = draft.replace(/^-+|-+$/g, "");
    if (tag) {
      onChange([...new Set([...tags, tag])]);
    }
    setDraft("");
  };

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1">
          #{tag}
          {!disabled ? (
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => remove(tag)}
              className="hover:text-foreground"
            >
              <span aria-hidden>×</span>
            </button>
          ) : null}
        </Badge>
      ))}
      {disabled ? null : editing ? (
        <Input
          ref={(el) => el?.focus()}
          value={draft}
          placeholder="tag"
          className="h-5 w-24 px-2 py-0 text-xs [field-sizing:content]"
          onChange={(e) => setDraft(sanitize(e.target.value))}
          onBlur={() => {
            commit();
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              // Commit and stay open so several tags can be added in a row.
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft("");
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          aria-label="Add tag"
          onClick={() => setEditing(true)}
          className={cn(badgeVariants({ variant: "secondary" }), "h-5 cursor-pointer gap-0 px-1.5")}
        >
          <Plus className="size-3" />
        </button>
      )}
    </div>
  );
}
