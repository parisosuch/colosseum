import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";

import { createClient } from "@supabase/supabase-js";
import { encodeUrlToFilename } from "@/lib/url-encoding";

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
    return NextResponse.json({ error: "Missing auth token." }, { status: 400 });
  }

  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ensure user is authenticated first
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

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

    const { error: insertError } = await supabase
      .from("screenshot")
      .upsert(
        { url: url, image_url: publicUrl },
        { onConflict: "url", ignoreDuplicates: true }
      );

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

export async function GET(req: NextRequest) {
  const requestURL = new URL(req.url);

  const targetURL = requestURL.searchParams.get("url");

  if (!targetURL) {
    return NextResponse.json(
      { error: "Missing url parameter." },
      { status: 401 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // look up if image exists in database
  const { data, error: selectError } = await supabase
    .from("screenshot")
    .select("*")
    .eq("url", targetURL)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "Screenshot for URL does not exist." },
      { status: 404 }
    );
  }

  // return image url
  return NextResponse.json({ image_url: data.image_url });
}
