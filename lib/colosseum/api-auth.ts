// Server-only helpers for the REST API (app/api/v1/*) and the token-create
// route. Imports node:crypto, so it must never be pulled into a client bundle —
// only route handlers (nodejs runtime) import it.

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { apiToken } from "@/lib/db/schema";
import {
  Channel,
  ChannelAccess,
  ChannelViewer,
  canContributeChannel,
  canManageChannel,
  canReadChannel,
  viewerScope,
} from "./channel";
import { getChannel, transferChannel } from "./channel";
import {
  type Group,
  type GroupMember,
  type GroupRole,
  createGroup,
  deleteGroup,
  getGroupByHandle,
  groupRole,
  listGroupMembers,
  removeGroupMember,
  roleCanManage,
  setGroupRole,
  transferGroupOwnership,
  updateGroup,
} from "./group";
import { getOwnerByHandle } from "./owner";
import { HandleTakenError, getPublicUserProfile } from "./user";
import {
  type ChannelMember,
  addChannelMemberWithNotice,
  addGroupMemberWithNotice,
  isChannelMember,
  listChannelMembers,
  removeChannelMember,
  removeChannelMemberByHandle,
} from "./member";
import {
  Column,
  addChannelColumn,
  copyColumnInto,
  getColumn,
  moveColumn,
  reorderColumn,
} from "./column";
import {
  type Comment,
  createCommentWithNotices,
  deleteComment,
  getColumnComments,
  getCommentAuthorization,
} from "./comment";
import { ApiToken } from "./api-token";
import { getScreenshot, getScreenshotsForUrls } from "./screenshot-data";
import { assertColumnQuota } from "./admin";
import { notifyChannelNested } from "./nest";
import { checkRateLimit } from "./rate-limit";
import { logError, logInfo } from "@/lib/log";

// Tokens look like `clsm_<43 base64url chars>`. The prefix namespaces the secret
// (so it's greppable in logs/secret scanners) and the random part has 256 bits
// of entropy.
const TOKEN_PREFIX = "clsm_";
const TOKEN_BYTES = 32;
// How much of the token (prefix + a few secret chars) we keep in plaintext for
// display, so a user can tell their tokens apart without exposing the secret.
const PREFIX_DISPLAY_LEN = TOKEN_PREFIX.length + 8;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, prefix: token.slice(0, PREFIX_DISPLAY_LEN), hash: hashToken(token) };
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

// Resolve a channel's access mode from an API request body. Accepts the new
// `access` enum, and still honors the legacy `private` boolean (true → private,
// false → public) so existing clients keep working. Falls back to `fallback`
// (the current value on PATCH, or "public" on create) when neither is given.
export function parseAccess(body: Record<string, unknown>, fallback: ChannelAccess): ChannelAccess {
  if (body.access === "public" || body.access === "open" || body.access === "private") {
    return body.access;
  }
  if (typeof body.private === "boolean") {
    return body.private ? "private" : "public";
  }
  return fallback;
}

// A bearer token has no user session, so API handlers resolve it to a user id
// and then authorize every request explicitly (the Drizzle connection bypasses
// row-level security).
export type ApiAuth = { userId: string };

// Resolve a raw bearer token to its owning user. Shared by the REST API
// (authenticateApiToken, below) and the MCP endpoint (app/api/[transport]).
// Returns null for an unknown token; throws on a DB error so callers can
// distinguish "invalid token" from "auth backend unavailable".
export async function resolveApiToken(token: string): Promise<ApiAuth | null> {
  const hash = hashToken(token);

  const [row] = await db
    .select({ user_id: apiToken.user_id })
    .from(apiToken)
    .where(eq(apiToken.token_hash, hash))
    .limit(1);

  if (!row) {
    return null;
  }

  // Best-effort usage timestamp; never fail the request over it.
  void db
    .update(apiToken)
    .set({ last_used_at: new Date() })
    .where(eq(apiToken.token_hash, hash))
    .catch(() => {});

  return { userId: row.user_id };
}

