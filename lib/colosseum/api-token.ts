import { SupabaseClient } from "@supabase/supabase-js";

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

// Non-secret columns only — see the note on the RLS policies in the api_token
// migration (the owner *can* read token_hash, so we must not select it here).
const TOKEN_COLUMNS = "id, created_at, name, token_prefix, last_used_at";

// The caller's tokens, newest first. RLS restricts this to the caller's own
// rows; the explicit user filter mirrors the rest of the data-access layer
// (cf. getMyInviteCodes in lib/colosseum/invite.ts).
export async function getMyApiTokens(
  supabase: SupabaseClient,
  userId: string,
): Promise<ApiToken[]> {
  const { data, error } = await supabase
    .from("api_token")
    .select(TOKEN_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ApiToken[];
}

// Revoke (delete) a token by id. RLS only permits deleting the caller's own
// tokens, so a token belonging to someone else simply matches no rows.
export async function revokeApiToken(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("api_token").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}
