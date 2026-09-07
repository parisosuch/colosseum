import { NextResponse } from "next/server";

import { apiError, authenticateApiToken, json } from "@/lib/colosseum/api-auth";
import { listUserGroups } from "@/lib/colosseum/group";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/groups — the groups the token's user belongs to, with the role
// they hold in each. Read-only on purpose: creating a group claims a handle in
// the same namespace people draw from, and changing a roster decides who can
// read private channels, so both stay in the app where they can be confirmed.
//
// The point of exposing it at all is that `POST /api/v1/channels` takes an
// `owner` handle — this is how a client learns which handles it may use, and
// `role` tells it which ones will be accepted (owner and admin, not member).
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const groups = await listUserGroups(auth.userId);
    return json({
      groups: groups.map((g) => ({
        handle: g.handle,
        name: g.name,
        about: g.about,
        role: g.role,
        created_at: g.created_at,
      })),
    });
  } catch (e) {
    logError("groups.GET", `failed to list groups for user ${auth.userId}`, e);
    return apiError("Failed to list groups.", 500);
  }
}
