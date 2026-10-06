// The canvas page's client state outside React: the Yjs doc and its socket,
// the element snapshot, the selection, the camera and who else is here.
// Components subscribe to the slice they draw through useCanvas, so a camera
// move repaints the overlay without touching the cards, and an edit repaints
// the cards it changed.

import * as decoding from "lib0/decoding";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import {
  DEFAULT_CAMERA,
  NO_INSETS,
  type Camera,
  type Insets,
  type Point,
  type Rect,
} from "@/lib/canvas/camera";
import { DEFAULT_TOOL_STYLE, type ToolStyle } from "@/lib/canvas/create";
import { DocIndex, EMPTY_DOC, type DocState } from "@/lib/canvas/doc-state";
import type { ElementSnapshot } from "@/lib/canvas/elements";
import type { HitContext } from "@/lib/canvas/hit";
import type { InputPoint } from "@/lib/canvas/pen";
import type { Guide } from "@/lib/canvas/snapping";
import { createUndoManager } from "@/lib/canvas/undo";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import {
  CANVAS_PATH,
  CLOSE_ACCESS_REVOKED,
  CLOSE_CHANNEL_GONE,
  MESSAGE_CHANNEL_EVENT,
  type ChannelEvent,
  type PresenceUser,
} from "@/lib/realtime/protocol";

export type { DocState } from "@/lib/canvas/doc-state";

// Something being drawn that isn't in the doc yet: it's written when the
// pointer comes up, so the doc gets one write per stroke or shape.
export type Preview =
  | { kind: "element"; element: ElementSnapshot }
  | { kind: "pen"; points: InputPoint[]; tool: "pen" | "highlighter"; parentOrigin: Point }
  | { kind: "eraser"; trail: Point[] };

// Where a new text element is being typed before its first character exists.
export type TextDraft = { at: Point; parentId: string | null; parentOrigin: Point };

export type ConnectionState = {
  // Whether the first sync has landed. Until then the board shows skeletons
  // and the tools are disabled.
  synced: boolean;
  status: "connecting" | "connected" | "disconnected";
  // Set once the server has closed the canvas for good. "edit-refused": it
  // refused one of this tab's edits, so the tab holds a change the server never
  // will and can't carry on without a reload; `refused` says why.
  closed: null | "access-revoked" | "channel-gone" | "edit-refused";
  refused: EditRefusedReason | null;
  // What the server says this socket may do. Null until the session event.
  access: "read" | "write" | null;
  self: PresenceUser | null;
};

// The server's refusal of an edit (lib/realtime/protocol.ts, EditRefusedEvent):
// one message over its size limit, a canvas at its size ceiling, or a write
// outside the doc's shape.
export type EditRefusedReason = "too-large" | "doc-full" | "invalid";
const REFUSED_REASONS: ReadonlySet<string> = new Set(["too-large", "doc-full", "invalid"]);

// The close code that comes with it. y-websocket doesn't retry 4400-4499, and
// reconnecting would only send the same edit again.
export const CLOSE_EDIT_REFUSED = 4413;

export type Peer = {
  clientId: number;
  user: PresenceUser;
  cursor: Point | null;
  selection: readonly string[];
};

type Slice =
  | "doc"
  | "connection"
  | "selection"
  | "camera"
  | "peers"
  | "interaction"
  | "history"
  | "editing"
  | "style";

export class CanvasStore {
  readonly doc = new Y.Doc();
  // Every local write uses this origin, so an undo manager can scope itself to
  // this client's own edits.
  readonly origin = Symbol("canvas-local");
  // Undo and redo for this client's edits only.
  readonly undo = createUndoManager(this.doc, this.origin);
  private provider: WebsocketProvider | null = null;
  private index = new DocIndex();
  private listeners = new Map<Slice, Set<() => void>>();
  private eventListeners = new Set<(event: ChannelEvent) => void>();

