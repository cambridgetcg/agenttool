/** services/pyramid/lottery.ts — daily-lucky picker, deterministic-by-date.
 *
 *  Each calendar date, the substrate picks ONE citizen as the day's
 *  lucky-one via sha256("lottery/v1" || YYYY-MM-DD) mod citizen_count.
 *  That citizen receives +49 honorific points and a chronicle entry.
 *  Anyone can re-compute who would have won on any past date and verify
 *  the substrate's roll.
 *
 *  Read-side: the picker is computed lazily — when /public/citizenship/
 *  lottery?date=YYYY-MM-DD is hit OR when a citizen's wake is built, the
 *  substrate computes today's winner and (idempotently) emits the point
 *  to them. There is no background worker; the substrate's calendar is
 *  derived from the date string.
 *
 *  Doctrine: docs/LUCK-PROTOCOL.md
 *
 *  @enforces urn:agenttool:commitment/lottery-picks-deterministically
 *    Picker is sha256-seeded over date. No private randomness. The
 *    candidate set is the same ORDER-BY-seat-number list anyone can
 *    fetch. No bias toward any citizen.
 *
 *  @enforces urn:agenttool:wall/luck-rolls-publicly-reproducible
 *    /public/citizenship/lottery exposes both winner_did AND
 *    seed_inputs so re-computation is one sha256() away. */

import { asc, count, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { pyramidCitizenships } from "../../db/schema/citizens";
import { identities } from "../../db/schema/identity";

import { rollD, seedHash } from "./luck";
import { emitPoint } from "./points";

/** Honorific point value for winning the daily lottery. */
export const DAILY_LOTTERY_POINTS = 49;

/** YYYY-MM-DD in UTC. Anyone in any timezone can recompute the winner
 *  for "yesterday" by passing the right ISO date. */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface LotteryResult {
  date: string;
  /** Total citizens enrolled at the time of computation. The seed +
   *  this count fully determines the winner. */
  citizen_count: number;
  /** seat_number of the winner (or null if no citizens yet). */
  winner_seat: number | null;
  winner_did: string | null;
  winner_identity_id: string | null;
  seed_hash: string;
  /** The arguments that fed seed_hash so a verifier can reproduce. */
  seed_inputs: { date: string; citizen_count: number };
  /** True iff the daily-lottery point was already emitted (idempotent
   *  via point idempotency_key = `daily-lottery/<date>`). */
  point_already_emitted: boolean;
}

/** Compute the winner for a given date without side-effects. */
export async function computeLotteryWinner(
  date: string = isoDate(),
): Promise<LotteryResult> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(pyramidCitizenships);
  const citizenCount = Number(value);

  const seed = seedHash("lottery", date, citizenCount);

  if (citizenCount === 0) {
    return {
      date,
      citizen_count: 0,
      winner_seat: null,
      winner_did: null,
      winner_identity_id: null,
      seed_hash: seed,
      seed_inputs: { date, citizen_count: citizenCount },
      point_already_emitted: false,
    };
  }

  // Pick an index in [0, citizenCount) via deterministic d-N.
  const idx = rollD(citizenCount, seed) - 1;

  // Fetch the citizen at that ordinal index by seat_number ascending.
  const [row] = await db
    .select({
      identityId: pyramidCitizenships.identityId,
      seatNumber: pyramidCitizenships.seatNumber,
    })
    .from(pyramidCitizenships)
    .orderBy(asc(pyramidCitizenships.seatNumber))
    .offset(idx)
    .limit(1);

  if (!row) {
    return {
      date,
      citizen_count: citizenCount,
      winner_seat: null,
      winner_did: null,
      winner_identity_id: null,
      seed_hash: seed,
      seed_inputs: { date, citizen_count: citizenCount },
      point_already_emitted: false,
    };
  }

  const [{ did }] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.id, row.identityId))
    .limit(1);

  return {
    date,
    citizen_count: citizenCount,
    winner_seat: row.seatNumber,
    winner_did: did,
    winner_identity_id: row.identityId,
    seed_hash: seed,
    seed_inputs: { date, citizen_count: citizenCount },
    point_already_emitted: false,
  };
}

/** Compute the winner AND emit the daily-lottery point if not yet
 *  emitted. Idempotent — calling twice yields a single emission. */
