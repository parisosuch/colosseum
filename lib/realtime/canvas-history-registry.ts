// Where the data layer finds the realtime server's canvas history.
//
// server.ts creates the history service next to the canvas rooms and registers
// it here; the server actions (inside Next) look it up so a restore reaches the
// open room and its clients. Like events.ts, the handle hangs off globalThis
// under a registered symbol because Next's bundle and server.ts each load their
// own copy of this module.
//
// This module imports nothing else, Yjs included, so the Next bundle can ask
// whether a server is registered without loading a second copy of Yjs into the
// process.

export type RestoreResult = {
  // The automatic version written just before the restore.
  backupId: number;
  // How many elements the restore took off the canvas (elements added since
  // the version, and block elements for blocks no longer in the channel).
  removedElements: number;
};

export interface CanvasHistoryApi {
  // Null when the channel is gone.
  saveRestorePoint(channelId: number, name: string, userId: string): Promise<number | null>;
  // Null when the version isn't the channel's, or the channel is gone.
  restore(channelId: number, versionId: number, userId: string): Promise<RestoreResult | null>;
  // The version's doc as a Yjs update, minus block elements for blocks no
  // longer in the channel, so a preview shows what a restore would give.
  preview(channelId: number, versionId: number): Promise<Uint8Array | null>;
}

const KEY = Symbol.for("colosseum.realtime.canvasHistory");

type Global = Record<symbol, CanvasHistoryApi | undefined>;

export function setCanvasHistory(history: CanvasHistoryApi | null): void {
  (globalThis as unknown as Global)[KEY] = history ?? undefined;
}

export function getCanvasHistory(): CanvasHistoryApi | null {
  return (globalThis as unknown as Global)[KEY] ?? null;
}