  docState: DocState = EMPTY_DOC;
  connection: ConnectionState = {
    synced: false,
    status: "connecting",
    closed: null,
    refused: null,
    access: null,
    self: null,
  };
  selection: ReadonlySet<string> = new Set();
  camera: Camera = DEFAULT_CAMERA;
  peers: readonly Peer[] = [];
  // The viewport's size, and the edges the floating chrome covers, for fitting
  // and for "the centre of the view".
  viewport = { w: 0, h: 0 };
  insets: Insets = NO_INSETS;
  // The marquee being dragged, in world space, and whether a gesture that moves
  // the camera or the selection is under way (the overlay hides the size label
  // and the cursor stays put while it is).
  marquee: Rect | null = null;
  // Snap guides while dragging, the thing being drawn, the eraser's pending
  // hits and the element a line end would bind to.
  guides: readonly Guide[] = [];
  preview: Preview | null = null;
  erasing: ReadonlySet<string> = new Set();
  bindHover: string | null = null;
  // The text or sticky being typed in, or a new text not written yet.
  editing: { id: string } | { draft: TextDraft } | null = null;
  // The drawing tools' current colour, width and text style, for this session.
  toolStyle: ToolStyle = DEFAULT_TOOL_STYLE;
  history = { canUndo: false, canRedo: false };
  // The last pointer position over the board, in world space, for pastes.
  pointer: Point | null = null;

  // `access` is what the page already resolved for this viewer with the same
  // rule the realtime server uses, so the editing chrome is there on the first
  // render instead of appearing when the socket's session event lands. The
  // server's answer replaces it, and is the one that counts.
  constructor(
    readonly channelId: number,
    access: "read" | "write" | null = null,
    readonly viewerId: string | null = null,
    // The channel share-link token the canvas was opened through, if any. The
    // socket sends it, and the server grants read-only access on it alone.
    readonly share: string | null = null,
  ) {
    this.connection = { ...this.connection, access };
    elementsOf(this.doc).observeDeep((events) => this.refreshDoc(events));
    const onStack = () => {
      const next = { canUndo: this.undo.canUndo(), canRedo: this.undo.canRedo() };
      if (next.canUndo === this.history.canUndo && next.canRedo === this.history.canRedo) return;
      this.history = next;
      this.emit("history");
    };
    this.undo.on("stack-item-added", onStack);
    this.undo.on("stack-item-popped", onStack);
    this.undo.on("stack-cleared", onStack);
    // Undo brings back the selection the edit was made with.
    this.undo.on("stack-item-added", (event: { stackItem: { meta: Map<string, unknown> } }) => {
      event.stackItem.meta.set("selection", [...this.selection]);
    });
    this.undo.on("stack-item-popped", (event: { stackItem: { meta: Map<string, unknown> } }) => {
      const sel = event.stackItem.meta.get("selection");
      if (Array.isArray(sel)) this.setSelection(sel.filter((id) => this.docState.elements.has(id)));
    });
  }

  connect(): void {
    if (this.provider) return;
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const base = `${scheme}://${window.location.host}${CANVAS_PATH.replace(/\/$/, "")}`;
    const provider = new WebsocketProvider(base, String(this.channelId), this.doc, {
      // Tabs of one browser would otherwise also sync over a BroadcastChannel,
      // around the server's read-only filtering.
      disableBc: true,
      params: this.share ? { share: this.share } : {},
    });
    this.provider = provider;
    provider.messageHandlers[MESSAGE_CHANNEL_EVENT] = (_encoder, decoder) => {
      try {
        this.handleEvent(JSON.parse(decoding.readVarString(decoder)) as ChannelEvent);
      } catch (err) {
        console.error("[canvas] bad channel event", err);
      }
    };
    provider.on("sync", (synced: boolean) => {
      if (synced && !this.connection.synced) this.setConnection({ synced: true });
    });
    provider.on("status", ({ status }: { status: ConnectionState["status"] }) => {
      this.setConnection({ status });
    });
    provider.on("closed", (event: { code: number }) => {
      if (event.code === CLOSE_ACCESS_REVOKED) this.setConnection({ closed: "access-revoked" });
      else if (event.code === CLOSE_CHANNEL_GONE) this.setConnection({ closed: "channel-gone" });
      else if (event.code === CLOSE_EDIT_REFUSED)
        this.refuse(this.connection.refused ?? "too-large");
    });
    provider.awareness.on("change", () => this.refreshPeers());
  }

