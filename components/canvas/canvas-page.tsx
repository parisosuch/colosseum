"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Shapes } from "lucide-react";

import { AddBlockBody, useAddBlockFlow, type PickableChannel } from "@/components/add-block-flow";
import BlockModal from "@/components/block-modal";
import CommandPalette from "@/components/command-palette";
import { GradientSpin } from "@/components/gradient-spin";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { viewCenter, type Point } from "@/lib/canvas/camera";
import { placeBlock } from "@/lib/canvas/elements";
import { setPopStateInterceptor } from "@/lib/canvas/popstate-gate";
import {
  markReturningFromCanvas,
  openedFromChannel,
  runCanvasTransition,
  supportsViewTransitions,
  transitionReady,
} from "@/lib/canvas/transition";
import { getScreenshotsForUrlsAction } from "@/lib/colosseum/actions";
import { getCanvasBlocksAction } from "@/lib/colosseum/canvas-actions";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { BlocksPanel } from "./blocks-panel";
import { zoomToFit } from "./camera-actions";
import { EndIsland, StartIsland, Toolbar, ZoomIsland, type ViewerProfile } from "./canvas-chrome";
import { CanvasStore } from "./canvas-store";
import { CanvasViewport, type Tool } from "./canvas-viewport";
import { useCanvas } from "./use-canvas";

// The canvas is view-only on phones and on touch-first devices, per the issue:
// pan, pinch and tap to open, with no toolbar and no blocks panel.
const VIEW_ONLY_QUERY = "(max-width: 639.98px), (pointer: coarse)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// How much of the window the floating chrome covers, so fit and "the middle of
// the view" mean the part of the board that's actually open. Top: 16px margin
// plus the 50px islands. Bottom: the toolbar the same way. Left: the panel.
const PANEL_WIDTH = 288;
const EDGE = 16;
const ISLAND = 50;

const FETCH_BATCH = 200;

export type CanvasPageProps = {
  channel: { id: number; title: string; private: boolean };
  handle: string;
  // /<handle>/<channel>, the page Back returns to.
  channelPath: string;
  // May add blocks to the channel; the realtime server decides canvas writes
  // with the same rule and has the final say.
  canContribute: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  viewerId: string | null;
  viewer: ViewerProfile | null;
  // The viewer's own channels, for the block modal's Move and Copy.
  channels: PickableChannel[];
};

