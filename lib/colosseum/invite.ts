import { SupabaseClient } from "@supabase/supabase-js";

export type InviteCode = {
  code: string;
  created_at: string;
  created_by: string | null;
  max_uses: number;
  uses: number;
  note: string | null;
};

// Human-friendly alphabet: no 0/O/1/I to avoid transcription mistakes when a
// code is read aloud or copied from a screenshot.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = "";
  for (const b of bytes) {
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out;
}

// Codes the member has minted, newest first. RLS restricts this to the caller's
// own codes, so no owner filter is strictly required — it's kept explicit to
// mirror the rest of the data-access layer.
export async function getMyInviteCodes(
  supabase: SupabaseClient,
  userId: string,
): Promise<InviteCode[]> {
  const { data, error } = await supabase
    .from("invite_code")
    .select("*")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createInviteCode(
  supabase: SupabaseClient,
  params: { created_by: string; max_uses?: number; note?: string | null },
): Promise<InviteCode> {
  const { data, error } = await supabase
    .from("invite_code")
    .insert({
      code: generateInviteCode(),
      created_by: params.created_by,
      max_uses: params.max_uses ?? 1,
      note: params.note ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// Revoke an unused code. RLS only permits deleting the caller's own codes with
// uses = 0, so a spent code can't be revoked (and wouldn't matter — it's done).
export async function revokeInviteCode(supabase: SupabaseClient, code: string): Promise<void> {
  const { error } = await supabase.from("invite_code").delete().eq("code", code);
  if (error) {
    throw new Error(error.message);
  }
}
