// Give every block that predates the manual sort a place in its channel's
// order, matching the arrangement the channel already showed: newest first,
// which is what the board's default sort was rendering the day before.
//
// Free once converged. Only channels holding an unplaced block are read, so a
// settled deployment runs one grouped count and exits. New blocks are placed by
// the insert path itself, so nothing this misses accumulates.
//
// Not `required`. Manual sort is a mode a viewer opts into, and it reads
// `position asc nulls last` — a channel this hasn't reached still renders, in
// newest-first order, and a drag inside it places the whole channel on the way
// through. Failing here should not keep a container off the port over a sort
// mode nobody may use.

import { isNull, sql } from "drizzle-orm";

import { ensureChannelPositions } from "@/lib/colosseum/column";
import type { DataMigration } from "@/lib/colosseum/data-migration";
import { db } from "@/lib/db";
import { column } from "@/lib/db/schema";

const migration: DataMigration = {
  id: "0004-backfill-block-positions",
  required: false,

  async run() {
    // Which channels still hold an unplaced block. One grouped query rather
    // than reading every block in the instance to find out.
    const channels = await db
      .select({ channel_id: column.channel_id })
      .from(column)
      .where(isNull(column.position))
      .groupBy(column.channel_id)
      .orderBy(sql`${column.channel_id} asc`);

    let placed = 0;
    let failed = 0;
    // Sequential, one channel at a time: each channel's keys have to be
    // generated in order against that channel's own tail, and a channel that
    // fails leaves the others done rather than taking the run down with it.
    for (const { channel_id } of channels) {
      try {
        placed += await ensureChannelPositions(channel_id);
      } catch (err) {
        failed += 1;
        console.warn(`skip channel ${channel_id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(
      `block positions: ${placed} blocks placed across ${channels.length - failed} channels, ${failed} channels skipped`,
    );
    // A skipped channel keeps its nulls, so withholding the ledger row brings
    // the whole pass back next boot — and it will read only the channels still
    // missing keys, not the ones already done. The channels that succeeded stay
    // done either way.
    if (failed > 0) {
      return { done: false };
    }
  },
};

export default migration;
