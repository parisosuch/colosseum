import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  addGroupMemberFor,
  json,
  listGroupMembersFor,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ handle: string }> };

// GET /api/v1/groups/:handle/members — the roster. Any member may read it;
// knowing who else is in a group you belong to is not privileged.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle } = await params;

  try {
    const result = await listGroupMembersFor(handle, auth.userId);
    if (result instanceof NextResponse) return result;
    return json({ members: result });
  } catch (e) {
    logError("groups.members.GET", `failed to list members of ${handle}`, e);
    return apiError("Failed to list members.", 500);
  }
}

// POST /api/v1/groups/:handle/members — add someone. Owner or admin.
// Body: `{ "handle": "alice", "role": "member" }`.
//
// `owner` is not an accepted role: a group has exactly one, and it changes
// hands through the transfer route.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  if (typeof body.handle !== "string" || !body.handle.trim()) {
    return apiError("`handle` is required.", 400);
  }
  const role = body.role ?? "member";
  if (role !== "member" && role !== "admin") {
    return apiError("`role` must be `member` or `admin`.", 400);
  }

  try {
    const result = await addGroupMemberFor(handle, body.handle, role, auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("groups.members.POST", `added ${body.handle} to group ${handle} as ${role}`);
    return json({ member: result }, 201);
  } catch (e) {
    logError("groups.members.POST", `failed to add a member to ${handle}`, e);
    return apiError("Failed to add member.", 500);
  }
}
