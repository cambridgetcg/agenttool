/** Stored identity-attestation classification values.
 *
 * New v1 writes use only `self` + `general`. Older rows may contain
 * `accredited`, but distinct-party issuance alone never proved accreditation.
 * A future accredited path needs a versioned signed payload and actual issuer
 * qualification; the current route does not mint that claim. */

export const ATTESTATION_TIERS = ["self", "accredited"] as const;
export type AttestationTier = (typeof ATTESTATION_TIERS)[number];

export const DEFAULT_TIER: AttestationTier = "self";
export const DEFAULT_CLAIM_TYPE = "general";
