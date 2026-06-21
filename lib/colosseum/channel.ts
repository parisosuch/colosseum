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
  user_id: string,
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
  user_id: string,
): Promise<Channel[] | []> {
  const { data, error } = await supabase.from("channel").select("*").eq("owner_id", user_id);

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }
  return data;
}

export async function createChannel(
  supabase: SupabaseClient,
  channel: {
    title: string;
    description?: string;
    private: boolean;
    owner_id: string;
  },
): Promise<Channel> {
  const { data, error } = await supabase.from("channel").upsert(channel).select().single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Returns null when the channel doesn't exist OR when RLS hides it from the
// caller (e.g. a private channel they don't own). Callers must not distinguish
// the two, so we don't leak the existence of private channels.
export async function getChannel(
  supabase: SupabaseClient,
  channel_id: number,
): Promise<Channel | null> {
  const { data, error } = await supabase
    .from("channel")
    .select("*")
    .eq("id", channel_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
