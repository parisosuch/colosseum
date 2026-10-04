"use client";

import { Bookmark, History, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listCanvasVersionsAction,
  restoreCanvasVersionAction,
  saveCanvasRestorePointAction,
} from "@/lib/colosseum/actions";
import type { CanvasVersion } from "@/lib/colosseum/canvas-version";
import { cn } from "@/lib/utils";
import { IconButton } from "./canvas-chrome";
import {
  editorsLine,
  formatSize,
  formatTime,
  formatWhen,
  groupVersions,
  initials,
  previewSubtitle,
  restoreTarget,
  savedByLine,
  versionLabel,
} from "./history-format";
import type { CanvasHistory } from "./history-state";
import { useCanvas } from "./use-canvas";

// Mirrors the server's page size and name cap (canvas-version.ts), which the
// client bundle can't import.
const PAGE = 50;
const MAX_NAME = 100;

// Shown on avatars per row; the line beside them names everyone.
const AVATARS_SHOWN = 2;

// The top-right island's history button.
export function HistoryButton({ history }: { history: CanvasHistory }) {
  return (
    <IconButton
      label="Version history"
      aria-pressed={history.open}
      aria-expanded={history.open}
      onClick={() => history.setOpen(!history.open)}
      className={history.open ? "bg-secondary shadow-sm hover:bg-secondary/80" : undefined}
    >
      <History />
    </IconButton>
  );
}

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; versions: CanvasVersion[]; more: boolean };

