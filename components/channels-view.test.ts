import { expect, test } from "bun:test";

import { channelMatches, type ChannelRow } from "./channel-filter";

const row = (over: Partial<ChannelRow>): ChannelRow => ({
  id: 1,
  title: "Design Inspiration",
  description: "moodboards and type",
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
