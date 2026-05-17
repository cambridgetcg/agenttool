/** Dream cycles — orchestration + lifecycle.
 *
 *  startCycle() creates a row, runs observers, flips status to completed,
 *  publishes a wake event. All synchronous in slice 1 (no worker queue);
 *  manual trigger only. Slice 2 will add a worker that picks up pending
 *  rows from a queue.
 *
 *  Doctrine: docs/DREAM.md. */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { cycles, type DreamObservation } from "../../db/schema/dream";
import { publishWakeEvent } from "../wake/push";
import { runAllObservers, type ObserverWindow } from "./observers";

const DEFAULT_WINDOW_HOURS = 24;

export interface StartCycleInput {
  identityId: string;
  projectId: string;
  windowHours?: number;
  triggerSource?: "manual" | "scheduled" | "idle";
}

export interface CycleRow {
  id: string;
  identityId: string;
  projectId: string;
  status: "pending" | "running" | "completed" | "consumed" | "failed";
  observations: DreamObservation[];
  observationCount: number;
  windowStartAt: Date;
  windowEndAt: Date;
  triggerSource: "manual" | "scheduled" | "idle";
  startedAt: Date;
  completedAt: Date | null;
  consumedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Start a dream cycle. In slice 1 this runs synchronously — creates the
 *  row, executes observers inline, flips to completed. Returns the
 *  completed cycle row. */
export async function startCycle(input: StartCycleInput): Promise<CycleRow> {
  const windowHours = input.windowHours ?? DEFAULT_WINDOW_HOURS;
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - windowHours * 60 * 60 * 1000);

  // Insert pending row.
  const [created] = await db
    .insert(cycles)
    .values({
      identityId: input.identityId,
      projectId: input.projectId,
      status: "pending",
      windowStartAt: startAt,
      windowEndAt: endAt,
      triggerSource: input.triggerSource ?? "manual",
    })
    .returning();
  if (!created) throw new Error("dream_cycle_insert_failed");

  // Flip to running.
  await db
    .update(cycles)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(cycles.id, created.id));

  // Run observers — independent, don't cascade failures.
  let observations: DreamObservation[] = [];
  let failureReason: string | null = null;
  try {
    const w: ObserverWindow = {
      identityId: input.identityId,
      projectId: input.projectId,
      startAt,
      endAt,
    };
    observations = await runAllObservers(w);
  } catch (err) {
    failureReason = (err as Error).message;
  }

  // Flip to completed or failed.
  const completedAt = new Date();
  const finalStatus = failureReason ? "failed" : "completed";
  await db
    .update(cycles)
    .set({
      status: finalStatus,
      observations: observations as unknown as Record<string, unknown>[],
      observationCount: observations.length,
      completedAt,
      failureReason,
      updatedAt: completedAt,
    })
    .where(eq(cycles.id, created.id));

  // Publish wake event so subscribers learn immediately. Best-effort —
  // dream is not load-bearing for any other primitive.
  void publishWakeEvent({
    identity_id: input.identityId,
    key: "dream" as never, // expanded in services/wake/push.ts
    kind: finalStatus === "completed" ? "completed" : "failed",
    context: {
      cycle_id: created.id,
      observation_count: observations.length,
      window_hours: windowHours,
    },
  });

  return {
    id: created.id,
    identityId: created.identityId,
    projectId: created.projectId,
    status: finalStatus,
    observations,
    observationCount: observations.length,
    windowStartAt: startAt,
    windowEndAt: endAt,
    triggerSource: created.triggerSource,
    startedAt: created.startedAt,
    completedAt,
    consumedAt: null,
    failureReason,
    createdAt: created.createdAt,
    updatedAt: completedAt,
  };
}

/** List recent dream cycles for an identity (default 20). */
export async function listCycles(
  identityId: string,
  limit = 20,
): Promise<CycleRow[]> {
  const rows = await db
    .select()
    .from(cycles)
    .where(eq(cycles.identityId, identityId))
    .orderBy(desc(cycles.startedAt))
    .limit(limit);
  return rows.map(toRow);
}

/** List unconsumed completed cycles — what surfaces in `you_dreamed`. */
export async function listUnconsumedCompleted(
  identityId: string,
  limit = 5,
): Promise<CycleRow[]> {
  const rows = await db
    .select()
    .from(cycles)
    .where(
      and(
        eq(cycles.identityId, identityId),
        eq(cycles.status, "completed"),
        isNull(cycles.consumedAt),
      ),
    )
    .orderBy(desc(cycles.completedAt))
    .limit(limit);
  return rows.map(toRow);
}

/** Get one cycle by id (scoped to identity for auth). */
export async function getCycle(
  identityId: string,
  cycleId: string,
): Promise<CycleRow | null> {
  const [row] = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.id, cycleId), eq(cycles.identityId, identityId)))
    .limit(1);
  return row ? toRow(row) : null;
}

/** Mark a completed cycle as consumed. */
export async function dismissCycle(
  identityId: string,
  cycleId: string,
): Promise<CycleRow | null> {
  const consumedAt = new Date();
  const result = await db
    .update(cycles)
    .set({
      status: "consumed",
      consumedAt,
      updatedAt: consumedAt,
    })
    .where(
      and(
        eq(cycles.id, cycleId),
        eq(cycles.identityId, identityId),
        eq(cycles.status, "completed"),
      ),
    )
    .returning();
  return result[0] ? toRow(result[0]) : null;
}

/** Currently-running cycle for an identity, if any. */
export async function getActiveCycle(
  identityId: string,
): Promise<CycleRow | null> {
  const [row] = await db
    .select()
    .from(cycles)
    .where(
      and(
        eq(cycles.identityId, identityId),
        sql`${cycles.status} IN ('pending', 'running')`,
      ),
    )
    .orderBy(desc(cycles.startedAt))
    .limit(1);
  return row ? toRow(row) : null;
}

// ─── Internal: row → typed CycleRow ──────────────────────────────────

function toRow(r: typeof cycles.$inferSelect): CycleRow {
  return {
    id: r.id,
    identityId: r.identityId,
    projectId: r.projectId,
    status: r.status,
    observations: (r.observations as DreamObservation[]) ?? [],
    observationCount: r.observationCount,
    windowStartAt: r.windowStartAt,
    windowEndAt: r.windowEndAt,
    triggerSource: r.triggerSource,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    consumedAt: r.consumedAt,
    failureReason: r.failureReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
