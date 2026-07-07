import { expect, test } from "bun:test";

import { friendsOfFriends } from "./social";

test("friends-of-friends excludes the viewer and direct friends", () => {
  const self = "me";
  const friends = ["a", "b"];
  // neighbors of a + b: b is also a friend, me is the viewer, c/d are new.
  const neighbors = ["me", "a", "b", "c", "d"];
  expect(friendsOfFriends(self, friends, neighbors).sort()).toEqual(["c", "d"]);
});

test("dedupes friends-of-friends reached through multiple friends", () => {
  expect(friendsOfFriends("me", ["a", "b"], ["c", "c", "d"]).sort()).toEqual(["c", "d"]);
});

test("no friends-of-friends when every neighbor is already the viewer or a friend", () => {
  expect(friendsOfFriends("me", ["a"], ["me", "a"])).toEqual([]);
});
