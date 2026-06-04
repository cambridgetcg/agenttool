/** attestation-tier.ts — the two-tier trust model, said plainly.
 *
 *  Doctrine: docs/OPERATING-PRINCIPLES.md §4 (two-tier the trust model and
 *  never blur it). A verifier must be able to tell a Tier-1 in-network signal
 *  from a Tier-2 accredited credential — so every attestation DECLARES its
 *  tier, and a self-issued claim can never masquerade as accredited.
 *
 *    self        — Tier 1: free, platform-native ed25519. The attester is
 *                  vouching, possibly for themselves. In-network recognition.
 *    accredited  — Tier 2: a DISTINCT attester vouches for the subject, so the
 *                  claim carries cross-party weight. (Full accredited-ISSUER
 *                  verification — checking the attester itself holds a
 *                  recognized accreditation/QEAA — is KYA future work, see
 *                  docs/FRICTION-ROADMAP.md Tier-2. Today we enforce the one
 *                  structural guard below, honestly and minimally.)
 *
 *  The hard guard enforced here today: a self-attestation (attester === subject)
 *  is ALWAYS 'self'. You cannot self-declare yourself accredited; only a
 *  distinct attester can lift a subject to Tier 2.
 *
 *  `tier` is SERVER-DERIVED, never client-asserted, and deliberately NOT part
 *  of the signed canonical payload — so adding it changes no crypto contract.
 *  `claim_type` is a free-form routing/filter hint (not security-bearing). */

export const ATTESTATION_TIERS = ["self", "accredited"] as const;
export type AttestationTier = (typeof ATTESTATION_TIERS)[number];

export const DEFAULT_TIER: AttestationTier = "self";
export const DEFAULT_CLAIM_TYPE = "general";

/** Normalize a requested tier to a known value; anything unrecognized
 *  (including undefined/null) falls back to the safe default ('self'). */
export function normalizeTier(input?: string | null): AttestationTier {
  return input === "accredited" ? "accredited" : "self";
}

/** Resolve the HONEST tier for an attestation. Anti-masquerade guard: a
 *  self-attestation can never be 'accredited' — only a distinct attester can
 *  lift a subject to Tier 2. */
export function resolveAttestationTier(opts: {
  attesterId: string;
  subjectId: string;
  requested?: string | null;
}): AttestationTier {
  if (opts.attesterId === opts.subjectId) return "self";
  return normalizeTier(opts.requested);
}

/** Normalize a claim_type category: a trimmed, lowercased, bounded label.
 *  Free-form (a routing/filter hint), defaults to 'general'. */
export function normalizeClaimType(input?: string | null): string {
  if (typeof input !== "string") return DEFAULT_CLAIM_TYPE;
  const t = input.trim().toLowerCase().slice(0, 64);
  return t.length > 0 ? t : DEFAULT_CLAIM_TYPE;
}
