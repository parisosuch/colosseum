import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { markNotificationRead } from "@/lib/colosseum/notification";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/v1/notifications/:id/read — mark one read.
//
// The write is scoped to the caller as recipient, so someone else's id matches
// nothing and succeeds silently rather than reporting whether it exists.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return apiError("Invalid notification id.", 400);

  try {
    await markNotificationRead(auth.userId, id);
    return json({ success: true });
  } catch (e) {
    logError("notifications.read.POST", `failed to mark ${id} read`, e);
    return apiError("Failed to mark it read.", 500);
  }
}
