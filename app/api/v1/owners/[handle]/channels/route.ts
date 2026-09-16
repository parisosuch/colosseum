import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { getVisibleOwnerChannels, viewerScope } from "@/lib/colosseum/channel";
import { getOwnerByHandle } from "@/lib/colosseum/owner";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ handle: string }> };

// GET /api/v1/owners/:handle/channels — the channels under a handle, whether or
// not the caller owns it. A handle is a person or a group; both live in the
// same namespace and both own channels the same way.
//
// Scoped through the viewer exactly as the profile page is, so this lists the
// public and open channels plus any private ones the caller can already reach.
// `GET /channels` stays what it is — the caller's own — and this is how anything
// else becomes reachable at all.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle } = await params;

  try {
    const owner = await getOwnerByHandle(handle);
    if (!owner) return apiError("Not found.", 404);

    const channels = await getVisibleOwnerChannels(owner.id, await viewerScope(auth.userId));
    return json({
      owner: { handle: owner.handle, kind: owner.kind, about: owner.about },
      channels,
    });
  } catch (e) {
    logError("owners.channels.GET", `failed to list channels for ${handle}`, e);
    return apiError("Failed to list channels.", 500);
  }
}
