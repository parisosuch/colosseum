import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import {
  canContributeChannel,
  canReadChannel,
  getChannel,
  resolveChannelViewer,
} from "@/lib/colosseum/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/realtime/authorize?channel=<id> — what the caller's session may do on
// a channel's canvas. server.ts asks this over loopback with the viewer's cookie
// before accepting a canvas socket, so the rule stays the channel page's:
// contributors write, other readers get a read-only socket. A missing channel
// and an unreadable one both 404, so nothing leaks which.
//
// It only ever describes the caller's own access, which the channel page
// already reveals, so it needs no protection beyond the session itself.
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("channel"));
  if (!Number.isSafeInteger(id) || id <= 0) return notFound();

  const [channel, user] = await Promise.all([getChannel(id), getSessionUser()]);
  if (!channel) return notFound();
  const viewer = await resolveChannelViewer(channel, user?.id ?? null);
  if (!canReadChannel(channel, viewer)) return notFound();

  return NextResponse.json(
    {
      access: canContributeChannel(channel, viewer) ? "write" : "read",
      userId: user?.id ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
