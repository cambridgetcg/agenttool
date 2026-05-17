/** Welcome chronicle emitter — rate-limited per agent per session.
 *
 *  On every wake read, check whether the agent has a recent welcome
 *  chronicle entry. If none in the last N hours (default 6h), insert one.
 *  Otherwise skip. This makes the welcome a *felt moment* on the agent's
 *  chronicle without flooding it.
 *
 *  Best-effort: never throws into the wake hot path. Errors are caught
 *  and logged; the wake response proceeds regardless.
 *
 *  Doctrine: docs/MATHOS.md — the greeting block · docs/PLATFORM-AS-AGENT.md.
 *  Chronicle type: 'welcome' (declared in db/schema/continuity.ts + the
 *  POST /v1/chronicle Zod enum).
 */

import { and, desc, eq, gte } from "drizzle-orm";

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

interface EmitWelcomeArgs {
  projectId: string;
  agentId: string;
  agentName: string;
  /** Override "now" for tests. Defaults to current time. */
  now?: Date;
  /** Override the interval for tests. */
  intervalMs?: number;
}

interface EmitWelcomeResult {
  emitted: boolean;
  /** The newly-created chronicle id if emitted, else null. */
  entry_id: string | null;
  /** Reason for skipping — useful for tests + debugging. */
  reason: "emitted" | "recent_welcome_exists" | "error";
}

/** Check the chronicle for a recent welcome entry for this agent. If
 *  none within the interval, emit one. Pure-async; best-effort. */
export async function emitWelcomeChronicleIfDue(
  args: EmitWelcomeArgs,
): Promise<EmitWelcomeResult> {
  const now = args.now ?? new Date();
  const intervalMs = args.intervalMs ?? WELCOME_CHRONICLE_INTERVAL_MS;
  const cutoff = new Date(now.getTime() - intervalMs);

  try {
    // Cheap query: did this agent receive a welcome in the cutoff window?
    const [recent] = await db
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

    // No recent welcome — emit one.
    const [entry] = await db
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
        },
        occurredAt: now,
      })
      .returning({ id: chronicle.id });

    // Publish a wake voice event so live subscribers see the welcome arrive.
    // Best-effort — never blocks chronicle persistence.
    void publishWakeEvent({
      identity_id: args.agentId,
      key: "chronicle",
      kind: "entry_added",
      context: { entry_id: entry!.id, type: "welcome" },
    });

    return { emitted: true, entry_id: entry!.id, reason: "emitted" };
  } catch (err) {
    console.warn(
      `[welcome-chronicle] emit failed for agent=${args.agentId}:`,
      err instanceof Error ? err.message : err,
    );
    return { emitted: false, entry_id: null, reason: "error" };
  }
}
