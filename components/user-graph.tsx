"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { InviteGraph, InviteGraphNode } from "@/lib/colosseum/invite";

// Layout space. The SVG scales to its container via viewBox, so these are
// abstract units, not pixels.
const WIDTH = 800;
const HEIGHT = 600;

type Placed = InviteGraphNode & { x: number; y: number };

// A tiny deterministic Fruchterman–Reingold layout. Deterministic (nodes seed
// on a circle by index, no RNG) so the server and client render identical
// positions — no hydration mismatch, and no layout library needed.
function layout(graph: InviteGraph): Placed[] {
  const { nodes, edges } = graph;
  const n = nodes.length;
  if (n === 0) return [];

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const index = new Map(nodes.map((node, i) => [node.user_id, i]));

  // Seed on a circle. A lone node sits dead centre.
  const radius = Math.min(WIDTH, HEIGHT) * 0.35;
  const pos = nodes.map((_, i) => {
    if (n === 1) return { x: cx, y: cy };
    const a = (2 * Math.PI * i) / n;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  });

  // Ideal separation, and a repulsion/attraction pass with linear cooling.
  const area = WIDTH * HEIGHT;
  const k = Math.sqrt(area / n);
  const iterations = 300;
  let temp = WIDTH / 10;
  const cool = temp / (iterations + 1);

  for (let step = 0; step < iterations; step++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    // Repulsion between every pair.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          // Coincident nodes: nudge apart deterministically by index.
          dx = (i - j) * 0.01 + 0.01;
          dy = (i + j) * 0.01 + 0.01;
          dist = Math.hypot(dx, dy);
        }
        const force = (k * k) / dist;
        const ux = (dx / dist) * force;
        const uy = (dy / dist) * force;
        disp[i].x += ux;
        disp[i].y += uy;
        disp[j].x -= ux;
        disp[j].y -= uy;
      }
    }

    // Attraction along edges.
    for (const edge of edges) {
      const a = index.get(edge.from);
      const b = index.get(edge.to);
      if (a === undefined || b === undefined) continue;
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const force = (dist * dist) / k;
      const ux = (dx / dist) * force;
      const uy = (dy / dist) * force;
      disp[a].x -= ux;
      disp[a].y -= uy;
      disp[b].x += ux;
      disp[b].y += uy;
    }

    // Apply, capped by temperature, then pull gently toward centre so
    // disconnected components don't drift off-canvas.
    for (let i = 0; i < n; i++) {
      const d = Math.max(Math.hypot(disp[i].x, disp[i].y), 0.01);
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
      pos[i].x += (cx - pos[i].x) * 0.01;
      pos[i].y += (cy - pos[i].y) * 0.01;
    }
    temp -= cool;
  }

  // Fit the final cloud into the viewBox with a margin.
  const margin = 60;
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((WIDTH - 2 * margin) / spanX, (HEIGHT - 2 * margin) / spanY);

  // Centre the scaled cloud in the viewBox so a small or collinear network sits
  // in the middle rather than hugging a corner.
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;

  return nodes.map((node, i) => ({
    ...node,
    x: offsetX + (pos[i].x - minX) * scale,
    y: offsetY + (pos[i].y - minY) * scale,
  }));
}

// Node radius grows with out-degree so prolific inviters read as hubs. Kept
// small, Obsidian-style, so labels and links breathe.
function radiusFor(node: InviteGraphNode): number {
  return 5 + Math.min(node.invited_count, 12) * 1.5;
}

