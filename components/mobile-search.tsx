"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Input } from "./ui/input";
import type { Column } from "@/lib/colosseum/column";
import { useSearch } from "@/components/use-search";

function blockLabel(column: Column): string {
  return column.title || column.url || column.text || "Untitled";
}

// Each of the three searches returns up to ten rows. Thirty rows in a drawer is
// a scroll with no landmarks, so show the top few per group and name what was
// left out.
const RESULT_LIMIT = 5;

function groupHeading(label: string, shown: number, total: number): string {
  return shown < total ? `${label} (${shown} of ${total})` : label;
}

// Same shape as cmdk's group headings in the command palette, so the drawer and
// the palette read as one surface.
function GroupHeading({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{children}</p>;
}

// Search inside the mobile drawer. Unlike the nav SearchBar's anchored
// dropdown, results fill the drawer body as a list; tapping one navigates and
// closes the drawer (onClose). Searches everyone's public content plus the
// viewer's own; each result carries its owner's handle for the link.
export function MobileSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    query: searchedQuery,
    results: { profiles, channels, columns },
    searching,
  } = useSearch(query);

  // Focus the input when the drawer opens (avoids the autoFocus attribute,
  // which the a11y lint disallows).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasResults = profiles.length > 0 || channels.length > 0 || columns.length > 0;
  const shownProfiles = profiles.slice(0, RESULT_LIMIT);
  const shownChannels = channels.slice(0, RESULT_LIMIT);
  const shownColumns = columns.slice(0, RESULT_LIMIT);

  return (
    <div className="flex min-h-[60dvh] flex-col gap-3 px-4 pb-6">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Colosseum"
          aria-label="Search profiles, channels, and columns"
          // text-base (16px) so iOS doesn't zoom on focus.
          className="pl-8 text-base"
        />
      </div>

      {/* An explicit cap, not just flex-1: the drawer stops at 80dvh but this
          column's min-h keeps it from shrinking, and a flex child with the
          default min-height:auto never scrolls — the list just ran off the
          bottom of the screen. min-h-0 lets it shrink, and the max-h holds the
          scroll region inside the drawer whatever the header measures. */}
      <div className="flex min-h-0 max-h-[50dvh] flex-1 flex-col overflow-y-auto">
        {/* Not while a search is in flight — the answer isn't back yet. */}
        {searchedQuery && !hasResults && !searching ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">No results.</p>
        ) : null}

        {shownProfiles.length > 0 ? (
          <div>
            <GroupHeading>
              {groupHeading("People", shownProfiles.length, profiles.length)}
            </GroupHeading>
            {shownProfiles.map((profile) => (
              <Link
                key={`profile-${profile.handle}`}
                href={`/${profile.handle}`}
                onClick={onClose}
                className="block truncate px-2 py-2.5 text-sm hover:bg-accent border-b"
              >
                @{profile.handle}
              </Link>
            ))}
          </div>
        ) : null}

        {shownChannels.length > 0 ? (
          <div>
            <GroupHeading>
              {groupHeading("Channels", shownChannels.length, channels.length)}
            </GroupHeading>
            {shownChannels.map((channel) => (
              <Link
                key={`channel-${channel.id}`}
                href={`/${channel.handle}/${channel.id}`}
                onClick={onClose}
                className="block truncate px-2 py-2.5 text-sm hover:bg-accent border-b"
              >
                {channel.title}
              </Link>
            ))}
          </div>
        ) : null}

        {shownColumns.length > 0 ? (
          <div>
            <GroupHeading>
              {groupHeading("Columns", shownColumns.length, columns.length)}
            </GroupHeading>
            {shownColumns.map((column) => (
              <Link
                key={`block-${column.id}`}
                href={`/${column.handle}/${column.channel_id}/${column.id}`}
                onClick={onClose}
                className="block truncate px-2 py-2.5 text-sm hover:bg-accent border-b"
              >
                {blockLabel(column)}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
