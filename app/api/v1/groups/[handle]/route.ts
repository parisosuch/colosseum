import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  deleteGroupFor,
  json,
  updateGroupFor,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ handle: string }> };

// PATCH /api/v1/groups/:handle — rename a group or change its blurb.
// Owner or admin. Body: `{ "name": "...", "about": "..." }`.
//
// The handle itself is not editable here: it is the group's address, every link
// to its channels runs through it, and changing it belongs with the same
// deliberation the app gives it.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const updates: { name?: string; about?: string } = {};
  if (typeof body.name === "string") updates.name = body.name;
  if (typeof body.about === "string") updates.about = body.about;

  try {
    const result = await updateGroupFor(handle, updates, auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("groups.handle.PATCH", `updated group ${handle}`);
    return json({ group: result });
  } catch (e) {
    logError("groups.handle.PATCH", `failed to update ${handle}`, e);
    return apiError("Failed to update group.", 500);
  }
}

// DELETE /api/v1/groups/:handle — delete a group. Owner only.
//
// Its channels go with it. That cascade is why this is restricted to the single
// owner rather than to admins, and why the MCP tool asks for confirmation.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle } = await params;

  try {
    const denial = await deleteGroupFor(handle, auth.userId);
    if (denial) return denial;
    logInfo("groups.handle.DELETE", `deleted group ${handle} and its channels`);
    return json({ success: true });
  } catch (e) {
    logError("groups.handle.DELETE", `failed to delete ${handle}`, e);
    return apiError("Failed to delete group.", 500);
  }
}
