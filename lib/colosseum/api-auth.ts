// Server-only helpers for the REST API (app/api/v1/*) and the token-create
// route. Imports node:crypto, so it must never be pulled into a client bundle —
// only route handlers (nodejs runtime) import it.

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { apiToken } from "@/lib/db/schema";
import { Channel } from "./channel";
import { Column } from "./column";
import { ApiToken } from "./api-token";
import { getScreenshot, getScreenshotsForUrls } from "./screenshot-data";
import { logError, logInfo } from "@/lib/log";

// Tokens look like `clsm_<43 base64url chars>`. The prefix namespaces the secret
// (so it's greppable in logs/secret scanners) and the random part has 256 bits
// of entropy.
const TOKEN_PREFIX = "clsm_";
const TOKEN_BYTES = 32;
// How much of the token (prefix + a few secret chars) we keep in plaintext for
// display, so a user can tell their tokens apart without exposing the secret.
const PREFIX_DISPLAY_LEN = TOKEN_PREFIX.length + 8;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, prefix: token.slice(0, PREFIX_DISPLAY_LEN), hash: hashToken(token) };
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

// A bearer token has no user session, so API handlers resolve it to a user id
// and then authorize every request explicitly (the Drizzle connection bypasses
// row-level security).
export type ApiAuth = { userId: string };

// Resolve a raw bearer token to its owning user. Shared by the REST API
// (authenticateApiToken, below) and the MCP endpoint (app/api/[transport]).
// Returns null for an unknown token; throws on a DB error so callers can
// distinguish "invalid token" from "auth backend unavailable".
export async function resolveApiToken(token: string): Promise<ApiAuth | null> {
  const hash = hashToken(token);

  const [row] = await db
    .select({ user_id: apiToken.user_id })
    .from(apiToken)
    .where(eq(apiToken.token_hash, hash))
    .limit(1);

  if (!row) {
    return null;
  }

  // Best-effort usage timestamp; never fail the request over it.
  void db
    .update(apiToken)
    .set({ last_used_at: new Date() })
    .where(eq(apiToken.token_hash, hash))
    .catch(() => {});

  return { userId: row.user_id };
}

// Resolve the `Authorization: Bearer <token>` header to the owning user. On
// success returns the user id; on failure returns a NextResponse the handler
// should return as-is.
export async function authenticateApiToken(req: Request): Promise<ApiAuth | NextResponse> {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return apiError("Missing or malformed Authorization header.", 401);
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return apiError("Missing bearer token.", 401);
  }

  try {
    const auth = await resolveApiToken(token);
    if (!auth) {
      // Never log the token itself, even truncated — just that one was
      // rejected, useful for spotting a client using a revoked/typo'd token.
      logInfo("api-auth", "rejected an invalid API token");
      return apiError("Invalid API token.", 401);
    }
    return auth;
  } catch (e) {
    logError("api-auth", "token resolution failed (DB error)", e);
    return apiError("Authentication failed.", 500);
  }
}

// Persist a freshly generated token. The hash + non-secret prefix are stored;
// the plaintext is returned once for the caller to display and is unrecoverable
// afterwards.
export async function createApiToken(params: {
  userId: string;
  name: string | null;
}): Promise<{ token: string; row: ApiToken }> {
  const { token, prefix, hash } = generateApiToken();

  const [row] = await db
    .insert(apiToken)
    .values({
      user_id: params.userId,
      name: params.name,
      token_prefix: prefix,
      token_hash: hash,
    })
    .returning({
      id: apiToken.id,
      created_at: apiToken.created_at,
      name: apiToken.name,
      token_prefix: apiToken.token_prefix,
      last_used_at: apiToken.last_used_at,
    });

  return {
    token,
    row: {
      id: row.id,
      created_at: row.created_at.toISOString(),
      name: row.name,
      token_prefix: row.token_prefix,
      last_used_at: row.last_used_at?.toISOString() ?? null,
    },
  };
}

// Read authorization: a channel is visible when it's public or owned by the
// caller. A missing OR hidden (private, not owned) channel both return 404 so we
// never leak the existence of someone else's private channel.
export function authorizeChannelRead(channel: Channel | null, userId: string): NextResponse | null {
  if (!channel || (channel.private && channel.owner_id !== userId)) {
    return apiError("Not found.", 404);
  }
  return null;
}

// Write authorization: only the owner may mutate. A hidden channel still 404s
// (don't leak); a visible-but-not-owned channel is 403.
export function authorizeChannelWrite(
  channel: Channel | null,
  userId: string,
): NextResponse | null {
  if (!channel || (channel.private && channel.owner_id !== userId)) {
    return apiError("Not found.", 404);
  }
  if (channel.owner_id !== userId) {
    logInfo(
      "api-auth",
      `user ${userId} denied write on channel ${channel.id} (owned by ${channel.owner_id})`,
    );
    return apiError("You do not have permission to modify this resource.", 403);
  }
  return null;
}

// url blocks capture a preview asynchronously (see triggerScreenshotCapture in
// ./screenshot); these attach whatever's currently cached so API clients can
// poll a block until `preview` resolves instead of the API blocking on a
// multi-second Puppeteer run.
// - null            -> no row yet, still capturing (or never triggered) — keep polling.
// - { failed: true } -> capture ran and failed permanently — stop polling.
// - { image_url, title } -> captured successfully.
export type BlockWithPreview = Column & {
  preview: { image_url: string; title: string } | { failed: true } | null;
};

function toPreview(row: { image_url: string | null; title: string | null } | undefined) {
  if (!row) return null;
  if (row.image_url) return { image_url: row.image_url, title: row.title ?? "" };
  return { failed: true } as const;
}

export async function attachPreview(block: Column): Promise<BlockWithPreview> {
  if (block.type !== "url" || !block.url) return { ...block, preview: null };
  return { ...block, preview: toPreview((await getScreenshot(block.url)) ?? undefined) };
}

export async function attachPreviews(blocks: Column[]): Promise<BlockWithPreview[]> {
  const urls = blocks.filter((b) => b.type === "url" && b.url).map((b) => b.url!);
  const screenshots = await getScreenshotsForUrls(urls);
  return blocks.map((b) => ({
    ...b,
    preview: b.type === "url" && b.url ? toPreview(screenshots.get(b.url)) : null,
  }));
}