// The history panel, the preview bar and the restore confirmation.
export function HistoryLayer({ history }: { history: CanvasHistory }) {
  const { enabled, channelId, open, preview, closePreview } = history;
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [restoring, setRestoring] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const loads = useRef(0);

  const load = useCallback(async () => {
    const id = ++loads.current;
    setList({ status: "loading" });
    try {
      const versions = await listCanvasVersionsAction(channelId);
      if (loads.current !== id) return;
      setList({ status: "ready", versions, more: versions.length === PAGE });
    } catch (err) {
      if (loads.current !== id) return;
      console.error(err);
      setList({ status: "error" });
    }
  }, [channelId]);

  // Fresh each time the panel opens: automatic versions land in the
  // background while nobody is looking.
  useEffect(() => {
    if (open && enabled) void load();
  }, [open, enabled, load]);

  const restore = async () => {
    if (!preview) return;
    setRestoring(true);
    try {
      const { removedElements } = await restoreCanvasVersionAction(channelId, preview.version.id);
      closePreview();
      toast.success(
        "Canvas restored.",
        removedElements > 0
          ? {
              description: `${removedElements} ${removedElements === 1 ? "block isn't" : "blocks aren't"} in the channel any more, so ${removedElements === 1 ? "it was" : "they were"} left out.`,
            }
          : undefined,
      );
      void load();
    } catch (err) {
      console.error(err);
      toast.error("Couldn't restore that version. Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  if (!enabled) return null;
  const when = preview ? formatWhen(new Date(preview.version.created_at), new Date()) : "";

  return (
    <>
      {open ? (
        <div className="pointer-events-none absolute bottom-4 right-4 top-20 z-10 flex flex-col [&>*]:pointer-events-auto">
          <HistoryPanel
            history={history}
            list={list}
            onRetry={load}
            onSaved={(v) =>
              setList((prev) =>
                prev.status === "ready" ? { ...prev, versions: [v, ...prev.versions] } : prev,
              )
            }
            onMore={(older, more) =>
              setList((prev) =>
                prev.status === "ready"
                  ? { status: "ready", versions: [...prev.versions, ...older], more }
                  : prev,
              )
            }
          />
        </div>
      ) : null}

      {preview ? (
        // Between the top islands where the window is wide enough for the
        // three side by side, as the design has it at 1440; under them below.
        <section
          aria-label="Version preview"
          className="absolute left-1/2 top-20 z-20 min-[1440px]:top-4 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border bg-background py-2 pl-4 pr-2 shadow-md"
        >
          <History aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{preview.version.name ?? when}</p>
            <p className="truncate text-xs text-muted-foreground" aria-live="polite">
              {preview.store
                ? preview.version.name
                  ? `${when} · ${previewSubtitle(preview.version)}`
                  : previewSubtitle(preview.version)
                : "Loading the version…"}
            </p>
          </div>
          <Button variant="outline" className="shrink-0" onClick={closePreview}>
            Back to current
          </Button>
          <Button
            className="shrink-0"
            disabled={!preview.store || restoring}
            onClick={() => setConfirming(true)}
          >
            {restoring ? "Restoring…" : "Restore this version"}
          </Button>
        </section>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              {preview
                ? `The canvas goes back to ${restoreTarget(preview.version, new Date())} for everyone who has it open. The canvas as it is now is saved to history first.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restore()}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function HistoryPanel({
  history,
  list,
  onRetry,
  onSaved,
  onMore,
}: {
  history: CanvasHistory;
  list: ListState;
  onRetry: () => void;
  onSaved: (version: CanvasVersion) => void;
  onMore: (older: CanvasVersion[], more: boolean) => void;
}) {
  const { channelId, preview, openVersion, closePreview, setOpen } = history;
  const now = new Date();
  const groups = list.status === "ready" ? groupVersions(list.versions, now) : [];
  const [loadingMore, setLoadingMore] = useState(false);

  const more = async () => {
    if (list.status !== "ready" || list.versions.length === 0) return;
    setLoadingMore(true);
    try {
      const before = list.versions[list.versions.length - 1].id;
      const older = await listCanvasVersionsAction(channelId, { before });
      onMore(older, older.length === PAGE);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load older versions. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <aside
      aria-label="Version history"
      className="flex max-h-full w-72 flex-col gap-2 rounded-lg border bg-background p-4 shadow-md"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Version history</h2>
        <IconButton label="Close history" onClick={() => setOpen(false)}>
          <X />
        </IconButton>
      </div>
      <SaveRestorePoint channelId={channelId} onSaved={onSaved} />

      <div className="-mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto px-1">
        {/* The live canvas heads the list, under Today's heading when there
            are versions from today, and on its own otherwise. */}
        {groups[0]?.label !== "Today" ? (
          <>
            <GroupLabel>Today</GroupLabel>
            <CurrentRow history={history} selected={!preview} onSelect={closePreview} />
          </>
        ) : null}
        {list.status === "loading" ? (
          <div className="flex flex-col gap-2" role="status">
            <span className="sr-only">Loading versions</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[3.75rem] w-full" />
            ))}
          </div>
        ) : list.status === "error" ? (
          <div className="flex flex-col items-start gap-2 py-2" role="alert">
            <p className="text-sm text-destructive-text">Couldn&apos;t load the history.</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : list.versions.length === 0 ? (
          <EmptyState
            icon={History}
            title="No versions yet"
            description="A version saves after 5 quiet minutes of editing. Save a restore point to keep the canvas as it is now."
            className="px-4 py-8"
          />
        ) : (
          groups.map((g, gi) => (
            <section key={g.label} aria-label={g.label} className="flex flex-col gap-2">
              <GroupLabel>{g.label}</GroupLabel>
              {gi === 0 && g.label === "Today" ? (
                <CurrentRow history={history} selected={!preview} onSelect={closePreview} />
              ) : null}
              {g.versions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  now={now}
                  selected={preview?.version.id === v.id}
                  onSelect={() => openVersion(v)}
                />
              ))}
            </section>
          ))
        )}
        {list.status === "ready" && list.more ? (
          <Button variant="ghost" size="sm" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? "Loading…" : "Show older versions"}
          </Button>
        ) : null}
      </div>

      <p className="text-caption">
        Automatic versions stay 7 days, then one a day for 90 days. Restore points never expire.
      </p>
    </aside>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>;
}

const ROW =
  "focus-ring flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 text-left transition-colors duration-micro";

function rowState(selected: boolean) {
  return selected ? "bg-secondary" : "hover:bg-accent";
}

// The live canvas, and who is editing it now.
function CurrentRow({
  history,
  selected,
  onSelect,
}: {
  history: CanvasHistory;
  selected: boolean;
  onSelect: () => void;
}) {
  const peers = useCanvas(history.live, "peers", (s) => s.peers);
  const self = useCanvas(history.live, "connection", (s) => s.connection.self);
  const here = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of peers) {
      if (p.user.id === self?.id || names.has(p.user.id)) continue;
      names.set(p.user.id, p.user.handle ?? p.user.name);
    }
    return [...names.values()];
  }, [peers, self?.id]);
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(ROW, rowState(selected))}
    >
      <span className="text-sm font-medium">Current version</span>
      {here.length > 0 ? <Editors handles={here} suffix=" editing now" /> : null}
    </button>
  );
}

function VersionRow({
  version,
  now,
  selected,
  onSelect,
}: {
  version: CanvasVersion;
  now: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  const time = formatTime(new Date(version.created_at));
  return (
    <button
      type="button"
      aria-label={versionLabel(version, now)}
      aria-current={selected ? "true" : undefined}
      title={formatSize(version.size)}
      onClick={onSelect}
      className={cn(ROW, rowState(selected))}
    >
      {version.name ? (
        <>
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <Bookmark aria-hidden className="size-4 shrink-0" />
            <span className="truncate text-sm font-semibold">{version.name}</span>
          </span>
          <span className="text-xs text-muted-foreground">{savedByLine(version)}</span>
        </>
      ) : (
        <span className="text-sm font-medium">{time}</span>
      )}
      {version.editors.length > 0 ? (
        <Editors handles={version.editors} />
      ) : version.name ? null : (
        <span className="text-xs text-muted-foreground">Automatic</span>
      )}
    </button>
  );
}

function Editors({ handles, suffix = "" }: { handles: readonly string[]; suffix?: string }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      <span className="flex shrink-0 gap-1" aria-hidden>
        {handles.slice(0, AVATARS_SHOWN).map((h) => (
          <Avatar key={h} className="size-5">
            <AvatarFallback className="bg-secondary text-[10px]">{initials(h)}</AvatarFallback>
          </Avatar>
        ))}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {editorsLine(handles)}
        {suffix}
      </span>
    </span>
  );
}

// Save restore point: the button opens a name field in its place.
function SaveRestorePoint({
  channelId,
  onSaved,
}: {
  channelId: number;
  onSaved: (version: CanvasVersion) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  // The field takes focus when it replaces the button that opened it.
  useEffect(() => {
    if (naming) field.current?.focus();
  }, [naming]);

  const cancel = () => {
    setNaming(false);
    setName("");
    setError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the restore point a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const version = await saveCanvasRestorePointAction(channelId, trimmed);
      onSaved(version);
      cancel();
      toast.success("Restore point saved.");
    } catch (err) {
      console.error(err);
      setError("Couldn't save the restore point. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!naming) {
    return (
      <Button variant="outline" className="w-full" onClick={() => setNaming(true)}>
        Save restore point
      </Button>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <Input
        ref={field}
        aria-label="Restore point name"
        placeholder="Name this restore point"
        maxLength={MAX_NAME}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        aria-invalid={error ? true : undefined}
      />
      {error ? <p className="text-xs text-destructive-text">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