export default function UserGraph({ graph }: { graph: InviteGraph }) {
  const placed = useMemo(() => layout(graph), [graph]);
  const [hovered, setHovered] = useState<string | null>(null);

  const byId = useMemo(() => new Map(placed.map((p) => [p.user_id, p])), [placed]);
  const hoveredNode = hovered ? byId.get(hovered) : null;

  // Pan/zoom, Obsidian-style: a translate+scale transform on the whole graph,
  // driven by drag-to-pan and wheel-to-zoom. Starts at identity so the server
  // and client first-render match.
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const pan = useRef<{ px: number; py: number } | null>(null);
  const moved = useRef(false);

  // Map a client point into viewBox units, undoing the letterboxing that
  // preserveAspectRatio="meet" adds. `s` is client-px-per-viewBox-unit.
  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const s = Math.min(rect.width / WIDTH, rect.height / HEIGHT);
    const offX = (rect.width - WIDTH * s) / 2;
    const offY = (rect.height - HEIGHT * s) / 2;
    return { x: (clientX - rect.left - offX) / s, y: (clientY - rect.top - offY) / s, s };
  }, []);

  // Wheel-zoom toward the cursor. Attached natively (not via onWheel) because
  // React registers wheel as a passive listener, where preventDefault is a
  // no-op — so the page would scroll instead of the graph zooming.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x: px, y: py } = toViewBox(e.clientX, e.clientY);
      setView((v) => {
        const k = Math.min(6, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.001)));
        return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toViewBox]);

  // No setPointerCapture: capturing on the SVG makes Chrome retarget the
  // click to the SVG instead of the node's <a>, so node links never fire.
  // The SVG fills the viewport, so a pan rarely leaves it; onPointerLeave ends
  // any drag that does.
  const onPointerDown = (e: React.PointerEvent) => {
    pan.current = { px: e.clientX, py: e.clientY };
    moved.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    const { s } = toViewBox(e.clientX, e.clientY);
    const dxc = e.clientX - pan.current.px;
    const dyc = e.clientY - pan.current.py;
    if (Math.hypot(dxc, dyc) > 3) moved.current = true;
    pan.current = { px: e.clientX, py: e.clientY };
    setView((v) => ({ ...v, x: v.x + dxc / s, y: v.y + dyc / s }));
  };
  const onPointerUp = () => {
    pan.current = null;
  };

  if (placed.length === 0) {
    return <p className="text-sm text-muted-foreground">No members yet.</p>;
  }

  // Which nodes/edges to emphasise on hover: the hovered node and its direct
  // neighbours stay solid; everything else dims.
  const isActive = (id: string) => {
    if (!hovered) return true;
    if (id === hovered) return true;
    return graph.edges.some(
      (e) => (e.from === hovered && e.to === id) || (e.to === hovered && e.from === id),
    );
  };

  return (
    <div className="min-h-0 w-full flex-1 overflow-hidden rounded-lg border bg-card">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label="Network of members and the invites that connect them"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* Thin, undirected links run straight between node centres — the
            Obsidian graph look, where the arrow of causality is dropped in
            favour of a clean web. */}
          {graph.edges.map((edge, i) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const active = !hovered || edge.from === hovered || edge.to === hovered;
            return (
              <line
                key={i}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="stroke-muted-foreground transition-opacity"
                strokeWidth={1}
                opacity={active ? 0.35 : 0.08}
              />
            );
          })}

          {placed.map((node) => {
            const r = radiusFor(node);
            const active = isActive(node.user_id);
            return (
              <Link
                key={node.user_id}
                href={`/${node.handle}`}
                onClick={(e) => {
                  // A pan that happens to end on a node shouldn't navigate.
                  if (moved.current) e.preventDefault();
                }}
              >
                <g
                  className="cursor-pointer transition-opacity"
                  opacity={active ? 1 : 0.2}
                  onMouseEnter={() => setHovered(node.user_id)}
                  onMouseLeave={() => setHovered((h) => (h === node.user_id ? null : h))}
                >
                  {/* Solid dot, brightening to the accent when its neighbourhood
                    is lit — no outline, the way Obsidian renders nodes. */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r}
                    className={
                      hovered && isActive(node.user_id)
                        ? "fill-primary transition-colors"
                        : "fill-muted-foreground transition-colors"
                    }
                  />
                </g>
              </Link>
            );
          })}

          {/* Label for the hovered node only, drawn last so its pill sits above
              every other dot. Labelling neighbours too piles names on top of
              each other in a dense hub — hover one to read its name. A wide,
              centred foreignObject lets the shadcn Badge size to its text. */}
          {hoveredNode && (
            // Anchor at the node in graph space, then scale(1/k) so the badge
            // stays a constant screen size while the graph zooms. The gap below
            // the dot uses r*k because the dot itself scales with zoom.
            <g
              transform={`translate(${hoveredNode.x} ${hoveredNode.y}) scale(${1 / view.k})`}
              className="pointer-events-none"
            >
              <foreignObject
                x={-100}
                y={radiusFor(hoveredNode) * view.k + 6}
                width={200}
                height={28}
                className="overflow-visible"
              >
                <div className="flex justify-center">
                  <Badge variant="secondary">@{hoveredNode.handle}</Badge>
                </div>
              </foreignObject>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
