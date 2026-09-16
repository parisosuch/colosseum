import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import {
  listNotifications,
  unreadNotificationCount,
  NOTIFICATION_PAGE,
} from "@/lib/colosseum/notification";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/notifications?before=&unread=true — what has happened to the
// token's own account: comments, mentions, nests, and channel invitations.
//
// No channel authorization here: every query is scoped to the caller as the
// recipient, so there is nothing to deny beyond the token itself.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const search = new URL(req.url).searchParams;
  const before = search.get("before") ?? undefined;
  const unreadOnly = search.get("unread") === "true";

  try {
    const [notifications, unread] = await Promise.all([
      listNotifications(auth.userId, before, { unreadOnly }),
      unreadNotificationCount(auth.userId),
    ]);
    // `unread` is the whole count, not the page's, so a client can show a badge
    // without paging to the end.
    return json({ notifications, unread, page_size: NOTIFICATION_PAGE });
  } catch (e) {
    logError("notifications.GET", `failed to list for ${auth.userId}`, e);
    return apiError("Failed to list notifications.", 500);
  }
}