// Resolve the `Authorization: Bearer <token>` header to the owning user. On
// success returns the user id; on failure returns a NextResponse the handler
// should return as-is.
export async function authenticateApiToken(req: Request): Promise<ApiAuth | NextResponse> {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return apiError("Missing or malformed Authorization header.", 401);
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return apiError("Missing bearer token.", 401);
  }

  try {
    const auth = await resolveApiToken(token);
    if (!auth) {
      // Never log the token itself, even truncated — just that one was
      // rejected, useful for spotting a client using a revoked/typo'd token.
      logInfo("api-auth", "rejected an invalid API token");
      return apiError("Invalid API token.", 401);
    }
    // Throttle per token owner so one client can't spam the API.
    const rl = checkRateLimit(auth.userId);
    if (!rl.ok) {
      logInfo("api-auth", `rate limited user ${auth.userId}`);
      return NextResponse.json(
        { error: "Rate limit exceeded. Slow down." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }
    return auth;
  } catch (e) {
    logError("api-auth", "token resolution failed (DB error)", e);
    return apiError("Authentication failed.", 500);
  }
}

// Persist a freshly generated token. The hash + non-secret prefix are stored;
// the plaintext is returned once for the caller to display and is unrecoverable
// afterwards.
export async function createApiToken(params: {
  userId: string;
  name: string | null;
}): Promise<{ token: string; row: ApiToken }> {
  const { token, prefix, hash } = generateApiToken();

  const [row] = await db
    .insert(apiToken)
    .values({
      user_id: params.userId,
      name: params.name,
      token_prefix: prefix,
      token_hash: hash,
    })
    .returning({
      id: apiToken.id,
      created_at: apiToken.created_at,
      name: apiToken.name,
      token_prefix: apiToken.token_prefix,
      last_used_at: apiToken.last_used_at,
    });

  return {
    token,
    row: {
      id: row.id,
      created_at: row.created_at.toISOString(),
      name: row.name,
      token_prefix: row.token_prefix,
      last_used_at: row.last_used_at?.toISOString() ?? null,
    },
  };
}

// Whether the caller has a membership row. `open` channels never gate on it, so
// skip the query there. Read only needs it for private channels; contribute
// needs it for public ones too (members can add to a public channel), so callers
// pass which modes matter.
async function viewerFor(
  channel: Channel,
  userId: string,
  modes: readonly ChannelAccess[],
): Promise<ChannelViewer> {
  const scope = await viewerScope(userId);
  const isMember = modes.includes(channel.access)
    ? await isChannelMember(channel.id, userId)
    : false;
  return { ...scope, isChannelMember: isMember };
}

// Read authorization: public/open channels are visible to anyone; a private one
// only to its owner or a member. A missing OR hidden channel both return 404, so
// we never leak the existence of someone else's private channel.
export async function authorizeChannelRead(
  channel: Channel | null,
  userId: string,
): Promise<NextResponse | null> {
  if (!channel || !canReadChannel(channel, await viewerFor(channel, userId, ["private"]))) {
    return apiError("Not found.", 404);
  }
  return null;
}

// Manage authorization: settings, delete, and membership — owner only. A hidden
// channel 404s (don't leak); a readable-but-not-owned channel is 403.
export async function authorizeChannelManage(
  channel: Channel | null,
  userId: string,
): Promise<NextResponse | null> {
  const denied = await authorizeChannelRead(channel, userId);
  if (denied) return denied;
  if (!canManageChannel(channel!, await viewerScope(userId))) {
    logInfo(
      "api-auth",
      `user ${userId} denied manage on channel ${channel!.id} (owned by ${channel!.owned_by})`,
    );
    return apiError("You do not have permission to modify this resource.", 403);
  }
  return null;
}

// Contribute authorization (adding blocks): per the access matrix — open → any
// signed-in user, public/private → owner or member. 404 for a hidden channel,
// 403 for a readable one the caller may not add to.
export async function authorizeChannelContribute(
  channel: Channel | null,
  userId: string,
): Promise<NextResponse | null> {
  if (!channel) return apiError("Not found.", 404);
  const viewer = await viewerFor(channel, userId, ["public", "private"]);
  if (!canReadChannel(channel, viewer)) return apiError("Not found.", 404);
  if (!canContributeChannel(channel, viewer)) {
    return apiError("You do not have permission to modify this resource.", 403);
  }
  return null;
}

// Block edit/delete authorization: the caller must be able to read the block's
// channel, and be either the channel owner or the block's own creator.
export async function authorizeBlockWrite(
  channel: Channel | null,
  block: Column,
  userId: string,
): Promise<NextResponse | null> {
  const denied = await authorizeChannelRead(channel, userId);
  if (denied) return denied;
  const viewer = await viewerScope(userId);
  if (channel!.owned_by !== viewer.ownerId && block.created_by !== userId) {
    return apiError("You do not have permission to modify this resource.", 403);
  }
  return null;
}

// Reassign a block to another channel, authorizing both ends: the caller must
// own the channel the block lives in now and the one it is going to. Composed
// here, next to the rest of the matrix, so the rule has one home rather than
// being reassembled at each call site. Returns the updated block, or the denial
// NextResponse to hand back (which the MCP tool turns into a tool error). A
// missing block — or a channel the caller cannot even read — is a 404, so this
// never confirms that someone else's private channel exists.
export async function moveBlock(
  blockId: number,
  destinationChannelId: number,
  userId: string,
): Promise<Column | NextResponse> {
  const block = await getColumn(blockId, { html: false });
  if (!block) return apiError("Not found.", 404);

  const sourceDenial = await authorizeChannelManage(await getChannel(block.channel_id), userId);
  if (sourceDenial) return sourceDenial;

  const destinationDenial = await authorizeChannelManage(
    await getChannel(destinationChannelId),
    userId,
  );
  if (destinationDenial) return destinationDenial;

  // Already where it was asked to go — nothing to write.
  if (block.channel_id === destinationChannelId) return block;

  const moved = await moveColumn(blockId, destinationChannelId);
  return moved ?? apiError("Not found.", 404);
}

// Group authorization, mirroring the channel matrix above. A group the caller
// may not administer is a 404 rather than a 403, for the same reason a private
// channel is: a distinguishable refusal confirms it exists.
//
// Addressed by handle over the API, since that is what GET /api/v1/groups
// returns and what a person would paste. `getGroupByHandle` resolves it.
async function requireGroupBy(
  handle: string,
  userId: string,
  need: "manage" | "own",
): Promise<Group | NextResponse> {
  const group = await getGroupByHandle(handle);
  if (!group) return apiError("Not found.", 404);
  const role = await groupRole(group.id, userId);
  const ok = need === "own" ? role === "owner" : roleCanManage(role);
  if (!ok) return apiError("Not found.", 404);
  return group;
}

// A group's roster. Any member may read it — knowing who else is in a group you
// belong to is not privileged.
export async function listGroupMembersFor(
  handle: string,
  userId: string,
): Promise<GroupMember[] | NextResponse> {
  const group = await getGroupByHandle(handle);
  if (!group) return apiError("Not found.", 404);
  if (!(await groupRole(group.id, userId))) return apiError("Not found.", 404);
  return listGroupMembers(group.id);
}

export async function addGroupMemberFor(
  handle: string,
  memberHandle: string,
  role: Exclude<GroupRole, "owner">,
  userId: string,
): Promise<GroupMember | NextResponse> {
  const group = await requireGroupBy(handle, userId, "manage");
  if (group instanceof NextResponse) return group;
  try {
    return await addGroupMemberWithNotice({
      groupId: group.id,
      handle: memberHandle,
      role,
      actorUserId: userId,
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Could not add that member.", 400);
  }
}

export async function setGroupRoleFor(
  handle: string,
  memberHandle: string,
  role: Exclude<GroupRole, "owner">,
  userId: string,
): Promise<NextResponse | null> {
  const group = await requireGroupBy(handle, userId, "manage");
  if (group instanceof NextResponse) return group;
  const profile = await getPublicUserProfile(memberHandle);
  if (!profile) return apiError("No user with that handle.", 400);
  try {
    // setGroupRole refuses to touch the owner, which is what keeps a group from
    // ending up with nobody able to administer it.
    await setGroupRole(group.id, profile.user_id, role);
    return null;
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Could not set that role.", 400);
  }
}

export async function removeGroupMemberFor(
  handle: string,
  memberHandle: string,
  userId: string,
): Promise<NextResponse | null> {
  const group = await getGroupByHandle(handle);
  if (!group) return apiError("Not found.", 404);
  const profile = await getPublicUserProfile(memberHandle);
  if (!profile) return apiError("No user with that handle.", 400);

  // Leaving is a member's own business; removing someone else takes manage.
  if (profile.user_id !== userId) {
    const managed = await requireGroupBy(handle, userId, "manage");
    if (managed instanceof NextResponse) return managed;
  } else if (!(await groupRole(group.id, userId))) {
    return apiError("Not found.", 404);
  }

  try {
    // removeGroupMember refuses the owner — they transfer or delete instead.
    await removeGroupMember(group.id, profile.user_id);
    return null;
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Could not remove that member.", 400);
  }
}

export async function transferGroupOwnershipFor(
  handle: string,
  toHandle: string,
  userId: string,
): Promise<NextResponse | null> {
  const group = await requireGroupBy(handle, userId, "own");
  if (group instanceof NextResponse) return group;
  const profile = await getPublicUserProfile(toHandle);
  if (!profile) return apiError("No user with that handle.", 400);
  try {
    await transferGroupOwnership(group.id, userId, profile.user_id);
    return null;
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Could not transfer the group.", 400);
  }
}

export async function updateGroupFor(
  handle: string,
  updates: { name?: string; about?: string },
  userId: string,
): Promise<Group | NextResponse> {
  const group = await requireGroupBy(handle, userId, "manage");
  if (group instanceof NextResponse) return group;
  if (Object.keys(updates).length === 0) {
    return apiError("Nothing to update. Allowed: name, about.", 400);
  }
  return updateGroup(group.id, updates);
}

// Delete a group. Owner only, and its channels go with it — the cascade is why
// this is the one group operation restricted to the single owner.
export async function deleteGroupFor(handle: string, userId: string): Promise<NextResponse | null> {
  const group = await requireGroupBy(handle, userId, "own");
  if (group instanceof NextResponse) return group;
  await deleteGroup(group.id);
  return null;
}

// Hand a channel to another owner — yourself, or a group you administer.
//
// Both ends are checked: you must own the channel now, and be able to manage
// where it is going. Note that ownership is what grants access to a private
// channel, so a transfer silently changes who can read it; the per-channel
// member roster is deliberately left alone.
export async function transferChannelFor(
  channelId: number,
  toHandle: string,
  userId: string,
): Promise<Channel | NextResponse> {
  const denial = await authorizeChannelManage(await getChannel(channelId), userId);
  if (denial) return denial;

  const target = await getOwnerByHandle(toHandle);
  if (!target) return apiError("Not found.", 404);

  const scope = await viewerScope(userId);
  const mayReceive =
    target.id === scope.ownerId || roleCanManage(await groupRole(target.id, userId));
  if (!mayReceive) {
    return apiError("You do not have permission to modify this resource.", 403);
  }

  const moved = await transferChannel(channelId, target.id);
  return moved ?? apiError("Not found.", 404);
}

// Create a group. Anyone signed in may, as in the app — a group is a handle
// plus a roster, and claiming one costs nothing anyone else holds.
//
// The handle comes from the same pool people draw from, so a taken one is a
// 409 naming the reason rather than a generic failure.
export async function createGroupFor(
  handle: string,
  name: string,
  userId: string,
): Promise<Group | NextResponse> {
  try {
    return await createGroup({ handle, name, created_by: userId });
  } catch (e) {
    if (e instanceof HandleTakenError) return apiError("That handle is already taken.", 409);
    return apiError(e instanceof Error ? e.message : "Could not create that group.", 400);
  }
}

// A channel's roster. Read-authorized rather than manage: the channel page
// already lists members to anyone who can see the channel, so gating the API
// harder would tell a different story about the same fact.
export async function listMembersFor(
  channelId: number,
  userId: string,
): Promise<ChannelMember[] | NextResponse> {
  const denial = await authorizeChannelRead(await getChannel(channelId), userId);
  if (denial) return denial;
  return listChannelMembers(channelId);
}

// Add someone by handle. Manage-authorized: who may read a private channel is
// the owner's decision, and an add sends the new member a notification.
export async function addMemberFor(
  channelId: number,
  handle: string,
  userId: string,
): Promise<ChannelMember | NextResponse> {
  const channel = await getChannel(channelId);
  const denial = await authorizeChannelManage(channel, userId);
  if (denial) return denial;
  try {
    return await addChannelMemberWithNotice({
      channelId,
      handle,
      actorUserId: userId,
      channelOwnedBy: channel!.owned_by,
    });
  } catch (e) {
    // A bad handle, or the owner's own, is the caller's mistake rather than a
    // server fault — surface the reason instead of a 500.
    return apiError(e instanceof Error ? e.message : "Could not add that member.", 400);
  }
}

// Remove someone by handle. Manage-authorized. Giving up your *own* membership
// is leaveChannel, which a member may do without managing anything.
export async function removeMemberFor(
  channelId: number,
  handle: string,
  userId: string,
): Promise<NextResponse | null> {
  const denial = await authorizeChannelManage(await getChannel(channelId), userId);
  if (denial) return denial;
  try {
    await removeChannelMemberByHandle(channelId, handle);
    return null;
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Could not remove that member.", 400);
  }
}

// A block's comments. Read-authorized: anyone who can see the block can see
// what was said about it, which is what the block modal shows.
export async function listCommentsFor(
  blockId: number,
  userId: string,
): Promise<Comment[] | NextResponse> {
  const block = await getColumn(blockId, { html: false });
  if (!block) return apiError("Not found.", 404);
  const denial = await authorizeChannelRead(await getChannel(block.channel_id), userId);
  if (denial) return denial;
  return getColumnComments(blockId);
}

// Post a comment. Read-authorized too — commenting is what a reader does, and
// an open channel's whole point is that others join in. The notices owed to the
// block's author and to anyone @mentioned are sent by createCommentWithNotices,
// which filters both to people who can actually read the channel.
export async function createCommentFor(
  blockId: number,
  body: string,
  userId: string,
): Promise<Comment | NextResponse> {
  const block = await getColumn(blockId, { html: false });
  if (!block) return apiError("Not found.", 404);
  const channel = await getChannel(block.channel_id);
  const denial = await authorizeChannelRead(channel, userId);
  if (denial) return denial;
  try {
    return await createCommentWithNotices({
      column: block,
      channel: channel!,
      authorId: userId,
      body,
    });
  } catch (e) {
    // Empty or over-length is the caller's mistake, not a server fault.
    return apiError(e instanceof Error ? e.message : "Could not post that comment.", 400);
  }
}

// Delete a comment. The author may always remove their own; otherwise the
// block's channel owner may moderate it — the same two-way rule the web app
// applies. A comment the caller can neither author nor moderate is a 404 rather
// than a 403, so this never confirms one exists on a channel they cannot see.
export async function deleteCommentFor(
  commentId: number,
  userId: string,
): Promise<NextResponse | null> {
  const target = await getCommentAuthorization(commentId);
  if (!target) return apiError("Not found.", 404);

  if (target.author_id !== userId) {
    const block = await getColumn(target.column_id, { html: false });
    if (!block) return apiError("Not found.", 404);
    const denial = await authorizeChannelManage(await getChannel(block.channel_id), userId);
    if (denial) return denial;
  }
  await deleteComment(commentId);
  return null;
}

// Nest a channel inside another as a block (the Are.na-style link), the one
// block type create_block can't produce.
//
// Manage on the host, not merely contribute: nesting puts a permanent link to
// someone else's collection in this channel and notifies its owner, which is an
// owner's call rather than a contributor's — matching addChannelColumnAction.
//
// The linked channel must be non-private, and a private one is a 404 rather
// than a 403 for the same reason every read is: a distinguishable refusal would
// confirm it exists. A channel can't be nested in itself.
export async function nestChannel(
  linkedChannelId: number,
  hostChannelId: number,
  userId: string,
): Promise<Column | NextResponse> {
  const host = await getChannel(hostChannelId);
  const denial = await authorizeChannelManage(host, userId);
  if (denial) return denial;

  if (linkedChannelId === hostChannelId) {
    return apiError("A channel can't be added to itself.", 400);
  }

  const linked = await getChannel(linkedChannelId);
  if (!linked || linked.private) return apiError("Not found.", 404);

  try {
    await assertColumnQuota(userId);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Block limit reached.", 403);
  }

  const added = await addChannelColumn({
    created_by: userId,
    channel_id: hostChannelId,
    linked_channel_id: linkedChannelId,
  });
  await notifyChannelNested({
    host: host!,
    linkedOwnerId: linked.owned_by,
    columnId: added.id,
    userId,
  });
  return added;
}

// Copy a block into another channel, leaving the original where it is.
//
// Asymmetric on purpose, and looser than moveBlock: copying only *reads* the
// source, so any block in a channel you can see may be copied, while the target
// must be one you can contribute to. Moving needs manage on both because it
// takes the block away from the channel it was in.
//
// A copy is a new block, so it is charged to the caller's quota — the same
// charge contributing makes on the web side.
export async function copyBlock(
  blockId: number,
  destinationChannelId: number,
  userId: string,
): Promise<Column | NextResponse> {
  const source = await getColumn(blockId, { html: false });
  if (!source) return apiError("Not found.", 404);

  const readDenial = await authorizeChannelRead(await getChannel(source.channel_id), userId);
  if (readDenial) return readDenial;

  const destination = await getChannel(destinationChannelId);
  const writeDenial = await authorizeChannelContribute(destination, userId);
  if (writeDenial) return writeDenial;

  try {
    await assertColumnQuota(userId);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Block limit reached.", 403);
  }

  return copyColumnInto({
    source,
    channel_id: destinationChannelId,
    created_by: userId,
    targetPrivate: destination!.private,
  });
}

// Place a block after another one in its channel's manual order, or at the head
// when `afterId` is null. Returns the moved block, or a denial to hand back.
//
// Owner-only, which is stricter than every other block write here: a
// contributor may add a block to an open channel and edit or delete the one
// they added, but a reorder rearranges everyone's blocks at once. A channel's
// arrangement belongs to the channel, so it follows ownership rather than the
// contributor rule — the same call the board makes (reorderColumnAction).
//
// The anchor is a block id rather than an index because an index only means
// something on the board that produced it; see reorderColumn. It must live in
// the same channel, and reorderColumn returns null when it doesn't, which is a
// 404 here rather than a 400: from outside, a block in someone else's channel
// and a block that doesn't exist are the same thing.
export async function reorderBlock(
  blockId: number,
  afterId: number | null,
  userId: string,
): Promise<Column | NextResponse> {
  const block = await getColumn(blockId, { html: false });
  if (!block) return apiError("Not found.", 404);

  const denial = await authorizeChannelManage(await getChannel(block.channel_id), userId);
  if (denial) return denial;

  const moved = await reorderColumn(blockId, afterId);
  return moved ?? apiError("Not found.", 404);
}

// Leaving a channel someone else owns: the caller drops their own membership.
// Composed here beside the rest of the matrix, since both surfaces need the
// same three guards.
//
// An owner cannot leave. Ownership is `channel.owned_by`, not a membership row,
// so removeChannelMember would delete nothing and report success while the
// channel stayed exactly as it was — the caller has to delete the channel, or
// hand it on, and should be told so rather than silently no-op'd. The same
// holds for a group's admins, who manage its channels through the group.
//
// A channel the caller cannot read is a 404, so this never confirms that
// someone else's private channel exists.
export async function leaveChannel(
  channelId: number,
  userId: string,
): Promise<NextResponse | null> {
  const channel = await getChannel(channelId);
  const denial = await authorizeChannelRead(channel, userId);
  if (denial) return denial;

  if (canManageChannel(channel!, await viewerScope(userId))) {
    return apiError(
      "You manage this channel, so there is no membership to give up. Delete it or transfer it instead.",
      409,
    );
  }
  if (!(await isChannelMember(channelId, userId))) {
    return apiError("You are not a member of this channel.", 409);
  }

  await removeChannelMember(channelId, userId);
  return null;
}

// url blocks capture a preview asynchronously (see triggerScreenshotCapture in
// ./screenshot); these attach whatever's currently cached so API clients can
// poll a block until `preview` resolves instead of the API blocking on a
// multi-second Puppeteer run.
// - null            -> no row yet, still capturing (or never triggered) — keep polling.
// - { failed: true } -> capture ran and failed permanently — stop polling.
// - { image_url, title } -> captured successfully.
export type BlockWithPreview = ApiBlock & {
  preview: { image_url: string; title: string } | { failed: true } | null;
};

function toPreview(row: { image_url: string | null; title: string | null } | undefined) {
  if (!row) return null;
  if (row.image_url) return { image_url: row.image_url, title: row.title ?? "" };
  return { failed: true } as const;
}

// A block as the REST API and the MCP tools return it: the markdown source,
// never the rendered HTML. An API client asked for the source, and shipping the
// server's rendered copy alongside it roughly doubles a text block's payload for
// something no API client renders. The single choke point means no handler can
// leak it back in by spreading a Column into a response.
export type ApiBlock = Omit<Column, "html">;

export function toApiBlock(block: Column): ApiBlock {
  if (block.html === undefined) return block;
  const { html: _html, ...rest } = block;
  return rest;
}

export async function attachPreview(block: Column): Promise<BlockWithPreview> {
  const api = toApiBlock(block);
  if (block.type !== "url" || !block.url) return { ...api, preview: null };
  return { ...api, preview: toPreview((await getScreenshot(block.url)) ?? undefined) };
}

export async function attachPreviews(blocks: Column[]): Promise<BlockWithPreview[]> {
  const urls = blocks.filter((b) => b.type === "url" && b.url).map((b) => b.url!);
  const screenshots = await getScreenshotsForUrls(urls);
  return blocks.map((b) => ({
    ...toApiBlock(b),
    preview: b.type === "url" && b.url ? toPreview(screenshots.get(b.url)) : null,
  }));
}
