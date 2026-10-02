// In-process events from the data layer to the realtime server (server.ts).
//
// Both sides run in one process but load this module twice: Next bundles its
// own copy into the server build, and server.ts imports it from source. A
// module-level emitter would give each side a different instance, so the
// listener set hangs off globalThis under a registered symbol, which both
// copies resolve to the same object.
//
// Publishing with nobody subscribed is a no-op. That's the case under
// `bun test` and in any process that isn't serving sockets, and it's safe:
// the canvas prunes blocks that no longer exist whenever it loads a channel,
// so a missed event only matters for a canvas someone has open right now.

export type RealtimeEvent =
  // A block was added to a channel: created, copied in, or moved in.
  | { type: "block.added"; channelId: number; columnId: number }
  // A block left a channel: deleted, or moved out to another one.
  | { type: "block.removed"; channelId: number; columnId: number }
  // The channel is gone; its canvas row went with it (ON DELETE CASCADE).
  // Published for each channel a deleted group took with it, too.
  | { type: "channel.deleted"; channelId: number }
  // Who may read or write the channel changed for everyone at once: its access
  // mode or its owner. Every open socket on it is re-authorized.
  | { type: "channel.access-changed"; channelId: number }
  // One person's access changed: removed from a channel (`channelId` set), or
  // their group role, group membership or ban changed (no `channelId`, since
  // that can reach any channel). Their open sockets are re-authorized.
  | { type: "user.access-changed"; userId: string; channelId?: number };

type Listener = (event: RealtimeEvent) => void;

const KEY = Symbol.for("colosseum.realtime.listeners");

function listeners(): Set<Listener> {
  const g = globalThis as unknown as Record<symbol, Set<Listener> | undefined>;
  return (g[KEY] ??= new Set());
}

export function publishRealtime(event: RealtimeEvent): void {
  for (const listener of listeners()) {
    // A listener failing must never fail the mutation that published.
    try {
      listener(event);
    } catch (err) {
      console.error("[realtime] listener failed", err);
    }
  }
}

export function subscribeRealtime(listener: Listener): () => void {
  listeners().add(listener);
  return () => listeners().delete(listener);
}
