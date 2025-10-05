"use server";

import { createClient } from "../supabase/server";

export type Screenshot = {
  column_id: number;
  created_at: string;
  image_url: string;
};

export async function getScreenshot(column_id: number, url: string) {
  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("screenshot")
    .select("*")
    .eq("column_id", column_id)
    .single();

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  if (existing && new Date(existing.created_at) > oneWeekAgo) {
    return existing.image_url; // return cached screenshot
  }

  const { chromium } = await import("playwright");

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const buffer = await page.screenshot({
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await browser.close();

  const fileName = `screenshots/${column_id}.png`;

  const { error: uploadError } = await supabase.storage
    .from("screenshots")
    .upload(fileName, buffer, { contentType: "image/png", upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicUrl } = supabase.storage
    .from("screenshots")
    .getPublicUrl(fileName);

  await supabase.from("screenshot").upsert({
    column_id: column_id,
    image_url: publicUrl,
    created_at: new Date().toISOString(),
  });

  return publicUrl;
}
