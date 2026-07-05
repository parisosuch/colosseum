"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Input } from "./ui/input";
import type { Channel } from "@/lib/colosseum/channel";
import type { Column } from "@/lib/colosseum/column";
import { searchAction } from "@/lib/colosseum/actions";

function blockLabel(column: Column): string {
  return column.title || column.url || column.text || "Untitled";
}

// Search inside the mobile drawer. Unlike the nav SearchBar's anchored
// dropdown, results fill the drawer body as a list; tapping one navigates and
// closes the drawer (onClose).
export function MobileSearch({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when the drawer opens (avoids the autoFocus attribute,
  // which the a11y lint disallows).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    (async () => {
      const { channels: channelResults, columns: columnResults } =
        await searchAction(debouncedQuery);
      if (cancelled) return;
      setChannels(channelResults);
      setColumns(columnResults);
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const hasResults = channels.length > 0 || columns.length > 0;

  return (
    <div className="flex min-h-[60vh] flex-col gap-3 px-4 pb-6">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your channels and blocks"
          aria-label="Search your channels and blocks"
          // text-base (16px) so iOS doesn't zoom on focus.
          className="pl-8 text-base"
        />
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {debouncedQuery.trim() && !hasResults ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">No results.</p>
        ) : null}

        {channels.map((channel) => (
          <Link
            key={`channel-${channel.id}`}
            href={`/${handle}/${channel.id}`}
            onClick={onClose}
            className="rounded-md px-2 py-2.5 text-sm hover:bg-accent"
          >
            {channel.title}
            <span className="ml-2 text-xs text-muted-foreground">channel</span>
          </Link>
        ))}

        {columns.map((column) => (
          <Link
            key={`block-${column.id}`}
            href={`/${handle}/${column.channel_id}/${column.id}`}
            onClick={onClose}
            className="truncate rounded-md px-2 py-2.5 text-sm hover:bg-accent"
          >
            {blockLabel(column)}
            <span className="ml-2 text-xs text-muted-foreground">block</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
