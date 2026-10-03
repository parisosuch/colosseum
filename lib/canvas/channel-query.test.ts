import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CHANNEL_QUERY,
  channelHref,
  channelQueryString,
  parseChannelQuery,
} from "./channel-query";

describe("channel URL query", () => {
  test("defaults give a bare URL", () => {
    expect(channelQueryString(DEFAULT_CHANNEL_QUERY)).toBe("");
    expect(channelHref("/alice/3", DEFAULT_CHANNEL_QUERY)).toBe("/alice/3");
  });

  test("round-trips every control", () => {
    const state = { sort: "title_az", type: "image", q: "quokka sketch", view: "list" } as const;
    const qs = channelQueryString(state);
    expect(qs).toBe("sort=title_az&type=image&q=quokka+sketch&view=list");
    expect(parseChannelQuery(new URLSearchParams(qs))).toEqual(state);
  });

  test("reads Next's searchParams object, taking the first of repeated keys", () => {
    expect(parseChannelQuery({ sort: ["oldest", "newest"], q: "a" })).toEqual({
      ...DEFAULT_CHANNEL_QUERY,
      sort: "oldest",
      q: "a",
    });
  });

  test("unknown values fall back to defaults", () => {
    expect(parseChannelQuery(new URLSearchParams("sort=sideways&type=gif&view=cards&q="))).toEqual(
      DEFAULT_CHANNEL_QUERY,
    );
    expect(parseChannelQuery(null)).toEqual(DEFAULT_CHANNEL_QUERY);
  });

  test("a search is trimmed when written and capped when read", () => {
    expect(channelQueryString({ q: "   " })).toBe("");
    expect(channelQueryString({ q: "  hi " })).toBe("q=hi");
    expect(parseChannelQuery({ q: "x".repeat(500) }).q).toHaveLength(200);
  });

  test("extra params follow the controls, and empty ones are dropped", () => {
    expect(channelHref("/a/1", { sort: "newest" }, { block: 42, thread: null })).toBe(
      "/a/1?sort=newest&block=42",
    );
    expect(channelHref("/a/1", {}, { block: 7 })).toBe("/a/1?block=7");
  });
});
