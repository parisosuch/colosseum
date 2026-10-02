import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { column, shareLink } from "@/lib/db/schema";
import { mediaUrl } from "./blob";
import { type Channel, getChannel } from "./channel";
import { type Column, getColumn } from "./column";
import { checkRateLimit, isRateLimited } from "./rate-limit";

// Share links: "anyone with the link" read access to a private channel, or to
// one block in it, without an account. The token in the URL is the whole
// credential. Only its sha256 is stored, so a link can be copied once, when it
// is made, and a database read never hands out a working one. Losing a link
// means making another, which is why a channel may hold any number of them.

// 32 random bytes as base64url: 43 characters, 256 bits, the same strength as
// an API token. No prefix — this lives in a URL, not a header someone pastes.
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// Expiry choices offered by the UI and accepted by the API, in days. A link
// expires after DEFAULT_SHARE_EXPIRY_DAYS unless its creator picks another, and
// `null` (never) has to be asked for explicitly.
export const SHARE_EXPIRY_DAYS = [1, 7, 30, 90, 365] as const;
export const DEFAULT_SHARE_EXPIRY_DAYS = 30;
export const MAX_SHARE_LABEL = 100;

export type ShareLink = {
  id: string;
  created_at: string;
  channel_id: number;
  // Set when the link opens one block rather than the whole channel.
  block_id: number | null;
  label: string | null;
  // Null: the link never expires.
  expires_at: string | null;
};

// A token that resolved to a live link, with what it opens.
export type ResolvedShare = {
  token: string;
  link: ShareLink;
  channel: Channel;
  // The shared block for a block link; null for a channel link.
  block: Column | null;
};

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateShareToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashShareToken(token) };
}

// Where a link opens, relative to the site. A channel link's blocks live one
// segment below it.
export function sharePath(token: string, blockId?: number | null): string {
  return blockId == null ? `/s/${token}` : `/s/${token}/${blockId}`;
}

// The longest expiry the API takes, so a typo can't mint a link for the next
// thousand years while still claiming to expire.
export const MAX_SHARE_EXPIRY_DAYS = 3650;

// An expiry as the UI, API and MCP send it: omitted → the default, null → never,
// a whole number of days → that. Anything else is "invalid".
export function parseShareExpiryDays(value: unknown): number | null | "invalid" {
  if (value === undefined) return DEFAULT_SHARE_EXPIRY_DAYS;
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value)) {
    return value >= 1 && value <= MAX_SHARE_EXPIRY_DAYS ? value : "invalid";
  }
  return "invalid";
}

// When a link made now with this many days should stop working; null for never.
export function shareExpiry(days: number | null, now: number = Date.now()): Date | null {
  return days == null ? null : new Date(now + days * 24 * 60 * 60 * 1000);
}

type ShareRow = typeof shareLink.$inferSelect;
function toShareLink(row: ShareRow): ShareLink {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    channel_id: row.channel_id,
    block_id: row.block_id ?? null,
    label: row.label ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
  };
}

export function isExpired(link: Pick<ShareLink, "expires_at">, now: number = Date.now()): boolean {
  return link.expires_at != null && new Date(link.expires_at).getTime() <= now;
}

// Make a link. Authorization (manage rights on a private channel, the block
// belonging to it) is the caller's job; this only writes. The plaintext token is
// returned here and nowhere else.
export async function createShareLink(input: {
  channelId: number;
  blockId?: number | null;
  label?: string | null;
  expiresAt: Date | null;
  createdBy: string | null;
}): Promise<{ link: ShareLink; token: string }> {
  const { token, hash } = generateShareToken();
  const label = input.label?.trim().slice(0, MAX_SHARE_LABEL) || null;
  const [row] = await db
    .insert(shareLink)
    .values({
      channel_id: input.channelId,
      block_id: input.blockId ?? null,
      token_hash: hash,
      label,
      created_by: input.createdBy,
      expires_at: input.expiresAt,
    })
    .returning();
  return { link: toShareLink(row), token };
}

// A channel's links that haven't been revoked, newest first, block links
// included. Expired ones stay listed (the UI marks them) so their creator can
// tell a dead link from a missing one.
export async function listShareLinks(channelId: number): Promise<ShareLink[]> {
  const rows = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.channel_id, channelId), isNull(shareLink.revoked_at)))
    .orderBy(desc(shareLink.created_at));
  return rows.map(toShareLink);
}

