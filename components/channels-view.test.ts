import { expect, test } from "bun:test";

import { channelMatches, filterSortChannels, type ChannelRow } from "./channel-filter";

const row = (over: Partial<ChannelRow>): ChannelRow => ({
  id: 1,
  title: "Design Inspiration",
  description: "moodboards and type",
  access: "public",
  private: false,
  created_at: "2026-01-01T00:00:00Z",
  count: 0,
  ...over,
});

test("empty query matches everything", () => {
  expect(channelMatches(row({}), "")).toBe(true);
  expect(channelMatches(row({}), "   ")).toBe(true);
});

test("matches title and description, case-insensitively", () => {
  expect(channelMatches(row({}), "design")).toBe(true); // title
  expect(channelMatches(row({}), "TYPE")).toBe(true); // description
  expect(channelMatches(row({}), "photography")).toBe(false);
});

test("tolerates a missing description", () => {
  expect(channelMatches(row({ description: undefined }), "design")).toBe(true);
  expect(channelMatches(row({ description: undefined }), "moodboard")).toBe(false);
});

// Server order (recently-added-to desc): a, b, c.
const list = [
  row({ id: 1, title: "Beta", access: "public", count: 3 }),
  row({ id: 2, title: "alpha", access: "open", count: 10, memberOf: true }),
  row({ id: 3, title: "Gamma", access: "private", count: 1 }),
];
const ids = (rows: ChannelRow[]) => rows.map((r) => r.id);
const noFilters = { search: "", access: [] as ChannelRow["access"][], memberOf: false };

test("recent sort preserves the server order", () => {
  expect(ids(filterSortChannels(list, noFilters, "recent"))).toEqual([1, 2, 3]);
});

test("name sort is case-insensitive alphabetical", () => {
  expect(ids(filterSortChannels(list, noFilters, "name"))).toEqual([2, 1, 3]); // alpha, Beta, Gamma
});

test("count sort is descending", () => {
  expect(ids(filterSortChannels(list, noFilters, "count"))).toEqual([2, 1, 3]); // 10, 3, 1
});

test("access filter keeps only the selected modes (empty = all)", () => {
  expect(ids(filterSortChannels(list, { ...noFilters, access: ["private"] }, "recent"))).toEqual([
    3,
  ]);
  expect(
    ids(filterSortChannels(list, { ...noFilters, access: ["public", "open"] }, "recent")),
  ).toEqual([1, 2]);
});

test("member-of filter keeps only member channels", () => {
  expect(ids(filterSortChannels(list, { ...noFilters, memberOf: true }, "recent"))).toEqual([2]);
});

test("filters combine with search and sort", () => {
  const res = filterSortChannels(
    list,
    { search: "a", access: ["public", "open", "private"], memberOf: false },
    "name",
  );
  // All three match "a" (alpha/Beta/Gamma), sorted by name.
  expect(ids(res)).toEqual([2, 1, 3]);
});
