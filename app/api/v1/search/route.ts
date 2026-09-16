import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, attachPreviews, json } from "@/lib/colosseum/api-auth";
import { searchChannels, viewerScope } from "@/lib/colosseum/channel";
import { searchColumns } from "@/lib/colosseum/column";
import { searchProfiles } from "@/lib/colosseum/user";
import { SEARCH_LIMIT } from "@/lib/utils";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

// The most a caller may ask for per kind. Search is meant for finding a thing,
// not for reading a collection — `GET /channels/:id/blocks` pages properly and
// is the right tool for that. The bound also keeps one call from filling a
// model's context with most of someone's library.
const MAX_SEARCH_LIMIT = 50;

// GET /api/v1/search?q=...&limit=N — people, channels and blocks matching `q`,
// under the token's own visibility: public things, plus what the caller owns or
// belongs to. Nothing private leaks.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const search = new URL(req.url).searchParams;
  const q = search.get("q") ?? "";
  if (!q.trim()) return apiError("`q` is required.", 400);

  const limitParam = search.get("limit");
  const limit = limitParam ? Number(limitParam) : SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    return apiError(`\`limit\` must be between 1 and ${MAX_SEARCH_LIMIT}.`, 400);
  }

  try {
    const viewer = await viewerScope(auth.userId);
    const [profiles, channels, columns] = await Promise.all([
      searchProfiles(q, limit),
      searchChannels(viewer, q, limit),
      searchColumns(viewer, q, limit),
    ]);
    return json({ profiles, channels, blocks: await attachPreviews(columns) });
  } catch (e) {
    logError("search.GET", `search failed for user ${auth.userId}`, e);
    return apiError("Search failed.", 500);
  }
}
