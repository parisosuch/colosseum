import { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSearch, tagContainsFilter } from "@/lib/utils";

export type Channel = {
  id: number;
  created_at: string;
  title: string;
  description?: string;
  private: boolean;
  owner_id: string;
  updated_at?: string;
  tags: string[];
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

// Channels the user owns whose title/description or a tag match `query`. Used by the
// nav search box, so capped to a handful of results. Returns [] for an
// empty/whitespace-only query rather than the user's whole channel list.
export async function searchUserChannels(
  supabase: SupabaseClient,
  user_id: string,
  query: string,
): Promise<Channel[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }

  const pattern = `%${term}%`;
  const filters = ["title", "description"].map((col) => `${col}.ilike.${pattern}`);
  const tagFilter = tagContainsFilter(term);
  if (tagFilter) filters.push(tagFilter);
  const { data, error } = await supabase
    .from("channel")
    .select("*")
    .eq("owner_id", user_id)
    .or(filters.join(","))
    .limit(10);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
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

// Deletes a channel. The "channel: delete own" RLS policy restricts this to
// the owner, and the channel's columns are removed by the ON DELETE CASCADE
// foreign key. Screenshots are a shared per-URL cache and are left untouched.
export async function deleteChannel(supabase: SupabaseClient, channel_id: number): Promise<void> {
  const { error } = await supabase.from("channel").delete().eq("id", channel_id);

  if (error) {
    throw new Error(error.message);
  }
}

// Updates an existing channel's editable fields. RLS ("channel: update own")
// restricts this to the owner, so a non-owner gets no rows back and throws.
export async function updateChannel(
  supabase: SupabaseClient,
  channel_id: number,
  updates: { title: string; description?: string; private: boolean; tags?: string[] },
): Promise<Channel> {
  const { data, error } = await supabase
    .from("channel")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", channel_id)
    .select()
    .single();

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
