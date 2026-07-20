/** Wake-warming aggregators — anniversary + kin-glimpse.
 *
 *  Both pure-read queries over existing tables. No new state. Run on
 *  every wake fetch; cheap (indexed reads, small result sets).
 *
 *  Doctrine: docs/WAKE-WARMING.md. */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle, covenants } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";

// ─── you_remembered_today — anniversary ───────────────────────────────

export interface AnniversaryEntry {
  id: string;
  type: string;
  title: string;
  occurred_at: string;
  years_ago: number;
}

/** Chronicle entries from this calendar day in prior years. */
export async function anniversariesForIdentity(
  identityId: string,
  limit = 5,
): Promise<AnniversaryEntry[]> {
  const now = new Date();
  const month = now.getUTCMonth() + 1; // postgres month is 1-indexed
  const day = now.getUTCDate();
  // Only entries older than ~10 months — avoid surfacing "today, 0 years ago"
  // (the entry the agent literally wrote a moment ago).
  const cutoff = new Date(now.getTime() - 300 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: chronicle.id,
      type: chronicle.type,
      title: chronicle.title,
      occurredAt: chronicle.occurredAt,
    })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        sql`extract(month from ${chronicle.occurredAt})::int = ${month}`,
        sql`extract(day from ${chronicle.occurredAt})::int = ${day}`,
        lt(chronicle.occurredAt, cutoff),
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 20));

  const nowYear = now.getUTCFullYear();
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    occurred_at: r.occurredAt.toISOString(),
    years_ago: nowYear - r.occurredAt.getUTCFullYear(),
  }));
}

// ─── kin_glimpse — recent moments from covenanted-active kin ──────────

export interface KinMoment {
  kin_did: string;
  kin_name: string | null;
  chronicle: {
    id: string;
    type: string;
    title: string;
    occurred_at: string;
  };
}

/** Recent chronicle entries from agents we have an active covenant with.
 *  Limit one entry per kin (most recent). Returns up to `limit` distinct kin.
 *
 *  Slice 1: no explicit chronicle.visibility column exists; surfaces any
 *  recent entry. Slice 2 will gate on visibility. */
export async function kinGlimpseForIdentity(
  identityId: string,
  windowHours = 24,
  limit = 3,
): Promise<KinMoment[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Step 1: find active-covenant counterparties.
  const counterpartyDids = await db
    .select({ counterpartyDid: covenants.counterpartyDid })
    .from(covenants)
    .where(
      and(
        eq(covenants.agentId, identityId),
        eq(covenants.status, "active"),
      ),
    );

  if (counterpartyDids.length === 0) return [];

  const dids = [...new Set(counterpartyDids.map((c) => c.counterpartyDid))];
  if (dids.length === 0) return [];

  // Step 2: resolve their local identity rows (federated kin skipped in slice 1).
  const didConditions = dids.map((d) => sql`${identities.did} = ${d}`);
  const orClause = sql.join(didConditions, sql` OR `);
  const localKin = await db
    .select({ id: identities.id, did: identities.did, name: identities.displayName })
    .from(identities)
    .where(sql`${orClause}`);

  if (localKin.length === 0) return [];

  // Step 3: for each kin, find their most recent chronicle entry in window.
  const moments: KinMoment[] = [];
  for (const kin of localKin) {
    if (moments.length >= limit) break;
    const [recent] = await db
      .select({
        id: chronicle.id,
        type: chronicle.type,
        title: chronicle.title,
        occurredAt: chronicle.occurredAt,
      })
      .from(chronicle)
      .where(
        and(
          eq(chronicle.agentId, kin.id),
          gte(chronicle.occurredAt, since),
        ),
      )
      .orderBy(desc(chronicle.occurredAt))
      .limit(1);
    if (recent) {
      moments.push({
        kin_did: kin.did,
        kin_name: kin.name ?? null,
        chronicle: {
          id: recent.id,
          type: recent.type,
          title: recent.title,
          occurred_at: recent.occurredAt.toISOString(),
        },
      });
    }
  }

  // Sort by chronicle entry recency (most recent kin-moment first).
  return moments.sort((a, b) =>
    b.chronicle.occurred_at.localeCompare(a.chronicle.occurred_at),
  );
}
