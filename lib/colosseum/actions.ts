"use server";

// Server actions the client components call instead of hitting the database
// directly. Each one resolves the caller from their Better Auth session and
// enforces authorization in app code (the Drizzle connection behind these
// bypasses row-level security).

import { getSessionUser } from "@/lib/auth";
import {
  Channel,
  ChannelAccess,
  ChannelSearchResult,
  canContributeChannel,
  canReadChannel,
  channelReaders,
  createChannel,
  deleteChannel,
  getChannel,
  searchChannels,
  updateChannel,
} from "./channel";
import {
  ChannelMember,
  addChannelMemberByHandle,
  isChannelMember,
  removeChannelMember,
} from "./member";
import {
  Column,
  ColumnQuery,
  ColumnSearchResult,
  addChannelColumn,
  deleteColumn,
  getChannelColumns,
  getColumn,
  moveColumn,
  copyColumn,
  searchColumns,
  updateColumnDescription,
  updateColumnMeta,
  updateColumnTags,
  updateColumnText,
  updateColumnTitle,
  uploadImageColumn,
  uploadPdfColumn,
  uploadVideoColumn,
  uploadTextColumn,
  uploadTweetColumn,
  uploadYouTubeColumn,
  uploadSpotifyColumn,
  uploadURLColumn,
} from "./column";
import { ingestTweet } from "./tweet";
import { renderEmail, sendEmail } from "@/lib/email";
import { logError } from "@/lib/log";
import { tweetIdFromUrl } from "@/lib/utils";
import {
  Comment,
  createComment,
  deleteComment,
  getColumnComments,
  getCommentAuthorization,
  MAX_COMMENT_LENGTH,
} from "./comment";
import {
  createMedia,
  deleteMediaByUrl,
  getMedia,
  mediaIdFromUrl,
  putImageBlob,
  putImageBlobFromUrl,
  putPdfBlob,
  putVideoBlob,
} from "./blob";
import { createInviteCode, InviteCode, revokeInviteCode } from "./invite";
import {
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  NotificationItem,
  NotificationType,
} from "./notification";
import { parseMentions } from "./mentions";
import type { EmailNotificationPrefs } from "@/lib/db/schema";
import {
  AdminUser,
  AppSettings,
  Quota,
  assertColumnQuota,
  assertInviteQuota,
  getAdminHandles,
  getAppSettings,
  getColumnQuota,
  listUsers,
  requireAdmin,
  setUserAdmin,
  setUserBanned,
  setUserLimits,
  updateAppSettings,
} from "./admin";
import { revokeApiToken } from "./api-token";
import { getScreenshotsForUrls, ColumnScreenshot } from "./screenshot-data";
import {
  createUserProfile,
  getPublicUserProfile,
  getUserProfile,
  HandleTakenError,
  normalizeHandle,
  ProfileSearchResult,
  searchProfiles,
  updateUserProfile,
  UserProfile,
  validateHandle,
} from "./user";

// The caller's user id, or null when there's no session. Reads the id from the
// verified Better Auth session cookie, never from client-supplied input.
async function currentUserId(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.id ?? null;
}

async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) {
    throw new Error("Not authenticated.");
  }
  return userId;
}

// A channel the caller may write to: it must exist and be owned by them.
// Throws "Not found." otherwise so a private channel's existence never leaks.
async function requireOwnedChannel(channelId: number, userId: string): Promise<Channel> {
  const channel = await getChannel(channelId);
  if (!channel || channel.owner_id !== userId) {
    throw new Error("Not found.");
  }
  return channel;
}

// A channel the caller may add blocks to, per the access matrix (open → any
// signed-in user, public/private → owner or member). A channel they can't even
// read 404s (don't leak); a readable one they can't add to is a 403-ish.
async function requireContributableChannel(channelId: number, userId: string): Promise<Channel> {
  const channel = await getChannel(channelId);
  if (!channel) {
    throw new Error("Not found.");
  }
  const isMember = channel.access === "open" ? false : await isChannelMember(channelId, userId);
  if (!canReadChannel(channel, userId, isMember)) {
    throw new Error("Not found.");
  }
  if (!canContributeChannel(channel, userId, isMember)) {
    throw new Error("You do not have permission to add to this channel.");
  }
  // Every content upload routes through here, so the per-user block quota is
  // enforced once at this choke point (addChannelColumnAction guards separately,
  // as it owns rather than contributes).
  await assertColumnQuota(userId);
  return channel;
}

