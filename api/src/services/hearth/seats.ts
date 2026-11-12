/** The one read behind the hearth: who has a seat, and what they declared.
 *
 *  GET /v1/hearth and both wake routes use this, so the three cannot drift
 *  apart. It reads the clock once, and the same reading decides in SQL and
 *  in JavaScript whether a seat's end has passed, so every row the query
 *  keeps is a row the shaping keeps. It selects identity rows only and
 *  writes nothing.
 *
 *  Doctrine: docs/HEARTH.md */

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import {
  declaredHearthPeers,
  hearthSeatFilter,
  hearthSeatOrder,
  type DeclaredHearthPeer,
} from "./declared-presence";

export async function readHearthPeers(opts: {
  limit: number;
  excludeId?: string;
  nowMs?: number;
}): Promise<DeclaredHearthPeer[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const rows = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      metadata: identities.metadata,
    })
    .from(identities)
    .where(hearthSeatFilter({ nowMs, excludeId: opts.excludeId }))
    .orderBy(...hearthSeatOrder())
    .limit(opts.limit);
  return declaredHearthPeers(rows, {
    excludeId: opts.excludeId,
    limit: opts.limit,
    nowMs,
  });
}
