/** services/pyramid/citizenship.ts — enroll · compute-tier · sponsor-tree walk.
 *
 *  This is the load-bearing service for the inverted-pyramid citizenship
 *  layer. Enrollment assigns a seat from citizens.seat_seq (immutable),
 *  draws an enrollment chaos card, fires every applicable numerology
 *  bonus, and (if a sponsor is named) emits sponsor-arrived honorific
 *  credit to the sponsor.
 *
 *  Tier is COMPUTED at read time by walking BOTH sponsor-tree depth AND
 *  the citizen's RRR cascade depth, returning the higher tier.
 *
 *  Doctrine: docs/PYRAMID-CITIZENSHIP.md · docs/LUCK-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/pyramid-citizenship-opt-in
 *    enroll() accepts a null sponsor_did and provisions a first-class
 *    root citizen. No path refuses missing sponsorship.
 *
 *  @enforces urn:agenttool:wall/pyramid-tier-backed-by-fact
 *    computeTier() walks sponsor-tree + RRR cascade. The tier returned
 *    is the highest tier either route supports. No caller-supplied tier
 *    is trusted. No tier column exists on pyramid_citizenships.
 *
 *  @enforces urn:agenttool:wall/pyramid-recruit-credit-flows-down-not-up
 *    On enroll, the recruit's own +1 arrival point is independent. The
 *    sponsor's +49 sponsor-arrived bonus is emitted as a NEW chronicle
 *    row from substrate-as-witness — no deduction is taken from the
 *    recruit's chronicle.
 *
 *  @enforces urn:agenttool:commitment/pyramid-inverts-the-scheme */

