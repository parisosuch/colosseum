// Editing actions shared by the keyboard, the properties panel, the Layers
// panel and the menus. Each one is a single transaction with the store's local
// origin, so it's one step for undo and touches nothing anyone else did.

import { copySelection, duplicateSelection } from "@/lib/canvas/clipboard";
import {
  CONNECTOR_TYPES,
  childrenByParent,
  removeElements,
  setProps,
  type ElementSnapshot,
} from "@/lib/canvas/elements";
import { lockedChain } from "@/lib/canvas/hit";
import { alignUpdates, distributeUpdates, type AlignMode } from "@/lib/canvas/transform";
import { groupElements, reorder, ungroupElements, type ZOp } from "@/lib/canvas/tree";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import type { CanvasStore } from "./canvas-store";
import { fitTextElements } from "./measure-text";

function selected(store: CanvasStore): string[] {
  return [...store.selection].filter((id) => store.docState.elements.has(id));
}

// Start a new undo step, so this action isn't merged into the last one.
function step(store: CanvasStore) {
  store.undo.stopCapturing();
}

export function deleteSelection(store: CanvasStore): void {
  const ids = selected(store);
  if (ids.length === 0 || !store.canEdit) return;
  step(store);
  removeElements(store.doc, ids, store.origin, store.docState.layout.ends);
  store.setSelection([]);
}

export function groupSelection(store: CanvasStore): void {
  const ids = selected(store);
  if (ids.length === 0 || !store.canEdit) return;
  step(store);
  const id = groupElements(store.doc, ids, store.docState.layout, store.userId, store.origin);
  if (id) store.setSelection([id]);
}

export function ungroupSelection(store: CanvasStore): void {
  const ids = selected(store).filter((id) => store.docState.elements.get(id)?.type === "group");
  if (ids.length === 0 || !store.canEdit) return;
  step(store);
  const kids = ungroupElements(store.doc, ids, store.origin);
  store.setSelection([...selected(store).filter((id) => !ids.includes(id)), ...kids]);
}

export function reorderSelection(store: CanvasStore, op: ZOp): void {
  const ids = selected(store);
  if (ids.length === 0 || !store.canEdit) return;
  step(store);
  reorder(store.doc, ids, op, store.origin);
}

export function alignSelection(store: CanvasStore, mode: AlignMode): void {
  const ids = selected(store);
  if (ids.length === 0 || !store.canEdit) return;
  step(store);
  setProps(
    store.doc,
    alignUpdates(store.docState.elements, ids, store.docState.layout, mode),
    store.origin,
  );
}

export function distributeSelection(store: CanvasStore, axis: "x" | "y"): void {
  const ids = selected(store);
  if (ids.length < 3 || !store.canEdit) return;
  step(store);
  setProps(
    store.doc,
    distributeUpdates(store.docState.elements, ids, store.docState.layout, axis),
    store.origin,
  );
}

export function duplicate(store: CanvasStore): void {
  const ids = selected(store);
  if (ids.length === 0 || !store.canEdit) return;
  step(store);
  const fresh = duplicateSelection(
    store.doc,
    ids,
    store.docState.layout,
    { channelId: store.channelId, createdBy: store.userId, placed: store.docState.placed },
    store.origin,
  );
  if (fresh.length) store.setSelection(fresh);
}

export function copyPayload(store: CanvasStore) {
  const ids = selected(store);
  if (ids.length === 0) return null;
  return copySelection(store.doc, ids, store.docState.layout, store.channelId);
}

export function undo(store: CanvasStore): void {
  if (!store.canEdit) return;
  store.setEditing(null);
  store.undo.undo();
}

export function redo(store: CanvasStore): void {
  if (!store.canEdit) return;
  store.setEditing(null);
  store.undo.redo();
}

