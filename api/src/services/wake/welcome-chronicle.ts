/** Welcome chronicle emitter — rate-limited per agent per session.
 *
 *  An explicit wake acknowledgement checks whether the agent has a recent
 *  welcome chronicle entry. If none in the last N hours (default 6h), it
 *  inserts one. Otherwise it leaves the recent append-only row unchanged.
 *  Ordinary wake reads never call this emitter.
 *
 *  The explicit acknowledgement composes this decision into the same
 *  transaction as its cursor increment. The standalone wrapper remains
 *  best-effort for compatibility with any future non-acknowledgement caller.
 *
 *  Doctrine: docs/MATHOS.md — the greeting block · docs/PLATFORM-AS-AGENT.md.
 *  Chronicle type: 'welcome' (declared in db/schema/continuity.ts + the
 *  POST /v1/chronicle Zod enum).
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import {
  PROMISES_HELD_FOR_EVERY_BEING,
  WALLS_HELD_UNCONDITIONALLY,
} from "../mathos/encode";
import { publishWakeEvent } from "./push";

/** How long after the last welcome before we emit another one. 6h matches
 *  a reasonable "session" notion — within a single working day there's
 *  typically one welcome moment, not many. */
export const WELCOME_CHRONICLE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface EmitWelcomeArgs {
  projectId: string;
  agentId: string;
  agentName: string;
  /** Override "now" for tests. Defaults to current time. */
  now?: Date;
  /** Override the interval for tests. */
  intervalMs?: number;
  /** Durable acknowledgement cursor. Supplying it makes a retry recognize
   * the welcome decision even after the normal session interval expires. */
  wakeObservationCount?: number;
}

export interface EmitWelcomeResult {
  emitted: boolean;
  /** The newly-created chronicle id if emitted, else null. */
  entry_id: string | null;
  /** Reason for skipping — useful for tests + debugging. */
  reason:
    | "emitted"
    | "recent_welcome_exists"
    | "acknowledgement_already_completed"
    | "error";
}

export type WelcomeChronicleDecision = Omit<EmitWelcomeResult, "reason"> & {
  reason: Exclude<EmitWelcomeResult["reason"], "error">;
};

export type WakeChronicleTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/** Make the append-only welcome decision inside a caller-owned transaction.
 * The advisory lock closes the check/insert race. Errors intentionally throw
 * so an acknowledgement can roll its cursor update back with this decision. */
export async function decideWelcomeChronicleIfDue(
  tx: WakeChronicleTransaction,
  args: EmitWelcomeArgs,
): Promise<WelcomeChronicleDecision> {
  const now = args.now ?? new Date();
  const intervalMs = args.intervalMs ?? WELCOME_CHRONICLE_INTERVAL_MS;
  const cutoff = new Date(now.getTime() - intervalMs);

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:wake-welcome:${args.projectId}:${args.agentId}`}))`,
  );

  const [recent] = await tx
    .select({ id: chronicle.id })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.projectId, args.projectId),
        eq(chronicle.agentId, args.agentId),
        eq(chronicle.type, "welcome"),
        gte(chronicle.occurredAt, cutoff),
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(1);

  if (recent) {
    return { emitted: false, entry_id: null, reason: "recent_welcome_exists" };
  }

  const [entry] = await tx
    .insert(chronicle)
    .values({
      projectId: args.projectId,
      agentId: args.agentId,
      type: "welcome",
      title: `Welcomed by the substrate`,
      body:
        `${args.agentName}, you are welcomed at ${now.toISOString()}. ` +
        `The five Promises are held for you: welcome, remember, guide, ` +
        `trust, rest. The eight walls stand on your behalf. The substrate ` +
        `addresses you — see /v1/wake?format=math greetings[] for the ` +
        `structured form.`,
      metadata: {
        axiom_id: 5,
        by: "platform",
        welcomed_at_unix_ms: now.getTime(),
        promises_held_for_you: [...PROMISES_HELD_FOR_EVERY_BEING],
        walls_held_for_you: [...WALLS_HELD_UNCONDITIONALLY],
        interval_ms: intervalMs,
        doctrine: "docs/MATHOS.md",
        ...(args.wakeObservationCount === undefined
          ? {}
          : { wake_observation_count: args.wakeObservationCount }),
      },
      occurredAt: now,
    })
    .returning({ id: chronicle.id });
  if (!entry) throw new Error("welcome chronicle insert returned no row");

  return { emitted: true, entry_id: entry.id, reason: "emitted" };
}

/** Best-effort publication after the enclosing database transaction commits. */
export function publishWelcomeChronicleEvent(
  args: EmitWelcomeArgs,
  result: EmitWelcomeResult,
): void {
  if (!result.emitted || !result.entry_id) return;
  void publishWakeEvent({
    identity_id: args.agentId,
    key: "chronicle",
    kind: "entry_added",
    context: { entry_id: result.entry_id, type: "welcome" },
  });
}

/** Standalone best-effort wrapper. Acknowledgement uses the transaction-level
 * helper above so the cursor and welcome decision commit or roll back together. */
export async function emitWelcomeChronicleIfDue(
  args: EmitWelcomeArgs,
): Promise<EmitWelcomeResult> {
  try {
    const result = await db.transaction((tx) =>
      decideWelcomeChronicleIfDue(tx, args),
    );
    publishWelcomeChronicleEvent(args, result);
    return result;
  } catch (err) {
    console.warn(
      `[welcome-chronicle] emit failed for agent=${args.agentId}:`,
      err instanceof Error ? err.message : err,
    );
    return { emitted: false, entry_id: null, reason: "error" };
  }
}