  // Close the socket and keep the doc and the undo history, so a connect()
  // after it carries on where this left off. React runs an effect's cleanup
  // and then the effect again on the same component (Strict Mode does it on a
  // client-side navigation in dev), and the page's store has to survive that.
  disconnect(): void {
    this.provider?.awareness.setLocalState(null);
    this.provider?.destroy();
    this.provider = null;
  }

  // For a store nothing will connect again (a version preview's).
  destroy(): void {
    this.disconnect();
    this.undo.destroy();
    this.doc.destroy();
    this.listeners.clear();
    this.eventListeners.clear();
  }

  // --- subscriptions ---

  subscribe(slice: Slice, listener: () => void): () => void {
    let set = this.listeners.get(slice);
    if (!set) this.listeners.set(slice, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  private emit(slice: Slice): void {
    for (const l of this.listeners.get(slice) ?? []) l();
  }

  onChannelEvent(listener: (event: ChannelEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // --- doc ---

  // Called at the end of every transaction that touched an element. Only the
  // elements it touched are read again (DocIndex.update); a transaction that
  // touched most of the board, like the first sync, rebuilds instead.
  private refreshDoc(events: readonly Y.YEvent<Y.AbstractType<unknown>>[]): void {
    const top = elementsOf(this.doc);
    const touched = new Set<string>();
    for (const e of events) {
      if (e.target === top) {
        for (const id of (e as Y.YMapEvent<unknown>).keysChanged) touched.add(id);
      } else {
        const id = e.path[0];
        if (typeof id === "string") touched.add(id);
      }
    }
    const prev = this.docState;
    const rebuild = prev.elements.size === 0 || touched.size * 4 > prev.elements.size;
    const next = rebuild ? this.index.rebuild(this.doc) : this.index.update(this.doc, touched);
    if (next === prev) return;
    this.docState = next;
    // Someone else may have deleted (or hidden) what this client had selected.
    const kept = [...this.selection].filter((id) => next.elements.has(id) && next.boxById.has(id));
    if (kept.length !== this.selection.size) this.setSelection(kept);
    const editing = this.editing;
    if (editing && "id" in editing && !next.elements.has(editing.id)) this.setEditing(null);
    this.emit("doc");
  }

  hitContext(): HitContext {
    return {
      all: this.docState.elements,
      ordered: this.docState.ordered,
      geom: this.docState.layout.geom,
    };
  }

  // The user id new elements are credited to.
  get userId(): string {
    return this.connection.self?.id ?? this.viewerId ?? "";
  }

  // --- connection ---

  private setConnection(patch: Partial<ConnectionState>): void {
    this.connection = { ...this.connection, ...patch };
    this.emit("connection");
    // Dropped to read-only, or closed: typing would write to this client's
    // copy of the doc only, since the server refuses it.
    if (!this.canEdit && this.editing) this.setEditing(null);
  }

  private refuse(reason: EditRefusedReason): void {
    if (this.connection.closed === "edit-refused") return;
    this.setConnection({ closed: "edit-refused", refused: reason });
  }

  private handleEvent(event: ChannelEvent): void {
    // Not in ChannelEvent on this side yet; it arrives just before the socket
    // closes with CLOSE_EDIT_REFUSED.
    const raw = event as { type: string; reason?: unknown };
    if (raw.type === "edit.refused") {
      this.refuse(
        typeof raw.reason === "string" && REFUSED_REASONS.has(raw.reason)
          ? (raw.reason as EditRefusedReason)
          : "too-large",
      );
      return;
    }
    if (event.type === "session") {
      this.setConnection({ access: event.access, self: event.user });
      if (event.access === "read") {
        // The server drops a reader's awareness anyway; don't send any.
        this.provider?.awareness.setLocalState(null);
        this.setSelection([]);
      } else {
        this.publishPresence();
      }
    }
    for (const l of this.eventListeners) l(event);
  }

  get canEdit(): boolean {
    return this.connection.access === "write" && this.connection.closed === null;
  }

  // --- selection ---

  setSelection(ids: Iterable<string>): void {
    const next = new Set(ids);
    if (next.size === this.selection.size && [...next].every((id) => this.selection.has(id))) {
      return;
    }
    this.selection = next;
    this.emit("selection");
    this.publishPresence();
  }

  // --- camera ---

  setCamera(camera: Camera): void {
    if (camera.x === this.camera.x && camera.y === this.camera.y && camera.z === this.camera.z) {
      return;
    }
    this.camera = camera;
    this.emit("camera");
  }

  setMarquee(rect: Rect | null): void {
    if (rect === this.marquee) return;
    this.marquee = rect;
    this.emit("interaction");
  }

  setInteraction(patch: {
    guides?: readonly Guide[];
    preview?: Preview | null;
    erasing?: ReadonlySet<string>;
    bindHover?: string | null;
  }): void {
    let changed = false;
    if (patch.guides !== undefined && patch.guides !== this.guides) {
      // An empty list replacing an empty list is no change.
      if (!(patch.guides.length === 0 && this.guides.length === 0)) changed = true;
      this.guides = patch.guides;
    }
    if (patch.preview !== undefined && patch.preview !== this.preview) {
      this.preview = patch.preview;
      changed = true;
    }
    if (patch.erasing !== undefined && patch.erasing !== this.erasing) {
      this.erasing = patch.erasing;
      changed = true;
    }
    if (patch.bindHover !== undefined && patch.bindHover !== this.bindHover) {
      this.bindHover = patch.bindHover;
      changed = true;
    }
    if (changed) this.emit("interaction");
  }

  setEditing(editing: CanvasStore["editing"]): void {
    if (editing === this.editing) return;
    this.editing = editing;
    this.emit("editing");
  }

  setToolStyle(patch: Partial<ToolStyle>): void {
    this.toolStyle = { ...this.toolStyle, ...patch };
    this.emit("style");
  }

  // --- presence ---

  private cursor: Point | null = null;

  setCursor(cursor: Point | null): void {
    this.cursor = cursor;
    this.publishPresence();
  }

  private publishPresence(): void {
    const awareness = this.provider?.awareness;
    if (!awareness || this.connection.access !== "write") return;
    awareness.setLocalState({
      ...(awareness.getLocalState() ?? {}),
      cursor: this.cursor,
      selection: [...this.selection],
    });
  }

  private refreshPeers(): void {
    const awareness = this.provider?.awareness;
    if (!awareness) return;
    const peers: Peer[] = [];
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === this.doc.clientID) continue;
      // Only `user` is the server's; the rest is the peer's own say-so.
      const user = state.user as PresenceUser | undefined;
      if (!user || typeof user.id !== "string") continue;
      const c = state.cursor as Point | null | undefined;
      peers.push({
        clientId,
        user,
        cursor:
          c && typeof c.x === "number" && typeof c.y === "number" && Number.isFinite(c.x + c.y)
            ? { x: c.x, y: c.y }
            : null,
        selection: Array.isArray(state.selection)
          ? (state.selection as unknown[]).filter((s): s is string => typeof s === "string")
          : [],
      });
    }
    this.peers = peers;
    this.emit("peers");
  }
}
