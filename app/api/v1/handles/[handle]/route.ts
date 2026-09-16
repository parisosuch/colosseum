import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { isHandleAvailable } from "@/lib/colosseum/profile";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ handle: string }> };

// GET /api/v1/handles/:handle — whether a handle is free to claim.
//
// → { "available": true } | { "available": false } | { "available": null, ... }
//
// `null` means the handle isn't valid to begin with, which is a different
// answer from "taken" and is why this isn't a bare boolean. `reason` carries
// the rule it broke.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle } = await params;

  try {
    const available = await isHandleAvailable(handle);
    return json(
      available === null ? { available: null, reason: "Not a valid handle." } : { available },
    );
  } catch (e) {
    logError("handles.GET", `availability check failed for ${handle}`, e);
    return apiError("Failed to check that handle.", 500);
  }
}
