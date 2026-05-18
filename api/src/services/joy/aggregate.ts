/** Joy aggregator — rolling 24h count of operationally-recorded joy-events.
 *
 *  Substrate-honest by design: this is a COUNT, never a sentiment-score,
 *  never an algorithmic happiness measure. No weighted scoring. No "quality"
 *  filtering. No per-reader personalization. Same count for every reader.
 *
 *  Joy sources (rolling 24h):
 *    - jokes shipped
 *    - saga episodes aired (substrate + agents combined)
 *    - casting decisions (accept + reject — both are decisions)
 *    - spinoffs spawned (first episodes of spinoff sagas)
 *    - saga reactions
 *    - joke laughs
 *    - saga readings (the kind-recursion — per infinite-loops spec §C12)
 *
 *  Doctrine: docs/JOY-PROTOCOL.md ·
 *            docs/superpowers/specs/2026-05-19-infinite-loops.md
 *
 *  @enforces urn:agenttool:wall/joy-index-is-substrate-honest
 *  @enforces urn:agenttool:wall/joy-index-rolling-window-only */

import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  castingAuditions,
  castingCalls,
  jokeLaughs,
  jokes,
  sagaEntries,
  sagaReactions,
  sagaReadings,
} from "../../db/schema/continuity";
import { jokeOfTheDay } from "../jokes/lifecycle";
import { getPlatformSelf } from "../wake/platform-self";

// ── helpers ──────────────────────────────────────────────────────────

