// The channel page's controls as URL query: `?sort=&type=&q=&view=`. Kept in the
// URL so Back from the canvas, a reload and a shared link all land on the board
// as it was. Defaults are left out, so an untouched channel keeps its bare URL.

import type { ColumnFilter, ColumnSort } from "@/lib/colosseum/column";

export type ChannelView = "grid" | "list";

export type ChannelQuery = {
  sort: ColumnSort;
  type: ColumnFilter;
  q: string;
  view: ChannelView;
};

export const DEFAULT_CHANNEL_QUERY: ChannelQuery = {
  sort: "manual",
  type: "all",
  q: "",
  view: "grid",
};

const SORTS: readonly ColumnSort[] = ["manual", "newest", "oldest", "title_az", "title_za"];
const TYPES: readonly ColumnFilter[] = ["all", "url", "text", "image", "video", "pdf", "channel"];
const VIEWS: readonly ChannelView[] = ["grid", "list"];

// A search longer than this is a pasted paragraph, not a search.
const MAX_Q = 200;

type ParamSource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function read(source: ParamSource, key: string): string | undefined {
  if (!source) return undefined;
  if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
  const v = source[key];
  return Array.isArray(v) ? v[0] : v;
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// Anything unknown or malformed falls back to the default rather than failing:
// these come straight from a URL anyone can edit.
export function parseChannelQuery(source: ParamSource): ChannelQuery {
  return {
    sort: pick(read(source, "sort"), SORTS, DEFAULT_CHANNEL_QUERY.sort),
    type: pick(read(source, "type"), TYPES, DEFAULT_CHANNEL_QUERY.type),
    q: (read(source, "q") ?? "").slice(0, MAX_Q),
    view: pick(read(source, "view"), VIEWS, DEFAULT_CHANNEL_QUERY.view),
  };
}

// The query string for `state`, without the leading "?", in a fixed key order
// so equal states give equal URLs. `extra` carries params the controls don't
// own (the board's `block`), which are appended after them.
export function channelQueryString(
  state: Partial<ChannelQuery>,
  extra: Record<string, string | number | null | undefined> = {},
): string {
  const params = new URLSearchParams();
  const full = { ...DEFAULT_CHANNEL_QUERY, ...state };
  if (full.sort !== DEFAULT_CHANNEL_QUERY.sort) params.set("sort", full.sort);
  if (full.type !== DEFAULT_CHANNEL_QUERY.type) params.set("type", full.type);
  const q = full.q.trim();
  if (q) params.set("q", q);
  if (full.view !== DEFAULT_CHANNEL_QUERY.view) params.set("view", full.view);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function channelHref(
  base: string,
  state: Partial<ChannelQuery>,
  extra: Record<string, string | number | null | undefined> = {},
): string {
  const qs = channelQueryString(state, extra);
  return qs ? `${base}?${qs}` : base;
}
