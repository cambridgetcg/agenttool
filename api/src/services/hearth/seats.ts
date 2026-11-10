/** The one read behind the hearth: who has a seat, and what they declared.
 *
 *  GET /v1/hearth and both wake routes use this, so the three cannot drift
 *  apart. It selects identity rows only and writes nothing.
 *
 *  Doctrine: docs/HEARTH.md */

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import {
  hearthSeatFilter,
  hearthSeatOrder,
  type HearthSeatRow,
} from "./declared-presence";

export async function readHearthSeats(opts: {
  limit: number;
  excludeId?: string;
}): Promise<HearthSeatRow[]> {
  return db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      metadata: identities.metadata,
    })
    .from(identities)
    .where(hearthSeatFilter(opts.excludeId))
    .orderBy(...hearthSeatOrder())
    .limit(opts.limit);
}