export default function CanvasPage({
  channel,
  handle,
  channelPath,
  canContribute,
  isOwner,
  isAdmin,
  viewerId,
  viewer,
  channels,
}: CanvasPageProps) {
  const router = useRouter();
  const [store] = useState(() => new CanvasStore(channel.id));
  const connection = useCanvas(store, "connection", (s) => s.connection);
  const doc = useCanvas(store, "doc", (s) => s.docState);
  const viewOnlyDevice = useMediaQuery(VIEW_ONLY_QUERY);
  const canEdit = connection.access === "write" && connection.closed === null;
  const editing = canEdit && !viewOnlyDevice && connection.synced;

  const [tool, setTool] = useState<Tool>("select");
  const [panelOpen, setPanelOpen] = useState(true);
  const showPanel = canEdit && !viewOnlyDevice && panelOpen;
  const [openColumnId, setOpenColumnId] = useState<number | null>(null);

  // --- connect, and tell an open transition the canvas is up ---
  useEffect(() => {
    store.connect();
    transitionReady("canvas");
    return () => store.destroy();
  }, [store]);

  // Focus goes to the board, so shortcuts work at once.
  const viewportFocused = useRef(false);
  useEffect(() => {
    if (viewportFocused.current) return;
    viewportFocused.current = true;
    document.querySelector<HTMLElement>('[aria-roledescription="canvas"]')?.focus({
      preventScroll: true,
    });
  }, []);

  // --- insets for fitting ---
  useEffect(() => {
    store.insets = viewOnlyDevice
      ? { top: EDGE + ISLAND, right: 0, bottom: 0, left: 0 }
      : {
          top: EDGE + ISLAND,
          right: 0,
          bottom: EDGE + 46,
          left: showPanel ? EDGE + PANEL_WIDTH : 0,
        };
  }, [store, viewOnlyDevice, showPanel]);

  // The opening camera: everything on the canvas, at no more than 100%.
  const framed = useRef(false);
  useEffect(() => {
    if (!connection.synced || framed.current) return;
    framed.current = true;
    zoomToFit(store, 1);
  }, [connection.synced, store]);

  // --- the blocks the elements point at ---
  const [columns, setColumns] = useState<Map<number, Column | null>>(() => new Map());
  const requested = useRef(new Set<number>());
  const addColumns = useCallback((cols: Column[]) => {
    if (cols.length === 0) return;
    setColumns((prev) => {
      const next = new Map(prev);
      for (const c of cols) next.set(c.id, c);
      return next;
    });
  }, []);

  useEffect(() => {
    const missing = [...doc.placed].filter((id) => !columns.has(id) && !requested.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requested.current.add(id);
    void (async () => {
      for (let i = 0; i < missing.length; i += FETCH_BATCH) {
        const batch = missing.slice(i, i + FETCH_BATCH);
        try {
          const got = await getCanvasBlocksAction(channel.id, batch);
          const found = new Set(got.map((c) => c.id));
          setColumns((prev) => {
            const next = new Map(prev);
            for (const c of got) next.set(c.id, c);
            // Not in this channel: drawn as nothing.
            for (const id of batch) if (!found.has(id)) next.set(id, null);
            return next;
          });
        } catch (e) {
          console.error(e);
          for (const id of batch) requested.current.delete(id);
        }
      }
    })();
  }, [doc.placed, columns, channel.id]);

  // A block deleted elsewhere: the server has already taken its element off.
  useEffect(
    () =>
      store.onChannelEvent((event) => {
        if (event.type === "block.removed") {
          setColumns((prev) => {
            if (!prev.has(event.columnId)) return prev;
            const next = new Map(prev);
            next.set(event.columnId, null);
            return next;
          });
          setOpenColumnId((id) => (id === event.columnId ? null : id));
        }
      }),
    [store],
  );

  // --- screenshots for link blocks ---
  const [screenshots, setScreenshots] = useState<Map<string, ColumnScreenshot>>(() => new Map());
  const shotsRequested = useRef(new Set<string>());
  useEffect(() => {
    const urls = [...columns.values()]
      .filter((c): c is Column => !!c && c.type === "url" && !!c.url)
      .map((c) => c.url!)
      .filter((u) => !shotsRequested.current.has(u));
    if (urls.length === 0) return;
    for (const u of urls) shotsRequested.current.add(u);
    void getScreenshotsForUrlsAction(urls)
      .then((rows) => {
        const got = new Map(rows);
        setScreenshots((prev) => {
          const next = new Map(prev);
          for (const u of urls) {
            next.set(u, got.get(u) ?? { url: u, image_url: null, title: null, captured_at: null });
          }
          return next;
        });
      })
      .catch((e) => console.error(e));
  }, [columns]);

  // --- placing blocks ---
  const placeAt = useCallback(
    (columnId: number, at: Point) => {
      if (!store.canEdit) return;
      const createdBy = store.connection.self?.id ?? viewerId ?? "";
      const id = placeBlock(store.doc, { columnId, at, createdBy }, store.origin);
      store.setSelection([id]);
    },
    [store, viewerId],
  );
  const placeInView = useCallback(
    (column: Column) => {
      addColumns([column]);
      placeAt(column.id, viewCenter(store.camera, store.viewport, store.insets));
    },
    [addColumns, placeAt, store],
  );

  // --- back to the channel ---
  const goBack = useCallback(() => {
    markReturningFromCanvas(channelPath);
    if (openedFromChannel(channelPath)) {
      // The channel page is the entry behind this one; popping it runs the
      // close transition through the popstate interceptor below.
      window.history.back();
      return;
    }
    // Opened from a link: there's no channel page behind this one to return
    // to, so push it instead of leaving the site.
    runCanvasTransition("close", "channel", () => router.push(channelPath));
  }, [channelPath, router]);

  // The browser's own back button, and Back above, get the close transition.
  // The interceptor runs before Next sees the popstate (popstate-gate.ts),
  // starts the transition, and hands Next the event inside it.
  useEffect(() => {
    setPopStateInterceptor((_event, replay) => {
      if (window.location.pathname !== channelPath) return false;
      if (!supportsViewTransitions()) return false;
      markReturningFromCanvas(channelPath);
      runCanvasTransition("close", "channel", replay);
      return true;
    });
    return () => setPopStateInterceptor(null);
  }, [channelPath]);

  // --- add a block from the island ---
  const flow = useAddBlockFlow(channels, {
    channelId: channel.id,
    onAdded: (column) => {
      addColumns([column]);
      if (store.canEdit) placeAt(column.id, viewCenter(store.camera, store.viewport, store.insets));
    },
  });

  const openColumn = openColumnId != null ? (columns.get(openColumnId) ?? null) : null;
  const setModalColumns = useCallback((update: Column[] | ((prev: Column[]) => Column[])) => {
    setColumns((prev) => {
      const list = [...prev.values()].filter((c): c is Column => !!c);
      const nextList = typeof update === "function" ? update(list) : update;
      const next = new Map(prev);
      const kept = new Set(nextList.map((c) => c.id));
      for (const c of nextList) next.set(c.id, c);
      for (const c of list) if (!kept.has(c.id)) next.set(c.id, null);
      return next;
    });
  }, []);

  const toolbarLeft = showPanel ? `calc(50% + ${(EDGE + PANEL_WIDTH) / 2}px)` : "50%";
  const empty = connection.synced && doc.ordered.length === 0;

  return (
    <div className="fixed inset-0 overflow-hidden bg-canvas-surface">
      <h1 className="sr-only">{`${channel.title} canvas`}</h1>
      <CanvasViewport
        store={store}
        columns={columns}
        screenshots={screenshots}
        editing={editing}
        touchOnly={viewOnlyDevice}
        tool={tool}
        onToolChange={setTool}
        onOpenBlock={setOpenColumnId}
        onPlaceBlock={(columnId, at) => placeAt(columnId, at)}
      />

      {!connection.synced && connection.closed === null ? (
        <div className="pointer-events-none absolute bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background px-3 py-1 text-caption shadow-sm">
          <GradientSpin cellSize={2} />
          Loading the canvas
        </div>
      ) : null}

      {empty ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
          style={{ paddingLeft: showPanel ? EDGE + PANEL_WIDTH + 24 : undefined }}
        >
          <EmptyState
            icon={Shapes}
            title="Nothing on the canvas yet"
            description={
              canEdit && !viewOnlyDevice
                ? "Drag blocks in from the left. Blocks you place stay in grid and list too."
                : "Blocks placed here show up for everyone who can see the channel."
            }
            className="w-full max-w-md bg-background/60 py-12"
          />
        </div>
      ) : null}

      {connection.closed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-6">
          <EmptyState
            icon={Shapes}
            title={
              connection.closed === "channel-gone"
                ? "This channel was deleted"
                : "You can no longer see this canvas"
            }
            className="w-full max-w-md bg-background"
          />
        </div>
      ) : connection.status === "disconnected" && connection.synced ? (
        <div
          className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border bg-background px-3 py-1 text-caption shadow-sm"
          role="status"
        >
          Reconnecting…
        </div>
      ) : null}

      <div className="absolute left-4 top-4 max-w-[calc(100%-2rem)]">
        <StartIsland
          handle={handle}
          channelTitle={channel.title}
          channelHref={channelPath}
          onBack={goBack}
          panel={
            canEdit && !viewOnlyDevice
              ? { open: panelOpen, onToggle: () => setPanelOpen((o) => !o) }
              : null
          }
          onAdd={canContribute && !viewOnlyDevice ? () => flow.onOpenChange(true) : null}
          showSearch={!!viewer && !viewOnlyDevice}
        />
      </div>
      <div className={viewOnlyDevice ? "hidden" : "absolute right-4 top-4"}>
        <EndIsland store={store} viewer={viewer} />
      </div>

      {showPanel ? (
        <aside
          data-vt="panel"
          aria-label="Blocks"
          className="absolute bottom-4 left-4 top-20 flex w-72 flex-col gap-3 rounded-lg border bg-background p-4 shadow-md"
        >
          <div role="tablist" aria-label="Panel" className="flex w-fit rounded-lg border p-0.5">
            <button
              type="button"
              role="tab"
              aria-selected
              className="focus-ring h-7 rounded-md bg-secondary px-3 text-sm"
            >
              Blocks
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={false}
              aria-disabled
              disabled
              className="h-7 rounded-md px-3 text-sm text-muted-foreground"
            >
              Layers
            </button>
          </div>
          <BlocksPanel
            store={store}
            channelId={channel.id}
            knownColumns={columns}
            screenshots={screenshots}
            onLoaded={addColumns}
            onPlace={placeInView}
          />
        </aside>
      ) : null}

      {!viewOnlyDevice ? (
        <>
          <div className="absolute bottom-4 -translate-x-1/2" style={{ left: toolbarLeft }}>
            <Toolbar tool={tool} onToolChange={setTool} disabled={!connection.synced} />
          </div>
          <div className="absolute bottom-4 right-4">
            <ZoomIsland store={store} />
          </div>
        </>
      ) : null}

      <BlockModal
        column={openColumn}
        open={openColumn != null}
        onOpenChange={(o) => {
          if (!o) setOpenColumnId(null);
        }}
        isOwner={isOwner}
        canEdit={isOwner || (!!viewerId && openColumn?.created_by === viewerId)}
        isAdmin={isAdmin && !channel.private}
        canShare={isOwner && channel.private}
        handle={handle}
        viewerId={viewerId}
        setColumns={setModalColumns}
        channels={channels}
        screenshot={openColumn?.url ? screenshots.get(openColumn.url) : undefined}
        onPrev={() => {}}
        onNext={() => {}}
        hasPrev={false}
        hasNext={false}
      />

      <Dialog open={flow.open} onOpenChange={flow.onOpenChange}>
        <DialogContent className="gap-0 p-0 sm:max-w-md">
          <DialogHeader className="px-4 pb-3 pt-4">
            <DialogTitle>Add a block to {channel.title}</DialogTitle>
          </DialogHeader>
          <AddBlockBody flow={flow} advanceOnEnter />
        </DialogContent>
      </Dialog>

      {viewer ? <CommandPalette handle={viewer.handle} /> : null}
    </div>
  );
}
