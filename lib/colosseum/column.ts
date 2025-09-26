import { SupabaseClient } from "@supabase/supabase-js";
import { isURL } from "../utils";

export type Column = {
  id: number;
  created_at: string;
  type: "url" | "text" | "image";
  title?: string;
  description?: string;
  url?: string;
  text?: string;
  image?: string;
  created_by: string;
  channel_id: number;
};

export async function getChannelColumns(
  supabase: SupabaseClient,
  channel_id: number
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

export async function uploadTextAreaColumn(
  supabase: SupabaseClient,
  column: {
    created_by: string;
    channel_id: string;
    text: string;
  }
): Promise<Column> {
  const columnData = isURL(column.text)
    ? {
        type: "url",
        url: column.text,
        channel_id: parseInt(column.channel_id),
        created_by: column.created_by,
      }
    : {
        type: "text",
        text: column.text,
        channel_id: parseInt(column.channel_id),
        created_by: column.created_by,
      };

  console.log(columnData);

  const { data, error: insertError } = await supabase
    .from("column")
    .insert(columnData) // use insert instead of upsert
    .select()
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return data;
}
