"use server";

// Server actions the client components call instead of hitting the database
// directly. Each one resolves the caller from their Better Auth session and
// enforces authorization in app code (the Drizzle connection behind these
// bypasses row-level security).

import { getSessionUser } from "@/lib/auth";
import {
  Channel,
  ChannelSearchResult,
  createChannel,
  deleteChannel,
  getChannel,
  searchChannels,
  updateChannel,
} from "./channel";
import {
  Column,
  ColumnQuery,
  ColumnSearchResult,
  addChannelColumn,
  deleteColumn,
  getChannelColumns,
  getColumn,
  moveColumn,
  searchColumns,
  updateColumnDescription,
  updateColumnMeta,
  updateColumnTags,
  updateColumnText,
  updateColumnTitle,
  uploadImageColumn,
  uploadTextColumn,
  uploadURLColumn,
} from "./column";
import { deleteMediaByUrl, MAX_IMAGE_BYTES, putImageBlob } from "./blob";
import { DESKTOP_UA } from "./og-meta";
import { createInviteCode, InviteCode, revokeInviteCode } from "./invite";
import { revokeApiToken } from "./api-token";
import { getScreenshotsForUrls, ColumnScreenshot } from "./screenshot-data";
import {
  createUserProfile,
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

// A block the caller may write to: it must exist and live in a channel they own.
async function requireOwnedBlock(columnId: number, userId: string): Promise<Column> {
  const column = await getColumn(columnId);
  if (!column) {
    throw new Error("Not found.");
  }
  await requireOwnedChannel(column.channel_id, userId);
  return column;
}

// A channel the caller may read: public channels are visible to anyone; private
// channels only to their owner.
async function requireReadableChannel(channelId: number): Promise<Channel> {
  const channel = await getChannel(channelId);
  if (!channel) {
    throw new Error("Not found.");
  }
  if (channel.private && channel.owner_id !== (await currentUserId())) {
    throw new Error("Not found.");
  }
  return channel;
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

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
export async function createChannelAction(input: {
  title: string;
  description?: string;
  private: boolean;
}): Promise<Channel> {
  const userId = await requireUserId();
  return createChannel({ ...input, owner_id: userId });
}

export async function updateChannelAction(
  channelId: number,
  updates: { title: string; description?: string; private: boolean; tags?: string[] },
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
// Blocks
// ---------------------------------------------------------------------------
export async function getChannelColumnsAction(
  channelId: number,
  query: ColumnQuery = {},
): Promise<Column[]> {
  await requireReadableChannel(channelId);
  return getChannelColumns(channelId, query);
}

export async function uploadURLColumnAction(input: {
  channelId: number;
  text: string;
}): Promise<Column> {
  const userId = await requireUserId();
  await requireOwnedChannel(input.channelId, userId);
  return uploadURLColumn({ created_by: userId, channel_id: input.channelId, text: input.text });
}

export async function uploadTextColumnAction(input: {
  channelId: number;
  text: string;
}): Promise<Column> {
  const userId = await requireUserId();
  await requireOwnedChannel(input.channelId, userId);
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
  const channel = await requireOwnedChannel(channelId, userId);
  // The media reference inherits the channel's privacy; updateChannel keeps it
  // in sync if the channel flips later.
  const image = await putImageBlob(file, userId, channel.private ? "private" : "public");
  return uploadImageColumn({ created_by: userId, channel_id: channelId, image });
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
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("Bad image URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported image URL.");
  }
  const channel = await requireOwnedChannel(channelId, userId);

  // Same posture as the screenshot capture, which already fetches arbitrary
  // user-supplied URLs. ponytail: no SSRF allowlist here to match that existing
  // behavior — tighten both together if the threat model ever changes.
  const res = await fetch(url, { headers: { "User-Agent": DESKTOP_UA, Accept: "image/*" } });
  if (!res.ok) {
    throw new Error("Couldn't fetch that image.");
  }
  if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    throw new Error("That image is too large (max 10MB).");
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const file = new File([await res.arrayBuffer()], "pasted-image", { type });
  // putImageBlob re-validates the type and size against ALLOWED_IMAGE_TYPES/MAX.
  const image = await putImageBlob(file, userId, channel.private ? "private" : "public");
  return uploadImageColumn({ created_by: userId, channel_id: channelId, image });
}

export async function updateColumnMetaAction(
  columnId: number,
  fields: { title?: string; description?: string },
): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedBlock(columnId, userId);
  await updateColumnMeta(columnId, fields);
}

export async function updateColumnTitleAction(columnId: number, title: string): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedBlock(columnId, userId);
  await updateColumnTitle(columnId, title);
}

export async function updateColumnDescriptionAction(
  columnId: number,
  description: string,
): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedBlock(columnId, userId);
  await updateColumnDescription(columnId, description);
}

export async function updateColumnTextAction(columnId: number, text: string): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedBlock(columnId, userId);
  await updateColumnText(columnId, text);
}

export async function updateColumnTagsAction(columnId: number, tags: string[]): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedBlock(columnId, userId);
  await updateColumnTags(columnId, tags);
}

export async function deleteColumnAction(columnId: number): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedBlock(columnId, userId);
  await deleteColumn(columnId);
}

// Move a block to another channel. The caller must own both the block's current
// channel and the target — this connection bypasses RLS, so both checks live
// here. requireOwnedBlock already authorizes the current side.
export async function moveColumnAction(columnId: number, targetChannelId: number): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedBlock(columnId, userId);
  await requireOwnedChannel(targetChannelId, userId);
  await moveColumn(columnId, targetChannelId);
}

// Add a channel as a column inside one of the caller's channels (Are.na-style).
// The caller must own the host; the linked channel must exist and be public
// (you can't nest a private channel, so nothing private ever leaks through the
// link). A channel can't be added to itself.
export async function addChannelColumnAction(
  linkedChannelId: number,
  hostChannelId: number,
): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedChannel(hostChannelId, userId);
  const linked = await getChannel(linkedChannelId);
  if (!linked || linked.private) {
    throw new Error("Not found.");
  }
  if (linkedChannelId === hostChannelId) {
    throw new Error("A channel can't be added to itself.");
  }
  await addChannelColumn({
    created_by: userId,
    channel_id: hostChannelId,
    linked_channel_id: linkedChannelId,
  });
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
export async function createInviteCodeAction(input?: {
  max_uses?: number;
  note?: string | null;
}): Promise<InviteCode> {
  const userId = await requireUserId();
  return createInviteCode({
    created_by: userId,
    max_uses: input?.max_uses ?? 1,
    note: input?.note ?? null,
  });
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
