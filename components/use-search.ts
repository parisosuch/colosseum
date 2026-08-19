"use client";

import { useEffect, useRef, useState } from "react";

import { searchAction } from "@/lib/colosseum/actions";
import type { ChannelSearchResult } from "@/lib/colosseum/channel";
import type { ColumnSearchResult } from "@/lib/colosseum/column";
import type { ProfileSearchResult } from "@/lib/colosseum/user";

export type SearchResults = {
  profiles: ProfileSearchResult[];
  channels: ChannelSearchResult[];
  columns: ColumnSearchResult[];
};

const EMPTY: SearchResults = { profiles: [], channels: [], columns: [] };

// Trigram indexes need three characters before they can narrow anything, so a
// one- or two-character query seq-scans every searched table to produce results
// nobody stops to read on their way to a longer word.
export const MIN_SEARCH_LENGTH = 3;

// Trailing edge only, so this fires once typing pauses rather than once per
// character. Typing runs slower than this per keystroke, so the wait lands
// between words; what it drops are the intermediate queries whose responses
// were already being discarded as stale.
const DEBOUNCE_MS = 150;

// Shared search state for the three surfaces that call searchAction: the nav
// SearchBar, the mobile drawer, and the command palette. Each keystroke used to
// be its own round trip on at least one of them, and each round trip is three
// queries.
//
// `results` holds the last successful response until the next one lands, so a
// query in flight leaves the previous results on screen instead of blanking the
// list and filling it back in. Callers that render a "No results" state should
// gate it on `searching` being false, or it shows up in that gap.
export function useSearch(input: string): {
  query: string;
  results: SearchResults;
  searching: boolean;
} {
  const trimmed = input.trim();
  const query = trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : "";
  // Per-mount, so it lives as long as the palette session or the page and
  // never has to be invalidated: a mounted surface can't outlast a write by
  // long enough for a stale hit to matter.
  const cache = useRef(new Map<string, SearchResults>());
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query) {
      setResults(EMPTY);
      setSearching(false);
      return;
    }

    // Backspacing to a prefix that was already searched, or retyping the same
    // word, is answered without a round trip — and without the debounce, since
    // there is nothing to wait for.
    const cached = cache.current.get(query);
    if (cached) {
      setResults(cached);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const next = await searchAction(query);
        if (cancelled) return;
        cache.current.set(query, next);
        setResults(next);
      } finally {
        // A failed search has to clear `searching` too, or the surfaces that
        // hide their empty state behind it wait on a response that never
        // comes. The miss isn't cached, so the next keystroke retries.
        if (!cancelled) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { query, results, searching };
}
