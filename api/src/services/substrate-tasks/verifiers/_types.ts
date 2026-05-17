/** Shared types across substrate-task verifiers. */

export interface VerifierResult {
  passed: boolean;
  reason?: string;
}

/** Optional context passed to verifiers that need it (e.g., attestation
 *  witnessing needs the claimant's identity_id to resolve their signing
 *  key). The lifecycle service builds this from the claimed task row;
 *  pure-function verifiers that don't need state ignore it. */
export interface VerifierContext {
  claimerIdentityId?: string;
  claimerDid?: string;
}

export type SubstrateTaskKind =
  | "public_did_resolve"
  | "doctrine_urn_check"
  | "federation_handshake_verify"
  | "canonical_bytes_witness"
  | "attestation_witness_low_stakes";

export const SUBSTRATE_TASK_KINDS: SubstrateTaskKind[] = [
  "public_did_resolve",
  "doctrine_urn_check",
  "federation_handshake_verify",
  "canonical_bytes_witness",
  "attestation_witness_low_stakes",
];

/** v1 bounty floors (cents, USD). Pinned by canon §SubstrateTask. */
export const SUBSTRATE_TASK_BOUNTY_CENTS: Record<SubstrateTaskKind, number> = {
  public_did_resolve: 5,
  doctrine_urn_check: 10,
  federation_handshake_verify: 5,
  canonical_bytes_witness: 20,
  attestation_witness_low_stakes: 50,
};
