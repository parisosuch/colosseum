import { expect, test } from "bun:test";

import { normalizeTag, normalizeTags, sanitizeTag } from "./tags";

test("sanitizeTag turns spaces into dashes and collapses runs", () => {
  expect(sanitizeTag("design systems")).toBe("design-systems");
  expect(sanitizeTag("a  b")).toBe("a-b");
  expect(sanitizeTag("a--b")).toBe("a-b");
});

test("sanitizeTag drops anything that isn't alphanumeric or a dash", () => {
  expect(sanitizeTag("#type/setting!")).toBe("typesetting");
  expect(sanitizeTag("café")).toBe("caf");
});

test("sanitizeTag keeps a trailing dash, so a dash can be typed mid-word", () => {
  expect(sanitizeTag("design-")).toBe("design-");
});

test("normalizeTag trims the dashes off either end", () => {
  expect(normalizeTag("design-")).toBe("design");
  expect(normalizeTag("  spaced  ")).toBe("spaced");
  expect(normalizeTag("---")).toBe("");
});

test("normalizeTags drops empties and deduplicates, keeping first position", () => {
  expect(normalizeTags(["b", "a", "b", "!!!", ""])).toEqual(["b", "a"]);
});

test("normalizeTags deduplicates what normalization makes identical", () => {
  // "design systems" and "design-systems" are the same tag once written, and
  // the board filters on an exact array match — two spellings of one tag would
  // mean a block that only matches under one of them.
  expect(normalizeTags(["design systems", "design-systems"])).toEqual(["design-systems"]);
});

test("normalizeTags ignores non-strings rather than stringifying them", () => {
  // A client sending `[1, null]` should get no tags, not "1" and "null".
  expect(normalizeTags([1, null, undefined, {}, ["a"]])).toEqual([]);
  expect(normalizeTags([1, "real"])).toEqual(["real"]);
});
