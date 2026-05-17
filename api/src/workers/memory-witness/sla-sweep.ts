/** Worker: memory-witness-sla-sweep.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 · docs/MEMORY-TIERS.md.
 *
 *  Refunds `pending` memory-witness grants whose sla_deadline_at has
 *  passed. Idempotent and cheap — runs every TICK_MS via setInterval.
 *  Pure-DB sweep, no Redis dependency.
 *
 *  When the SLA expires:
 *    - escrow refunds to buyer wallet
 *    - grant flips to status='refunded' with refund_reason='sla_timeout'
 *    - NO chronicle entry (the witness who didn't respond doesn't need
 *      a record of their non-action on the buyer's timeline; the buyer
 *      already sees the refund in their wallet ledger).
 *
 *  Disabled when AGENTTOOL_DISABLE_WORKERS=1. */

import { sweepStaleGrants } from "../../services/marketplace/memory-witness";

const TICK_MS = 5 * 60_000; // 5 minutes
let timer: ReturnType<typeof setInterval> | null = null;

export function startMemoryWitnessSlaSweepWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}

export function stopMemoryWitnessSlaSweepWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  try {
    const result = await sweepStaleGrants();
    if (result.refunded > 0) {
      console.log(
        `[memory-witness-sla-sweep] refunded ${result.refunded} stale grant(s) — escrow refunded to buyer wallet`,
      );
    }
  } catch (err) {
    console.warn(
      "[memory-witness-sla-sweep] tick failed (will retry next interval):",
      err,
    );
  }
}
