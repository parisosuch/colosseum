"use client";

import { worldRectToScreen, worldToScreen, type Camera, type Rect } from "@/lib/canvas/camera";
import { HANDLES, handlePoint, unionRects } from "@/lib/canvas/geometry";
import type { CanvasStore, DocState, Peer } from "./canvas-store";
import { useCanvas } from "./use-canvas";

// Selection handles are 8px squares on the corners, as in the design's
// "Selection · local".
export const HANDLE_SIZE = 8;

// Everything drawn in screen space over the world: the local selection with
// its handles and size, the marquee, and other editors' cursors and
// selections. Screen space keeps lines at 1px and handles at 8px at every
// zoom, which the world layer's scale can't.
export function CanvasOverlay({
  store,
  showHandles,
}: {
  store: CanvasStore;
  // Editors on a desktop get handles; viewers and phones see no selection.
  showHandles: boolean;
}) {
  const camera = useCanvas(store, "camera", (s) => s.camera);
  const selection = useCanvas(store, "selection", (s) => s.selection);
  const doc = useCanvas(store, "doc", (s) => s.docState);
  const allPeers = useCanvas(store, "peers", (s) => s.peers);
  const self = useCanvas(store, "connection", (s) => s.connection.self);
  // Other people only: this viewer's own other tabs aren't drawn, matching
  // the presence avatars.
  const peers = allPeers.filter((p) => p.user.id !== self?.id);
  const marquee = useCanvas(store, "interaction", (s) => s.marquee);

  const selectedRects: Rect[] = [];
  if (showHandles) {
    for (const id of selection) {
      const box = doc.boxById.get(id);
      if (box) selectedRects.push(box.rect);
    }
  }
  const bounds = unionRects(selectedRects);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {peers.map((peer) => (
        <PeerSelection
          key={`sel-${peer.clientId}`}
          peer={peer}
          camera={camera}
          boxById={doc.boxById}
        />
      ))}

      {selectedRects.length > 1
        ? selectedRects.map((r, i) => {
            const s = worldRectToScreen(camera, r);
            return (
              <div key={i} className="absolute border border-foreground" style={outlineBox(s)} />
            );
          })
        : null}

      {bounds ? <SelectionBox rect={worldRectToScreen(camera, bounds)} world={bounds} /> : null}

      {marquee ? (
        <div
          className="absolute border border-foreground"
          style={{
            ...screenBox(worldRectToScreen(camera, marquee)),
            backgroundColor: "hsl(var(--foreground) / var(--canvas-wash-alpha))",
          }}
        />
      ) : null}

      {peers.map((peer) =>
        peer.cursor ? (
          <PeerCursor
            key={`cur-${peer.clientId}`}
            peer={peer}
            at={worldToScreen(camera, peer.cursor)}
          />
        ) : null,
      )}
    </div>
  );
}

function screenBox(r: Rect) {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}

// A 1px outline drawn outside the box, as the design's outside stroke, so it
// never covers the card's own border or caption.
function outlineBox(r: Rect) {
  return { left: r.x - 1, top: r.y - 1, width: r.w + 2, height: r.h + 2 };
}

function SelectionBox({ rect, world }: { rect: Rect; world: Rect }) {
  return (
    <>
      <div className="absolute border border-foreground" style={outlineBox(rect)} />
      {HANDLES.map((h) => {
        const p = handlePoint(rect, h);
        return (
          <div
            key={h}
            className="absolute border border-foreground bg-background"
            style={{
              left: p.x - HANDLE_SIZE / 2,
              top: p.y - HANDLE_SIZE / 2,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
            }}
          />
        );
      })}
      <div
        className="absolute -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1 py-0.5 font-mono text-xs tabular-nums text-background"
        style={{ left: rect.x + rect.w / 2, top: rect.y + rect.h + 8 }}
      >
        {Math.round(world.w)} × {Math.round(world.h)}
      </div>
    </>
  );
}

function presenceVar(color: string): string {
  // `color` is a PRESENCE_COLORS name; anything else falls back to the
  // foreground rather than injecting arbitrary CSS.
  return /^[a-z]+$/.test(color)
    ? `hsl(var(--presence-${color}, var(--foreground)))`
    : "hsl(var(--foreground))";
}

export function presenceColorCss(color: string): string {
  return presenceVar(color);
}

function PeerSelection({
  peer,
  camera,
  boxById,
}: {
  peer: Peer;
  camera: Camera;
  boxById: DocState["boxById"];
}) {
  const rects = peer.selection.map((id) => boxById.get(id)?.rect).filter((r) => r !== undefined);
  if (rects.length === 0) return null;
  const color = presenceVar(peer.user.color);
  return (
    <>
      {rects.map((r, i) => {
        const s = worldRectToScreen(camera, r);
        return (
          <div key={i} className="absolute border" style={{ ...outlineBox(s), borderColor: color }}>
            {i === 0 ? (
              <span
                className="absolute -left-px -top-[22px] whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium leading-4 text-background"
                style={{ backgroundColor: color }}
              >
                {peer.user.name}
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

// The design's cursor: a filled arrow outlined in the page background, with
// the editor's name in a pill below and to the right.
function PeerCursor({ peer, at }: { peer: Peer; at: { x: number; y: number } }) {
  const color = presenceVar(peer.user.color);
  return (
    <div
      className="absolute left-0 top-0 transition-transform duration-micro ease-out"
      style={{ transform: `translate(${at.x - 3.3}px, ${at.y - 3.3}px)` }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" className="block overflow-visible">
        <path
          transform="translate(3.33 3.33)"
          d="M0.034 0.577C0.001 0.501-0.008 0.417 0.007 0.335 0.023 0.254 0.062 0.179 0.121 0.121 0.179 0.062 0.254 0.023 0.335 0.007 0.417-0.008 0.501 0.001 0.577 0.034L13.91 5.451C13.991 5.484 14.06 5.541 14.106 5.616 14.152 5.69 14.174 5.777 14.168 5.864 14.163 5.952 14.129 6.035 14.074 6.102 14.018 6.17 13.942 6.218 13.857 6.24L8.754 7.557C8.466 7.631 8.202 7.781 7.992 7.991 7.781 8.201 7.63 8.464 7.556 8.752L6.24 13.857C6.218 13.942 6.17 14.018 6.102 14.074 6.035 14.129 5.952 14.163 5.864 14.168 5.777 14.174 5.69 14.152 5.616 14.106 5.541 14.06 5.484 13.991 5.451 13.91L0.034 0.577Z"
          fill={color}
          stroke="hsl(var(--background))"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      </svg>
      <div className="pl-3.5">
        <span
          className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium leading-4 text-background"
          style={{ backgroundColor: color }}
        >
          {peer.user.name}
        </span>
      </div>
    </div>
  );
}
