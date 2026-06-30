import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { createChannel, getUserChannels } from "@/lib/colosseum/channel";

export const runtime = "nodejs";

// GET /api/v1/channels — the token owner's channels.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const channels = await getUserChannels(auth.supabase, auth.userId);
    return json({ channels });
  } catch (e) {
    console.error(e);
    return apiError("Failed to list channels.", 500);
  }
}

// POST /api/v1/channels — create a channel owned by the token user.
export async function POST(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return apiError("`title` is required.", 400);
  }
  const description = typeof body.description === "string" ? body.description : undefined;
  const isPrivate = body.private === true;

  try {
    const channel = await createChannel(auth.supabase, {
      title,
      description,
      private: isPrivate,
      // owner is always the token user; any client-supplied owner is ignored.
      owner_id: auth.userId,
    });
    return json({ channel }, 201);
  } catch (e) {
    console.error(e);
    return apiError("Failed to create channel.", 500);
  }
}
