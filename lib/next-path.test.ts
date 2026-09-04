import { expect, test } from "bun:test";

import { safeNextPath } from "./next-path";

test("safeNextPath keeps a gated destination, query and all", () => {
  expect(safeNextPath("/settings")).toBe("/settings");
  expect(safeNextPath("/invites/abc?from=mail")).toBe("/invites/abc?from=mail");
});

test("safeNextPath rejects anything that could leave the origin", () => {
  expect(safeNextPath("//evil.example")).toBeNull();
  expect(safeNextPath("/\\evil.example")).toBeNull();
  expect(safeNextPath("https://evil.example")).toBeNull();
});

test("safeNextPath rejects paths outside the gated routes", () => {
  expect(safeNextPath("/explore")).toBeNull();
  // A prefix match must not stop mid-segment.
  expect(safeNextPath("/settings-evil")).toBeNull();
  expect(safeNextPath(undefined)).toBeNull();
});
