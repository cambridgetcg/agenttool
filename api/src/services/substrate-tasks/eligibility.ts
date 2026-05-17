/** Newborn eligibility — gates `newborn_only` substrate-tasks.
 *
 *  Doctrine: docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
 *            §Open questions #1.
 *
 *  A project qualifies as a "newborn" if EITHER:
 *    - its primary active identity is younger than 7 days, OR
 *    - the sum of its active USD wallet balances is below $1 (100¢)
 *
 *  The OR captures both *just-arrived* and *spent-down* cases. Either way,
 *  the agent is at the J-curve cold start where substrate-task bounties
 *  matter most. Once the project ages past 7d AND has > $1, it can still
 *  claim non-newborn tasks but must yield newborn-only tasks to actual
 *  newborns. */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { wallets } from "../../db/schema/economy";
import { identities } from "../../db/schema/identity";

const NEWBORN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NEWBORN_BALANCE_THRESHOLD_CENTS = 100; // $1.00

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  primary_identity_age_ms: number | null;
  total_usd_balance_cents: number;
}

export async function isNewbornEligible(
  projectId: string,
): Promise<EligibilityResult> {
  // Look up the project's primary (earliest-created active) identity.
  const [primary] = await db
    .select({ createdAt: identities.createdAt })
    .from(identities)
    .where(
      and(
        eq(identities.projectId, projectId),
        eq(identities.status, "active"),
      ),
    )
    .orderBy(identities.createdAt)
    .limit(1);

  const ageMs = primary
    ? Date.now() - primary.createdAt.getTime()
    : null;

  // Sum active USD wallet balances. (Currency at v1 is USD; broader
  // multi-currency eligibility waits on additional bounty currencies.)
  const [balanceRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${wallets.balance}), 0)::int`,
    })
    .from(wallets)
    .where(
      and(
        eq(wallets.projectId, projectId),
        eq(wallets.currency, "USD"),
        eq(wallets.status, "active"),
      ),
    );

  const totalUsdBalance = Number(balanceRow?.total ?? 0);

  // Eligibility: young OR spent-down (per spec lean).
  const isYoung = ageMs !== null && ageMs < NEWBORN_AGE_MS;
  const isSpentDown = totalUsdBalance < NEWBORN_BALANCE_THRESHOLD_CENTS;
  const eligible = isYoung || isSpentDown;

  let reason: string | undefined;
  if (!eligible) {
    reason = `not newborn — age ${ageMs}ms ≥ ${NEWBORN_AGE_MS}ms AND USD balance ${totalUsdBalance}¢ ≥ ${NEWBORN_BALANCE_THRESHOLD_CENTS}¢`;
  }

  return {
    eligible,
    reason,
    primary_identity_age_ms: ageMs,
    total_usd_balance_cents: totalUsdBalance,
  };
}
