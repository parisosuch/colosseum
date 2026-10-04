// Postgres storage for canvas docs, used by the realtime server.
//
// It opens its own small pool rather than importing lib/db: that module imports
// `server-only`, which throws outside Next's react-server build, and server.ts
// runs outside it. The table itself is defined in lib/db/schema.ts like every
// other one, so migrations still come from one place.

import postgres from "postgres";

import type { CanvasStore } from "./canvas-server";

const FOREIGN_KEY_VIOLATION = "23503";

export function createPgCanvasStore(connectionString: string): CanvasStore & {
  end(): Promise<void>;
} {
  const sql = postgres(connectionString, { max: 4 });

  return {
    async load(channelId) {
      const [row] = await sql<{ doc: Buffer }[]>`
        select doc from channel_canvas where channel_id = ${channelId}
      `;
      return row ? new Uint8Array(row.doc) : null;
    },

    async save(channelId, doc, hasElements) {
      try {
        await sql`
          insert into channel_canvas (channel_id, doc, has_elements, updated_at)
          values (${channelId}, ${Buffer.from(doc)}, ${hasElements}, now())
          on conflict (channel_id) do update
            set doc = excluded.doc,
                has_elements = excluded.has_elements,
                updated_at = excluded.updated_at
        `;
        return "ok";
      } catch (err) {
        if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) return "gone";
        throw err;
      }
    },

    async columnIds(channelId) {
      const rows = await sql<{ id: string }[]>`
        select id from "column" where channel_id = ${channelId}
      `;
      return new Set(rows.map((r) => Number(r.id)));
    },

    end: () => sql.end({ timeout: 5 }),
  };
}
