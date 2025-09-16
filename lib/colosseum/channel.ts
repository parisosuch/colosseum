import { SupabaseClient } from "@supabase/supabase-js";

export type Channel = {
  id: number;
  created_at: string;
  title: string;
  description?: string;
  private: boolean;
  owner_id: string;
  updated_at?: string;
};

export async function getUserPublicChannels(
  supabase: SupabaseClient,
  user_id: string
): Promise<Channel[] | []> {
  const { data, error } = await supabase
    .from("channel")
    .select("*")
    .eq("owner_id", user_id)
    .eq("private", false);

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }
  return data;
}

export async function getUserChannels(
  supabase: SupabaseClient,
  user_id: string
): Promise<Channel[] | []> {
  const { data, error } = await supabase
    .from("channel")
    .select("*")
    .eq("owner_id", user_id);

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }
  return data;
}

export async function createChannel(supabase: SupabaseClient, data: {
  title: string;
  description?: string;
  private: boolean;
  owner_id: string;

}) {
  const { error } = await supabase.from("channel").insert(data);

  if (error) {
    throw new Error(error.message);
  }
}
