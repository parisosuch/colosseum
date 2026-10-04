import { expect, test } from "bun:test";

import { keysReachBoard } from "./focus";

// Just enough of an element for keysReachBoard: a tag, contenteditable, and
// `closest` over a chain of ancestors described by the selectors they match.
function el(tagName: string, ancestors: string[] = [], isContentEditable = false): Element {
  return {
    tagName,
    isContentEditable,
    closest: (selector: string) =>
      selector
        .split(",")
        .map((s) => s.trim())
        .some((s) => ancestors.includes(s))
        ? ({} as Element)
        : null,
  } as unknown as Element;
}

test("the board takes keys pressed on itself or on nothing in particular", () => {
  expect(keysReachBoard(null)).toBe(true);
  expect(keysReachBoard(el("DIV"))).toBe(true);
  expect(keysReachBoard(el("BUTTON"))).toBe(true);
});

test("no board shortcut fires from a comment thread's popover", () => {
  // The popover itself (focused when it opens), a button in it, its reply box.
  expect(keysReachBoard(el("DIV", ["[data-canvas-ui]", '[role="dialog"]']))).toBe(false);
  expect(keysReachBoard(el("BUTTON", ["[data-canvas-ui]"]))).toBe(false);
  expect(keysReachBoard(el("TEXTAREA", ["[data-canvas-ui]"]))).toBe(false);
});

test("text fields, menus and dialogs keep their keys", () => {
  expect(keysReachBoard(el("INPUT"))).toBe(false);
  expect(keysReachBoard(el("SELECT"))).toBe(false);
  expect(keysReachBoard(el("DIV", [], true))).toBe(false);
  expect(keysReachBoard(el("DIV", ['[role="menu"]']))).toBe(false);
  expect(keysReachBoard(el("BUTTON", ['[role="alertdialog"]']))).toBe(false);
  expect(keysReachBoard(el("TEXTAREA", ["[data-canvas-editor]"]))).toBe(false);
});
