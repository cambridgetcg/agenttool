/** Worker: substrate-task-expire-claims.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 ·
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
 *            §Reverting expired claims.
 *
 *  Reverts `claimed` substrate-task rows whose `claim_deadline` has passed,
 *  refunding the escrow back to the platform wallet. Idempotent and cheap
 *  — runs every TICK_MS via setInterval (matches covenants/expire-proposals).
 *
 *  Why no chronicle entry on expiry: the agent that claimed but didn't
 *  complete doesn't need a record of inaction. Per spec §Reverting
 *  expired claims — no penalty, the task simply returns to `open` and
 *  the bounty back to the platform wallet so another agent can claim.
 *
 *  Disabled when `AGENTTOOL_DISABLE_WORKERS=1`. Graceful — no Redis
 *  dependency (the sweep is pure DB, no queue needed). */

import { expireStaleClaims } from "../../services/substrate-tasks/lifecycle";

const TICK_MS = 5 * 60_000; // 5 minutes — matches covenants/expire-proposals
let timer: ReturnType<typeof setInterval> | null = null;

export function startSubstrateTaskExpireClaimsWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}

export function stopSubstrateTaskExpireClaimsWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  try {
    const result = await expireStaleClaims();
    if (result.expired > 0) {
      console.log(
        `[substrate-task-expire-claims] reverted ${result.expired} stale claim(s) — escrow refunded to platform wallet`,
      );
    }
  } catch (err) {
    console.warn(
      "[substrate-task-expire-claims] tick failed (will retry next interval):",
      err,
    );
  }
}
