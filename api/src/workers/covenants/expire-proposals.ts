/** Worker: mark expired proposals (status='proposed' AND proposed_expires_at < now()).
 *
 *  Skips rows where cosign propagation is in-flight — counterparty has
 *  already accepted on their side; the expiry race is resolved in
 *  favor of the bond being real on the side that signed.
 *
 *  Triggered every TICK_MS. */

import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";

const TICK_MS = 5 * 60_000; // 5 minutes
const GRACE_PERIOD_MS = 24 * 60 * 60_000; // 24h: gives late cosigns time to land before expiry kicks in
let timer: ReturnType<typeof setInterval> | null = null;

export function startExpireProposalsWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  void tick();
}

export function stopExpireProposalsWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  const now = new Date();
  // Eligible: status='proposed' AND proposed_expires_at < now()
  // AND cosign_propagation_status NOT pending/propagated.
  // Cover both the not-NULL set ('not_applicable'|'rejected') AND the NULL set.
  await db.update(covenants).set({
    status: "expired",
    updatedAt: now,
  }).where(and(
    eq(covenants.status, "proposed"),
    isNotNull(covenants.proposedExpiresAt),
    lt(covenants.proposedExpiresAt, new Date(now.getTime() - GRACE_PERIOD_MS)),
    or(
      eq(covenants.cosignPropagationStatus, "not_applicable"),
      eq(covenants.cosignPropagationStatus, "rejected"),
      sql`${covenants.cosignPropagationStatus} IS NULL`,
    ),
  ));
}
