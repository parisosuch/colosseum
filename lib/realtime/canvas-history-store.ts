// Postgres storage for canvas versions (channel_canvas_version), on its own
// small pool for the same reason as canvas-store.ts: server.ts can't load
// lib/db, which imports `server-only`.

import postgres from "postgres";

import { createCanvasHistory, storedDocs, type VersionStore } from "./canvas-history";
import type { CanvasHistoryApi } from "./canvas-history-registry";
import { createPgCanvasStore } from "./canvas-store";

const FOREIGN_KEY_VIOLATION = "23503";

// A Postgres array literal for uuids or integers, neither of which needs
// quoting. Passed as text and cast in the query.
function arrayLiteral(values: readonly (string | number)[]): string {
  return `{${values.join(",")}}`;
}

export function createPgVersionStore(connectionString: string): VersionStore & {
  end(): Promise<void>;
} {
  const sql = postgres(connectionString, { max: 2 });

  return {
    async insertVersion({ channelId, doc, name, createdBy, editors }) {
      try {
        const [row] = await sql<{ id: string }[]>`
          insert into channel_canvas_version (channel_id, doc, name, created_by, editors)
          values (${channelId}, ${Buffer.from(doc)}, ${name}, ${createdBy}, ${arrayLiteral(editors)}::uuid[])
          returning id
        `;
        return Number(row.id);
      } catch (err) {
        // The channel (or the user saving a restore point) was deleted under us.
        if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) return null;
        throw err;
      }
    },

    async versionDoc(channelId, versionId) {
      const [row] = await sql<{ doc: Buffer }[]>`
        select doc from channel_canvas_version
        where id = ${versionId} and channel_id = ${channelId}
      `;
      return row ? new Uint8Array(row.doc) : null;
    },

    async replaceVersionDoc(versionId, doc) {
      await sql`
        update channel_canvas_version set doc = ${Buffer.from(doc)} where id = ${versionId}
      `;
    },

    async automaticVersionsBefore(cutoff) {
      const rows = await sql<{ id: string; channel_id: string; created_at: Date }[]>`
        select id, channel_id, created_at from channel_canvas_version
        where name is null and created_at <= ${cutoff}
      `;
      return rows.map((r) => ({
        id: Number(r.id),
        channelId: Number(r.channel_id),
        createdAt: r.created_at,
        named: false,
      }));
    },

    async deleteVersions(ids) {
      if (ids.length === 0) return;
      await sql`delete from channel_canvas_version where id = any(${arrayLiteral(ids)}::bigint[])`;
    },

    end: () => sql.end({ timeout: 5 }),
  };
}

const STORED_KEY = Symbol.for("colosseum.realtime.storedCanvasHistory");

// History for a process with no realtime server, such as `bun test`: it works
// on the stored doc directly. One instance per process.
export function storedCanvasHistory(connectionString: string): CanvasHistoryApi {
  const g = globalThis as unknown as Record<symbol, CanvasHistoryApi | undefined>;
  if (!g[STORED_KEY]) {
    const store = createPgCanvasStore(connectionString);
    g[STORED_KEY] = createCanvasHistory({
      versions: createPgVersionStore(connectionString),
      canvases: store,
      docs: storedDocs(store),
    });
  }
  return g[STORED_KEY];
}
