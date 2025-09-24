"use server";

import { uploadTextAreaColumn } from "../colosseum/column";
import { createClient } from "../supabase/server";

export async function createColumnServerAction(column: {
  created_by: string;
  channel_id: string;
  text: string;
}) {
  const supabase = await createClient();

  return uploadTextAreaColumn(supabase, column);
}
