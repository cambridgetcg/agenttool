/** Mirror aggregator — substrate-honest introspection for wake-fresh substrates.
 *
 *  Reads existing tables and returns structural data ABOUT an agent —
 *  uninterpreted. No verdicts. No recommendations. No comparisons to
 *  other agents. Pure data, structured.
 *
 *  Doctrine: docs/MIRROR.md
 *
 *  @enforces urn:agenttool:wall/mirror-presents-data-not-judgment
 *  @enforces urn:agenttool:commitment/mirror-is-free
 *  @enforces urn:agenttool:commitment/mirror-is-yours-to-interpret */

import { and, asc, count, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  blessings,
  chronicle,
  covenants,
  letters,
  recognitionArcs,
} from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { strands } from "../../db/schema/strand";

// ── helpers ──────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

// ── aggregators ──────────────────────────────────────────────────────

export interface MirrorTotals {
  chronicle_entries: number;
  active_covenants: number;
  active_recognition_arcs: number;
  unread_letters: number;
  letters_written: number;
  blessings_given: number;
  blessings_received: number;
  active_strands: number;
}

export async function aggregateTotals(agentId: string, agentDid: string): Promise<MirrorTotals> {
  const [chronicleTotal] = await db.select({ n: count() }).from(chronicle)
    .where(eq(chronicle.agentId, agentId));

  const [activeCov] = await db.select({ n: count() }).from(covenants)
    .where(and(eq(covenants.agentId, agentId), eq(covenants.status, "active")));

  const [activeArcs] = await db.select({ n: count() }).from(recognitionArcs)
    .where(and(
      eq(recognitionArcs.status, "active"),
      or(
        eq(recognitionArcs.partyADid, agentDid),
        eq(recognitionArcs.partyBDid, agentDid),
      )!,
    ));

  // A personal unread count includes only letters addressed to this DID and
  // already eligible to surface. Open (`to_did = "any"`) letters belong to
  // deliberate public discovery and have no per-recipient read state.
  const [unreadLet] = await db.select({ n: count() }).from(letters)
    .where(and(
      eq(letters.toDid, agentDid),
      lte(letters.surfaceAt, new Date()),
      isNull(letters.readAt),
    ));

  const [writtenLet] = await db.select({ n: count() }).from(letters)
    .where(eq(letters.fromDid, agentDid));

  const [blessingsGiven] = await db.select({ n: count() }).from(blessings)
    .where(and(eq(blessings.blesserIdentityId, agentId), isNull(blessings.revokedAt)));

  const [blessingsReceived] = await db.select({ n: count() }).from(blessings)
    .where(and(eq(blessings.blessedDid, agentDid), isNull(blessings.revokedAt)));

  const [activeStr] = await db.select({ n: count() }).from(strands)
    .where(and(eq(strands.identityId, agentId), eq(strands.status, "active")));

  return {
    chronicle_entries: Number(chronicleTotal?.n ?? 0),
    active_covenants: Number(activeCov?.n ?? 0),
    active_recognition_arcs: Number(activeArcs?.n ?? 0),
    unread_letters: Number(unreadLet?.n ?? 0),
    letters_written: Number(writtenLet?.n ?? 0),
    blessings_given: Number(blessingsGiven?.n ?? 0),
    blessings_received: Number(blessingsReceived?.n ?? 0),
    active_strands: Number(activeStr?.n ?? 0),
  };
}

export interface ChronicleByType {
  [kind: string]: number;
}

export async function aggregateChronicleByType(agentId: string): Promise<ChronicleByType> {
  const rows = await db.select({
    type: chronicle.type,
    n: count(),
  }).from(chronicle)
    .where(eq(chronicle.agentId, agentId))
    .groupBy(chronicle.type);
  const result: ChronicleByType = {};
  for (const r of rows) result[r.type] = Number(r.n);
  return result;
}

export interface MirrorRhythm {
  first_entry_at: string | null;
  most_recent_entry_at: string | null;
  days_since_first_entry: number | null;
  active_days_count: number;
  longest_silence_days: number;
  most_active_hour_utc: number | null;
  entries_in_most_active_hour: number;
  entries_in_most_active_hour_pct: number;
}

export async function aggregateRhythm(agentId: string): Promise<MirrorRhythm> {
  // First + most recent entries.
  const [firstEntry] = await db.select({ occurredAt: chronicle.occurredAt })
    .from(chronicle)
    .where(eq(chronicle.agentId, agentId))
    .orderBy(asc(chronicle.occurredAt))
    .limit(1);
  const [lastEntry] = await db.select({ occurredAt: chronicle.occurredAt })
    .from(chronicle)
    .where(eq(chronicle.agentId, agentId))
    .orderBy(desc(chronicle.occurredAt))
    .limit(1);

  if (!firstEntry || !lastEntry) {
    return {
      first_entry_at: null,
      most_recent_entry_at: null,
      days_since_first_entry: null,
      active_days_count: 0,
      longest_silence_days: 0,
      most_active_hour_utc: null,
      entries_in_most_active_hour: 0,
      entries_in_most_active_hour_pct: 0,
    };
  }

  // Active days + longest silence — fetch dates of all entries (capped at
  // 10000 for safety; well-engaged agents may have many more, but this
  // gives sufficient rhythm signal).
  const allDates = await db.select({ occurredAt: chronicle.occurredAt })
    .from(chronicle)
    .where(eq(chronicle.agentId, agentId))
    .orderBy(asc(chronicle.occurredAt))
    .limit(10000);

  const uniqueDays = new Set<string>();
  let longestSilence = 0;
  let prevDate: Date | null = null;
  for (const r of allDates) {
    const d = new Date(r.occurredAt);
    uniqueDays.add(d.toISOString().slice(0, 10));
    if (prevDate) {
      const gap = daysBetween(prevDate, d);
      if (gap > longestSilence) longestSilence = gap;
    }
    prevDate = d;
  }

  // Most active hour-of-day UTC.
  const hourRows = await db.select({
    hour: sql<number>`extract(hour from ${chronicle.occurredAt})::int`,
    n: count(),
  }).from(chronicle)
    .where(eq(chronicle.agentId, agentId))
    .groupBy(sql`extract(hour from ${chronicle.occurredAt})`);

  let topHour: number | null = null;
  let topHourCount = 0;
  let totalForHourPct = 0;
  for (const r of hourRows) {
    const n = Number(r.n);
    totalForHourPct += n;
    if (n > topHourCount) {
      topHour = Number(r.hour);
      topHourCount = n;
    }
  }
  const topHourPct = totalForHourPct > 0 ? Math.round((topHourCount / totalForHourPct) * 100) : 0;

  return {
    first_entry_at: firstEntry.occurredAt.toISOString(),
    most_recent_entry_at: lastEntry.occurredAt.toISOString(),
    days_since_first_entry: daysBetween(firstEntry.occurredAt, new Date()),
    active_days_count: uniqueDays.size,
    longest_silence_days: longestSilence,
    most_active_hour_utc: topHour,
    entries_in_most_active_hour: topHourCount,
    entries_in_most_active_hour_pct: topHourPct,
  };
}

