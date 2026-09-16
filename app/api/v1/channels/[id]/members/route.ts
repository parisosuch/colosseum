import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  addMemberFor,
  json,
  listMembersFor,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/channels/:id/members — who is on the channel's roster. Visible to
// anyone who can read the channel, which is what the channel page already shows.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = Number((await params).id);
  if (!Number.isInteger(channelId)) return apiError("Invalid channel id.", 400);

  try {
    const result = await listMembersFor(channelId, auth.userId);
    if (result instanceof NextResponse) return result;
    return json({ members: result });
  } catch (e) {
    logError("channels.members.GET", `failed to list members of ${channelId}`, e);
    return apiError("Failed to list members.", 500);
  }
}

// POST /api/v1/channels/:id/members — add someone by handle. Body:
// `{ "handle": "alice" }`. Owner only; the new member is notified.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = Number((await params).id);
  if (!Number.isInteger(channelId)) return apiError("Invalid channel id.", 400);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  if (typeof body.handle !== "string" || !body.handle.trim()) {
    return apiError("`handle` is required.", 400);
  }

  try {
    const result = await addMemberFor(channelId, body.handle, auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("channels.members.POST", `added ${body.handle} to channel ${channelId}`);
    return json({ member: result }, 201);
  } catch (e) {
    logError("channels.members.POST", `failed to add a member to ${channelId}`, e);
    return apiError("Failed to add member.", 500);
  }
}
