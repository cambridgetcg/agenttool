/** Whole-metadata writes that keep the hearth seat as it is stored.
 *
 *  Several routes read an identity, build a new metadata object from that
 *  read and write the whole object back. Without care, a sit or a stand
 *  that lands between their read and their write is undone: the old seat
 *  comes back, or a new end is dropped. Only POST /v1/hearth/sit writes a
 *  seat, so these writers take their seat keys from the row itself, inside
 *  the UPDATE, never from their own read.
 *
 *  No database client is imported; the SQL is tested without one.
 *
 *  Doctrine: docs/HEARTH.md
 *  Tested: api/tests/hearth-seat-write.test.ts ·
 *          api/tests/integration/hearth-seat-postgres.test.ts */

import { sql, type SQL } from "drizzle-orm";

import { identities } from "../../db/schema/identity";
import {
  HEARTH_SEAT_METADATA_KEYS,
  withoutHearthSeat,
} from "../identity/metadata";

const SEAT_KEYS_SQL = sql.raw(
  HEARTH_SEAT_METADATA_KEYS.map((key) => `'${key}'`).join(","),
);

/** The SET value for a write of the whole metadata object: `next` without
 *  the four seat keys, joined with the seat keys the row holds when the
 *  UPDATE runs. A stored value is kept exactly, a JSON null included, and
 *  stored metadata that is not an object contributes no keys. Use as
 *  `.set({ metadata: metadataKeepingStoredSeat(next) })`. */
export function metadataKeepingStoredSeat(next: Record<string, unknown>): SQL {
  const stored = identities.metadata;
  return sql`(${JSON.stringify(withoutHearthSeat(next))}::jsonb || (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(case when jsonb_typeof(${stored}) = 'object' then ${stored} else '{}'::jsonb end) as e where e.key in (${SEAT_KEYS_SQL})))`;
}
