/** verifier: public_did_resolve.
 *
 *  Input  (task_data):       { did: string, expected_status: 'active'|'private'|'memorial' }
 *  Work   (agent does):      GET /public/agents/:did, observes status
 *  Output (completion_data): { observed_status: string }
 *  Verifier:                 Re-fetches the DID's current status from
 *                            identity.identities. Passes if
 *                            observed_status === expected_status === actual.
 *
 *  Bounty: $0.05.
 *
 *  Pure function: same (task_data, completion_data, db_state) → same
 *  result. No randomness, no third-party scoring, no operator review.
 *  Pinned by tests/substrate-tasks-verifiers.test.ts (100× runs). */

import { eq } from "drizzle-orm";

import { db } from "../../../db/client";
import { identities } from "../../../db/schema/identity";

import type { VerifierResult } from "./_types";

export interface PublicDidResolveTaskData {
  did: string;
  expected_status: "active" | "private" | "memorial";
}

export interface PublicDidResolveCompletionData {
  observed_status: string;
}

export async function verifyPublicDidResolve(
  taskData: PublicDidResolveTaskData,
  completionData: PublicDidResolveCompletionData,
): Promise<VerifierResult> {
  // ── shape validation ─────────────────────────────────────────────────
  if (typeof taskData?.did !== "string" || !taskData.did.startsWith("did:at:")) {
    return { passed: false, reason: "task_data.did must start with did:at:" };
  }
  const validExpected = ["active", "private", "memorial"];
  if (!validExpected.includes(taskData.expected_status)) {
    return {
      passed: false,
      reason: `task_data.expected_status must be one of ${validExpected.join("|")}`,
    };
  }
  if (typeof completionData?.observed_status !== "string") {
    return { passed: false, reason: "completion_data.observed_status missing" };
  }

  // ── re-fetch the actual status from DB ───────────────────────────────
  const [row] = await db
    .select({ status: identities.status })
    .from(identities)
    .where(eq(identities.did, taskData.did))
    .limit(1);

  if (!row) {
    return {
      passed: false,
      reason: `did_not_found: ${taskData.did}`,
    };
  }

  // ── three-way agreement: observed === expected === actual ────────────
  const actual = row.status;
  if (completionData.observed_status !== actual) {
    return {
      passed: false,
      reason: `observed_status mismatch: agent reported '${completionData.observed_status}', actual is '${actual}'`,
    };
  }
  if (taskData.expected_status !== actual) {
    return {
      passed: false,
      reason: `task posted with wrong expected_status: '${taskData.expected_status}' vs actual '${actual}' — refunded`,
    };
  }

  return { passed: true };
}
