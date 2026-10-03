"use client";

import Link from "next/link";
import { ArrowLeft, Bell, Hand, Minus, MousePointer2, PanelLeft, Plus, Search } from "lucide-react";

import { openCommandPalette } from "@/components/command-palette";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UserMenu } from "@/components/user-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { zoomLabel } from "@/lib/canvas/camera";
import { cn } from "@/lib/utils";
import { zoomStep, zoomToActual } from "./camera-actions";
import { presenceColorCss } from "./canvas-overlay";
import type { CanvasStore, Peer } from "./canvas-store";
import type { Tool } from "./canvas-viewport";
import { useCanvas } from "./use-canvas";

// A floating island: the design's white card with a 1px border, a 10px corner
// (rounded-xl, the nearest step on the radius scale) and the medium shadow.
export function Island({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center rounded-xl border bg-background p-1 shadow-md", className)}
      {...props}
    />
  );
}

function Divider() {
  return <span aria-hidden className="h-10 w-px shrink-0 bg-border" />;
}

// An icon button with a tooltip. The first tooltip waits 400ms; its
// neighbours open at once (Radix's skipDelayDuration).
function IconButton({
  label,
  shortcut,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className={className} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-3">
        <span>{label}</span>
        {shortcut ? <span className="font-mono">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export type ViewerProfile = {
  handle: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  unread: number;
};

// Top left: back, the breadcrumb, the blocks-panel toggle, search and add.
export function StartIsland({
  handle,
  channelTitle,
  channelHref,
  onBack,
  panel,
  onAdd,
  showSearch,
}: {
  handle: string;
  channelTitle: string;
  channelHref: string;
  onBack: () => void;
  // The blocks-panel toggle, for editors on a desktop.
  panel: { open: boolean; onToggle: () => void } | null;
  // Add a block (contributors only).
  onAdd: (() => void) | null;
  showSearch: boolean;
}) {
  return (
    <Island data-vt="island-start" className="gap-2">
      <IconButton label="Back to channel" onClick={onBack}>
        <ArrowLeft />
      </IconButton>
      <Divider />
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5 pr-1 font-serif text-lg leading-7"
      >
        <Link href={`/${handle}`} className="link-subtle shrink-0 rounded-sm focus-ring">
          {handle}
        </Link>
        {/* The design sets the slash in the handle's 75% ink, as the page
            header's links are. */}
        <span className="link-subtle" aria-hidden>
          /
        </span>
        <Link
          href={channelHref}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onBack();
          }}
          aria-current="page"
          className="max-w-[16rem] truncate rounded-sm focus-ring"
        >
          {channelTitle}
        </Link>
      </nav>
      {panel ? (
        <IconButton
          label={panel.open ? "Hide blocks" : "Show blocks"}
          aria-pressed={panel.open}
          onClick={panel.onToggle}
          className={panel.open ? "bg-secondary shadow-sm hover:bg-secondary/80" : undefined}
        >
          <PanelLeft />
        </IconButton>
      ) : null}
      {showSearch || onAdd ? <Divider /> : null}
      {showSearch ? (
        <IconButton label="Search" shortcut="⌘K" onClick={openCommandPalette}>
          <Search />
        </IconButton>
      ) : null}
      {onAdd ? (
        <IconButton label="Add a block" onClick={onAdd}>
          <Plus />
        </IconButton>
      ) : null}
    </Island>
  );
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

// Editors on the canvas now, one avatar per person however many tabs they
// have open, ringed in their cursor colour.
function PresenceAvatars({ store }: { store: CanvasStore }) {
  const peers = useCanvas(store, "peers", (s) => s.peers);
  const self = useCanvas(store, "connection", (s) => s.connection.self);
  const people = new Map<string, Peer>();
  for (const p of peers)
    if (p.user.id !== self?.id && !people.has(p.user.id)) people.set(p.user.id, p);
  if (people.size === 0) return null;
  const shown = [...people.values()].slice(0, 4);
  const more = people.size - shown.length;
  return (
    <>
      <ul className="flex items-center gap-1" aria-label="Editors on this canvas">
        {shown.map((p) => (
          <li key={p.user.id}>
            <span
              title={p.user.name}
              className="flex size-9 items-center justify-center rounded-full border-2 bg-background"
              style={{ borderColor: presenceColorCss(p.user.color) }}
            >
              <span className="sr-only">{p.user.name}</span>
              <Avatar className="size-6" aria-hidden>
                {p.user.avatarUrl ? <AvatarImage src={p.user.avatarUrl} alt="" /> : null}
                <AvatarFallback className="text-[10px]">{initials(p.user.name)}</AvatarFallback>
              </Avatar>
            </span>
          </li>
        ))}
        {more > 0 ? (
          <li className="px-1 text-xs tabular-nums text-muted-foreground">+{more}</li>
        ) : null}
      </ul>
      {/* Full height, like the design's divider before the bell. */}
      <Divider />
    </>
  );
}

// Top right: who's here, notifications and the account menu.
export function EndIsland({ store, viewer }: { store: CanvasStore; viewer: ViewerProfile | null }) {
  return (
    // 50px like the left island, whose full-height dividers set its height;
    // without presence this one has no divider to do that.
    <Island data-vt="island-end" className="min-h-[3.125rem] gap-1 pl-2">
      <PresenceAvatars store={store} />
      {viewer ? (
        <>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild>
                <Link href="/notifications" aria-label="Notifications">
                  <span className="relative">
                    <Bell />
                    {viewer.unread > 0 ? (
                      <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium tabular-nums text-primary-foreground">
                        {viewer.unread > 9 ? "9+" : viewer.unread}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Notifications</TooltipContent>
          </Tooltip>
          <UserMenu
            avatarUrl={viewer.avatarUrl ?? undefined}
            handle={viewer.handle}
            isAdmin={viewer.isAdmin}
            avatarClassName="size-6"
            triggerClassName="flex size-9 items-center justify-center coarse:size-11"
          />
        </>
      ) : (
        <>
          <Button asChild size="sm" variant="ghost">
            <Link href="/auth/login">Log in</Link>
          </Button>
          <ThemeSwitcher />
        </>
      )}
    </Island>
  );
}

// Bottom centre: the tools. This issue ships select and hand; the drawing
// tools join them.
export function Toolbar({
  tool,
  onToolChange,
  disabled,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  disabled: boolean;
}) {
  const item = (value: Tool, label: string, key: string, icon: React.ReactNode) => (
    <IconButton
      label={label}
      shortcut={key}
      aria-pressed={tool === value}
      disabled={disabled}
      onClick={() => onToolChange(value)}
      className={tool === value ? "bg-secondary hover:bg-secondary/80" : undefined}
    >
      {icon}
    </IconButton>
  );
  return (
    <Island data-vt="toolbar" role="toolbar" aria-label="Tools" className="gap-0.5">
      {item("select", "Select", "V", <MousePointer2 />)}
      {item("hand", "Hand", "H", <Hand />)}
    </Island>
  );
}

// Bottom right: zoom out, the level, zoom in. The level resets to 100%.
export function ZoomIsland({ store }: { store: CanvasStore }) {
  const z = useCanvas(store, "camera", (s) => s.camera.z);
  return (
    <Island data-vt="zoom">
      <IconButton label="Zoom out" shortcut="−" onClick={() => zoomStep(store, -1)}>
        <Minus />
      </IconButton>
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => zoomToActual(store)}
            aria-label={`Zoom ${zoomLabel(z)}, reset to 100%`}
            className="focus-ring h-9 w-12 rounded-md text-center font-mono text-sm tabular-nums hover:bg-accent"
          >
            {zoomLabel(z)}
          </button>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-3">
          <span>Zoom to 100%</span>
          <span className="font-mono">⇧0</span>
        </TooltipContent>
      </Tooltip>
      <IconButton label="Zoom in" shortcut="+" onClick={() => zoomStep(store, 1)}>
        <Plus />
      </IconButton>
    </Island>
  );
}