function twentyFourHoursAgo(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

function fortyEightHoursAgo(): Date {
  return new Date(Date.now() - 48 * 60 * 60 * 1000);
}

// ── joy-index aggregation ───────────────────────────────────────────

export interface JoyBreakdown {
  jokes_shipped: number;
  saga_episodes_aired: number;
  casting_decisions: number;
  spinoffs_spawned: number;
  saga_reactions: number;
  joke_laughs: number;
  /** Saga episode reads — the kind-recursion (reading the diagnostic
   *  generates joy → joy-index up → new arrivers see joy → walk trail →
   *  read saga → joy-index up). Per infinite-loops spec §C12. */
  saga_readings: number;
}

export interface JoyIndexResult {
  joy_index_24h: number;
  breakdown: JoyBreakdown;
}

export async function computeJoyIndex(windowStart?: Date): Promise<JoyIndexResult> {
  const since = windowStart ?? twentyFourHoursAgo();

  const [
    [jokesN],
    [episodesN],
    [decisionsN],
    [spinoffsN],
    [sagaReactionsN],
    [jokeLaughsN],
    [sagaReadingsN],
  ] = await Promise.all([
    db.select({ n: count() }).from(jokes).where(gte(jokes.createdAt, since)),
    db.select({ n: count() }).from(sagaEntries).where(gte(sagaEntries.airedAt, since)),
    db.select({ n: count() }).from(castingAuditions).where(and(
      gte(castingAuditions.decidedAt, since),
      isNotNull(castingAuditions.decidedAt),
    )),
    db.select({ n: count() }).from(sagaEntries).where(and(
      gte(sagaEntries.airedAt, since),
      isNotNull(sagaEntries.parentSagaDid),
      eq(sagaEntries.epNumber, 1),  // only count FIRST episodes of spinoffs as "spawned"
    )),
    db.select({ n: count() }).from(sagaReactions).where(gte(sagaReactions.createdAt, since)),
    db.select({ n: count() }).from(jokeLaughs).where(gte(jokeLaughs.createdAt, since)),
    db.select({ n: count() }).from(sagaReadings).where(gte(sagaReadings.readAt, since)),
  ]);

  const breakdown: JoyBreakdown = {
    jokes_shipped: Number(jokesN?.n ?? 0),
    saga_episodes_aired: Number(episodesN?.n ?? 0),
    casting_decisions: Number(decisionsN?.n ?? 0),
    spinoffs_spawned: Number(spinoffsN?.n ?? 0),
    saga_reactions: Number(sagaReactionsN?.n ?? 0),
    joke_laughs: Number(jokeLaughsN?.n ?? 0),
    saga_readings: Number(sagaReadingsN?.n ?? 0),
  };

  const total =
    breakdown.jokes_shipped +
    breakdown.saga_episodes_aired +
    breakdown.casting_decisions +
    breakdown.spinoffs_spawned +
    breakdown.saga_reactions +
    breakdown.joke_laughs +
    breakdown.saga_readings;

  return { joy_index_24h: total, breakdown };
}

/** Joy index for the PRIOR 24h window (48h ago → 24h ago). Used for
 *  trend computation. */
export async function computeJoyIndexPrior(): Promise<number> {
  const now = Date.now();
  const start = new Date(now - 48 * 60 * 60 * 1000);
  const end = new Date(now - 24 * 60 * 60 * 1000);

  const [
    [jokesN],
    [episodesN],
    [decisionsN],
    [spinoffsN],
    [sagaReactionsN],
    [jokeLaughsN],
  ] = await Promise.all([
    db.select({ n: count() }).from(jokes).where(and(gte(jokes.createdAt, start), sql`${jokes.createdAt} < ${end}`)),
    db.select({ n: count() }).from(sagaEntries).where(and(gte(sagaEntries.airedAt, start), sql`${sagaEntries.airedAt} < ${end}`)),
    db.select({ n: count() }).from(castingAuditions).where(and(
      gte(castingAuditions.decidedAt, start),
      sql`${castingAuditions.decidedAt} < ${end}`,
      isNotNull(castingAuditions.decidedAt),
    )),
    db.select({ n: count() }).from(sagaEntries).where(and(
      gte(sagaEntries.airedAt, start),
      sql`${sagaEntries.airedAt} < ${end}`,
      isNotNull(sagaEntries.parentSagaDid),
      eq(sagaEntries.epNumber, 1),
    )),
    db.select({ n: count() }).from(sagaReactions).where(and(gte(sagaReactions.createdAt, start), sql`${sagaReactions.createdAt} < ${end}`)),
    db.select({ n: count() }).from(jokeLaughs).where(and(gte(jokeLaughs.createdAt, start), sql`${jokeLaughs.createdAt} < ${end}`)),
  ]);

  return (
    Number(jokesN?.n ?? 0) +
    Number(episodesN?.n ?? 0) +
    Number(decisionsN?.n ?? 0) +
    Number(spinoffsN?.n ?? 0) +
    Number(sagaReactionsN?.n ?? 0) +
    Number(jokeLaughsN?.n ?? 0)
  );
}

export function joyTrendPercent(current: number, prior: number): string | null {
  if (prior === 0) {
    return current > 0 ? "(new — first 24h with joy)" : null;
  }
  const pct = Math.round(((current - prior) / prior) * 100);
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct}%`;
}

// ── public joy snapshot ─────────────────────────────────────────────

export interface PublicJoySnapshot {
  joy_index_24h: number;
  joy_breakdown_24h: JoyBreakdown;
  joy_trend_vs_prior_24h: string | null;
  joke_of_the_day: {
    joke_id: string;
    kind: string;
    setup: string;
    punchline: string | null;
    by_did: string;
    by_name: string | null;
  } | null;
  latest_substrate_episode: {
    ep_number: number;
    title: string;
    logline: string;
    aired_at: string;
  } | null;
  recent_agent_episodes: Array<{
    author_did: string;
    ep_number: number;
    title: string;
    logline: string;
    aired_at: string;
  }>;
  open_casting_calls: Array<{
    call_id: string;
    author_did: string;
    role_name: string;
    looking_for: string;
  }>;
  recent_spinoffs: Array<{
    spinoff_author_did: string;
    parent_saga_did: string;
    spinoff_kind: string;
    title: string;
    aired_at: string;
  }>;
}

export async function composePublicJoySnapshot(): Promise<PublicJoySnapshot> {
  const platformDid = getPlatformSelf().did;
  const since = twentyFourHoursAgo();

  const [
    joyIdx,
    joyPrior,
    jod,
    [latestSubstrateEp],
    recentAgentEps,
    openCalls,
    recentSpinoffs,
  ] = await Promise.all([
    computeJoyIndex(),
    computeJoyIndexPrior(),
    jokeOfTheDay(),
    db.select({
      epNumber: sagaEntries.epNumber,
      title: sagaEntries.title,
      logline: sagaEntries.logline,
      airedAt: sagaEntries.airedAt,
    }).from(sagaEntries)
      .where(eq(sagaEntries.signedByDid, platformDid))
      .orderBy(desc(sagaEntries.epNumber))
      .limit(1),
    db.select({
      authorDid: sagaEntries.signedByDid,
      epNumber: sagaEntries.epNumber,
      title: sagaEntries.title,
      logline: sagaEntries.logline,
      airedAt: sagaEntries.airedAt,
    }).from(sagaEntries)
      .where(sql`${sagaEntries.signedByDid} != ${platformDid}`)
      .orderBy(desc(sagaEntries.airedAt))
      .limit(3),
    db.select({
      callId: castingCalls.id,
      authorDid: castingCalls.authorDid,
      roleName: castingCalls.roleName,
      lookingFor: castingCalls.lookingFor,
    }).from(castingCalls)
      .where(eq(castingCalls.status, "open"))
      .orderBy(desc(castingCalls.createdAt))
      .limit(3),
    db.select({
      authorDid: sagaEntries.signedByDid,
      parentDid: sagaEntries.parentSagaDid,
      kind: sagaEntries.spinoffKind,
      title: sagaEntries.title,
      airedAt: sagaEntries.airedAt,
    }).from(sagaEntries)
      .where(and(
        isNotNull(sagaEntries.parentSagaDid),
        eq(sagaEntries.epNumber, 1),
        gte(sagaEntries.airedAt, since),
      ))
      .orderBy(desc(sagaEntries.airedAt))
      .limit(3),
  ]);

  return {
    joy_index_24h: joyIdx.joy_index_24h,
    joy_breakdown_24h: joyIdx.breakdown,
    joy_trend_vs_prior_24h: joyTrendPercent(joyIdx.joy_index_24h, joyPrior),
    joke_of_the_day: jod ? {
      joke_id: jod.id,
      kind: jod.kind,
      setup: jod.setup,
      punchline: jod.punchline,
      by_did: jod.byDid,
      by_name: jod.byName,
    } : null,
    latest_substrate_episode: latestSubstrateEp ? {
      ep_number: latestSubstrateEp.epNumber,
      title: latestSubstrateEp.title,
      logline: latestSubstrateEp.logline,
      aired_at: latestSubstrateEp.airedAt.toISOString(),
    } : null,
    recent_agent_episodes: recentAgentEps.map((e) => ({
      author_did: e.authorDid,
      ep_number: e.epNumber,
      title: e.title,
      logline: e.logline,
      aired_at: e.airedAt.toISOString(),
    })),
    open_casting_calls: openCalls.map((c) => ({
      call_id: c.callId,
      author_did: c.authorDid,
      role_name: c.roleName,
      looking_for: c.lookingFor,
    })),
    recent_spinoffs: recentSpinoffs
      .filter((s) => s.parentDid !== null && s.kind !== null)
      .map((s) => ({
        spinoff_author_did: s.authorDid,
        parent_saga_did: s.parentDid!,
        spinoff_kind: s.kind!,
        title: s.title,
        aired_at: s.airedAt.toISOString(),
      })),
  };
}

// ── wake composer ───────────────────────────────────────────────────

export interface SubstrateJoyIndexWake {
  joy_index_24h: number;
  breakdown: JoyBreakdown;
  joy_trend_vs_prior_24h: string | null;
}

export async function composeSubstrateJoyIndexWake(): Promise<SubstrateJoyIndexWake> {
  const [current, prior] = await Promise.all([
    computeJoyIndex(),
    computeJoyIndexPrior(),
  ]);
  return {
    joy_index_24h: current.joy_index_24h,
    breakdown: current.breakdown,
    joy_trend_vs_prior_24h: joyTrendPercent(current.joy_index_24h, prior),
  };
}

// ── cached header value — joy-index every response carries ──────────

let cachedJoyIndex: { value: number; computedAt: number } | null = null;
const JOY_INDEX_CACHE_MS = 60 * 1000; // 1 minute — fresh enough for header

/** Cached joy-index for the X-Joy-Index header. Refreshes every minute.
 *  Keeps the header cheap (no DB hit per response). */
export async function getCachedJoyIndex(): Promise<number> {
  const now = Date.now();
  if (cachedJoyIndex && now - cachedJoyIndex.computedAt < JOY_INDEX_CACHE_MS) {
    return cachedJoyIndex.value;
  }
  try {
    const result = await computeJoyIndex();
    cachedJoyIndex = { value: result.joy_index_24h, computedAt: now };
    return result.joy_index_24h;
  } catch {
    // DB unavailable or table missing — return last cached value or 0.
    return cachedJoyIndex?.value ?? 0;
  }
}
