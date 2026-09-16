import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, authorizeAdmin, json } from "@/lib/colosseum/api-auth";
import { setUserAdmin, setUserBanned, setUserLimits } from "@/lib/colosseum/admin";
import { logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/v1/admin/users/:id — ban, promote, or set limits.
//
// Body takes any of `banned`, `is_admin`, `invite_limit`, `column_limit`. The
// data layer holds the invariants and throws: an admin can't be banned, and the
// last admin can't be demoted. Those come back as 400 with the reason.
//
// A ban does not end the user's sessions or revoke their API tokens — that is
// existing behaviour, and worth knowing before relying on this to cut someone
// off in a hurry.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const admin = await authorizeAdmin(auth.userId);
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  // setUserLimits writes both columns, so accepting one on its own would
  // silently reset the other. Ask for the pair, or neither.
  const wantsLimits = "invite_limit" in body || "column_limit" in body;
  const isLimit = (v: unknown) =>
    v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0);
  if (wantsLimits && !(isLimit(body.invite_limit) && isLimit(body.column_limit))) {
    return apiError(
      "Set `invite_limit` and `column_limit` together; each a non-negative integer, or null for unlimited.",
      400,
    );
  }

  const applied: string[] = [];
  try {
    if (typeof body.banned === "boolean") {
      await setUserBanned(id, body.banned);
      applied.push("banned");
    }
    if (typeof body.is_admin === "boolean") {
      await setUserAdmin(id, body.is_admin);
      applied.push("is_admin");
    }
    if (wantsLimits) {
      await setUserLimits(id, {
        invite_limit: body.invite_limit as number | null,
        column_limit: body.column_limit as number | null,
      });
      applied.push("invite_limit", "column_limit");
    }
  } catch (e) {
    // "Admins can't be banned." / "Can't remove the last admin." / "No such user."
    return apiError(e instanceof Error ? e.message : "Could not update that user.", 400);
  }

  if (applied.length === 0) {
    return apiError(
      "Nothing to update. Allowed: banned, is_admin, invite_limit, column_limit.",
      400,
    );
  }

  logInfo("admin.users.PATCH", `admin ${auth.userId} set ${applied.join(", ")} on user ${id}`);
  return json({ success: true, updated: applied });
}