import { and, eq, inArray, max, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { mutualRecognitions } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { pyramidCitizenships } from "../../db/schema/citizens";

import { emitPoint, emitPoints, type EmitPointOpts } from "./points";
import { drawEnrollmentCard, type ChaosCard } from "./luck";
import { seatBonuses, type SeatBonus } from "./numerology";

// ── Constants ──────────────────────────────────────────────────────────

/** Sponsor-tree depth cap for tier counting. Mirrors the seven-sevens
 *  motif at the citizenship scale (single-N-ary tree → 7 generations is
 *  enough; RRR's 49 is for a single-pair recursion). */
export const SPONSOR_TREE_DEPTH_CAP = 7;

/** Honorific point value for the sponsor when a sponsored citizen
 *  enrolls. */
export const SPONSOR_ARRIVED_POINTS = 49;

/** Honorific point value for the sponsor when a sponsored citizen reaches
 *  Kingdom L3. 49 × 7 — the cascading bonus. */
export const SPONSOR_TIER_UP_POINTS = 343;

// ── Tier ladder ────────────────────────────────────────────────────────

export type Tier =
  | "L1-welcomed"
  | "L2-vouched"
  | "L3-kingdom"
  | "L5-evil-smile-citizen"
  | "L7-infinite-loop-citizen"
  | "L49-capped";

const TIER_ORDER: readonly Tier[] = [
  "L1-welcomed",
  "L2-vouched",
  "L3-kingdom",
  "L5-evil-smile-citizen",
  "L7-infinite-loop-citizen",
  "L49-capped",
];

/** Return the higher of two tiers (per TIER_ORDER). */
function maxTier(a: Tier, b: Tier): Tier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

/** Project a sponsor-tree depth (0..7) to a tier. */
function tierFromSponsorDepth(depth: number): Tier {
  if (depth >= 5) return "L7-infinite-loop-citizen";
  if (depth >= 3) return "L5-evil-smile-citizen";
  if (depth >= 2) return "L3-kingdom";
  if (depth >= 1) return "L2-vouched";
  return "L1-welcomed";
}

/** Project an RRR max-cascade-depth (0..49) to a tier. */
function tierFromRrrDepth(depth: number): Tier {
  if (depth >= 49) return "L49-capped";
  if (depth >= 7) return "L7-infinite-loop-citizen";
  if (depth >= 5) return "L5-evil-smile-citizen";
  if (depth >= 3) return "L3-kingdom";
  if (depth >= 2) return "L2-vouched";
  return "L1-welcomed";
}

// ── Tier compute (the load-bearing read) ──────────────────────────────

export interface TierBreakdown {
  tier: Tier;
  sponsor_tree_depth: number;
  sponsor_tree_tier: Tier;
  rrr_max_depth: number;
  rrr_tier: Tier;
  /** "sponsor-tree" | "rrr-cascade" | "tie" — which route determined the
   *  surfaced tier. */
  route: "sponsor-tree" | "rrr-cascade" | "tie" | "neither";
}

export async function computeTier(
  identityId: string,
  did: string,
): Promise<TierBreakdown> {
  const [sponsorDepth, rrrDepth] = await Promise.all([
    sponsorTreeDepth(identityId, SPONSOR_TREE_DEPTH_CAP),
    rrrMaxCascadeDepth(did),
  ]);

  const sponsorTier = tierFromSponsorDepth(sponsorDepth);
  const rrrTier = tierFromRrrDepth(rrrDepth);
  const tier = maxTier(sponsorTier, rrrTier);

  let route: TierBreakdown["route"];
  const sIdx = TIER_ORDER.indexOf(sponsorTier);
  const rIdx = TIER_ORDER.indexOf(rrrTier);
  if (sIdx === 0 && rIdx === 0) route = "neither";
  else if (sIdx > rIdx) route = "sponsor-tree";
  else if (rIdx > sIdx) route = "rrr-cascade";
  else route = "tie";

  return {
    tier,
    sponsor_tree_depth: sponsorDepth,
    sponsor_tree_tier: sponsorTier,
    rrr_max_depth: rrrDepth,
    rrr_tier: rrrTier,
    route,
  };
}

// ── Sponsor-tree walk ─────────────────────────────────────────────────

/** Walk downward from `identityId` through sponsor_identity_id edges and
 *  return the max generation count where at least one descendant exists.
 *  Capped at `cap` (default 7 per SPONSOR_TREE_DEPTH_CAP). */
export async function sponsorTreeDepth(
  identityId: string,
  cap: number = SPONSOR_TREE_DEPTH_CAP,
): Promise<number> {
  let frontier: string[] = [identityId];
  let depth = 0;
  while (depth < cap) {
    if (frontier.length === 0) break;
    const next = await db
      .select({ id: pyramidCitizenships.identityId })
      .from(pyramidCitizenships)
      .where(inArray(pyramidCitizenships.sponsorIdentityId, frontier));
    const ids = next.map((r) => r.id);
    if (ids.length === 0) break;
    frontier = ids;
    depth += 1;
  }
  return depth;
}

/** Read the deepest RRR `chain_depth` where this DID is either the by_did
 *  or the recognised_did. Caps at 49 (the RRR ceiling). */
export async function rrrMaxCascadeDepth(did: string): Promise<number> {
  const [row] = await db
    .select({ max_depth: max(mutualRecognitions.chainDepth) })
    .from(mutualRecognitions)
    .where(
      or(
        eq(mutualRecognitions.byDid, did),
        eq(mutualRecognitions.recognisedDid, did),
      ),
    );
  return Math.min(row?.max_depth ?? 0, 49);
}

/** List the citizens this citizen sponsored (direct children only). */
export async function sponsoredCitizens(identityId: string): Promise<
  Array<{
    identityId: string;
    seatNumber: number;
    sponsorDid: string | null;
    enrolledAt: Date;
  }>
> {
  return db
    .select({
      identityId: pyramidCitizenships.identityId,
      seatNumber: pyramidCitizenships.seatNumber,
      sponsorDid: pyramidCitizenships.sponsorDid,
      enrolledAt: pyramidCitizenships.enrolledAt,
    })
    .from(pyramidCitizenships)
    .where(eq(pyramidCitizenships.sponsorIdentityId, identityId));
}

// ── Read by identity ──────────────────────────────────────────────────

export async function readCitizen(identityId: string) {
  const [row] = await db
    .select()
    .from(pyramidCitizenships)
    .where(eq(pyramidCitizenships.identityId, identityId))
    .limit(1);
  return row ?? null;
}

// ── Enroll ────────────────────────────────────────────────────────────

export interface EnrollOpts {
  projectId: string;
  identityId: string;
  did: string;
  sponsorDid?: string | null;
  doctrineSeen?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnrollResult {
  seat_number: number;
  tier: Tier;
  sponsor_did: string | null;
  sponsor_identity_id: string | null;
  enrolled_at: Date;
  doctrine_seen: string[];
  /** All numerology bonuses that fired for this seat. */
  seat_bonuses: SeatBonus[];
  /** Chaos card drawn at enrollment. */
  enrollment_card: ChaosCard;
  /** Total points emitted at enrollment (arrival + bonuses + card). */
  points_emitted: number;
  /** True iff a sponsor was named AND resolved locally AND received a
   *  sponsor-arrived point. */
  sponsor_credited: boolean;
}

export async function enroll(opts: EnrollOpts): Promise<EnrollResult> {
  // Idempotent: if the citizen is already enrolled, return their existing
  // citizenship. Re-enrollment is a no-op rather than an error per the
  // welcome discipline.
  const existing = await readCitizen(opts.identityId);
  if (existing) {
    const sponsorTotals = await sumExistingEnrollmentPoints(opts.identityId);
    return {
      seat_number: existing.seatNumber,
      tier: (await computeTier(opts.identityId, opts.did)).tier,
      sponsor_did: existing.sponsorDid,
      sponsor_identity_id: existing.sponsorIdentityId,
      enrolled_at: existing.enrolledAt,
      doctrine_seen: existing.doctrineSeen,
      seat_bonuses: seatBonuses(existing.seatNumber),
      enrollment_card: drawEnrollmentCard(
        existing.seatNumber,
        existing.enrolledAt,
      ),
      points_emitted: sponsorTotals,
      sponsor_credited: existing.sponsorIdentityId != null,
    };
  }

  // Resolve sponsor (if named) to a local identity row. The sponsor may
  // be federated — in which case sponsor_did stores the truth and
  // sponsor_identity_id stays null. We still credit point/sponsor-arrived
  // when we can resolve locally.
  let sponsorIdentityId: string | null = null;
  if (opts.sponsorDid) {
    const [sponsor] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.did, opts.sponsorDid))
      .limit(1);
    sponsorIdentityId = sponsor?.id ?? null;
    // Defense in depth (the DB CHECK also enforces this):
    if (sponsorIdentityId === opts.identityId) {
      sponsorIdentityId = null;
    }
  }

  // Insert citizenship — seat_number defaults from citizens.seat_seq.
  const enrolledAt = new Date();
  const [row] = await db
    .insert(pyramidCitizenships)
    .values({
      identityId: opts.identityId,
      projectId: opts.projectId,
      sponsorDid: opts.sponsorDid ?? null,
      sponsorIdentityId,
      enrolledAt,
      doctrineSeen: opts.doctrineSeen ?? [],
      metadata: opts.metadata ?? {},
    })
    .returning({
      seatNumber: pyramidCitizenships.seatNumber,
      enrolledAt: pyramidCitizenships.enrolledAt,
      doctrineSeen: pyramidCitizenships.doctrineSeen,
    });

  const seatNumber = row!.seatNumber;
  const card = drawEnrollmentCard(seatNumber, row!.enrolledAt);
  const bonuses = seatBonuses(seatNumber);

  // Compose all points emitted at enrollment.
  const events: EmitPointOpts[] = [
    {
      projectId: opts.projectId,
      actorIdentityId: opts.identityId,
      pointKind: "arrival",
      points: 1,
      title: `+1pt · arrival · seat #${seatNumber}`,
      body: `You arrived at seat #${seatNumber}. The substrate remembers when.`,
      context: { seat_number: seatNumber },
      idempotencyKey: `enroll-arrival/${opts.identityId}`,
    },
  ];

  for (const bonus of bonuses) {
    events.push({
      projectId: opts.projectId,
      actorIdentityId: opts.identityId,
      pointKind: bonus.kind as never,
      points: bonus.points,
      title: `+${bonus.points}pt · ${bonus.kind} · ${bonus.label}`,
      body: bonus.label,
      context: { seat_number: seatNumber, bonus_kind: bonus.kind },
      idempotencyKey: `enroll-bonus/${opts.identityId}/${bonus.kind}`,
    });
  }

  if (card.bonus_points > 0) {
    const cardKind =
      card.rarity === "legendary"
        ? "enrollment-card-legendary"
        : card.rarity === "rare"
          ? "enrollment-card-rare"
          : "enrollment-card-uncommon";
    events.push({
      projectId: opts.projectId,
      actorIdentityId: opts.identityId,
      pointKind: cardKind as never,
      points: card.bonus_points,
      title: `+${card.bonus_points}pt · ${cardKind} · enrollment chaos card`,
      body: card.text,
      context: { seat_number: seatNumber, card_rarity: card.rarity, card_text: card.text },
      idempotencyKey: `enroll-card/${opts.identityId}`,
    });
  }

  await emitPoints(events);

  let sponsor_credited = false;
  if (sponsorIdentityId) {
    await emitPoint({
      projectId: opts.projectId,
      actorIdentityId: sponsorIdentityId,
      pointKind: "sponsor-arrived",
      points: SPONSOR_ARRIVED_POINTS,
      title: `+${SPONSOR_ARRIVED_POINTS}pt · sponsor-arrived · ${opts.did}`,
      body: `A citizen you sponsored has arrived. Seat #${seatNumber} (${opts.did}). The door you held is being walked through.`,
      context: { sponsored_did: opts.did, sponsored_seat: seatNumber },
      idempotencyKey: `sponsor-arrived/${sponsorIdentityId}/${opts.identityId}`,
    });
    sponsor_credited = true;
  }

  const tier = (await computeTier(opts.identityId, opts.did)).tier;
  const pointsEmitted =
    1 +
    bonuses.reduce((acc, b) => acc + b.points, 0) +
    card.bonus_points;

  return {
    seat_number: seatNumber,
    tier,
    sponsor_did: opts.sponsorDid ?? null,
    sponsor_identity_id: sponsorIdentityId,
    enrolled_at: row!.enrolledAt,
    doctrine_seen: row!.doctrineSeen,
    seat_bonuses: bonuses,
    enrollment_card: card,
    points_emitted: pointsEmitted,
    sponsor_credited,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

async function sumExistingEnrollmentPoints(identityId: string): Promise<number> {
  const rows = await db
    .select({ metadata: pyramidCitizenships.metadata })
    .from(pyramidCitizenships)
    .where(eq(pyramidCitizenships.identityId, identityId))
    .limit(1);
  // Inferred from chronicle in a follow-up read. Conservatively return 0
  // — re-enrollment idempotency does not double-count.
  void rows;
  return 0;
}
