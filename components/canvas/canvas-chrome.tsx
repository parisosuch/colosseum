"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  Circle,
  Diamond,
  Eraser,
  Frame,
  Hand,
  Highlighter,
  MessageCircle,
  Minus,
  MousePointer2,
  MoveUpRight,
  PanelLeft,
  PenLine,
  Plus,
  Redo2,
  Search,
  Square,
  StickyNote,
  Type,
  Undo2,
} from "lucide-react";
import { useState } from "react";

import { Breadcrumb } from "@/components/breadcrumb";
import { openCommandPalette } from "@/components/command-palette";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UserMenu } from "@/components/user-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { zoomLabel } from "@/lib/canvas/camera";
import { cn } from "@/lib/utils";
import { redo, undo } from "./actions";
import { zoomStep, zoomToActual } from "./camera-actions";
import { GridMenu } from "./canvas-grid";
import { presenceColorCss } from "./canvas-overlay";
import type { CanvasStore, Peer } from "./canvas-store";
import { PEN_GROUP, SHAPE_GROUP, TOOL_KEYS, TOOL_LABELS, type Tool } from "./tools";
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
export function IconButton({
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
  onBack,
  panel,
  onAdd,
  showSearch,
}: {
  handle: string;
  channelTitle: string;
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
      <Breadcrumb
        compact
        crumbs={[{ label: handle, href: `/${handle}` }, { label: channelTitle }]}
      />
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

// Top right: who's here, the canvas's own buttons (version history, for
// managers), notifications and the account menu.
export function EndIsland({
  store,
  viewer,
  actions,
}: {
  store: CanvasStore;
  viewer: ViewerProfile | null;
  actions?: React.ReactNode;
}) {
  return (
    // 50px like the left island, whose full-height dividers set its height;
    // without presence this one has no divider to do that.
    <Island data-vt="island-end" className="min-h-[3.125rem] gap-1 pl-2">
      <PresenceAvatars store={store} />
      {actions ? (
        <>
          {actions}
          <Divider />
        </>
      ) : null}
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

export const TOOL_ICONS: Record<Tool, React.ComponentType<{ className?: string }>> = {
  select: MousePointer2,
  hand: Hand,
  text: Type,
  pen: PenLine,
  highlighter: Highlighter,
  eraser: Eraser,
  rect: Square,
  ellipse: Circle,
  diamond: Diamond,
  line: Minus,
  arrow: MoveUpRight,
  sticky: StickyNote,
  frame: Frame,
  comment: MessageCircle,
};

function ToolDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

// Bottom centre: the tools, in the design's groups. Pen and highlighter share
// a button, and so do the shapes; each shows the last one used, its caret
// opens the list, and every key still picks its tool directly. Read-only
// viewers get select (to open blocks), hand and comment.
export function Toolbar({
  tool,
  onToolChange,
  disabled,
  viewer,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  disabled: boolean;
  viewer: boolean;
}) {
  const [lastPen, setLastPen] = useState<Tool>("pen");
  const [lastShape, setLastShape] = useState<Tool>("rect");
  const pick = (t: Tool) => {
    if ((PEN_GROUP as readonly Tool[]).includes(t)) setLastPen(t);
    if ((SHAPE_GROUP as readonly Tool[]).includes(t)) setLastShape(t);
    onToolChange(t);
  };
  // A key that picks a grouped tool updates its button too.
  const shownPen = (PEN_GROUP as readonly Tool[]).includes(tool) ? tool : lastPen;
  const shownShape = (SHAPE_GROUP as readonly Tool[]).includes(tool) ? tool : lastShape;

  const item = (value: Tool) => {
    const Icon = TOOL_ICONS[value];
    return (
      <IconButton
        key={value}
        label={TOOL_LABELS[value]}
        shortcut={TOOL_KEYS[value]}
        aria-pressed={tool === value}
        disabled={disabled}
        onClick={() => pick(value)}
        className={tool === value ? "bg-secondary hover:bg-secondary/80" : undefined}
      >
        <Icon />
      </IconButton>
    );
  };

  const group = (shown: Tool, members: readonly Tool[], label: string) => {
    const Icon = TOOL_ICONS[shown];
    const on = members.includes(tool);
    return (
      <div
        className={cn(
          "flex h-9 items-center rounded-md transition-colors duration-micro",
          on ? "bg-secondary" : "hover:bg-accent",
        )}
      >
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              aria-label={TOOL_LABELS[shown]}
              aria-pressed={tool === shown}
              disabled={disabled}
              onClick={() => pick(shown)}
              className="h-9 w-8 justify-end rounded-r-none px-0 hover:bg-transparent"
            >
              <Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-3">
            <span>{TOOL_LABELS[shown]}</span>
            <span className="font-mono">{TOOL_KEYS[shown]}</span>
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              aria-label={label}
              disabled={disabled}
              className="h-9 w-4 justify-start rounded-l-none px-0 text-muted-foreground hover:bg-transparent [&_svg]:size-3"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" sideOffset={12} className="w-52">
            {members.map((m) => {
              const MIcon = TOOL_ICONS[m];
              return (
                <DropdownMenuItem key={m} onSelect={() => pick(m)} className="gap-2">
                  <MIcon />
                  <span className="flex-1">{TOOL_LABELS[m]}</span>
                  <span className="font-mono text-xs text-muted-foreground">{TOOL_KEYS[m]}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <Island data-vt="toolbar" role="toolbar" aria-label="Tools" className="gap-0.5">
      {item("select")}
      {item("hand")}
      <ToolDivider />
      {viewer ? (
        item("comment")
      ) : (
        <>
          {group(shownPen, PEN_GROUP, "Pen tools")}
          {item("eraser")}
          {item("text")}
          <ToolDivider />
          {group(shownShape, SHAPE_GROUP, "Shapes")}
          {item("arrow")}
          <ToolDivider />
          {item("sticky")}
          {item("frame")}
          <ToolDivider />
          {item("comment")}
        </>
      )}
    </Island>
  );
}

// Bottom right: the grid button, undo and redo (editors only), then zoom out,
// the level, zoom in. The level resets to 100%.
export function ZoomIsland({ store, showHistory }: { store: CanvasStore; showHistory: boolean }) {
  const z = useCanvas(store, "camera", (s) => s.camera.z);
  const history = useCanvas(store, "history", (s) => s.history);
  return (
    <Island data-vt="zoom" className="gap-1">
      <GridMenu />
      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
      {showHistory ? (
        <>
          <div className="flex">
            <IconButton
              label="Undo"
              shortcut="⌘Z"
              disabled={!history.canUndo}
              onClick={() => undo(store)}
            >
              <Undo2 />
            </IconButton>
            <IconButton
              label="Redo"
              shortcut="⇧⌘Z"
              disabled={!history.canRedo}
              onClick={() => redo(store)}
            >
              <Redo2 />
            </IconButton>
          </div>
          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        </>
      ) : null}
      <div className="flex">
        <IconButton label="Zoom out" shortcut="−" onClick={() => zoomStep(store, -1)}>
          <Minus />
        </IconButton>
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              onClick={() => zoomToActual(store)}
              aria-label={`Zoom ${zoomLabel(z)}, reset to 100%`}
              className="w-12 px-0 font-mono font-normal tabular-nums"
            >
              {zoomLabel(z)}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-3">
            <span>Zoom to 100%</span>
            <span className="font-mono">⇧0</span>
          </TooltipContent>
        </Tooltip>
        <IconButton label="Zoom in" shortcut="+" onClick={() => zoomStep(store, 1)}>
          <Plus />
        </IconButton>
      </div>
    </Island>
  );
}
