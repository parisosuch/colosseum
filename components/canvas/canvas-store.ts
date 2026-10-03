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
import {
  boxesOf,
  paintOrder,
  placedColumns,
  readElements,
  type ElementSnapshot,
} from "@/lib/canvas/elements";
import type { Box } from "@/lib/canvas/geometry";
import { elementsOf, type ElementType } from "@/lib/realtime/canvas-doc";
import {
  CANVAS_PATH,
  CLOSE_ACCESS_REVOKED,
  CLOSE_CHANNEL_GONE,
  MESSAGE_CHANNEL_EVENT,
  type ChannelEvent,
  type PresenceUser,
} from "@/lib/realtime/protocol";

// Element types this page draws. The drawing tools add theirs.
const DRAWN_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(["block"]);

export type DocState = {
  elements: ReadonlyMap<string, ElementSnapshot>;
  // Drawn elements in paint order, bottom first, and their world boxes.
  ordered: readonly ElementSnapshot[];
  boxes: readonly Box[];
  boxById: ReadonlyMap<string, Box>;
  placed: ReadonlySet<number>;
};

export type ConnectionState = {
  // Whether the first sync has landed. Until then the board shows skeletons
  // and the tools are disabled.
  synced: boolean;
  status: "connecting" | "connected" | "disconnected";
  // Set once the server has closed the canvas for good.
  closed: null | "access-revoked" | "channel-gone";
  // What the server says this socket may do. Null until the session event.
  access: "read" | "write" | null;
  self: PresenceUser | null;
};

export type Peer = {
  clientId: number;
  user: PresenceUser;
  cursor: Point | null;
  selection: readonly string[];
};

type Slice = "doc" | "connection" | "selection" | "camera" | "peers" | "interaction";

const EMPTY_DOC: DocState = {
  elements: new Map(),
  ordered: [],
  boxes: [],
  boxById: new Map(),
  placed: new Set(),
};

export class CanvasStore {
  readonly doc = new Y.Doc();
  // Every local write uses this origin, so an undo manager can scope itself to
  // this client's own edits.
  readonly origin = Symbol("canvas-local");
  private provider: WebsocketProvider | null = null;
  private listeners = new Map<Slice, Set<() => void>>();
  private eventListeners = new Set<(event: ChannelEvent) => void>();

  docState: DocState = EMPTY_DOC;
  connection: ConnectionState = {
    synced: false,
    status: "connecting",
    closed: null,
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

  constructor(readonly channelId: number) {
    elementsOf(this.doc).observeDeep(() => this.refreshDoc());
  }

  connect(): void {
    if (this.provider) return;
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const base = `${scheme}://${window.location.host}${CANVAS_PATH.replace(/\/$/, "")}`;
    const provider = new WebsocketProvider(base, String(this.channelId), this.doc, {
      // Tabs of one browser would otherwise also sync over a BroadcastChannel,
      // around the server's read-only filtering.
      disableBc: true,
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
    });
    provider.awareness.on("change", () => this.refreshPeers());
  }

  destroy(): void {
    this.provider?.awareness.setLocalState(null);
    this.provider?.destroy();
    this.provider = null;
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

  private refreshDoc(): void {
    const elements = readElements(this.doc, this.docState.elements);
    const ordered = paintOrder(elements, DRAWN_TYPES);
    const boxes = boxesOf(ordered, elements);
    this.docState = {
      elements,
      ordered,
      boxes,
      boxById: new Map(boxes.map((b) => [b.id, b])),
      placed: placedColumns(elements),
    };
    // Someone else may have deleted what this client had selected.
    const kept = [...this.selection].filter((id) => elements.has(id));
    if (kept.length !== this.selection.size) this.setSelection(kept);
    this.emit("doc");
  }

  // --- connection ---

  private setConnection(patch: Partial<ConnectionState>): void {
    this.connection = { ...this.connection, ...patch };
    this.emit("connection");
  }

  private handleEvent(event: ChannelEvent): void {
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
