import { expect, test } from "bun:test";

import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  normalizeHandle,
  sanitizeHandleInput,
  validateHandle,
} from "./handle";

test("normalizeHandle trims and lowercases", () => {
  expect(normalizeHandle("  Alice ")).toBe("alice");
});

test("sanitizeHandleInput turns the three likely inputs into valid handles", () => {
  expect(sanitizeHandleInput("Paris Osuch")).toBe("paris-osuch");
  expect(sanitizeHandleInput("paris.osuch")).toBe("parisosuch");
  expect(sanitizeHandleInput("@paris")).toBe("paris");
});

test("sanitizeHandleInput caps the length", () => {
  expect(sanitizeHandleInput("a".repeat(HANDLE_MAX_LENGTH + 10))).toHaveLength(HANDLE_MAX_LENGTH);
});

test("validateHandle accepts a well-formed handle", () => {
  expect(validateHandle("cool_user-1")).toBeNull();
});

test("validateHandle rejects too-short, too-long, and bad characters", () => {
  expect(validateHandle("a".repeat(HANDLE_MIN_LENGTH - 1))).toContain("at least");
  expect(validateHandle("a".repeat(31))).toContain("at most");
  expect(validateHandle("Bad Handle!")).toContain("lowercase");
});
