/** Pure relay transition decisions shared by the durable store and tests. */

import type { OperationPhase } from "./contracts";

export const SERVER_DERIVED_ATTRIBUTION = {
  device_id: null,
  session_id: null,
  actor_label: null,
} as const;

export type ExpiredLeaseTransition =
  | "release_claim"
  | "require_recovery"
  | null;

export function expiredLeaseTransition(
  phase: OperationPhase,
  leaseExpiresAt: Date | null,
  now: Date,
): ExpiredLeaseTransition {
  if (!leaseExpiresAt || leaseExpiresAt.getTime() > now.getTime()) return null;
  if (phase === "claimed") return "release_claim";
  if (phase === "executing") return "require_recovery";
  return null;
}

export function enrollmentDeviceEvent(input: {
  exists: boolean;
  credential_changed: boolean;
  metadata_changed: boolean;
}):
  | "device.enrolled"
  | "device.credential_rotated"
  | "device.metadata_updated"
  | null {
  if (!input.exists) return "device.enrolled";
  if (input.credential_changed) return "device.credential_rotated";
  if (input.metadata_changed) return "device.metadata_updated";
  return null;
}