// One link by id, revoked or not — for authorizing a revoke against the
// channel it belongs to.
export async function getShareLink(id: string): Promise<ShareLink | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await db.select().from(shareLink).where(eq(shareLink.id, id)).limit(1);
  return row ? toShareLink(row) : null;
}

// Revoke one link. It stops working on the next request: resolveShareToken
// reads the row every time and nothing caches it. Returns false when there was
// no live link with that id on that channel.
export async function revokeShareLink(id: string, channelId: number): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const rows = await db
    .update(shareLink)
    .set({ revoked_at: new Date() })
    .where(
      and(eq(shareLink.id, id), eq(shareLink.channel_id, channelId), isNull(shareLink.revoked_at)),
    )
    .returning({ id: shareLink.id });
  return rows.length > 0;
}

// Resolve a token from a URL to what it opens, or null for anything that
// shouldn't work: a malformed or unknown token, a revoked or expired link, a
// deleted channel, or a block link whose block has left the channel it was
// shared from (moved blocks don't carry their links along).
export async function resolveShareToken(token: string): Promise<ResolvedShare | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.token_hash, hashShareToken(token)), isNull(shareLink.revoked_at)))
    .limit(1);
  if (!row) return null;
  const link = toShareLink(row);
  if (isExpired(link)) return null;
  const channel = await getChannel(link.channel_id);
  if (!channel) return null;
  let block: Column | null = null;
  if (link.block_id != null) {
    block = await getColumn(link.block_id);
    if (!block || block.channel_id !== channel.id) return null;
  }
  return { token, link, channel, block };
}

// Whether a share opens this whole channel (block links don't).
export function shareCoversChannel(share: ResolvedShare, channelId: number): boolean {
  return share.link.block_id == null && share.channel.id === channelId;
}

// Whether a share opens this block: any block of a shared channel, or the one
// block a block link names.
export function shareCoversBlock(
  share: ResolvedShare,
  block: Pick<Column, "id" | "channel_id">,
): boolean {
  if (block.channel_id !== share.channel.id) return false;
  return share.link.block_id == null || share.link.block_id === block.id;
}

// Whether a share opens a stored file: it has to be the media of a block the
// share covers. Same lookup canReadMedia does for a signed-in reader.
export async function shareCoversMedia(share: ResolvedShare, mediaId: string): Promise<boolean> {
  const rows = await db
    .select({ id: column.id, channel_id: column.channel_id })
    .from(column)
    .where(and(eq(column.image, mediaUrl(mediaId)), eq(column.channel_id, share.channel.id)));
  return rows.some((r) => shareCoversBlock(share, r));
}

// A block's own media URL, rewritten to the token-scoped route a link holder
// can load (/api/media/<id>/s/<token>). Anything else — an external URL, a
// public file — passes through. Callers append `?thumb` after this, so the
// token goes in the path.
export function shareMediaUrl(url: string, token: string): string {
  const match = /^(\/api\/media\/[0-9a-f-]{36})(\?.*)?$/.exec(url);
  return match ? `${match[1]}/s/${token}${match[2] ?? ""}` : url;
}

// The block as a link holder receives it: its media pointed at the share route.
export function shareColumn(col: Column, token: string): Column {
  return col.image ? { ...col, image: shareMediaUrl(col.image, token) } : col;
}

// Who is asking, for the miss counter: the first hop the proxy recorded.
function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `share-miss:${forwarded || headers.get("x-real-ip") || "unknown"}`;
}

// resolveShareToken for a request: a client that keeps presenting dead or
// made-up tokens gets "limited" instead of an answer. Only misses count, so a
// board loading a hundred thumbnails through a good link is never throttled.
// At 256 bits a token can't be guessed anyway; this keeps the lookups cheap.
export async function resolveShareRequest(
  token: string,
  headers: Headers,
): Promise<ResolvedShare | null | "limited"> {
  const key = clientKey(headers);
  if (isRateLimited(key)) return "limited";
  const share = await resolveShareToken(token);
  if (!share) checkRateLimit(key);
  return share;
}
