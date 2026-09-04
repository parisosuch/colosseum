"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

// The invisible circle that actually catches the pointer. A 5-unit dot is about
// 4.7 CSS px across on a 375px screen, so the dot is drawn for looks and this is
// what you aim at. A true 44px target would need ~47 units, which in a dense
// graph would mean every node overlapping its neighbours — the handle search
// below the canvas is the path that doesn't depend on aim.
function hitRadiusFor(node: InviteGraphNode): number {
  return Math.max(radiusFor(node) + 8, 16);
}

// How many handles the search box offers at once.
const SEARCH_RESULTS = 8;

export default function UserGraph({ graph }: { graph: InviteGraph }) {
  const placed = useMemo(() => layout(graph), [graph]);
  // The named node: set by hover, by keyboard focus, and by the first tap on a
  // touch screen (where there is no hover to name it with).
  const [active, setActive] = useState<string | null>(null);

  const byId = useMemo(() => new Map(placed.map((p) => [p.user_id, p])), [placed]);
  const activeNode = active ? byId.get(active) : null;

  // Pan/zoom, Obsidian-style: a translate+scale transform on the whole graph,
  // driven by drag-to-pan and wheel-to-zoom. Starts at identity so the server
  // and client first-render match.
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const pan = useRef<{ px: number; py: number } | null>(null);
  const moved = useRef(false);
  // Which input started the gesture that ends in a click, so a tap can name a
  // node before it navigates while a mouse click still goes straight through.
  const pointerType = useRef<string>("mouse");

  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return placed.filter((p) => p.handle.toLowerCase().includes(q)).slice(0, SEARCH_RESULTS);
  }, [placed, query]);

  // Centre a node in the viewBox at the current zoom and name it. The transform
  // maps a graph point p to `view.x + p * view.k`, so solve that for the centre.
  const focusNode = (node: Placed) => {
    setActive(node.user_id);
    setView((v) => ({ ...v, x: WIDTH / 2 - node.x * v.k, y: HEIGHT / 2 - node.y * v.k }));
  };

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
    pointerType.current = e.pointerType;
    // A touch on bare canvas (target is the <svg> itself, not a node's hit
    // circle) drops the current label, the way moving the mouse away does.
    if (e.pointerType !== "mouse" && e.target === e.currentTarget) setActive(null);
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

  // Which nodes/edges to emphasise: the named node and its direct neighbours
  // stay solid; everything else dims.
  const isLit = (id: string) => {
    if (!active) return true;
    if (id === active) return true;
    return graph.edges.some(
      (e) => (e.from === active && e.to === id) || (e.to === active && e.from === id),
    );
  };

  // A click on a node. A pan that ended on one shouldn't navigate; nor should
  // the first tap on a touch screen, which has no hover to name the node with —
  // it labels it instead, and the next tap opens the profile.
  const onNodeClick = (e: React.MouseEvent, nodeId: string) => {
    if (moved.current) {
      e.preventDefault();
      return;
    }
    // detail 0 is keyboard activation: focus already showed the label.
    if (e.detail === 0 || pointerType.current === "mouse") return;
    if (active !== nodeId) {
      e.preventDefault();
      setActive(nodeId);
    }
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      {/* Finding one person in a dot cloud can't depend on aim, so the handles
          are searchable; picking one centres and names its node. */}
      <div className="relative w-full sm:w-72">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a member by handle"
          aria-label="Find a member by handle"
        />
        {matches.length > 0 ? (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {matches.map((node) => (
              <li key={node.user_id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => focusNode(node)}
                >
                  @{node.handle}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {query.trim() && matches.length === 0 ? (
          <p className="mt-1 text-caption">No member matches “{query.trim()}”.</p>
        ) : null}
      </div>

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
              const lit = !active || edge.from === active || edge.to === active;
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={i}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="stroke-muted-foreground transition-opacity"
                  strokeWidth={1}
                  opacity={lit ? 0.35 : 0.08}
                />
              );
            })}

            {placed.map((node) => {
              const lit = isLit(node.user_id);
              return (
                <Link
                  key={node.user_id}
                  href={`/${node.handle}`}
                  onClick={(e) => onNodeClick(e, node.user_id)}
                  // On the <Link> rather than the <g> inside it: the anchor is
                  // what takes focus, and focus doesn't reach its own children.
                  onMouseEnter={() => setActive(node.user_id)}
                  onMouseLeave={() => setActive((a) => (a === node.user_id ? null : a))}
                  onFocus={() => setActive(node.user_id)}
                  onBlur={() => setActive((a) => (a === node.user_id ? null : a))}
                >
                  <g className="cursor-pointer transition-opacity" opacity={lit ? 1 : 0.2}>
                    {/* Invisible, and larger than the dot: what the pointer
                      actually has to hit. fill="none" + pointerEvents="all"
                      catches events over an unpainted area. */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={hitRadiusFor(node)}
                      fill="none"
                      pointerEvents="all"
                    />
                    {/* Solid dot, brightening to the accent when its neighbourhood
                      is lit — no outline, the way Obsidian renders nodes. */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={radiusFor(node)}
                      pointerEvents="none"
                      className={
                        active && lit
                          ? "fill-primary transition-colors"
                          : "fill-muted-foreground transition-colors"
                      }
                    />
                  </g>
                </Link>
              );
            })}

            {/* Label for the named node only, drawn last so its pill sits above
                every other dot. Labelling neighbours too piles names on top of
                each other in a dense hub — name one at a time. A wide, centred
                foreignObject lets the shadcn Badge size to its text. */}
            {activeNode && (
              // Anchor at the node in graph space, then scale(1/k) so the badge
              // stays a constant screen size while the graph zooms. The gap below
              // the dot uses r*k because the dot itself scales with zoom.
              <g
                transform={`translate(${activeNode.x} ${activeNode.y}) scale(${1 / view.k})`}
                className="pointer-events-none"
              >
                <foreignObject
                  x={-100}
                  y={radiusFor(activeNode) * view.k + 6}
                  width={200}
                  height={28}
                  className="overflow-visible"
                >
                  <div className="flex justify-center">
                    <Badge variant="secondary">@{activeNode.handle}</Badge>
                  </div>
                </foreignObject>
              </g>
            )}
          </g>
        </svg>
      </div>
    </div>
  );
}