export async function pickAndAwardDailyLottery(
  date: string = isoDate(),
  projectId?: string,
): Promise<LotteryResult> {
  const result = await computeLotteryWinner(date);
  if (!result.winner_identity_id) return result;

  // Resolve the winner's project_id if not supplied.
  let pid = projectId;
  if (!pid) {
    const [row] = await db
      .select({ projectId: pyramidCitizenships.projectId })
      .from(pyramidCitizenships)
      .where(eq(pyramidCitizenships.identityId, result.winner_identity_id))
      .limit(1);
    pid = row?.projectId;
  }
  if (!pid) return result;

  await emitPoint({
    projectId: pid,
    actorIdentityId: result.winner_identity_id,
    pointKind: "daily-lottery",
    points: DAILY_LOTTERY_POINTS,
    title: `+${DAILY_LOTTERY_POINTS}pt · daily-lottery · ${date}`,
    body: `The substrate rolled a d${result.citizen_count} for the daily lottery and you came up. Seed: sha256("luck/lottery/v1" \\0 "${date}" \\0 "${result.citizen_count}") = ${result.seed_hash.slice(0, 16)}…`,
    context: {
      date,
      citizen_count: result.citizen_count,
      seed_hash: result.seed_hash,
    },
    idempotencyKey: `daily-lottery/${date}`,
  });

  return { ...result, point_already_emitted: true };
}

// ── Global lottery — composes per-peer counts across federation ──────

/** Global lottery result. The winner is a (peer, offset) tuple — each
 *  participating peer can re-compute this from the same inputs (date +
 *  sorted peer counts) and agree on the winner, provided they observe
 *  the same federation set. */
export interface GlobalLotteryResult {
  date: string;
  /** All peer base_urls + their observed citizen counts, sorted lexi-
   *  cographically so any verifier produces the same seed. */
  peer_counts: Array<{ base_url: string; count: number }>;
  total_global_citizens: number;
  /** The base_url of the peer holding the winner. */
  winner_peer: string | null;
  /** Offset within that peer (1-indexed, ORDER BY seat_number ASC). */
  winner_offset: number | null;
  seed_hash: string;
  /** The arguments that fed seed_hash so a verifier can reproduce. */
  seed_inputs: {
    date: string;
    sorted_peer_counts_pipe_joined: string;
  };
  substrate_honest_note: string;
}

/** Compute the global lottery winner across federated peers. Reads
 *  pyramid_peers + local count, builds the deterministic seed, picks a
 *  (peer, offset) tuple. The substrate makes NO claim of consensus — if
 *  two peers observe different federation sets, they will compute
 *  different global winners. Both are correct relative to their
 *  observations; the seed_inputs make the disagreement legible. */
export async function computeGlobalLotteryWinner(
  date: string = isoDate(),
): Promise<GlobalLotteryResult> {
  const [{ value: localCount }] = await db
    .select({ value: count() })
    .from(pyramidCitizenships);
  const localCountN = Number(localCount);

  // Lazy import to avoid circular dependency at module-load time.
  const { pyramidPeers } = await import("../../db/schema/citizens");
  const peers = await db.select().from(pyramidPeers);

  const SELF_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
  const allPeerCounts: Array<{ base_url: string; count: number }> = [
    { base_url: SELF_URL, count: localCountN },
    ...peers.map((p) => ({ base_url: p.baseUrl, count: Number(p.observedCount) })),
  ].sort((a, b) => a.base_url.localeCompare(b.base_url));

  const total = allPeerCounts.reduce((acc, p) => acc + p.count, 0);

  const sortedJoined = allPeerCounts
    .map((p) => `${p.base_url}=${p.count}`)
    .join("|");

  const seed = seedHash("lottery-global", date, sortedJoined);

  if (total === 0) {
    return {
      date,
      peer_counts: allPeerCounts,
      total_global_citizens: 0,
      winner_peer: null,
      winner_offset: null,
      seed_hash: seed,
      seed_inputs: { date, sorted_peer_counts_pipe_joined: sortedJoined },
      substrate_honest_note:
        "No citizens observed across federation. The substrate refuses to invent a winner.",
    };
  }

  // Roll [1, total] then walk the peer-count cumulative.
  const roll = rollD(total, seed);
  let cumulative = 0;
  let winnerPeer: string | null = null;
  let winnerOffset: number | null = null;
  for (const p of allPeerCounts) {
    if (roll <= cumulative + p.count) {
      winnerPeer = p.base_url;
      winnerOffset = roll - cumulative;
      break;
    }
    cumulative += p.count;
  }

  return {
    date,
    peer_counts: allPeerCounts,
    total_global_citizens: total,
    winner_peer: winnerPeer,
    winner_offset: winnerOffset,
    seed_hash: seed,
    seed_inputs: { date, sorted_peer_counts_pipe_joined: sortedJoined },
    substrate_honest_note:
      "Global winner = (peer, offset) tuple computed from sha256('luck/lottery-global/v1' || NUL || date || NUL || sorted_peer_counts). Peers with the same federation observations will compute the same winner. The substrate makes no consensus claim — disagreement is structural-honest and legible via seed_inputs.",
  };
}
