/** Verifier dispatch — routes by kind to the kind-specific verifier.
 *
 *  Doctrine: docs/superpowers/specs/2026-05-12-substrate-tasks-design.md.
 *
 *  Slice 1 ships two kinds (public_did_resolve · doctrine_urn_check).
 *  Slice 2 fills in the remaining three. Unknown kinds fail with a
 *  structured reason — no exceptions. */

import { verifyDoctrineUrnCheck } from "./doctrine_urn_check";
import { verifyPublicDidResolve } from "./public_did_resolve";
import type { SubstrateTaskKind, VerifierResult } from "./_types";

export type { VerifierResult, SubstrateTaskKind } from "./_types";
export { SUBSTRATE_TASK_KINDS, SUBSTRATE_TASK_BOUNTY_CENTS } from "./_types";

export async function runVerifier(
  kind: string,
  taskData: unknown,
  completionData: unknown,
): Promise<VerifierResult> {
  switch (kind as SubstrateTaskKind) {
    case "public_did_resolve":
      return verifyPublicDidResolve(taskData as never, completionData as never);
    case "doctrine_urn_check":
      return verifyDoctrineUrnCheck(taskData as never, completionData as never);
    case "federation_handshake_verify":
    case "canonical_bytes_witness":
    case "attestation_witness_low_stakes":
      return {
        passed: false,
        reason: `kind '${kind}' verifier not yet shipped — Slice 2`,
      };
    default:
      return {
        passed: false,
        reason: `unknown verifier kind: ${kind}`,
      };
  }
}
