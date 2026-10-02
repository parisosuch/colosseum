// Postgres side of thread anchoring (canvas-threads.ts), for the realtime
// server. Its own small pool for the same reason canvas-store.ts has one:
// lib/db imports `server-only`, which server.ts can't load. The table is
// `canvas_thread` in lib/db/schema.ts.

import postgres from "postgres";

import type { AnchoredThread, ThreadAnchorStore } from "./canvas-threads";

export function createPgThreadStore(connectionString: string): ThreadAnchorStore & {
  end(): Promise<void>;
} {
  const sql = postgres(connectionString, { max: 2 });

  return {
    async anchoredThreads(channelId) {
      const rows = await sql<
        {
          id: string;
          element_id: string;
          offset_x: number | null;
          offset_y: number | null;
          x: number;
          y: number;
        }[]
      >`
        select id, element_id, offset_x, offset_y, x, y
        from canvas_thread
        where channel_id = ${channelId} and element_id is not null
      `;
      return rows.map((r): AnchoredThread => ({ ...r, id: Number(r.id) }));
    },

    async detach(threadId, elementId, x, y) {
      const rows = await sql`
        update canvas_thread set element_id = null, x = ${x}, y = ${y}
        where id = ${threadId} and element_id = ${elementId}
        returning id
      `;
      return rows.length > 0;
    },

    async savePositions(rows) {
      if (rows.length === 0) return;
      await sql`
        update canvas_thread t set x = v.x, y = v.y
        from jsonb_to_recordset(${sql.json(rows)}::jsonb)
          as v(id bigint, element_id text, x double precision, y double precision)
        where t.id = v.id and t.element_id = v.element_id
      `;
    },

    end: () => sql.end({ timeout: 5 }),
  };
}
