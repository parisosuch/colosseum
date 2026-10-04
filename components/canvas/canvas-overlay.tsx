"use client";

import {
  visibleWorldRect,
  worldRectToScreen,
  worldToScreen,
  type Camera,
  type Rect,
} from "@/lib/canvas/camera";
import { CONNECTOR_TYPES } from "@/lib/canvas/elements";
import { HANDLES, handlePoint, intersects, unionRects } from "@/lib/canvas/geometry";
import { FRAME_LABEL } from "@/lib/canvas/hit";
import type { Guide } from "@/lib/canvas/snapping";
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
  const guides = useCanvas(store, "interaction", (s) => s.guides);
  const preview = useCanvas(store, "interaction", (s) => s.preview);
  const bindHover = useCanvas(store, "interaction", (s) => s.bindHover);
  const editing = useCanvas(store, "editing", (s) => s.editing);

  const selectedRects: Rect[] = [];
  if (showHandles) {
    for (const id of selection) {
      const box = doc.boxById.get(id);
      if (box) selectedRects.push(box.rect);
    }
  }
  const bounds = unionRects(selectedRects);
  // A lone line or arrow is edited by its ends, not a box.
  const [onlyId] = selection.size === 1 ? selection : [null];
  const only = onlyId ? doc.elements.get(onlyId) : undefined;
  const lineRoute =
    showHandles && only && CONNECTOR_TYPES.has(only.type)
      ? doc.layout.geom.get(only.id)?.route
      : undefined;
  const bindRect = bindHover ? doc.layout.geom.get(bindHover)?.rect : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <FrameLabels doc={doc} camera={camera} viewport={store.viewport} selection={selection} />

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

      {lineRoute && lineRoute.length >= 2 ? (
        <LineHandles points={lineRoute.map((p) => worldToScreen(camera, p))} />
      ) : bounds && !editing ? (
        <SelectionBox rect={worldRectToScreen(camera, bounds)} world={bounds} />
      ) : bounds ? (
        <div
          className="absolute border border-foreground"
          style={outlineBox(worldRectToScreen(camera, bounds))}
        />
      ) : null}

      {bindRect ? (
        <div
          className="absolute rounded-sm border-2 border-foreground"
          style={outlineBox(worldRectToScreen(camera, bindRect))}
        />
      ) : null}

      {guides.length ? <Guides guides={guides} camera={camera} /> : null}

      {preview?.kind === "eraser" ? (
        <EraserTrail points={preview.trail.map((p) => worldToScreen(camera, p))} />
      ) : null}

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

// Frame names, above each frame's top-left corner at a constant size, as in
// Figma. A selected frame's name is in the foreground; the rest are muted.
function FrameLabels({
  doc,
  camera,
  viewport,
  selection,
}: {
  doc: DocState;
  camera: Camera;
  viewport: { w: number; h: number };
  selection: ReadonlySet<string>;
}) {
  const view = visibleWorldRect(camera, viewport);
  return (
    <>
      {doc.frames.map((el) => {
        const g = doc.layout.geom.get(el.id);
        if (!g || !intersects(g.rect, view)) return null;
        if (g.clip && !intersects(g.clip, g.rect)) return null;
        const s = worldRectToScreen(camera, g.rect);
        return (
          <span
            key={el.id}
            className={`absolute truncate text-xs font-medium leading-[18px] ${selection.has(el.id) ? "text-foreground" : "text-muted-foreground"}`}
            style={{
              left: s.x,
              top: s.y - FRAME_LABEL.height - FRAME_LABEL.gap,
              maxWidth: Math.max(0, s.w),
              height: FRAME_LABEL.height,
            }}
          >
            {el.name ?? "Frame"}
          </span>
        );
      })}
    </>
  );
}

// The two ends of a selected line, as round handles.
function LineHandles({ points }: { points: { x: number; y: number }[] }) {
  const ends = [points[0], points[points.length - 1]];
  return (
    <>
      {ends.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full border border-foreground bg-background"
          style={{ left: p.x - 5, top: p.y - 5, width: 10, height: 10 }}
        />
      ))}
    </>
  );
}

// Snap guides in the guide colour: lines through matched edges with an x at
// each end of every box on them, and equal gaps with their size in px.
function Guides({ guides, camera }: { guides: readonly Guide[]; camera: Camera }) {
  const sx = (x: number) => x * camera.z + camera.x;
  const sy = (y: number) => y * camera.z + camera.y;
  const color = "hsl(var(--canvas-guide))";
  const mark = (x: number, y: number, key: string) => (
    <path
      key={key}
      d={`M ${x - 3} ${y - 3} L ${x + 3} ${y + 3} M ${x + 3} ${y - 3} L ${x - 3} ${y + 3}`}
    />
  );
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" fill="none">
      <g stroke={color} strokeWidth={1}>
        {guides.map((g, i) => {
          if (g.kind === "line") {
            const vertical = g.axis === "x";
            const a = vertical ? sx(g.at) : sy(g.at);
            return (
              <g key={i}>
                {vertical ? (
                  <line x1={a} x2={a} y1={sy(g.from)} y2={sy(g.to)} />
                ) : (
                  <line y1={a} y2={a} x1={sx(g.from)} x2={sx(g.to)} />
                )}
                {g.marks.map((m, j) =>
                  vertical ? mark(a, sy(m), `${i}-${j}`) : mark(sx(m), a, `${i}-${j}`),
                )}
              </g>
            );
          }
          const along = g.axis === "x";
          const from = along ? sx(g.from) : sy(g.from);
          const to = along ? sx(g.to) : sy(g.to);
          const at = along ? sy(g.at) : sx(g.at);
          return along ? (
            <g key={i}>
              <line x1={from} x2={to} y1={at} y2={at} />
              <line x1={from} x2={from} y1={at - 4} y2={at + 4} />
              <line x1={to} x2={to} y1={at - 4} y2={at + 4} />
            </g>
          ) : (
            <g key={i}>
              <line y1={from} y2={to} x1={at} x2={at} />
              <line y1={from} y2={from} x1={at - 4} x2={at + 4} />
              <line y1={to} y2={to} x1={at - 4} x2={at + 4} />
            </g>
          );
        })}
      </g>
      {guides.map((g, i) => {
        if (g.kind !== "gap") return null;
        const along = g.axis === "x";
        const mid = (g.from + g.to) / 2;
        const x = along ? sx(mid) : sx(g.at) + 6;
        const y = along ? sy(g.at) + 6 : sy(mid);
        return (
          <foreignObject
            key={`l${i}`}
            x={along ? x - 30 : x}
            y={along ? y : y - 9}
            width={60}
            height={18}
            className="overflow-visible"
          >
            <div className={`flex h-full ${along ? "justify-center" : "justify-start"}`}>
              <span
                className="rounded px-1 font-mono text-xs leading-4 tabular-nums text-background"
                style={{ backgroundColor: color }}
              >
                {g.size}
              </span>
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}

// The eraser's path, fading toward its tail.
function EraserTrail({ points }: { points: { x: number; y: number }[] }) {
  if (points.length < 2) return null;
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" fill="none">
      {points.slice(1).map((p, i) => (
        <line
          key={i}
          x1={points[i].x}
          y1={points[i].y}
          x2={p.x}
          y2={p.y}
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={6}
          strokeLinecap="round"
          strokeOpacity={((i + 1) / points.length) * 0.5}
        />
      ))}
    </svg>
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
      // The glide between awareness updates is motion the viewer didn't cause;
      // with reduced motion the cursor jumps instead.
      className="absolute left-0 top-0 transition-transform duration-micro ease-out motion-reduce:transition-none"
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
