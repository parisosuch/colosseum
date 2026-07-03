import { defineConfig } from "drizzle-kit";

// Bun auto-loads .env.local, so DATABASE_URL is available when running
// `bun run db:*`. drizzle-kit migrate applies pending migrations idempotently
// (already-applied ones are tracked in __drizzle_migrations and skipped), which
// is what the container entrypoint runs on boot.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
