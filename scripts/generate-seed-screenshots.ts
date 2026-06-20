/**
 * Regenerate the seed screenshots used for local development.
 *
 * Captures real screenshots of the seeded URLs the exact same way the app does
 * at runtime (`captureWebsiteScreenshot`, shared with
 * app/api/screenshot/route.ts) and writes them to supabase/seed-screenshots/.
 *
 * On `bun run db:reset` the Supabase CLI uploads those files into the local
 * `screenshots` bucket (config.toml -> [storage.buckets.screenshots].objects_path),
 * and supabase/seed.sql points the cached `screenshot` rows at them. The files
 * are named with the same base64url(url).png scheme the route uses.
 *
 * Requires a launchable Chromium (see README "Local development" troubleshooting
 * for the system libraries needed on WSL / minimal Linux).
 *
 *   bun run db:seed:screenshots   # then: bun run db:reset
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { captureWebsiteScreenshot } from "@/lib/colosseum/screenshot";
import { encodeUrlToFilename } from "@/lib/url-encoding";

// Keep this list in sync with the URL columns seeded in supabase/seed.sql.
const SEED_URLS = ["https://supabase.com", "https://nextjs.org"];

const OUT_DIR = path.join(process.cwd(), "supabase", "seed-screenshots");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const url of SEED_URLS) {
    process.stdout.write(`Capturing ${url} ... `);
    const { image, title } = await captureWebsiteScreenshot(url);
    const file = path.join(OUT_DIR, `${encodeUrlToFilename(url)}.png`);
    await writeFile(file, image);
    console.log(
      `ok — "${title || "no title"}", ${image.length} bytes -> ${path.relative(process.cwd(), file)}`,
    );
  }

  console.log("\nDone. Run `bun run db:reset` to load them into local storage.");
}

main().catch((err) => {
  console.error("\nFailed to generate seed screenshots:");
  console.error(err);
  process.exit(1);
});
