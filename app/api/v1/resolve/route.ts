import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  attachPreview,
  authorizeChannelRead,
  json,
} from "@/lib/colosseum/api-auth";
import { getChannel } from "@/lib/colosseum/channel";
import { getColumn } from "@/lib/colosseum/column";
import { getOwnerByHandle } from "@/lib/colosseum/owner";
import { parseColosseumLink } from "@/lib/colosseum/resolve";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/resolve?q=... — turn a Colosseum link, or a bare handle, into the
// ids everything else is addressed by.
//
// Without this a client handed a link — which is how a person actually shares a
// channel — could do nothing with it: every other endpoint takes a numeric id,
// and `GET /channels` lists only what the caller owns.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!q.trim()) return apiError("`q` is required — a Colosseum link or a handle.", 400);

  const link = parseColosseumLink(q);
  if (!link) return apiError("Not a Colosseum link or handle.", 400);

  try {
    const owner = await getOwnerByHandle(link.handle);
    if (!owner) return apiError("Not found.", 404);

    const result: Record<string, unknown> = {
      owner: { handle: owner.handle, kind: owner.kind, about: owner.about },
    };

    if (link.channelId !== undefined) {
      const channel = await getChannel(link.channelId);
      // Authorized like any other read, so a private channel is a 404 whether
      // or not it exists — a link to one resolves to nothing for an outsider.
      const denied = await authorizeChannelRead(channel, auth.userId);
      if (denied) return denied;
      result.channel = channel;

      if (link.blockId !== undefined) {
        const block = await getColumn(link.blockId, { html: false });
        // The block has to be in the channel the link named; one that isn't is
        // as good as missing, and saying so would confirm it exists elsewhere.
        if (!block || block.channel_id !== link.channelId) return apiError("Not found.", 404);
        result.block = await attachPreview(block);
      }
    }

    return json(result);
  } catch (e) {
    logError("resolve.GET", `failed to resolve ${q}`, e);
    return apiError("Failed to resolve.", 500);
  }
}
