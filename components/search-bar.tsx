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

// Each of the three searches returns up to ten rows, and thirty of them under
// one heading-less scroll is a list nobody reads to the end of. Show the top
// few per group and name what was left out, so a searcher can tell whether to
// narrow the query or open the palette.
const RESULT_LIMIT = 5;

function groupHeading(label: string, shown: number, total: number): string {
  return shown < total ? `${label} (${shown} of ${total})` : label;
}

// Same shape as cmdk's group headings in the command palette, so the dropdown
// and the palette read as one surface.
function GroupHeading({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{children}</p>;
}

// Nav search box over everyone's public content plus the viewer's own: profiles,
// channels, and blocks. Debounced, with results in a dropdown under the input;
// each result carries its owner's handle for the link.
export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    query: searchedQuery,
    results: { profiles, channels, columns },
    searching,
  } = useSearch(query);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasResults = profiles.length > 0 || channels.length > 0 || columns.length > 0;
  const shownProfiles = profiles.slice(0, RESULT_LIMIT);
  const shownChannels = channels.slice(0, RESULT_LIMIT);
  const shownColumns = columns.slice(0, RESULT_LIMIT);

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search Colosseum"
        aria-label="Search profiles, channels, and columns"
        className="pl-8"
      />
      {open && searchedQuery ? (
        <div className="absolute z-50 mt-1 w-full max-h-96 overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
          {!hasResults ? (
            // Nothing rather than "No results." while a search is in flight —
            // the answer isn't back yet, so saying there is none is wrong.
            searching ? null : (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">No results.</p>
            )
          ) : (
            <>
              {shownProfiles.length > 0 ? (
                <div>
                  <GroupHeading>
                    {groupHeading("People", shownProfiles.length, profiles.length)}
                  </GroupHeading>
                  {shownProfiles.map((profile) => (
                    <Link
                      key={`profile-${profile.handle}`}
                      href={`/${profile.handle}`}
                      className="block truncate rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={() => setOpen(false)}
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
                      className="block truncate rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={() => setOpen(false)}
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
                      className="block truncate rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={() => setOpen(false)}
                    >
                      {blockLabel(column)}
                    </Link>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
