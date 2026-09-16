import { expect, test } from "bun:test";

import { parseColosseumLink } from "./resolve";

test("parses a full URL down to handle, channel and block", () => {
  expect(parseColosseumLink("https://colosseum.example/alice")).toEqual({ handle: "alice" });
  expect(parseColosseumLink("https://colosseum.example/alice/12")).toEqual({
    handle: "alice",
    channelId: 12,
  });
  expect(parseColosseumLink("https://colosseum.example/alice/12/34")).toEqual({
    handle: "alice",
    channelId: 12,
    blockId: 34,
  });
});

test("accepts a bare path and a scheme-less host", () => {
  expect(parseColosseumLink("/alice/12")).toEqual({ handle: "alice", channelId: 12 });
  expect(parseColosseumLink("colosseum.example/alice/12")).toEqual({
    handle: "alice",
    channelId: 12,
  });
});

test("takes any host, since a self-hosted instance is not one known domain", () => {
  expect(parseColosseumLink("https://blocks.mycompany.internal/bob/3")).toEqual({
    handle: "bob",
    channelId: 3,
  });
});

test("rejects shapes that aren't a Colosseum link", () => {
  // Too deep, non-numeric ids, and a bare domain that would otherwise read as a
  // handle — "example.com" has a dot, which a handle never does.
  expect(parseColosseumLink("https://colosseum.example/alice/12/34/56")).toBeNull();
  expect(parseColosseumLink("https://colosseum.example/alice/not-a-number")).toBeNull();
  expect(parseColosseumLink("example.com")).toBeNull();
  expect(parseColosseumLink("")).toBeNull();
  expect(parseColosseumLink("   ")).toBeNull();
});

test("a bare handle resolves as one", () => {
  expect(parseColosseumLink("alice")).toEqual({ handle: "alice" });
  expect(parseColosseumLink("/alice")).toEqual({ handle: "alice" });
});
