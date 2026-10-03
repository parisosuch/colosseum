// Presence on a canvas: who each editor appears as, and the check that keeps a
// client from appearing as anyone else.
//
// y-websocket's awareness lets every client write any state it likes for any
// client id. The server narrows that: a socket may only write the ids it
// announced first, and whatever it writes gets its `user` field replaced with
// the identity the session was authorized as (PresenceUser in protocol.ts).

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

import type { PresenceUser } from "./protocol";

export type { PresenceUser };

// One colour per person, picked by hashing their user id, so it's the same on
// every canvas and after every reconnect. These are names, not colours: each
// one is a `--presence-<name>` token in app/globals.css with a light and a dark
// value, from the design's `canvas · explore` collection, so a cursor follows
// the viewer's theme.
export const PRESENCE_COLORS = ["violet", "orange", "teal"] as const;

export type PresenceColor = (typeof PRESENCE_COLORS)[number];

// What a cursor is labelled with when the editor hasn't picked a handle yet.
const UNNAMED = "Someone";

export function presenceColor(userId: string): PresenceColor {
  // FNV-1a: stable across processes and versions, unlike anything seeded.
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length];
}

// The identity a socket shows in presence, from what `authorize` said about it.
// Only editors have one: read-only sockets never appear.
export function presenceFor(auth: {
  access: "read" | "write";
  userId: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
}): PresenceUser | null {
  if (auth.access !== "write" || !auth.userId) return null;
  const handle = auth.handle ?? null;
  return {
    id: auth.userId,
    handle,
    name: handle ?? UNNAMED,
    avatarUrl: auth.avatarUrl ?? null,
    color: presenceColor(auth.userId),
  };
}

// May `self` write awareness for `clientId`? Yes unless another socket in the
// room announced it first. A yes claims the id for `self` until it leaves, so
// nobody else can move its cursor or remove it from presence.
export function claimClientId<S>(
  conns: Map<S, { clientIds: Set<number> }>,
  self: S,
  clientId: number,
): boolean {
  for (const [socket, conn] of conns) {
    if (socket !== self && conn.clientIds.has(clientId)) return false;
  }
  conns.get(self)?.clientIds.add(clientId);
  return true;
}

// Rewrite an awareness update from an editor's socket before the room applies
// it. Entries for client ids the socket may not write (`mayWrite` false) are
// dropped, and every state left gets `user` set to the editor's identity. A
// null state (the client leaving) passes through. Returns null when nothing is
// left to apply.
//
// The wire format is y-protocols' encodeAwarenessUpdate: a count, then per
// entry the client id, its clock and the state as JSON.
export function stampAwarenessUpdate(
  update: Uint8Array,
  user: PresenceUser,
  mayWrite: (clientId: number) => boolean,
): Uint8Array | null {
  const decoder = decoding.createDecoder(update);
  const entries: { clientId: number; clock: number; state: string }[] = [];
  const count = decoding.readVarUint(decoder);
  for (let i = 0; i < count; i++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const state: unknown = JSON.parse(decoding.readVarString(decoder));
    if (!mayWrite(clientId)) continue;
    if (state === null) {
      entries.push({ clientId, clock, state: "null" });
    } else if (typeof state === "object" && !Array.isArray(state)) {
      entries.push({ clientId, clock, state: JSON.stringify({ ...state, user }) });
    }
    // Anything else (a bare string or number) isn't a presence state; drop it.
  }
  if (entries.length === 0) return null;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const { clientId, clock, state } of entries) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, state);
  }
  return encoding.toUint8Array(encoder);
}
