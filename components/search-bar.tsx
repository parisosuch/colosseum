"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Input } from "./ui/input";
import { Channel, searchUserChannels } from "@/lib/colosseum/channel";
import { Column, searchUserColumns } from "@/lib/colosseum/column";
import { createClient } from "@/lib/supabase/client";

function blockLabel(column: Column): string {
  return column.title || column.url || column.text || "Untitled";
}

// Nav search box, scoped to the signed-in user's own channels and blocks
// (issue #31 — no cross-user search while single-user). Debounced like the
// per-channel search box, with results in a dropdown under the input.
export default function SearchBar({ userId, handle }: { userId: string; handle: string }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setChannels([]);
      setColumns([]);
      return;
    }

    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const [channelResults, columnResults] = await Promise.all([
        searchUserChannels(supabase, userId, debouncedQuery),
        searchUserColumns(supabase, userId, debouncedQuery),
      ]);
      if (cancelled) return;
      setChannels(channelResults);
      setColumns(columnResults);
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, userId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasResults = channels.length > 0 || columns.length > 0;

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
        placeholder="Search your channels and blocks"
        aria-label="Search your channels and blocks"
        className="pl-8"
      />
      {open && debouncedQuery.trim() ? (
        <div className="absolute z-50 mt-1 w-full max-h-96 overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
          {!hasResults ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No results.</p>
          ) : (
            <>
              {channels.map((channel) => (
                <Link
                  key={`channel-${channel.id}`}
                  href={`/${handle}/${channel.id}`}
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
                  href={`/${handle}/${column.channel_id}/${column.id}`}
                  className="block truncate rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => setOpen(false)}
                >
                  {blockLabel(column)}
                  <span className="ml-2 text-xs text-muted-foreground">block</span>
                </Link>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
