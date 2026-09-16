import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, authorizeAdmin, json } from "@/lib/colosseum/api-auth";
import { listUsers } from "@/lib/colosseum/admin";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/admin/users — every account, with its limits and flags.
//
// The whole admin surface 404s for a non-admin rather than 403ing: an ordinary
// token has no reason to learn that these routes exist.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const admin = await authorizeAdmin(auth.userId);
  if (admin instanceof NextResponse) return admin;

  try {
    return json({ users: await listUsers() });
  } catch (e) {
    logError("admin.users.GET", "failed to list users", e);
    return apiError("Failed to list users.", 500);
  }
}
