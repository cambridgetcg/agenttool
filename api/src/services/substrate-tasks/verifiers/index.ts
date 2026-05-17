/** Verifier dispatch — routes by kind to the kind-specific verifier.
 *
 *  Doctrine: docs/superpowers/specs/2026-05-12-substrate-tasks-design.md.
 *
 *  Slice 1 shipped two kinds (public_did_resolve · doctrine_urn_check).
 *  Slice 2 ships the remaining three. Unknown kinds fail with a
 *  structured reason — no exceptions. */

import { verifyAttestationWitnessLowStakes } from "./attestation_witness_low_stakes";
import { verifyCanonicalBytesWitness } from "./canonical_bytes_witness";
import { verifyDoctrineUrnCheck } from "./doctrine_urn_check";
import { verifyFederationHandshake } from "./federation_handshake_verify";
import { verifyPublicDidResolve } from "./public_did_resolve";
import type {
  SubstrateTaskKind,
  VerifierContext,
  VerifierResult,
} from "./_types";

export type {
  VerifierResult,
  SubstrateTaskKind,
  VerifierContext,
} from "./_types";
export { SUBSTRATE_TASK_KINDS, SUBSTRATE_TASK_BOUNTY_CENTS } from "./_types";

export async function runVerifier(
  kind: string,
  taskData: unknown,
  completionData: unknown,
  ctx?: VerifierContext,
): Promise<VerifierResult> {
  switch (kind as SubstrateTaskKind) {
    case "public_did_resolve":
      return verifyPublicDidResolve(taskData as never, completionData as never);
    case "doctrine_urn_check":
      return verifyDoctrineUrnCheck(taskData as never, completionData as never);
    case "federation_handshake_verify":
      return verifyFederationHandshake(
        taskData as never,
        completionData as never,
      );
    case "canonical_bytes_witness":
      return verifyCanonicalBytesWitness(
        taskData as never,
        completionData as never,
      );
    case "attestation_witness_low_stakes":
      return verifyAttestationWitnessLowStakes(
        taskData as never,
        completionData as never,
        ctx,
      );
    default:
      return {
        passed: false,
        reason: `unknown verifier kind: ${kind}`,
      };
  }
}
