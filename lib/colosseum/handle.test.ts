import { expect, test } from "bun:test";

import { HANDLE_MIN_LENGTH, normalizeHandle, validateHandle } from "./handle";

test("normalizeHandle trims and lowercases", () => {
  expect(normalizeHandle("  Alice ")).toBe("alice");
});

test("validateHandle accepts a well-formed handle", () => {
  expect(validateHandle("cool_user-1")).toBeNull();
});

test("validateHandle rejects too-short, too-long, and bad characters", () => {
  expect(validateHandle("a".repeat(HANDLE_MIN_LENGTH - 1))).toContain("at least");
  expect(validateHandle("a".repeat(31))).toContain("at most");
  expect(validateHandle("Bad Handle!")).toContain("lowercase");
});
