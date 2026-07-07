import { expect, test } from "bun:test";

import { otherMembers } from "./social";

test("everyone else excludes the viewer and direct friends", () => {
  const all = ["me", "a", "b", "c", "d"];
  expect(otherMembers("me", ["a", "b"], all).sort()).toEqual(["c", "d"]);
});

test("everyone else is the whole membership when you have no friends yet", () => {
  const all = ["me", "a", "b"];
  expect(otherMembers("me", [], all).sort()).toEqual(["a", "b"]);
});

test("empty when every member is the viewer or a friend", () => {
  expect(otherMembers("me", ["a"], ["me", "a"])).toEqual([]);
});
