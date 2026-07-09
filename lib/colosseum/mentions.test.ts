import { expect, test } from "bun:test";

import { activeMention, parseMentions } from "./mentions";

test("plain text is a single text segment", () => {
  expect(parseMentions("just some words")).toEqual([
    { type: "text", start: 0, value: "just some words" },
  ]);
});

test("splits a mention out of surrounding text and lowercases the handle", () => {
  expect(parseMentions("hey @Alice nice one")).toEqual([
    { type: "text", start: 0, value: "hey " },
    { type: "mention", start: 4, handle: "alice", raw: "@Alice" },
    { type: "text", start: 10, value: " nice one" },
  ]);
});

test("an email is not a mention (@ follows a word character)", () => {
  expect(parseMentions("reach me at me@gmail.com")).toEqual([
    { type: "text", start: 0, value: "reach me at me@gmail.com" },
  ]);
});

test("a too-short handle is not a mention", () => {
  expect(parseMentions("yo @ab")).toEqual([{ type: "text", start: 0, value: "yo @ab" }]);
});

test("activeMention captures the fragment being typed at the caret", () => {
  expect(activeMention("hey @al", 7)).toEqual({ query: "al", start: 4 });
  // caret right after the `@` — an empty query, mention still active.
  expect(activeMention("hey @", 5)).toEqual({ query: "", start: 4 });
});

test("activeMention is null outside a mention and inside an email", () => {
  expect(activeMention("no mention here", 5)).toBeNull();
  expect(activeMention("email me@gmail", 14)).toBeNull();
});

test("handles multiple mentions", () => {
  const segs = parseMentions("@alice and @bob");
  expect(segs.map((s) => (s.type === "mention" ? s.handle : s.value))).toEqual([
    "alice",
    " and ",
    "bob",
  ]);
});
