import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { column, owner, shareLink, user } from "@/lib/db/schema";
import { mediaUrl } from "./blob";
import { blockLabel } from "./block-meta";
import { type Channel, getChannel } from "./channel";
import { type Column, getColumn } from "./column";
import { shareMediaUrl } from "./share-url";

export { shareMediaUrl, stripShareToken } from "./share-url";

// Share links: "anyone with the link" read access to a private channel, or to
// one block in it, without an account. The token in the URL is the whole
// credential. Only its sha256 is stored, so a link can be copied once, when it
// is made, and a database read never hands out a working one. Losing a link
// means making another, which is why a channel may hold any number of them.

// 32 random bytes as base64url: 43 characters, 256 bits, the same strength as
// an API token. No prefix — this lives in a URL, not a header someone pastes.
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  // Whether it opens anything right now. `block_moved`: a block link whose
  // block has left this channel; it works again if the block comes back.
  status: "active" | "expired" | "block_moved";
  // What a block link's block is called, so a list of links can say which is
  // which. Null for a channel link, or a block that's been deleted.
  block_label: string | null;
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
type BlockInfo = { channel_id: number; label: string };

function toShareLink(row: ShareRow, block?: BlockInfo): ShareLink {
  const expires_at = row.expires_at?.toISOString() ?? null;
  const status =
    expires_at && isExpired({ expires_at })
      ? "expired"
      : row.block_id != null && block && block.channel_id !== row.channel_id
        ? "block_moved"
        : "active";
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    channel_id: row.channel_id,
    block_id: row.block_id ?? null,
    label: row.label ?? null,
    expires_at,
    status,
    block_label: block?.label ?? null,
  };
}

// The blocks behind a set of block links, in one read: where each lives now
// and what it's called.
async function blockInfo(rows: ShareRow[]): Promise<Map<number, BlockInfo>> {
  const ids = [...new Set(rows.map((r) => r.block_id).filter((id): id is number => id != null))];
  if (ids.length === 0) return new Map();
  const blocks = await db
    .select({
      id: column.id,
      channel_id: column.channel_id,
      type: column.type,
      title: column.title,
      url: column.url,
    })
    .from(column)
    .where(inArray(column.id, ids));
  return new Map(
    blocks.map((b) => [
      b.id,
      {
        channel_id: b.channel_id,
        label: blockLabel({
          type: b.type,
          title: b.title ?? undefined,
          url: b.url ?? undefined,
        } as Column),
      },
    ]),
  );
}

async function toShareLinks(rows: ShareRow[]): Promise<ShareLink[]> {
  const blocks = await blockInfo(rows);
  return rows.map((r) => toShareLink(r, r.block_id != null ? blocks.get(r.block_id) : undefined));
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
  const [link] = await toShareLinks([row]);
  return { link, token };
}

// A channel's links that haven't been revoked, newest first, block links
// included. Expired links and block links whose block has moved stay listed,
// with their `status`, so their creator can tell a dead link from a missing one.
export async function listShareLinks(channelId: number): Promise<ShareLink[]> {
  const rows = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.channel_id, channelId), isNull(shareLink.revoked_at)))
    .orderBy(desc(shareLink.created_at));
  return toShareLinks(rows);
}

// One link by id, revoked or not — for authorizing a revoke against the
// channel it belongs to.
export async function getShareLink(id: string): Promise<ShareLink | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(shareLink).where(eq(shareLink.id, id)).limit(1);
  return row ? toShareLink(row) : null;
}

// Revoke one link. It stops working on the next request: resolveShareToken
// reads the row every time and nothing caches it. Returns false when there was
// no live link with that id on that channel.
export async function revokeShareLink(id: string, channelId: number): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await db
    .update(shareLink)
    .set({ revoked_at: new Date() })
    .where(
      and(eq(shareLink.id, id), eq(shareLink.channel_id, channelId), isNull(shareLink.revoked_at)),
    )
    .returning({ id: shareLink.id });
  return rows.length > 0;
}

// Whether a ban stands behind a link: its creator is banned, or the channel
// belongs to a banned person. Like an API token, a link stops working the
// moment its user is banned and comes back if they're unbanned; the row is
// left alone so the ban stays reversible.
async function bannedBehind(createdBy: string | null, ownedBy: string): Promise<boolean> {
  const channelOwner = db.select({ id: owner.user_id }).from(owner).where(eq(owner.id, ownedBy));
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.banned, true),
        createdBy
          ? or(inArray(user.id, channelOwner), eq(user.id, createdBy))
          : inArray(user.id, channelOwner),
      ),
    )
    .limit(1);
  return !!row;
}

// Resolve a token from a URL to what it opens, or null for anything that
// shouldn't work: a malformed or unknown token, a revoked or expired link, a
// deleted channel, a banned creator or channel owner, or a block link whose
// block has left the channel it was shared from (moved blocks don't carry their
// links along).
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
  if (await bannedBehind(row.created_by, channel.owned_by)) return null;
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

// The block as a link holder receives it: its media pointed at the share route.
export function shareColumn(col: Column, token: string): Column {
  return col.image ? { ...col, image: shareMediaUrl(col.image, token) } : col;
}
