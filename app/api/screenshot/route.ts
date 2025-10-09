import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";

import { createClient } from "@/lib/supabase/server";
import { encodeUrlToFilename } from "@/lib/url-encoding";
import { createBrowserClient } from "@supabase/ssr";

export const runtime = "nodejs"; // puppeteer is going to require nodejs runtime for browsing

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 401 }
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");

  const supabase = await createClient();
  const supabaseUser = await createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    token
  );

  // ensure user is authenticated first
  const {
    data: { user },
    error,
  } = await supabaseUser.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // launch headless browser
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    const buffer = await page.screenshot({ fullPage: true });

    await browser.close();

    const fileName = `${encodeUrlToFilename(url)}.png`;

    // upload to supabase storage
    const { error } = await supabase.storage
      .from("screenshots")
      .upload(fileName, buffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (error) {
      console.error(error);
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("screenshots").getPublicUrl(fileName);

    const { error: insertError } = await supabase.from("screenshot").insert({
      url: url,
      image_url: publicUrl,
    });

    if (insertError) {
      console.error(insertError);
      return NextResponse.json({ error: insertError }, { status: 500 });
    }

    return NextResponse.json({ image_url: publicUrl });
  } catch (error) {
    console.error(error);

    return NextResponse.json({ error: error }, { status: 500 });
  }
}
