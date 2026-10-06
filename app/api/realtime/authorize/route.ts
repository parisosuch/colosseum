import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { canvasAuthorization, shareCanvasAuthorization } from "@/lib/colosseum/canvas-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/realtime/authorize?channel=<id> — what the caller's session may do on
// a channel's canvas, and who they appear as there. server.ts asks this over
// loopback with the viewer's cookie before accepting a canvas socket, and again
// for each open socket a permission change might reach, so the rule stays the
// channel page's: contributors write, other readers get a read-only socket. A
// missing channel and an unreadable one both 404, so nothing leaks which.
//
// `&share=<token>` asks what a channel share link grants instead.
//
// It only ever describes the caller's own access and their own public profile,
// which the channel page already reveals, so it needs no protection beyond the
// session itself.
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("channel"));
  if (!Number.isSafeInteger(id) || id <= 0) return notFound();

  // A share-link socket carries its token and nothing else counts: the link
  // holder is a read-only visitor whoever they're signed in as.
  const share = new URL(req.url).searchParams.get("share");
  const auth = share
    ? await shareCanvasAuthorization(id, share)
    : await canvasAuthorization(id, (await getSessionUser())?.id ?? null);
  if (!auth) return notFound();

  return NextResponse.json(auth, { headers: { "Cache-Control": "no-store" } });
}

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
