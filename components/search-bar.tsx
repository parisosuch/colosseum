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
              {profiles.map((profile) => (
                <Link
                  key={`profile-${profile.handle}`}
                  href={`/${profile.handle}`}
                  className="block truncate rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => setOpen(false)}
                >
                  @{profile.handle}
                  <span className="ml-2 text-xs text-muted-foreground">user</span>
                </Link>
              ))}
              {channels.map((channel) => (
                <Link
                  key={`channel-${channel.id}`}
                  href={`/${channel.handle}/${channel.id}`}
                  className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => setOpen(false)}
                >
                  {channel.title}
                  <span className="ml-2 text-xs text-muted-foreground">channel</span>
                </Link>
              ))}
              {columns.map((column) => (
                <Link
                  key={`block-${column.id}`}
                  href={`/${column.handle}/${column.channel_id}/${column.id}`}
                  className="block truncate rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => setOpen(false)}
                >
                  {blockLabel(column)}
                  <span className="ml-2 text-xs text-muted-foreground">column</span>
                </Link>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
