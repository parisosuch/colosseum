import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { markAllNotificationsRead } from "@/lib/colosseum/notification";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

// POST /api/v1/notifications/read-all — mark every unread one read.
export async function POST(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    await markAllNotificationsRead(auth.userId);
    return json({ success: true });
  } catch (e) {
    logError("notifications.readAll.POST", `failed for ${auth.userId}`, e);
    return apiError("Failed to mark them read.", 500);
  }
}
