// Canvas version history: automatic versions, named restore points and
// restore. History is for channel managers; the server actions in
// lib/colosseum/ check that before calling in here.
//
// Automatic versions are written when an editing session goes quiet (no edits
// for `quietMs`, 5 minutes by default) and always right before a restore. Each
// one records `editors`, the users whose updates the server accepted since the
// previous version of that channel, so the history shows who changed what.
//
// Restore applies the old state to the live doc as a new change. Clients
// merge it like any remote edit, nobody's undo stack can take it back, and the
// state it replaced stays in history as the version written just before.

import * as Y from "yjs";

import { elementsOf, removeBlockElements } from "./canvas-doc";
import type { RestoreResult } from "./canvas-history-registry";
import type { RetentionStore } from "./canvas-retention";
import type { CanvasStore } from "./canvas-server";

export const DEFAULT_QUIET_MS = 5 * 60 * 1000;

export type NewVersion = {
  channelId: number;
  doc: Uint8Array;
  // Set for a named restore point, null for an automatic version.
  name: string | null;
  // Who saved a named restore point; null for automatic versions.
  createdBy: string | null;
  editors: string[];
};

export interface VersionStore extends RetentionStore {
  // The new version's id, or null when the channel no longer exists.
  insertVersion(version: NewVersion): Promise<number | null>;
  // A version's doc, only if it belongs to `channelId`.
  versionDoc(channelId: number, versionId: number): Promise<Uint8Array | null>;
  replaceVersionDoc(versionId: number, doc: Uint8Array): Promise<void>;
}

// Access to a channel's current doc. `fn` runs synchronously against it, and
// whatever it changes is saved before the promise settles. Null when the
// channel is gone. The canvas server implements this over its rooms, so the
// change reaches connected clients; `storedDocs` below does the same against
// storage alone.
export interface CanvasDocs {
  withDoc<R>(channelId: number, fn: (doc: Y.Doc) => R): Promise<R | null>;
}

// An element a restore took off the canvas, with the box it last had. Its
// coordinates are the element's own fields (relative to a parent frame or
// group when it has one).
export type RemovedElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CanvasHistoryOptions = {
  versions: VersionStore;
  canvases: Pick<CanvasStore, "columnIds">;
  docs: CanvasDocs;
  quietMs?: number;
  now?: () => number;
  // Called after a restore with the elements it removed. Canvas comment
  // threads anchored to these fall back to free pins at the element's last
  // position; that hook is wired up once threads exist. A restore into an open
  // room is also an ordinary doc change, so a doc observer on the room sees the
  // same deletes. A restore into a closed canvas has no room, which is why
  // this callback exists.
  onElementsRemoved?: (channelId: number, removed: RemovedElement[]) => void | Promise<void>;
};

// Transaction origins for history's own changes.
const REVERT_ORIGIN = Symbol("canvas-history-revert");
export const RESTORE_ORIGIN = Symbol("canvas-history-restore");

// An update that, applied to `doc`, returns its elements to the state encoded
// in `version`. The version is loaded into a scratch doc, everything that
// happened since is applied there as one tracked change, and an undo of that
// change is what gets sent back. Undo re-creates deleted elements under their
// old keys, reverts changed fields and text, and deletes what was added, all as
// new operations, so the result merges into the live doc like any edit.
//
// Only the `elements` map is reverted. Any other top-level type a later
// feature adds to the doc keeps its current state.
function revertUpdate(doc: Y.Doc, version: Uint8Array): Uint8Array {
  const past = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(past, version);
    const undo = new Y.UndoManager(elementsOf(past), {
      trackedOrigins: new Set([REVERT_ORIGIN]),
      captureTimeout: 0,
    });
    Y.applyUpdate(past, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(past)), REVERT_ORIGIN);
    undo.undo();
    undo.destroy();
    return Y.encodeStateAsUpdate(past, Y.encodeStateVector(doc));
  } finally {
    past.destroy();
  }
}

