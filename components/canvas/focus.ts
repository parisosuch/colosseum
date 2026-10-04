// Which keys and clipboard events are the board's. The board listens on the
// document, so it has to stand aside when focus is somewhere that takes
// typing or keys of its own.

// Text fields, canvas popovers (a comment thread is marked data-canvas-ui),
// the text editor over an element, and any dialog or menu.
const OWNS_KEYS =
  '[data-canvas-ui], [data-canvas-editor], [role="dialog"], [role="alertdialog"], [role="menu"]';

export function keysReachBoard(target: Element | null): boolean {
  const t = target as HTMLElement | null;
  if (!t || typeof t.closest !== "function") return true;
  if (t.isContentEditable) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return false;
  return t.closest(OWNS_KEYS) === null;
}