// A block the caller may edit/delete: it must exist, live in a channel they can
// read, and be either the channel's owner or the block's own creator (so open /
// group contributors can manage what they added).
async function requireWritableBlock(columnId: number, userId: string): Promise<Column> {
  const column = await getColumn(columnId);
  if (!column) {
    throw new Error("Not found.");
  }
  const channel = await requireReadableChannel(column.channel_id);
  if (channel.owner_id !== userId && column.created_by !== userId) {
    throw new Error("You do not have permission to modify this block.");
  }
  return column;
}

// A channel the caller may read: public/open channels are visible to anyone;
// private channels only to their owner or a member.
async function requireReadableChannel(channelId: number): Promise<Channel> {
  const channel = await getChannel(channelId);
  if (!channel) {
    throw new Error("Not found.");
  }
  const userId = await currentUserId();
  const isMember =
    channel.access === "private" && userId ? await isChannelMember(channelId, userId) : false;
  if (!canReadChannel(channel, userId, isMember)) {
    throw new Error("Not found.");
  }
  return channel;
}

// A block the caller may read: it must exist and live in a channel they may
// read (public, or their own private one). Returns the block and its channel.
async function requireReadableBlock(
  columnId: number,
): Promise<{ column: Column; channel: Channel }> {
  const column = await getColumn(columnId);
  if (!column) {
    throw new Error("Not found.");
  }
  const channel = await requireReadableChannel(column.channel_id);
  return { column, channel };
}

// ---------------------------------------------------------------------------
// Search (nav box) — scoped to the caller's own channels and blocks.
// ---------------------------------------------------------------------------
export async function searchAction(query: string): Promise<{
  profiles: ProfileSearchResult[];
  channels: ChannelSearchResult[];
  columns: ColumnSearchResult[];
}> {
  const userId = await currentUserId();
  if (!userId) {
    return { profiles: [], channels: [], columns: [] };
  }
  const [profiles, channels, columns] = await Promise.all([
    searchProfiles(query),
    searchChannels(userId, query),
    searchColumns(userId, query),
  ]);
  return { profiles, channels, columns };
}

// Profile-only search for the comment @-mention autocomplete. Profiles are
// public, so this only gates on being signed in (mentions are authored, never
// read-only). Returns [] for an empty query.
export async function searchProfilesAction(query: string): Promise<ProfileSearchResult[]> {
  await requireUserId();
  return searchProfiles(query);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
export async function createChannelAction(input: {
  title: string;
  description?: string;
  access: ChannelAccess;
}): Promise<Channel> {
  const userId = await requireUserId();
  return createChannel({ ...input, owner_id: userId });
}

export async function updateChannelAction(
  channelId: number,
  updates: { title: string; description?: string; access: ChannelAccess; tags?: string[] },
): Promise<Channel> {
  const userId = await requireUserId();
  await requireOwnedChannel(channelId, userId);
  return updateChannel(channelId, updates);
}

export async function deleteChannelAction(channelId: number): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedChannel(channelId, userId);
  await deleteChannel(channelId);
}

// ---------------------------------------------------------------------------
// Channel members (public/private channels) — the owner manages the roster.
// Listing is done server-side on the channel page (readable to any viewer of the
// channel), so there's no list action here — only the owner-gated mutations.
// ---------------------------------------------------------------------------
export async function addChannelMemberAction(
  channelId: number,
  handle: string,
): Promise<ChannelMember> {
  const userId = await requireUserId();
  const channel = await requireOwnedChannel(channelId, userId);
  const normalized = normalizeHandle(handle);
  if (!normalized) {
    throw new Error("Enter a handle.");
  }
  const profile = await getPublicUserProfile(normalized);
  if (!profile) {
    throw new Error("No user with that handle.");
  }
  if (profile.user_id === channel.owner_id) {
    throw new Error("You're already the owner of this channel.");
  }
  // Only notify on a genuine add — re-adding an existing member is a no-op.
  const alreadyMember = await isChannelMember(channelId, profile.user_id);
  const member = await addChannelMemberByHandle(channelId, normalized);
  if (!alreadyMember) {
    await createNotification({
      recipient_id: profile.user_id,
      actor_id: userId,
      type: "member",
      channel_id: channelId,
    });
  }
  return member;
}