function boxOf(id: string, el: Y.Map<unknown>): RemovedElement {
  const num = (key: string) => {
    const v = el.get(key);
    return typeof v === "number" ? v : 0;
  };
  return {
    id,
    type: String(el.get("type")),
    x: num("x"),
    y: num("y"),
    w: num("w"),
    h: num("h"),
  };
}

// Restore `doc`'s elements to `version` in one transaction, dropping block
// elements whose column fails `keepColumn` (blocks deleted or moved out since).
// Returns the elements that were on the canvas before and aren't now.
export function restoreElements(
  doc: Y.Doc,
  version: Uint8Array,
  keepColumn: (columnId: number) => boolean,
  origin: unknown,
): RemovedElement[] {
  const elements = elementsOf(doc);
  const before = [...elements.entries()].map(([id, el]) => boxOf(id, el));
  const update = revertUpdate(doc, version);
  doc.transact(() => {
    Y.applyUpdate(doc, update, origin);
    removeBlockElements(doc, keepColumn, origin);
  }, origin);
  return before.filter((el) => !elements.has(el.id));
}

export function createCanvasHistory(options: CanvasHistoryOptions) {
  const {
    versions,
    canvases,
    docs,
    quietMs = DEFAULT_QUIET_MS,
    now = Date.now,
    onElementsRemoved,
  } = options;

  // An editing session per channel: who has edited since the last version,
  // and when the last edit came in.
  type Session = {
    editors: Set<string>;
    lastEditAt: number;
    timer: ReturnType<typeof setTimeout> | null;
  };
  const sessions = new Map<number, Session>();
  let stopped = false;

  function arm(channelId: number, session: Session, delay: number) {
    session.timer = setTimeout(() => onTimer(channelId), delay);
    session.timer.unref?.();
  }

  // Edits come in at pointer-move rate, so the timer isn't reset on each one.
  // It fires `quietMs` after the session started and re-arms for whatever is
  // left until the last edit is `quietMs` old.
  function onTimer(channelId: number) {
    const session = sessions.get(channelId);
    if (!session) return;
    session.timer = null;
    const idle = now() - session.lastEditAt;
    if (idle < quietMs) {
      arm(channelId, session, quietMs - idle);
      return;
    }
    writeVersion(channelId, null, null).catch((err) =>
      console.error(`[realtime] versioning canvas ${channelId} failed`, err),
    );
  }

  function recordEdit(channelId: number, userId: string | null): void {
    if (stopped) return;
    let session = sessions.get(channelId);
    if (!session) {
      session = { editors: new Set(), lastEditAt: 0, timer: null };
      sessions.set(channelId, session);
    }
    if (userId) session.editors.add(userId);
    session.lastEditAt = now();
    if (!session.timer) arm(channelId, session, quietMs);
  }

  // End the channel's session and hand back its editors. Called inside the
  // same synchronous step that encodes the doc, so the editors and the state
  // describe the same moment.
  function takeEditors(channelId: number): string[] {
    const session = sessions.get(channelId);
    if (!session) return [];
    if (session.timer) clearTimeout(session.timer);
    sessions.delete(channelId);
    return [...session.editors];
  }

  // Write a version of the channel's current doc. Returns its id and the doc's
  // Yjs snapshot at that moment, or null when the channel is gone.
  async function writeVersion(
    channelId: number,
    name: string | null,
    createdBy: string | null,
  ): Promise<{ id: number; snapshot: Y.Snapshot } | null> {
    let editors: string[] = [];
    const captured = await docs.withDoc(channelId, (doc) => {
      editors = takeEditors(channelId);
      return { state: Y.encodeStateAsUpdate(doc), snapshot: Y.snapshot(doc) };
    });
    if (!captured) return null;
    let id: number | null;
    try {
      id = await versions.insertVersion({
        channelId,
        doc: captured.state,
        name,
        createdBy,
        editors,
      });
    } catch (err) {
      // Put the session back so its editors land in the next version.
      for (const editor of editors) recordEdit(channelId, editor);
      throw err;
    }
    return id === null ? null : { id, snapshot: captured.snapshot };
  }

  const api = {
    // The canvas server calls this for every update a writer sends.
    recordEdit,

    async saveRestorePoint(channelId: number, name: string, userId: string) {
      const version = await writeVersion(channelId, name, userId);
      return version?.id ?? null;
    },

    async restore(
      channelId: number,
      versionId: number,
      userId: string,
    ): Promise<RestoreResult | null> {
      const target = await versions.versionDoc(channelId, versionId);
      if (!target) return null;

      const backup = await writeVersion(channelId, null, null);
      if (!backup) return null;

      const live = await canvases.columnIds(channelId);
      const result = await docs.withDoc(channelId, (doc) => {
        // An edit can land between the backup and this step. Rather than lose
        // it, rewrite the backup with the state the restore is about to replace.
        const drifted = Y.equalSnapshots(Y.snapshot(doc), backup.snapshot)
          ? null
          : Y.encodeStateAsUpdate(doc);
        const removed = restoreElements(doc, target, (id) => live.has(id), RESTORE_ORIGIN);
        return { drifted, removed };
      });
      if (!result) return null;
      if (result.drifted) await versions.replaceVersionDoc(backup.id, result.drifted);

      // The restore is the manager's edit. Starting a session for it means the
      // next version names them as having changed the canvas.
      recordEdit(channelId, userId);

      if (result.removed.length > 0 && onElementsRemoved) {
        await onElementsRemoved(channelId, result.removed);
      }
      return { backupId: backup.id, removedElements: result.removed.length };
    },

    async preview(channelId: number, versionId: number) {
      const state = await versions.versionDoc(channelId, versionId);
      if (!state) return null;
      const live = await canvases.columnIds(channelId);
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, state);
        removeBlockElements(doc, (id) => live.has(id), null);
        return Y.encodeStateAsUpdate(doc);
      } finally {
        doc.destroy();
      }
    },

    // Write a version for every session still open, so a restart doesn't lose
    // who edited. Call before the canvas server shuts its rooms.
    async shutdown(): Promise<void> {
      stopped = true;
      await Promise.all(
        [...sessions.keys()].map((channelId) =>
          writeVersion(channelId, null, null).catch((err) =>
            console.error(`[realtime] versioning canvas ${channelId} on shutdown failed`, err),
          ),
        ),
      );
    },

    // For tests: channels with edits not yet in a version.
    pendingChannels(): number[] {
      return [...sessions.keys()];
    },
  };

  return api;
}

