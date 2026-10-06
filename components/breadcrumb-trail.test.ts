import { expect, test } from "bun:test";

import { splitTrail } from "./breadcrumb-trail";

test("a single crumb is the current page with no trail", () => {
  expect(splitTrail([{ label: "settings" }])).toEqual({ parents: [], current: "settings" });
});

test("parents keep their links and the last crumb is the current page", () => {
  expect(
    splitTrail([
      { label: "paris", href: "/paris" },
      { label: "consume!", href: "/paris/30" },
      { label: "Text column" },
    ]),
  ).toEqual({
    parents: [
      { label: "paris", href: "/paris" },
      { label: "consume!", href: "/paris/30" },
    ],
    current: "Text column",
  });
});

test("a parent without an href renders as plain text", () => {
  const { parents } = splitTrail([
    { label: "paris", href: "/paris" },
    { label: "consume!" },
    { label: "Text column" },
  ]);
  expect(parents.map((p) => p.href)).toEqual(["/paris", null]);
});

test("the current page never links, even when given an href", () => {
  const { parents, current } = splitTrail([
    { label: "invites", href: "/invites" },
    { label: "users", href: "/users" },
  ]);
  expect(current).toBe("users");
  expect(parents).toEqual([{ label: "invites", href: "/invites" }]);
});

test("no crumbs is no header", () => {
  expect(splitTrail([])).toEqual({ parents: [], current: null });
});
