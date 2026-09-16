import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  json,
  removeGroupMemberFor,
  setGroupRoleFor,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ handle: string; member: string }> };

// PATCH /api/v1/groups/:handle/members/:member — change someone's role.
// Owner or admin. Body: `{ "role": "admin" }`.
//
// The owner's role can't be set from here, which is what keeps a group from
// ending up with nobody able to administer it — use the transfer route.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle, member } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  if (body.role !== "member" && body.role !== "admin") {
    return apiError("`role` must be `member` or `admin`.", 400);
  }

  try {
    const denial = await setGroupRoleFor(handle, member, body.role, auth.userId);
    if (denial) return denial;
    logInfo("groups.members.PATCH", `set ${member} to ${body.role} in ${handle}`);
    return json({ success: true });
  } catch (e) {
    logError("groups.members.PATCH", `failed to set a role in ${handle}`, e);
    return apiError("Failed to set role.", 500);
  }
}

// DELETE /api/v1/groups/:handle/members/:member — remove someone, or leave the
// group yourself. Removing anyone else takes owner or admin; leaving is your
// own business. The owner cannot be removed — they transfer or delete.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle, member } = await params;

  try {
    const denial = await removeGroupMemberFor(handle, member, auth.userId);
    if (denial) return denial;
    logInfo("groups.members.DELETE", `removed ${member} from ${handle}`);
    return json({ success: true });
  } catch (e) {
    logError("groups.members.DELETE", `failed to remove ${member} from ${handle}`, e);
    return apiError("Failed to remove member.", 500);
  }
}
