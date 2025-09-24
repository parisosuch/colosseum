import { SupabaseClient } from "@supabase/supabase-js";

export type Column = {
  id: number;
  created_at: string;
  type: string;
  title: string;
  description?: string;
  urL?: string;
  text?: string;
  image?: string;
  created_by: string;
  channel_id: number;
};

export async function getChannelColumns(
  supabase: SupabaseClient,
  channel_id: number,
): Promise<Column[]> {
  const { data, error } = await supabase
    .from("column")
    .select("*")
    .eq("channel_id", channel_id)
    .order("created_at");

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