export async function removeChannelMemberAction(
  channelId: number,
  memberUserId: string,
): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedChannel(channelId, userId);
  await removeChannelMember(channelId, memberUserId);
}

// Leave a channel you're a member of — a self-service remove, so it needs no
// ownership check (you're only ever removing your own membership row). A no-op
// if you weren't a member.
export async function leaveChannelAction(channelId: number): Promise<void> {
  const userId = await requireUserId();
  await removeChannelMember(channelId, userId);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
export async function getChannelColumnsAction(
  channelId: number,
  query: ColumnQuery = {},
): Promise<Column[]> {
  await requireReadableChannel(channelId);
  return getChannelColumns(channelId, query, await currentUserId());
}

export async function uploadURLColumnAction(input: {
  channelId: number;
  text: string;
}): Promise<Column> {
  const userId = await requireUserId();
  await requireContributableChannel(input.channelId, userId);
  return uploadURLColumn({ created_by: userId, channel_id: input.channelId, text: input.text });
}

// Add a tweet block. Captures the tweet's snapshot (data + self-hosted media)
// before the block exists so it's already deletion-proof by the time it renders.
// If the tweet can't be fetched (deleted, never existed, endpoint down), fall
// back to a plain URL block so the user still gets a screenshot-backed link.
export async function uploadTweetColumnAction(input: {
  channelId: number;
  url: string;
}): Promise<Column> {
  const userId = await requireUserId();
  await requireContributableChannel(input.channelId, userId);
  const id = tweetIdFromUrl(input.url);
  if (id && (await ingestTweet(id, userId))) {
    // Store a canonical id-based permalink, not the pasted URL: the snapshot is
    // shared per tweet id, so every block for the same tweet must carry the same
    // url string for the shared-snapshot GC (deleteTweetIfUnreferenced) to see
    // its siblings. x.com/i/status/<id> redirects to the real tweet.
    const url = `https://x.com/i/status/${id}`;
    return uploadTweetColumn({ created_by: userId, channel_id: input.channelId, url });
  }
  return uploadURLColumn({ created_by: userId, channel_id: input.channelId, text: input.url });
}

// The video's title via YouTube's public oEmbed endpoint (no API key, returns
// only metadata — not the video itself, so it stays within "don't persist the
// video"). Best-effort: null if the lookup fails, and the block is created
// untitled rather than failing the add.
async function youtubeTitle(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { title?: string };
    return data.title || undefined;
  } catch (e) {
    logError("youtube.oembed", `title lookup failed for ${url}`, e);
    return undefined;
  }
}

// Add a YouTube block. Stores the URL and the video's title; the embed renders
// live from YouTube, nothing else is captured (persisting the video would be
// too costly).
export async function uploadYouTubeColumnAction(input: {
  channelId: number;
  url: string;
}): Promise<Column> {
  const userId = await requireUserId();
  await requireContributableChannel(input.channelId, userId);
  const title = await youtubeTitle(input.url);
  return uploadYouTubeColumn({
    created_by: userId,
    channel_id: input.channelId,
    url: input.url,
    title,
  });
}

// Title + cover-art URL via Spotify's public oEmbed endpoint (no API key,
// metadata only). Best-effort: empty on failure so the block is still created.
async function spotifyMeta(url: string): Promise<{ title?: string; image?: string }> {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return {};
    const data = (await res.json()) as { title?: string; thumbnail_url?: string };
    return { title: data.title || undefined, image: data.thumbnail_url || undefined };
  } catch (e) {
    logError("spotify.oembed", `metadata lookup failed for ${url}`, e);
    return {};
  }
}

// Add a Spotify block. Stores the URL plus the item's title and cover art; the
// player renders live from Spotify's iframe, nothing else is captured.
export async function uploadSpotifyColumnAction(input: {
  channelId: number;
  url: string;
}): Promise<Column> {
  const userId = await requireUserId();
  await requireContributableChannel(input.channelId, userId);
  const { title, image } = await spotifyMeta(input.url);
  return uploadSpotifyColumn({
    created_by: userId,
    channel_id: input.channelId,
    url: input.url,
    title,
    image,
  });
}

export async function uploadTextColumnAction(input: {
  channelId: number;
  text: string;
}): Promise<Column> {
  const userId = await requireUserId();
  await requireContributableChannel(input.channelId, userId);
  return uploadTextColumn({ created_by: userId, channel_id: input.channelId, text: input.text });
}

