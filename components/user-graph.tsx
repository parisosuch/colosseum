"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

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

// Node radius grows with out-degree so prolific inviters read as hubs.
function radiusFor(node: InviteGraphNode): number {
  return 10 + Math.min(node.invited_count, 12) * 2.5;
}

export default function UserGraph({ graph }: { graph: InviteGraph }) {
  const placed = useMemo(() => layout(graph), [graph]);
  const [hovered, setHovered] = useState<string | null>(null);

  const byId = useMemo(() => new Map(placed.map((p) => [p.user_id, p])), [placed]);

  if (placed.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No invites redeemed yet. Once someone signs up with an invite code, the network appears
        here.
      </p>
    );
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
    <div className="w-full overflow-hidden rounded-lg border bg-card">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Network of members and the invites that connect them"
      >
        <defs>
          <marker
            id="invite-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {graph.edges.map((edge, i) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          // Stop the line at the target node's edge so the arrowhead sits on
          // the rim rather than under the circle.
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dist = Math.max(Math.hypot(dx, dy), 0.01);
          const r = radiusFor(to) + 4;
          const ex = to.x - (dx / dist) * r;
          const ey = to.y - (dy / dist) * r;
          const active = !hovered || edge.from === hovered || edge.to === hovered;
          return (
            <line
              key={i}
              x1={from.x}
              y1={from.y}
              x2={ex}
              y2={ey}
              className="stroke-muted-foreground"
              strokeWidth={1.5}
              opacity={active ? 0.6 : 0.12}
              markerEnd="url(#invite-arrow)"
            />
          );
        })}

        {placed.map((node) => {
          const r = radiusFor(node);
          const active = isActive(node.user_id);
          return (
            <Link key={node.user_id} href={`/${node.handle}`}>
              <g
                className="cursor-pointer"
                opacity={active ? 1 : 0.25}
                onMouseEnter={() => setHovered(node.user_id)}
                onMouseLeave={() => setHovered((h) => (h === node.user_id ? null : h))}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  className="fill-background stroke-foreground transition-colors hover:fill-accent"
                  strokeWidth={1.5}
                />
                <text
                  x={node.x}
                  y={node.y + r + 14}
                  textAnchor="middle"
                  className="fill-foreground text-[13px]"
                >
                  @{node.handle}
                </text>
              </g>
            </Link>
          );
        })}
      </svg>
    </div>
  );
}
