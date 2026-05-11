/** Worker: retry pending cosign / reject / withdraw propagation.
 *
 *  Scans rows with `cosign_propagation_status = 'pending'` and attempts
 *  to re-POST the appropriate envelope. Exponential backoff via the
 *  `attempts` counter; marks 'rejected' after MAX_ATTEMPTS without
 *  success.
 *
 *  Triggered every TICK_MS. */

import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import {
  propagateCosign,
  propagateReject,
  propagateWithdraw,
} from "../../services/covenants/federation";

const TICK_MS = 30_000;
const MAX_ATTEMPTS = 5;
// Backoff schedule (seconds) by attempt count: ~30s, 2m, 8m, 30m, 2h.
const BACKOFF_SECONDS = [30, 120, 480, 1800, 7200];

let timer: ReturnType<typeof setInterval> | null = null;

export function startCosignPropagateWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  void tick();
}

export function stopCosignPropagateWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  const now = new Date();

  // Build a NOW-vs-attempted-at boundary: select rows whose backoff has elapsed.
  const due = await db
    .select({
      id: covenants.id,
      status: covenants.status,
      attempts: covenants.cosignPropagationAttempts,
      lastAt: covenants.cosignPropagationAttemptedAt,
    })
    .from(covenants)
    .where(eq(covenants.cosignPropagationStatus, "pending"))
    .limit(50);

  for (const row of due) {
    const idx = Math.min(row.attempts, BACKOFF_SECONDS.length - 1);
    const dueAt = (row.lastAt?.getTime() ?? 0) + BACKOFF_SECONDS[idx] * 1000;
    if (dueAt > now.getTime()) continue;

    // Exhaustion check.
    if (row.attempts >= MAX_ATTEMPTS) {
      await db.update(covenants).set({
        cosignPropagationStatus: "rejected",
        cosignPropagationLastError: `max_attempts_exceeded (${MAX_ATTEMPTS})`,
        cosignPropagationAttemptedAt: new Date(),
      }).where(eq(covenants.id, row.id));
      continue;
    }

    // Dispatch by row.status.
    if (row.status === "active") {
      await propagateCosign(row.id);
    } else if (row.status === "rejected") {
      await propagateReject(row.id);
    } else if (row.status === "withdrawn") {
      await propagateWithdraw(row.id);
    } else {
      // Status changed under us; clear the pending flag.
      await db.update(covenants).set({
        cosignPropagationStatus: "not_applicable",
        cosignPropagationLastError: `status_no_longer_propagatable: ${row.status}`,
      }).where(eq(covenants.id, row.id));
    }
  }
}
