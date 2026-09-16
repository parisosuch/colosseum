// Turning a Colosseum link, or a bare handle, into the ids the rest of the API
// is addressed by. Pure string parsing — no database, no server-only deps — so
// the resolution itself stays testable and the lookups live with their callers.
//
// Everything else takes a numeric channel or block id, and `list_channels`
// returns only what the caller owns. So a client handed a link — the way a
// person actually shares a channel — had no way to act on it, and nothing it
// could read belonged to anyone else.
//
// Paths are `/{handle}`, `/{handle}/{channelId}`, and
// `/{handle}/{channelId}/{blockId}`, which is what the app's own routes use.

export type ResolvedLink = {
  handle: string;
  channelId?: number;
  blockId?: number;
};

// Pull the handle and any ids out of a Colosseum URL or path. Accepts a full
// URL on any host (a self-hosted instance is not colosseum.com, and the caller
// knows which instance it is talking to better than this does), a scheme-less
// host/path, or a bare path. Returns null when the shape isn't one of the three.
//
// The host is deliberately not checked. Refusing a link because it came from a
// different domain would break every self-hosted instance, and a handle that
// doesn't exist here resolves to nothing anyway.
export function parseColosseumLink(input: string): ResolvedLink | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A bare handle, with nothing around it. Decided before the URL parse because
  // `new URL("https://alice")` reads it as a host and leaves an empty path. A
  // handle never contains a dot or a slash, which is what separates "alice"
  // from "example.com" here.
  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? { handle: trimmed } : null;
  }

  let path = trimmed;
  // A full or scheme-less URL: keep the path. `new URL` needs a scheme, and a
  // bare "/alice/12" is already a path.
  if (!trimmed.startsWith("/")) {
    try {
      path = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).pathname;
    } catch {
      return null;
    }
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return null;

  const [handle, channel, block] = parts;
  // A handle is what the app allows in one: no dots or slashes, so a stray
  // "example.com" doesn't read as a handle.
  if (!/^[a-zA-Z0-9_-]+$/.test(handle)) return null;

  const result: ResolvedLink = { handle };
  if (channel !== undefined) {
    const id = Number(channel);
    if (!Number.isInteger(id)) return null;
    result.channelId = id;
  }
  if (block !== undefined) {
    const id = Number(block);
    if (!Number.isInteger(id)) return null;
    result.blockId = id;
  }
  return result;
}
