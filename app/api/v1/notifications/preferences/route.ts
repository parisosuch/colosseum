import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { setEmailNotificationPref, type NotificationType } from "@/lib/colosseum/notification";
import { getUserProfile } from "@/lib/colosseum/user";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const TYPES: NotificationType[] = ["comment", "mention", "connect", "member"];

// GET /api/v1/notifications/preferences — which kinds send email.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const profile = await getUserProfile(auth.userId);
    if (!profile) return apiError("This account has not finished onboarding.", 404);
    return json({ email_notifications: profile.email_notifications });
  } catch (e) {
    logError("notifications.prefs.GET", `failed for ${auth.userId}`, e);
    return apiError("Failed to read preferences.", 500);
  }
}

// PATCH /api/v1/notifications/preferences — turn one kind's email on or off.
// Body: `{ "type": "comment", "enabled": false }`.
//
// One at a time, because the stored value is a single JSON column: a partial
// write of the whole object would drop whichever keys the caller left out.
export async function PATCH(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const type = body.type as NotificationType;
  if (!TYPES.includes(type)) {
    return apiError(`\`type\` must be one of: ${TYPES.join(", ")}.`, 400);
  }
  if (typeof body.enabled !== "boolean") return apiError("`enabled` must be a boolean.", 400);

  try {
    const prefs = await setEmailNotificationPref(auth.userId, type, body.enabled);
    return json({ email_notifications: prefs });
  } catch (e) {
    logError("notifications.prefs.PATCH", `failed for ${auth.userId}`, e);
    return apiError("Failed to update preferences.", 500);
  }
}
