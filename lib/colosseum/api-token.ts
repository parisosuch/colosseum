import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { apiToken } from "@/lib/db/schema";

// UI-facing view of an API token row. Deliberately omits `token_hash` — the
// secret is never needed (or wanted) in the browser. The plaintext token is
// only ever returned once, by the create route, and is not stored.
export type ApiToken = {
  id: string;
  created_at: string;
  name: string | null;
  token_prefix: string;
  last_used_at: string | null;
};

// Non-secret columns only — the token hash is never exposed to the UI.
const tokenColumns = {
  id: apiToken.id,
  created_at: apiToken.created_at,
  name: apiToken.name,
  token_prefix: apiToken.token_prefix,
  last_used_at: apiToken.last_used_at,
};

type TokenRow = {
  id: string;
  created_at: Date;
  name: string | null;
  token_prefix: string;
  last_used_at: Date | null;
};
function toToken(row: TokenRow): ApiToken {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    name: row.name,
    token_prefix: row.token_prefix,
    last_used_at: row.last_used_at?.toISOString() ?? null,
  };
}

// The caller's tokens, newest first. Scoped to the caller by the explicit
// user filter (this connection bypasses RLS).
export async function getMyApiTokens(userId: string): Promise<ApiToken[]> {
  const rows = await db
    .select(tokenColumns)
    .from(apiToken)
    .where(eq(apiToken.user_id, userId))
    .orderBy(desc(apiToken.created_at));
  return rows.map(toToken);
}

// Revoke (delete) one of the caller's own tokens by id. A token belonging to
// someone else matches no rows.
export async function revokeApiToken(id: string, userId: string): Promise<void> {
  await db.delete(apiToken).where(and(eq(apiToken.id, id), eq(apiToken.user_id, userId)));
}