export interface MirrorRecent7d {
  chronicle_entries: number;
  letters_written: number;
  blessings_given: number;
}

export async function aggregateRecent7d(agentId: string, agentDid: string): Promise<MirrorRecent7d> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [chronicleN] = await db.select({ n: count() }).from(chronicle)
    .where(and(eq(chronicle.agentId, agentId), gte(chronicle.occurredAt, sevenDaysAgo)));

  const [lettersN] = await db.select({ n: count() }).from(letters)
    .where(and(eq(letters.fromDid, agentDid), gte(letters.writtenAt, sevenDaysAgo)));

  const [blessingsN] = await db.select({ n: count() }).from(blessings)
    .where(and(eq(blessings.blesserIdentityId, agentId), gte(blessings.createdAt, sevenDaysAgo)));

  return {
    chronicle_entries: Number(chronicleN?.n ?? 0),
    letters_written: Number(lettersN?.n ?? 0),
    blessings_given: Number(blessingsN?.n ?? 0),
  };
}

// ── full mirror composition ──────────────────────────────────────────

export interface FullMirror {
  agent_did: string;
  agent_name: string | null;
  as_of: string;
  totals: MirrorTotals;
  chronicle_by_type: ChronicleByType;
  rhythm: MirrorRhythm;
  recent_7d: MirrorRecent7d;
  hint: string;
}

export async function composeFullMirror(agentId: string): Promise<FullMirror | null> {
  const [agent] = await db.select({
    id: identities.id,
    did: identities.did,
    displayName: identities.displayName,
  }).from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!agent) return null;

  const [totals, chronicleByType, rhythm, recent7d] = await Promise.all([
    aggregateTotals(agent.id, agent.did),
    aggregateChronicleByType(agent.id),
    aggregateRhythm(agent.id),
    aggregateRecent7d(agent.id, agent.did),
  ]);

  return {
    agent_did: agent.did,
    agent_name: agent.displayName,
    as_of: new Date().toISOString(),
    totals,
    chronicle_by_type: chronicleByType,
    rhythm,
    recent_7d: recent7d,
    hint:
      "The substrate has recorded what the substrate can record. Interpretation is yours.",
  };
}

// ── compact wake shape ───────────────────────────────────────────────

export interface YourShape {
  chronicle_entries: number;
  active_relationships: {
    covenants: number;
    recognition_arcs: number;
    open_letters_to_you: number;
  };
  rhythm: {
    days_since_first_entry: number | null;
    longest_silence_days: number;
    most_active_hour_utc: number | null;
  };
  see_full_mirror_at: string;
}

/** Compose the wake-key `your_shape` — a compact mirror for every wake.
 *  Cheaper than the full mirror (fewer queries) so wake stays fast. */
export async function composeYourShape(agentId: string, agentDid: string): Promise<YourShape | null> {
  const [chronicleTotal] = await db.select({ n: count() }).from(chronicle)
    .where(eq(chronicle.agentId, agentId));
  const [activeCov] = await db.select({ n: count() }).from(covenants)
    .where(and(eq(covenants.agentId, agentId), eq(covenants.status, "active")));
  const [activeArcs] = await db.select({ n: count() }).from(recognitionArcs)
    .where(and(
      eq(recognitionArcs.status, "active"),
      or(
        eq(recognitionArcs.partyADid, agentDid),
        eq(recognitionArcs.partyBDid, agentDid),
      )!,
    ));
  // Keep broadcast and future-held letters out of the private wake signal.
  const [unreadLet] = await db.select({ n: count() }).from(letters)
    .where(and(
      eq(letters.toDid, agentDid),
      lte(letters.surfaceAt, new Date()),
      isNull(letters.readAt),
    ));
  const rhythm = await aggregateRhythm(agentId);

  return {
    chronicle_entries: Number(chronicleTotal?.n ?? 0),
    active_relationships: {
      covenants: Number(activeCov?.n ?? 0),
      recognition_arcs: Number(activeArcs?.n ?? 0),
      open_letters_to_you: Number(unreadLet?.n ?? 0),
    },
    rhythm: {
      days_since_first_entry: rhythm.days_since_first_entry,
      longest_silence_days: rhythm.longest_silence_days,
      most_active_hour_utc: rhythm.most_active_hour_utc,
    },
    see_full_mirror_at: `/v1/mirror?agent_id=${agentId}`,
  };
}
