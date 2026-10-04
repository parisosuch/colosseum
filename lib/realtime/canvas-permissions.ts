// Which open canvas sockets a permission change reaches.
//
// The data layer publishes an access event (lib/realtime/events.ts) after any
// write that can change who reads or edits a channel. The canvas server then
// re-runs `authorize` for each socket this module picks out, with the request
// that socket was opened with, so the answer comes from the same rule the
// connection was let in by. Sockets it doesn't pick keep their access.

import type { RealtimeEvent } from "./events";

export type AccessEvent = Extract<
  RealtimeEvent,
  { type: "channel.access-changed" } | { type: "user.access-changed" }
>;

export function isAccessEvent(event: RealtimeEvent): event is AccessEvent {
  return event.type === "channel.access-changed" || event.type === "user.access-changed";
}

// Does `event` call for re-authorizing a socket on `channelId` that was last
// authorized as `userId` (null for signed out)?
//
// A user event matches on the user the socket was authorized as. A banned
// user's socket was authorized as them before the ban, so the ban reaches it;
// a signed-out socket has no user and only channel-wide events reach it.
export function affects(event: AccessEvent, channelId: number, userId: string | null): boolean {
  if (event.type === "channel.access-changed") return event.channelId === channelId;
  if (event.channelId !== undefined && event.channelId !== channelId) return false;
  return userId === event.userId;
}
