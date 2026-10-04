// Wire protocol for /realtime. The first four message types are y-websocket's,
// so the stock WebsocketProvider can talk to the server unchanged. Anything
// Colosseum adds on top uses a type number far above them.

import * as encoding from "lib0/encoding";
import type { ThreadChannelEvent } from "./canvas-threads";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

// A JSON-encoded ChannelEvent (below), server → client only. Register a handler
// for it on the provider (`provider.messageHandlers[MESSAGE_CHANNEL_EVENT]`).
export const MESSAGE_CHANNEL_EVENT = 100;

// How an editor appears to everyone else on the canvas. The server writes it
// into the `user` field of each editor's awareness state from the editor's
// session, replacing whatever the client put there, so this is the only part
// of another client's awareness state that can be trusted. Everything else in
// the state (cursor, selection) is the client's own and unchecked.
//
// Read-only viewers have no awareness state on the server at all, so they
// never appear here.
export type PresenceUser = {
  // The user's id. Several tabs of one person share it; group avatars by it.
  id: string;
  // Their handle, or null before they've picked one at onboarding.
  handle: string | null;
  // What to label a cursor with. The app has no display name separate from the
  // handle, so this is the handle, or a placeholder when there isn't one.
  name: string;
  avatarUrl: string | null;
  // A colour name from PRESENCE_COLORS (canvas-presence.ts), the same for this
  // user on every canvas and in every session. Clients draw it with the
  // matching `--presence-<name>` token.
  color: string;
};

export type ChannelEvent =
  // A block joined the channel from somewhere other than this canvas (grid,
  // API, MCP, a move or copy). The unplaced-blocks sidebar picks it up.
  | { type: "block.added"; columnId: number }
  // A block left the channel. The server has already removed its elements from
  // the doc; this tells the sidebar to drop it too.
  | { type: "block.removed"; columnId: number }
  // What this socket may do and who it appears as. Sent once when the socket
  // joins, and again whenever a permission change re-checks it and the answer
  // differs. `read` means the server drops this client's updates and awareness
  // from then on: show the canvas read-only. `user` is null for read access.
  | { type: "session"; access: "read" | "write"; user: PresenceUser | null }
  // Canvas comment threads (canvas-threads.ts).
  | ThreadChannelEvent;

// The server refused an edit from this client and is closing its socket with
// CLOSE_EDIT_REFUSED. The doc in the tab now holds a change the server will
// never take, and every later edit builds on it, so the tab has to reload to
// carry on. `reason`:
//   - `too-large`: one message was over the per-message limit (a paste of a
//     few hundred strokes or more).
//   - `doc-full`: the canvas is at its size ceiling. Deleting still works.
//   - `invalid`: the edit wrote outside the doc's shape (canvas-doc.ts).
//
// Kept out of ChannelEvent until the client handles it: a type 100 event the
// client doesn't know reaches its thread reducer.
export type EditRefusedEvent = {
  type: "edit.refused";
  reason: "too-large" | "doc-full" | "invalid";
};

export function encodeChannelEvent(event: ChannelEvent | EditRefusedEvent): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_CHANNEL_EVENT);
  encoding.writeVarString(encoder, JSON.stringify(event));
  return encoding.toUint8Array(encoder);
}

// Canvas rooms live under /realtime/canvas/<channelId>.
export const CANVAS_PATH = "/realtime/canvas/";

// Close codes in the 4000-4999 application range. y-websocket's default
// `shouldReconnect` gives up on 4400-4499, so all three are final.
//
// The channel was deleted, directly or with the group that owned it.
export const CLOSE_CHANNEL_GONE = 4404;
// The viewer can no longer read the channel (removed, made private, banned), or
// never could. A socket that's refused at connect gets this too, after the
// handshake, so a tab whose access was revoked while it was offline stops
// retrying instead of polling the server forever.
export const CLOSE_ACCESS_REVOKED = 4403;
// The server refused one of this client's edits (EditRefusedEvent above says
// why). Reconnecting would send the same edit again, so it's final.
export const CLOSE_EDIT_REFUSED = 4413;
