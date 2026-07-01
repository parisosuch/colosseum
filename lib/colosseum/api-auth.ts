// Server-only helpers for the REST API (app/api/v1/*) and the token-create
// route. Imports node:crypto and the service-role key, so it must never be
// pulled into a client bundle — only route handlers (nodejs runtime) import it.

import { createHash, randomBytes } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { Channel } from "./channel";
import { ApiToken } from "./api-token";

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

// Service-role client — bypasses RLS. Used to resolve a bearer token to a user
// (the caller has no Supabase session) and for the explicit authorization the
// API layer performs itself. Mirrors the construction in
// app/api/screenshot/route.ts. Never back a request as this without an auth gate.
export function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export type ApiAuth = { userId: string; supabase: SupabaseClient };

// Resolve a raw bearer token to its owning user. Shared by the REST API
// (authenticateApiToken, below, after parsing the Authorization header) and
// the MCP endpoint (app/api/[transport]/route.ts), whose framework parses the
// header for us. Returns null for an unknown token; throws on a DB error so
// callers can distinguish "invalid token" from "auth backend unavailable".
export async function resolveApiToken(token: string): Promise<ApiAuth | null> {
  const hash = hashToken(token);
  const supabase = serviceClient();

  const { data, error } = await supabase
    .from("api_token")
    .select("user_id")
    .eq("token_hash", hash)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  // Best-effort usage timestamp; never fail the request over it.
  void supabase
    .from("api_token")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", hash);

  return { userId: data.user_id, supabase };
}

// Resolve the `Authorization: Bearer <token>` header to the owning user. On
// success returns the user id plus a service-role client for the handler to use
// (RLS can't apply — there's no session — so handlers authorize explicitly).
// On failure returns a NextResponse the handler should return as-is.
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
      return apiError("Invalid API token.", 401);
    }
    return auth;
  } catch (e) {
    console.error(e);
    return apiError("Authentication failed.", 500);
  }
}

// Persist a freshly generated token. The hash + non-secret prefix are stored;
// the plaintext is returned once for the caller to display and is unrecoverable
// afterwards. Run with the user's session client so the RLS insert policy
// (auth.uid() = user_id) applies.
export async function createApiToken(
  supabase: SupabaseClient,
  params: { userId: string; name: string | null },
): Promise<{ token: string; row: ApiToken }> {
  const { token, prefix, hash } = generateApiToken();

  const { data, error } = await supabase
    .from("api_token")
    .insert({
      user_id: params.userId,
      name: params.name,
      token_prefix: prefix,
      token_hash: hash,
    })
    .select("id, created_at, name, token_prefix, last_used_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return { token, row: data as ApiToken };
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
    return apiError("You do not have permission to modify this resource.", 403);
  }
  return null;
}
