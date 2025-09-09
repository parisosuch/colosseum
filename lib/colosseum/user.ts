import { SupabaseClient } from "@supabase/supabase-js";

export type UserProfile = {
  user_id: string;
  created_at: string;
  handle: string;
  avatar_url?: string;
  about?: string;
};

export async function getUserProfile(
  client: SupabaseClient,
  user_id: string
): Promise<UserProfile | null> {
  const { data, error } = await client
    .from("user_profile")
    .select("*")
    .eq("user_id", user_id)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error(`User with id ${user_id} does not exist.`);
  }

  return data;
}
