import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json, listApiTokensFor } from "@/lib/colosseum/api-auth";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/tokens — your API tokens, without their secrets. The one making
// this request is marked `current: true`.
//
// There is no POST here. Minting a token over a token would make revocation
// unrecoverable: revoke the one you know about and it may already have made
// more. Creation stays at POST /api/tokens, behind a browser session.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    return json({ tokens: await listApiTokensFor(auth.userId, auth.tokenId) });
  } catch (e) {
    logError("tokens.GET", `failed to list tokens for ${auth.userId}`, e);
    return apiError("Failed to list tokens.", 500);
  }
}