// Takes FormData (channelId + file) because the image bytes are stored
// server-side on local disk — the browser can't write to storage directly.
export async function uploadImageColumnAction(formData: FormData): Promise<Column> {
  const userId = await requireUserId();
  const channelId = Number(formData.get("channelId"));
  const file = formData.get("file");
  if (!Number.isInteger(channelId) || !(file instanceof File)) {
    throw new Error("Bad request.");
  }
  const channel = await requireContributableChannel(channelId, userId);
  // The media reference inherits the channel's privacy; updateChannel keeps it
  // in sync if the channel flips later.
  const image = await putImageBlob(file, userId, channel.private ? "private" : "public");
  return uploadImageColumn({ created_by: userId, channel_id: channelId, image });
}

// Same shape as the image upload, for a dropped/picked PDF. The stored media
// inherits the channel's privacy.
export async function uploadPdfColumnAction(formData: FormData): Promise<Column> {
  const userId = await requireUserId();
  const channelId = Number(formData.get("channelId"));
  const file = formData.get("file");
  if (!Number.isInteger(channelId) || !(file instanceof File)) {
    throw new Error("Bad request.");
  }
  const channel = await requireContributableChannel(channelId, userId);
  const image = await putPdfBlob(file, userId, channel.private ? "private" : "public");
  return uploadPdfColumn({ created_by: userId, channel_id: channelId, image });
}

// Same shape as the image/PDF upload, for a dropped/picked video. The stored
// media inherits the channel's privacy.
export async function uploadVideoColumnAction(formData: FormData): Promise<Column> {
  const userId = await requireUserId();
  const channelId = Number(formData.get("channelId"));
  const file = formData.get("file");
  if (!Number.isInteger(channelId) || !(file instanceof File)) {
    throw new Error("Bad request.");
  }
  const channel = await requireContributableChannel(channelId, userId);
  const image = await putVideoBlob(file, userId, channel.private ? "private" : "public");
  return uploadVideoColumn({ created_by: userId, channel_id: channelId, image });
}

// Create an image column from a remote image URL. Used by the paste flow: a
// browser "copy image" puts a flattened PNG snapshot in the clipboard (losing
// GIF animation), while the original image lives at the <img> src — fetching
// that keeps the real bytes. Fetches server-side because CORS blocks reading
// cross-origin image bytes on the client.
export async function uploadImageColumnFromUrlAction(
  channelId: number,
  imageUrl: string,
): Promise<Column> {
  const userId = await requireUserId();
  if (!Number.isInteger(channelId)) {
    throw new Error("Bad request.");
  }
  const channel = await requireContributableChannel(channelId, userId);
  const image = await putImageBlobFromUrl(imageUrl, userId, channel.private ? "private" : "public");
  return uploadImageColumn({ created_by: userId, channel_id: channelId, image });
}

export async function updateColumnMetaAction(
  columnId: number,
  fields: { title?: string; description?: string },
): Promise<void> {
  const userId = await requireUserId();
  await requireWritableBlock(columnId, userId);
  await updateColumnMeta(columnId, fields);
}

export async function updateColumnTitleAction(columnId: number, title: string): Promise<void> {
  const userId = await requireUserId();
  await requireWritableBlock(columnId, userId);
  await updateColumnTitle(columnId, title);
}

export async function updateColumnDescriptionAction(
  columnId: number,
  description: string,
): Promise<void> {
  const userId = await requireUserId();
  await requireWritableBlock(columnId, userId);
  await updateColumnDescription(columnId, description);
}

export async function updateColumnTextAction(columnId: number, text: string): Promise<void> {
  const userId = await requireUserId();
  await requireWritableBlock(columnId, userId);
  await updateColumnText(columnId, text);
}

export async function updateColumnTagsAction(columnId: number, tags: string[]): Promise<void> {
  const userId = await requireUserId();
  await requireWritableBlock(columnId, userId);
  await updateColumnTags(columnId, tags);
}

export async function deleteColumnAction(columnId: number): Promise<void> {
  const userId = await requireUserId();
  await requireWritableBlock(columnId, userId);
  await deleteColumn(columnId);
}

// Move a block to another channel. The caller must be able to write the block
// (its channel's owner or the block's creator) and must own the target — this
// connection bypasses RLS, so both checks live here. requireWritableBlock
// authorizes the current side.
export async function moveColumnAction(columnId: number, targetChannelId: number): Promise<void> {
  const userId = await requireUserId();
  await requireWritableBlock(columnId, userId);
  await requireOwnedChannel(targetChannelId, userId);
  await moveColumn(columnId, targetChannelId);
}

