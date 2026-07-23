import { sql } from "drizzle-orm";

export type ManagedEscrowOwner =
  | "attestation_grant"
  | "memory_witness_grant"
  | "capability_invocation";

/** Authorize managed escrow status changes for this database transaction. */
export function managedEscrowTransitionAuthorization(owner: ManagedEscrowOwner) {
  return sql`SELECT set_config('agenttool.managed_escrow_workflow', ${owner}, true)`;
}
