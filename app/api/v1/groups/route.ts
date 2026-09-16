import { NextResponse } from "next/server";

import { apiError, authenticateApiToken, createGroupFor, json } from "@/lib/colosseum/api-auth";
import { listUserGroups } from "@/lib/colosseum/group";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/groups — the groups the token's user belongs to, with the role
// they hold in each. This is how a client learns which handles it may pass as
// `owner` when creating a channel; `role` says which of them will be accepted.
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

// POST /api/v1/groups — start a group. Anyone signed in may, as in the app: a
// group is a handle plus a roster, and claiming one costs nobody anything.
//
// Body: `{ "handle": "studio", "name": "Studio" }`. The handle comes from the
// same pool people draw from, so a taken one is a 409.
export async function POST(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  if (typeof body.handle !== "string" || !body.handle.trim()) {
    return apiError("`handle` is required.", 400);
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return apiError("`name` is required.", 400);
  }

  try {
    const result = await createGroupFor(body.handle.trim(), body.name.trim(), auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("groups.POST", `created group ${result.handle} for ${auth.userId}`);
    return json({ group: result }, 201);
  } catch (e) {
    logError("groups.POST", `failed to create a group for ${auth.userId}`, e);
    return apiError("Failed to create group.", 500);
  }
}