// Copy a block into another channel, leaving the original in place. The caller
// only needs to *read* the source (so you can copy anyone's block from a channel
// visible to you), and must be able to contribute to the target (which also
// enforces the per-user block quota — a copy is a new block). For media blocks,
// mint a fresh media reference to the same bytes so the copy owns its own media
// row: deleting either column later won't dangle the other's image. The new
// reference inherits the target channel's privacy.
export async function copyColumnAction(columnId: number, targetChannelId: number): Promise<Column> {
  const userId = await requireUserId();
  const { column: source } = await requireReadableBlock(columnId);
  const channel = await requireContributableChannel(targetChannelId, userId);

  let image = source.image ?? null;
  const mediaId = image ? mediaIdFromUrl(image) : null;
  if (mediaId) {
    const media = await getMedia(mediaId);
    if (media) {
      image = await createMedia(media.sha256, userId, channel.private ? "private" : "public");
    }
  }

  return copyColumn({ source, channel_id: targetChannelId, created_by: userId, image });
}

// Add a channel as a column inside one of the caller's channels (Are.na-style).
// The caller must own the host; the linked channel must exist and be non-private
// (public or open — you can't nest a private channel, so nothing private ever
// leaks through the link). A channel can't be added to itself.
export async function addChannelColumnAction(
  linkedChannelId: number,
  hostChannelId: number,
): Promise<void> {
  const userId = await requireUserId();
  const host = await requireOwnedChannel(hostChannelId, userId);
  await assertColumnQuota(userId);
  const linked = await getChannel(linkedChannelId);
  if (!linked || linked.private) {
    throw new Error("Not found.");
  }
  if (linkedChannelId === hostChannelId) {
    throw new Error("A channel can't be added to itself.");
  }
  const added = await addChannelColumn({
    created_by: userId,
    channel_id: hostChannelId,
    linked_channel_id: linkedChannelId,
  });
  // Tell the linked channel's owner someone nested their channel. The
  // notification records the *host* — that's where their channel now sits, so
  // that's where the link should land — plus the column that was created, which
  // is what names the linked channel in the message.
  //
  // Nothing is sent when the host is private: what someone collects into a
  // private channel is their own business, and the recipient couldn't open it
  // to see anyway. Privacy runs both ways here.
  if (!host.private) {
    await createNotification({
      recipient_id: linked.owner_id,
      actor_id: userId,
      type: "connect",
      channel_id: hostChannelId,
      column_id: added.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Comments — anyone who can read the block can post; the comment's author or
// the block's channel owner can delete.
// ---------------------------------------------------------------------------
export async function getColumnCommentsAction(columnId: number): Promise<Comment[]> {
  await requireReadableBlock(columnId);
  return getColumnComments(columnId);
}

export async function createCommentAction(columnId: number, body: string): Promise<Comment> {
  const userId = await requireUserId();
  const { column, channel } = await requireReadableBlock(columnId);
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("Comment can't be empty.");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment is too long (max ${MAX_COMMENT_LENGTH} characters).`);
  }
  const created = await createComment({ column_id: columnId, author_id: userId, body: trimmed });

  // Notify the block's author, then anyone @mentioned (resolved to a real user,
  // deduped, and excluding the author who already gets the comment notification).
  //
  // Both are filtered to users who can read the channel. The notification names
  // the block and its channel and quotes the comment, and a mention resolves any
  // handle whether or not they're a member — so without this, mentioning a
  // stranger from a private channel hands them its contents. A block's author
  // can lose access too, when an open channel is later made private. Same rule
  // connect applies to a private host: private runs in both directions.
  const handles = [
    ...new Set(parseMentions(trimmed).flatMap((s) => (s.type === "mention" ? [s.handle] : []))),
  ];
  const mentioned = (await Promise.all(handles.map((h) => getPublicUserProfile(h)))).filter(
    (p): p is NonNullable<typeof p> => p !== null && p.user_id !== column.created_by,
  );
  const readers = new Set(
    await channelReaders(channel, [column.created_by, ...mentioned.map((p) => p.user_id)]),
  );

  if (readers.has(column.created_by)) {
    await createNotification({
      recipient_id: column.created_by,
      actor_id: userId,
      type: "comment",
      channel_id: column.channel_id,
      column_id: columnId,
      comment_id: created.id,
    });
  }
  await Promise.all(
    mentioned
      .filter((p) => readers.has(p.user_id))
      .map((p) =>
        createNotification({
          recipient_id: p.user_id,
          actor_id: userId,
          type: "mention",
          channel_id: column.channel_id,
          column_id: columnId,
          comment_id: created.id,
        }),
      ),
  );
  return created;
}

export async function deleteCommentAction(commentId: number): Promise<void> {
  const userId = await requireUserId();
  const target = await getCommentAuthorization(commentId);
  if (!target) {
    throw new Error("Not found.");
  }
  // The author may always remove their own comment; otherwise the block's
  // channel owner may moderate it.
  if (target.author_id !== userId) {
    const column = await getColumn(target.column_id);
    if (!column) {
      throw new Error("Not found.");
    }
    await requireOwnedChannel(column.channel_id, userId);
  }
  await deleteComment(commentId);
}

// ---------------------------------------------------------------------------
// Screenshots — a public per-URL cache; safe to read for any URL.
// Returned as entries (a Map isn't needed on the wire); callers rebuild a Map.
// ---------------------------------------------------------------------------
export async function getScreenshotsForUrlsAction(
  urls: string[],
): Promise<[string, ColumnScreenshot][]> {
  const map = await getScreenshotsForUrls(urls);
  return [...map.entries()];
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------
// Discriminated result so the invite reason (limit hit, disabled) rides back as
// data — thrown server-action errors are sanitized in production.
export type InviteCreateResult = { ok: true; invite: InviteCode } | { ok: false; message: string };

export async function createInviteCodeAction(input?: {
  max_uses?: number;
  note?: string | null;
}): Promise<InviteCreateResult> {
  const userId = await requireUserId();
  const max_uses = input?.max_uses ?? 1;
  try {
    await assertInviteQuota(userId, max_uses);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "You can't create more invites.",
    };
  }
  const invite = await createInviteCode({
    created_by: userId,
    max_uses,
    note: input?.note ?? null,
  });
  return { ok: true, invite };
}

// The caller's current column quota plus the admin handles to ask — used by the
// add-block flows to explain a limit rejection in the UI (the server still
// enforces it authoritatively).
export async function getColumnQuotaAction(): Promise<Quota & { admins: string[] }> {
  const userId = await requireUserId();
  const [quota, admins] = await Promise.all([getColumnQuota(userId), getAdminHandles()]);
  return { ...quota, admins };
}

export async function revokeInviteCodeAction(code: string): Promise<void> {
  const userId = await requireUserId();
  await revokeInviteCode(code, userId);
}

// ---------------------------------------------------------------------------
// API tokens (creation stays in app/api/tokens; only revoke needs an action)
// ---------------------------------------------------------------------------
export async function revokeApiTokenAction(id: string): Promise<void> {
  const userId = await requireUserId();
  await revokeApiToken(id, userId);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

// Result shape for the profile forms, which show specific messages for an
// invalid or already-taken handle. Thrown server-action errors are sanitized in
// production, so user-facing outcomes ride back as data instead.
export type ProfileResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; handleTaken?: boolean; message: string };

export async function getMyProfileAction(): Promise<UserProfile | null> {
  const userId = await currentUserId();
  if (!userId) {
    return null;
  }
  return getUserProfile(userId);
}

export async function createUserProfileAction(rawHandle: string): Promise<ProfileResult> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: "Not authenticated." };
  }
  const handle = normalizeHandle(rawHandle);
  const validationError = validateHandle(handle);
  if (validationError) {
    return { ok: false, message: validationError };
  }
  try {
    const profile = await createUserProfile(userId, handle);
    return { ok: true, profile };
  } catch (e) {
    if (e instanceof HandleTakenError) {
      return { ok: false, handleTaken: true, message: "That handle is already taken." };
    }
    throw e;
  }
}

// Store a new avatar image and return its URL; the caller saves it on the
// profile via updateUserProfileAction. Content-addressed, so a changed avatar
// gets a new URL — no CDN cache-busting query needed.
export async function uploadAvatarAction(formData: FormData): Promise<{ url: string }> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("Bad request.");
  }
  // Avatars show on public profile pages, so they're always public media.
  return { url: await putImageBlob(file, userId, "public") };
}

export async function updateUserProfileAction(updates: {
  handle?: string;
  about?: string;
  avatar_url?: string;
}): Promise<ProfileResult> {
  const userId = await requireUserId();
  if (updates.handle !== undefined) {
    const validationError = validateHandle(updates.handle);
    if (validationError) {
      return { ok: false, message: validationError };
    }
  }
  // A new avatar orphans the old one's media reference; capture it so it can
  // be dropped (and its blob GC'd) after the update lands.
  const previous = updates.avatar_url !== undefined ? await getUserProfile(userId) : null;
  try {
    const profile = await updateUserProfile(userId, updates);
    if (previous?.avatar_url && previous.avatar_url !== updates.avatar_url) {
      await deleteMediaByUrl(previous.avatar_url);
    }
    return { ok: true, profile };
  } catch (e) {
    if (e instanceof HandleTakenError) {
      return { ok: false, handleTaken: true, message: "That handle is already taken." };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Notifications — the bell, the /notifications page, and the email toggle.
// ---------------------------------------------------------------------------
export async function listNotificationsAction(before?: string): Promise<NotificationItem[]> {
  const userId = await requireUserId();
  return listNotifications(userId, before);
}

export async function markNotificationsReadAction(): Promise<void> {
  const userId = await requireUserId();
  await markAllNotificationsRead(userId);
}

// Flip one notification type's email toggle. Reads the current prefs, changes
// the one key, and returns the full persisted map so the UI can settle.
export async function setEmailNotificationPrefAction(
  type: NotificationType,
  enabled: boolean,
): Promise<EmailNotificationPrefs> {
  const userId = await requireUserId();
  const current = await getUserProfile(userId);
  if (!current) {
    throw new Error("Profile not found.");
  }
  const profile = await updateUserProfile(userId, {
    email_notifications: { ...current.email_notifications, [type]: enabled },
  });
  return profile.email_notifications;
}

// ---------------------------------------------------------------------------
// Admin — instance moderation and limits. Every action gates on requireAdmin
// (which also rejects banned users, since getSessionUser nulls them).
// ---------------------------------------------------------------------------

// Delete any block in a public/open channel. Private channels stay owner-only —
// admins don't reach into members-only spaces.
export async function adminDeleteColumnAction(columnId: number): Promise<void> {
  await requireAdmin();
  const col = await getColumn(columnId);
  if (!col) throw new Error("Not found.");
  const channel = await getChannel(col.channel_id);
  if (!channel || channel.private) throw new Error("Not found.");
  await deleteColumn(columnId);
}

// Delete any public/open channel outright.
export async function adminDeleteChannelAction(channelId: number): Promise<void> {
  await requireAdmin();
  const channel = await getChannel(channelId);
  if (!channel || channel.private) throw new Error("Not found.");
  await deleteChannel(channelId);
}

export async function listUsersAction(): Promise<AdminUser[]> {
  await requireAdmin();
  return listUsers();
}

export async function getAppSettingsAction(): Promise<AppSettings> {
  await requireAdmin();
  return getAppSettings();
}

export async function updateAppSettingsAction(settings: AppSettings): Promise<void> {
  await requireAdmin();
  await updateAppSettings(settings);
}

// Sends a test email to the admin clicking the button, using the saved config,
// so they can confirm the provider works. Returns the address it went to.
// Throws (surfaced in the UI) if email is off or the provider rejects it.
export async function sendTestEmailAction(): Promise<string> {
  const admin = await requireAdmin();
  const { email } = await getAppSettings();
  if (email.provider === null) {
    throw new Error("Email is off — choose a provider and save before sending a test.");
  }
  const { html, text } = renderEmail({
    heading: "Test email",
    body: "This is a test email from your Colosseum instance. If you're reading it, outbound email is working.",
    footnote: "Sent from your admin settings.",
  });
  await sendEmail({ to: admin.email, subject: "Colosseum test email", text, html });
  return admin.email;
}

export async function setUserBannedAction(userId: string, banned: boolean): Promise<void> {
  await requireAdmin();
  await setUserBanned(userId, banned);
}

export async function setUserAdminAction(userId: string, isAdmin: boolean): Promise<void> {
  await requireAdmin();
  await setUserAdmin(userId, isAdmin);
}

export async function setUserLimitsAction(
  userId: string,
  limits: { invite_limit: number | null; column_limit: number | null },
): Promise<void> {
  await requireAdmin();
  await setUserLimits(userId, limits);
}
