"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Input } from "./ui/input";
import type { ChannelSearchResult } from "@/lib/colosseum/channel";
import type { Column, ColumnSearchResult } from "@/lib/colosseum/column";
import type { ProfileSearchResult } from "@/lib/colosseum/user";
import { searchAction } from "@/lib/colosseum/actions";

function blockLabel(column: Column): string {
  return column.title || column.url || column.text || "Untitled";
}

// Search inside the mobile drawer. Unlike the nav SearchBar's anchored
// dropdown, results fill the drawer body as a list; tapping one navigates and
// closes the drawer (onClose). Searches everyone's public content plus the
// viewer's own; each result carries its owner's handle for the link.
export function MobileSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [profiles, setProfiles] = useState<ProfileSearchResult[]>([]);
  const [channels, setChannels] = useState<ChannelSearchResult[]>([]);
  const [columns, setColumns] = useState<ColumnSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when the drawer opens (avoids the autoFocus attribute,
  // which the a11y lint disallows).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 50);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setProfiles([]);
      setChannels([]);
      setColumns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await searchAction(debouncedQuery);
      if (cancelled) return;
      setProfiles(results.profiles);
      setChannels(results.channels);
      setColumns(results.columns);
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const hasResults = profiles.length > 0 || channels.length > 0 || columns.length > 0;

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
          aria-label="Search profiles, channels, and blocks"
          // text-base (16px) so iOS doesn't zoom on focus.
          className="pl-8 text-base"
        />
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {debouncedQuery.trim() && !hasResults ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">No results.</p>
        ) : null}

        {profiles.map((profile) => (
          <Link
            key={`profile-${profile.handle}`}
            href={`/${profile.handle}`}
            onClick={onClose}
            className="truncate px-2 py-2.5 text-sm hover:bg-accent border-b"
          >
            @{profile.handle}
            <span className="ml-2 text-xs text-muted-foreground">user</span>
          </Link>
        ))}

        {channels.map((channel) => (
          <Link
            key={`channel-${channel.id}`}
            href={`/${channel.handle}/${channel.id}`}
            onClick={onClose}
            className="px-2 py-2.5 text-sm hover:bg-accent border-b"
          >
            {channel.title}
            <span className="ml-2 text-xs text-muted-foreground">channel</span>
          </Link>
        ))}

        {columns.map((column) => (
          <Link
            key={`block-${column.id}`}
            href={`/${column.handle}/${column.channel_id}/${column.id}`}
            onClick={onClose}
            className="truncate px-2 py-2.5 text-sm hover:bg-accent border-b"
          >
            {blockLabel(column)}
            <span className="ml-2 text-xs text-muted-foreground">block</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
