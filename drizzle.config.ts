import { defineConfig } from "drizzle-kit";

// drizzle-kit runs this under node, which doesn't auto-load .env.local the way
// `bun <file>` does — load it ourselves when the shell didn't provide the URL.
// In the container DATABASE_URL is real env and there is no .env.local.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // leave it unset; drizzle-kit reports the missing url below
  }
}

// drizzle-kit migrate applies pending migrations idempotently (already-applied
// ones are tracked in __drizzle_migrations and skipped), which is what the
// container entrypoint runs on boot.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
