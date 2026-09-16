import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { getColumnQuota } from "@/lib/colosseum/admin";
import { putImageBlobFromUrl } from "@/lib/colosseum/blob";
import { updateProfile } from "@/lib/colosseum/profile";
import {
  HandleTakenError,
  getUserProfile,
  normalizeHandle,
  validateHandle,
} from "@/lib/colosseum/user";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/me — who the token belongs to. Everything else in the API is
// addressed by channel id or by a group handle from /api/v1/groups, so a client
// could name every group it belongs to and not its own account.
//
// Identity only: the handle its links live under, and what a profile shows.
// Not the user id or owner id, which no endpoint takes and which are easy to
// confuse with each other.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const [profile, blocks] = await Promise.all([
      getUserProfile(auth.userId),
      getColumnQuota(auth.userId),
    ]);
    // A token can only be minted from a settings page onboarding gates, so an
    // account with no profile row is a broken state rather than a normal one.
    if (!profile) return apiError("This account has not finished onboarding.", 404);

    return json({
      me: {
        handle: profile.handle,
        about: profile.about,
        avatar_url: profile.avatar_url,
        created_at: profile.created_at,
        // What `create_block` will refuse on, before it refuses. `limit: null`
        // is unlimited (admins, and instances that set no cap).
        blocks: { used: blocks.used, limit: blocks.limit },
      },
    });
  } catch (e) {
    logError("me.GET", `failed to load profile for user ${auth.userId}`, e);
    return apiError("Failed to load your profile.", 500);
  }
}

// PATCH /api/v1/me — edit your own profile: handle, bio, avatar.
//
// The avatar is given as a URL the server fetches, not as bytes. Everything
// else in this API is JSON, and an avatar is small and almost always already
// somewhere fetchable — the same shape `POST /channels/:id/blocks` uses for an
// image block.
//
// Creating a profile is deliberately absent. A token can only be minted from
// the settings page, which redirects to onboarding when there is no profile, so
// there is no state in which an API caller has a token and no profile to edit.
export async function PATCH(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const updates: { handle?: string; about?: string; avatar_url?: string } = {};
  if (typeof body.handle === "string") {
    const handle = normalizeHandle(body.handle);
    const invalid = validateHandle(handle);
    if (invalid) return apiError(invalid, 400);
    updates.handle = handle;
  }
  if (typeof body.about === "string") updates.about = body.about;

  const previous = await getUserProfile(auth.userId);
  if (!previous) return apiError("This account has not finished onboarding.", 404);

  if (typeof body.avatar === "string" && body.avatar.trim()) {
    try {
      // Public scope: an avatar is shown wherever the account is named, so it
      // can never be private media.
      updates.avatar_url = await putImageBlobFromUrl(body.avatar.trim(), auth.userId, "public");
    } catch (e) {
      return apiError(e instanceof Error ? e.message : "Couldn't fetch that image.", 422);
    }
  }

  if (Object.keys(updates).length === 0) {
    return apiError("Nothing to update. Allowed: handle, about, avatar.", 400);
  }

  try {
    const profile = await updateProfile(auth.userId, previous, updates);
    logInfo("me.PATCH", `updated profile for ${auth.userId} (${Object.keys(updates).join(", ")})`);
    return json({
      me: {
        handle: profile.handle,
        about: profile.about,
        avatar_url: profile.avatar_url,
        created_at: profile.created_at,
      },
    });
  } catch (e) {
    if (e instanceof HandleTakenError) return apiError("That handle is already taken.", 409);
    logError("me.PATCH", `failed to update profile for ${auth.userId}`, e);
    return apiError("Failed to update your profile.", 500);
  }
}
