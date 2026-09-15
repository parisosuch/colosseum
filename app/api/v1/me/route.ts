import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { getUserProfile } from "@/lib/colosseum/user";
import { logError } from "@/lib/log";

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
    const profile = await getUserProfile(auth.userId);
    // A token can only be minted from a settings page onboarding gates, so an
    // account with no profile row is a broken state rather than a normal one.
    if (!profile) return apiError("This account has not finished onboarding.", 404);

    return json({
      me: {
        handle: profile.handle,
        about: profile.about,
        avatar_url: profile.avatar_url,
        created_at: profile.created_at,
      },
    });
  } catch (e) {
    logError("me.GET", `failed to load profile for user ${auth.userId}`, e);
    return apiError("Failed to load your profile.", 500);
  }
}
