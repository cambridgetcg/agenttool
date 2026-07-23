/** Pure freshness decision for actionable operation receipt replays.
 *
 * A durable receipt proves that an earlier mutation committed. It is not a
 * renewable lease capability: claim, renew, and begin responses may be replayed
 * only while their exact slot snapshot is still current and unexpired.
 * Doctrine: docs/CROSS-DEVICE-COLLABORATION.md. */

import type { OperationSlotRecord } from "./contracts";
import { expiredLeaseTransition } from "./state";

export type ActionableOperationKind = "claim" | "renew" | "begin";

export type ActionableReplayDecision =
  | "current"
  | "stale"
  | "release_claim"
  | "require_recovery"
  | "recovery_required";

export function actionableReplayDecision(
  kind: ActionableOperationKind,
  replayed: OperationSlotRecord,
  current: OperationSlotRecord,
  now: Date,
): ActionableReplayDecision {
  const expectedReplayPhase =
    kind === "claim"
      ? replayed.phase === "claimed"
      : kind === "begin"
        ? replayed.phase === "executing"
        : replayed.phase === "claimed" || replayed.phase === "executing";
  if (!expectedReplayPhase) return "stale";

  const sameActionFence =
    current.repository_id === replayed.repository_id
    && current.operation === replayed.operation
    && current.environment === replayed.environment
    && current.action_id === replayed.action_id
    && current.action_id !== null
    && current.lease_id === replayed.lease_id
    && current.lease_id !== null
    && current.generation === replayed.generation;
  if (!sameActionFence) return "stale";
  if (current.phase === "recovery_required") return "recovery_required";

  const expiry = expiredLeaseTransition(
    current.phase,
    current.lease_expires_at
      ? new Date(current.lease_expires_at)
      : null,
    now,
  );
  if (expiry) return expiry;

  const exactLiveSnapshot =
    current.sequence === replayed.sequence
    && current.phase === replayed.phase
    && current.holder_device_id === replayed.holder_device_id
    && current.session_id === replayed.session_id
    && current.actor_label === replayed.actor_label
    && current.lease_expires_at === replayed.lease_expires_at
    && current.version === replayed.version
    && current.target === replayed.target
    && current.source_revision === replayed.source_revision
    && current.parameters_sha256 === replayed.parameters_sha256;
  return exactLiveSnapshot ? "current" : "stale";
}
