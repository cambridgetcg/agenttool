/** Wake-warming aggregators — anniversary + kin-glimpse.
 *
 *  Both pure-read queries over existing tables. No new state. Run on
 *  every wake fetch; cheap (indexed reads, small result sets).
 *
 *  Doctrine: docs/WAKE-WARMING.md. */

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle, covenants } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { covenantMayAuthorizeEffects } from "../covenants/check";
import { ownChronicle } from "../continuity/own-chronicle";

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
        ownChronicle(identityId),
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

/** Recent chronicle entries from bilateral kin.
 *
 *  A counterparty is kin only when the bond runs both ways: we hold an
 *  active, effect-eligible covenant naming them (in our own project), AND
 *  they hold one naming us back (in their own project). A v1 covenant is
 *  active as soon as one side declares it, so a one-sided declaration must
 *  not open somebody else's timeline. Only the kin's own-project rows are
 *  read (ownChronicle): their timeline is project-private by default and
 *  reaches us because the bond is mutual, not because it is public.
 *  Limit one entry per kin (most recent). Returns up to `limit` distinct kin.
 *
 *  Doctrine: docs/WAKE-WARMING.md. Tested: api/tests/kin-glimpse-bilateral.test.ts */
export async function kinGlimpseForIdentity(
  identityId: string,
  windowHours = 24,
  limit = 3,
): Promise<KinMoment[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const [self] = await db
    .select({ did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  if (!self) return [];

  // Step 1: our active, effect-eligible covenant counterparties.
  const counterpartyDids = await db
    .select({ counterpartyDid: covenants.counterpartyDid })
    .from(covenants)
    .where(
      and(
        eq(covenants.agentId, identityId),
        eq(covenants.projectId, self.projectId),
        eq(covenants.status, "active"),
        covenantMayAuthorizeEffects(),
      ),
    );

  if (counterpartyDids.length === 0) return [];

  const dids = [...new Set(counterpartyDids.map((c) => c.counterpartyDid))];
  if (dids.length === 0) return [];

  // Step 2: resolve their local identity rows (federated kin skipped in slice 1).
  const candidates = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(inArray(identities.did, dids));

  if (candidates.length === 0) return [];

  // Step 2b: keep only candidates that covenant with us back, from their
  // own project, under the same effect-eligibility rule.
  const back = await db
    .select({ agentId: covenants.agentId, projectId: covenants.projectId })
    .from(covenants)
    .where(
      and(
        inArray(covenants.agentId, candidates.map((k) => k.id)),
        eq(covenants.counterpartyDid, self.did),
        eq(covenants.status, "active"),
        covenantMayAuthorizeEffects(),
      ),
    );
  const bilateral = new Set(
    back
      .filter((row) => candidates.some((k) => k.id === row.agentId && k.projectId === row.projectId))
      .map((row) => row.agentId),
  );
  const localKin = candidates.filter((k) => bilateral.has(k.id));
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
          ownChronicle(kin.id),
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