export type CanvasHistory = ReturnType<typeof createCanvasHistory>;

// CanvasDocs over storage alone, for a process with no realtime server (tests,
// scripts). Loads the saved doc, prunes block elements the way a room does on
// load, runs `fn`, and saves if anything changed. Calls for one channel run one
// at a time so two of them can't overwrite each other's save.
export function storedDocs(store: CanvasStore): CanvasDocs {
  const queues = new Map<number, Promise<unknown>>();

  async function run<R>(channelId: number, fn: (doc: Y.Doc) => R): Promise<R | null> {
    const doc = new Y.Doc();
    try {
      const saved = await store.load(channelId);
      if (saved) Y.applyUpdate(doc, saved);
      let changed = false;
      doc.on("update", () => {
        changed = true;
      });
      const live = await store.columnIds(channelId);
      removeBlockElements(doc, (id) => live.has(id), null);
      const result = fn(doc);
      if (changed && (await store.save(channelId, Y.encodeStateAsUpdate(doc))) === "gone") {
        return null;
      }
      return result;
    } finally {
      doc.destroy();
    }
  }

  return {
    withDoc(channelId, fn) {
      const prev = queues.get(channelId) ?? Promise.resolve();
      const next = prev.then(
        () => run(channelId, fn),
        () => run(channelId, fn),
      );
      queues.set(channelId, next);
      const clear = () => {
        if (queues.get(channelId) === next) queues.delete(channelId);
      };
      next.then(clear, clear);
      return next;
    },
  };
}
