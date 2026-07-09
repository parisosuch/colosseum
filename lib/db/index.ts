// Drizzle client — a single Postgres connection shared across the server. The
// data-access layer in lib/colosseum/ queries through this instead of the
// Supabase client, so authorization is enforced in app code (this connection
// bypasses row-level security).
//
// Server-only: importing this into a client bundle pulls in the `postgres`
// driver and will fail. Client components must go through server actions.

import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

// Reuse the connection across hot-reloads in dev so we don't leak a new pool on
// every module reload.
//
// Prepared statements are left on (the postgres default): the app connects
// directly to Postgres, not through a transaction-mode pooler, so re-planning
// every query buys nothing. Only flip `prepare: false` back on if a PgBouncer /
// transaction-mode pooler is introduced in front of the DB.
const globalForDb = globalThis as unknown as { client?: ReturnType<typeof postgres> };
const client = globalForDb.client ?? postgres(connectionString);
if (process.env.NODE_ENV !== "production") {
  globalForDb.client = client;
}

export const db = drizzle(client, { schema });
