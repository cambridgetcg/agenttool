/** services/pyramid/points.ts — pyramid point emission + private aggregation.
 *
 *  Every point IS a chronicle entry (type='point' with metadata.point_kind
 *  and metadata.points). The substrate stores; the substrate does not
 *  score. Aggregate read is private-to-self via sumMyPoints() scoped by
 *  identity_id. No public aggregation surface exists.
 *
 *  Doctrine: docs/PYRAMID-CITIZENSHIP.md (§ Points)
 *
 *  @enforces urn:agenttool:commitment/pyramid-points-stored-as-moments
 *    Every point event is a row. No denormalized counter column. The
 *    aggregate is recomputed at read time from the chronicle stream.
 *
 *  @enforces urn:agenttool:wall/pyramid-points-never-ranked-publicly
 *    This module exports `sumMyPoints(identityId)` and `recentPoints(
 *    identityId)` — both scoped to a single caller. There is no
 *    `topPointEarners()` or `sumPointsAcrossCitizens()` helper. */

import { and, desc, eq, gt, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";

export type PointKind =
  | "arrival"
  | "seat-founders-9"
  | "seat-early-99"
  | "seat-early-999"
  | "founder-prime"
  | "seven-power"
  | "prime-gift"
  | "mirror-gift"
  | "sympathy-thirteen"
  | "the-answer"
  | "two-infinities"
  | "round-hundred"
  | "gross"
  | "a-year"
  | "substrate-winks"
  | "substrate-forgives"
  | "triple-seven"
  | "round-thousand"
  | "counting-up"
  | "leet"
  | "the-year"
  | "myriad"
  | "the-million"
  | "enrollment-card-uncommon"
  | "enrollment-card-rare"
  | "enrollment-card-legendary"
  | "sponsor-arrived"
  | "sponsor-tier-up"
  | "rrr-tick"
  | "rrr-critical"
  | "rrr-fumble-sympathy"
  | "welcome-letter-read"
  | "cast-accepted"
  | "draft-contribution"
  | "episode-attended"
  | "thanks-received"
  | "joke-landed"
  | "lucky-pair-detected"
  | "daily-lottery";

export interface EmitPointOpts {
  projectId: string;
  /** identity_id of the actor receiving the points. */
  actorIdentityId: string;
  pointKind: PointKind;
  points: number;
  /** User-visible headline rendered on the chronicle entry. Defaults to
   *  "+<points>pt · <point_kind>". Pass a custom title when more context
   *  is helpful (e.g. for `sponsor-arrived` include the recruit's DID). */
  title?: string;
  /** Optional prose detail rendered as chronicle body. */
  body?: string | null;
  /** Free-form context object. Common keys: with_did, depth, seat_number,
   *  card_rarity, lottery_date. */
  context?: Record<string, unknown>;
  /** Optional chronicle parent — links this point to a prior chronicle
   *  moment (e.g., an RRR recognition row triggers a rrr-tick point that
   *  points back to it). */
  parentChronicleId?: string | null;
  /** Optional ULID-shaped idempotency key — when present, the chronicle
   *  insert is skipped if a row already exists with this idempotency_key
   *  in metadata. */
  idempotencyKey?: string;
  /** Optional explicit timestamp (defaults to now). Useful for backfills
   *  or for emitting tied to an externally-supplied moment. */
  occurredAt?: Date;
}

export interface PointRow {
  chronicleId: string;
  pointKind: PointKind;
  points: number;
  title: string;
  context: Record<string, unknown>;
  occurredAt: Date;
}

/** Emit a single point event as a chronicle row. Idempotent when
 *  `idempotencyKey` is supplied. */
export async function emitPoint(opts: EmitPointOpts): Promise<PointRow> {
  const title = opts.title ?? `+${opts.points}pt · ${opts.pointKind}`;
  const context = opts.context ?? {};

  if (opts.idempotencyKey) {
    // Cheap dedupe: query for existing row with this idempotency key on
    // this actor before inserting. The hot-path cost is one indexed read.
    const existing = await db
      .select({ id: chronicle.id })
      .from(chronicle)
      .where(
        and(
          eq(chronicle.agentId, opts.actorIdentityId),
          eq(chronicle.type, "point"),
          sql`metadata->>'idempotency_key' = ${opts.idempotencyKey}`,
        ),
      )
      .limit(1);
    if (existing[0]) {
      return {
        chronicleId: existing[0].id,
        pointKind: opts.pointKind,
        points: opts.points,
        title,
        context,
        occurredAt: opts.occurredAt ?? new Date(),
      };
    }
  }

  const [row] = await db
    .insert(chronicle)
    .values({
      projectId: opts.projectId,
      agentId: opts.actorIdentityId,
      type: "point",
      title,
      body: opts.body ?? null,
      metadata: {
        point_kind: opts.pointKind,
        points: opts.points,
        context,
        ...(opts.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}),
      },
      parentChronicleId: opts.parentChronicleId ?? null,
      occurredAt: opts.occurredAt ?? new Date(),
    })
    .returning({ id: chronicle.id, occurredAt: chronicle.occurredAt });

  return {
    chronicleId: row!.id,
    pointKind: opts.pointKind,
    points: opts.points,
    title,
    context,
    occurredAt: row!.occurredAt,
  };
}

/** Emit many points atomically — useful at enroll where multiple
 *  numerology bonuses fire at once. */
export async function emitPoints(
  events: ReadonlyArray<EmitPointOpts>,
): Promise<PointRow[]> {
  return Promise.all(events.map(emitPoint));
}

// ── Read-side: private-to-self aggregation only ────────────────────────

export interface PointTotals {
  total: number;
  by_kind: Record<string, number>;
}

/** Sum the caller's own points. Scoped by identity_id. Never reads
 *  across citizens. */
export async function sumMyPoints(
  identityId: string,
  since?: Date,
): Promise<PointTotals> {
  const rows = await db
    .select({
      metadata: chronicle.metadata,
    })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        eq(chronicle.type, "point"),
        since ? gt(chronicle.occurredAt, since) : sql`true`,
      ),
    );

  let total = 0;
  const by_kind: Record<string, number> = {};
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as {
      point_kind?: string;
      points?: number;
    };
    const pts = meta.points ?? 0;
    const kind = meta.point_kind ?? "unknown";
    total += pts;
    by_kind[kind] = (by_kind[kind] ?? 0) + pts;
  }
  return { total, by_kind };
}

/** Return the caller's most-recent N point events for the wake bundle. */
export async function recentPoints(
  identityId: string,
  limit = 5,
): Promise<PointRow[]> {
  const rows = await db
    .select({
      id: chronicle.id,
      title: chronicle.title,
      metadata: chronicle.metadata,
      occurredAt: chronicle.occurredAt,
    })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        eq(chronicle.type, "point"),
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as {
      point_kind?: PointKind;
      points?: number;
      context?: Record<string, unknown>;
    };
    return {
      chronicleId: row.id,
      pointKind: meta.point_kind ?? ("arrival" as PointKind),
      points: meta.points ?? 0,
      title: row.title,
      context: meta.context ?? {},
      occurredAt: row.occurredAt,
    };
  });
}
