import "server-only";

import { deleteMediaByUrl } from "./blob";
import { getOwnerByHandle } from "./owner";
import { normalizeHandle, updateUserProfile, validateHandle, type UserProfile } from "./user";

// Editing your own profile, in the two places that do it: the settings form and
// the API.
//
// Its own module because the avatar swap needs ./blob, and user.ts is imported
// by most of the app — widening that module's graph with sharp and object
// storage to serve one write isn't worth it.

// Whether a handle is free to claim.
//
// Checked against `owner`, not against user profiles: `owner.handle` is unique
// across people *and* groups, which share one namespace. Asking only about
// users reports a group's handle as available and then fails at the write with
// HandleTakenError — the form says yes and the save says no.
//
// Returns null when the handle isn't valid to begin with: there is nothing to
// look up, and the caller already knows why.
export async function isHandleAvailable(rawHandle: string): Promise<boolean | null> {
  const handle = normalizeHandle(rawHandle);
  if (validateHandle(handle)) return null;
  return (await getOwnerByHandle(handle)) === null;
}

// Apply a profile edit, and clean up a replaced avatar.
//
// The old media row is deleted only after the new one is stored, and only when
// the URL actually changed — without it every avatar change leaks a blob, and
// deleting first would lose the old picture if the write then failed.
export async function updateProfile(
  userId: string,
  previous: UserProfile,
  updates: { handle?: string; about?: string; avatar_url?: string },
): Promise<UserProfile> {
  const updated = await updateUserProfile(userId, updates);
  if (
    updates.avatar_url !== undefined &&
    previous.avatar_url &&
    previous.avatar_url !== updated.avatar_url
  ) {
    await deleteMediaByUrl(previous.avatar_url);
  }
  return updated;
}