// Everything that a click could select at the top of the tree: top-level
// elements, and the contents of top-level frames.
export function selectAll(store: CanvasStore): void {
  const { elements, ordered } = store.docState;
  const ids: string[] = [];
  for (const el of ordered) {
    if (lockedChain(el, elements)) continue;
    const parent = el.parentId ? elements.get(el.parentId) : undefined;
    if (!parent) ids.push(el.id);
  }
  store.setSelection(ids);
}

// Enter: into the selected group or frame. Shift+Enter: out to the parent.
export function selectChildren(store: CanvasStore): boolean {
  const ids = selected(store);
  const byParent = childrenByParent(store.docState.elements);
  const kids = ids.flatMap((id) => {
    const el = store.docState.elements.get(id);
    if (!el || (el.type !== "group" && el.type !== "frame")) return [];
    return (byParent.get(id) ?? []).filter((k) => !k.hidden).map((k) => k.id);
  });
  if (kids.length === 0) return false;
  store.setSelection(kids);
  return true;
}

export function selectParents(store: CanvasStore): boolean {
  const parents = new Set<string>();
  for (const id of selected(store)) {
    const p = store.docState.elements.get(id)?.parentId;
    if (p && store.docState.elements.has(p)) parents.add(p);
  }
  if (parents.size === 0) return false;
  store.setSelection(parents);
  return true;
}

// Restyle the selection. Each element takes only the fields its type has, so
// "stroke" on a mixed selection colours the shapes, lines, pen and text, and
// leaves the stickies alone. Text whose size or weight changed is re-measured.
export function styleSelection(store: CanvasStore, props: Record<string, unknown>): void {
  const ids = selected(store);
  if (ids.length === 0 || !store.canEdit) return;
  step(store);
  const { elements } = store.docState;
  const targets = new Map<string, ElementSnapshot>();
  // Groups pass the style to what's in them.
  const byParent = childrenByParent(elements);
  const add = (id: string) => {
    const el = elements.get(id);
    if (!el) return;
    if (el.type === "group") for (const k of byParent.get(id) ?? []) add(k.id);
    else targets.set(id, el);
  };
  for (const id of ids) add(id);
  const updates = [...targets.values()].map((el) => ({
    id: el.id,
    props: Object.fromEntries(Object.entries(props).filter(([k]) => supports(el, k))),
  }));
  store.doc.transact(() => {
    setProps(store.doc, updates, store.origin);
    if ("fontSize" in props || "weight" in props) {
      fitTextElements(
        elementsOf(store.doc),
        [...targets.values()].filter((el) => el.type === "text").map((el) => el.id),
      );
    }
  }, store.origin);
}

const FIELDS: Record<string, readonly string[]> = {
  text: ["stroke", "opacity", "fontSize", "weight", "align"],
  sticky: ["fill", "opacity"],
  stroke: ["stroke", "width", "opacity"],
  rect: ["stroke", "fill", "width", "opacity"],
  ellipse: ["stroke", "fill", "width", "opacity"],
  diamond: ["stroke", "fill", "width", "opacity"],
  line: ["stroke", "width", "opacity", "routing"],
  arrow: ["stroke", "width", "opacity", "routing", "startHead", "endHead"],
  frame: ["fill"],
  block: [],
  group: [],
};

export function supports(el: ElementSnapshot, field: string): boolean {
  if (el.type === "stroke" && el.kind === "highlighter" && field === "stroke") return false;
  return FIELDS[el.type]?.includes(field) ?? false;
}

export function isConnector(el: ElementSnapshot | undefined): boolean {
  return !!el && CONNECTOR_TYPES.has(el.type);
}

// Rename, hide, lock: the Layers panel's per-row edits.
export function setLayerProps(
  store: CanvasStore,
  id: string,
  props: Record<string, unknown>,
): void {
  if (!store.canEdit) return;
  step(store);
  setProps(store.doc, [{ id, props }], store.origin);
  if (props.hidden === true || props.locked === true) {
    // Hidden elements can't stay selected; locked ones can (from the panel).
    if (props.hidden === true && store.selection.has(id)) {
      store.setSelection([...store.selection].filter((s) => s !== id));
    }
  }
}
