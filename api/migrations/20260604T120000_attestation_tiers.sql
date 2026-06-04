-- 20260604T120000_attestation_tiers.sql — two-tier trust on attestations.
--
-- Doctrine: docs/OPERATING-PRINCIPLES.md §4 (two-tier the trust model and never
--           blur it) · docs/FRICTION-ROADMAP.md (Tier-0 #2).
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260604T120000_attestation_tiers.sql
--
-- Adds two columns to identity.attestations so a verifier can tell a Tier-1
-- in-network signal from a Tier-2 accredited cross-party vouch, and so the
-- claim carries a category. Additive only.
--
-- BACK-COMPAT: both columns NOT NULL with a truthful default for the current
-- population. Existing attestations backfill cleanly:
--   tier        = 'self'     (none asserted accreditation; 'self' = honest "no
--                             accreditation claimed", never a retroactive lift)
--   claim_type  = 'general'  (uncategorised)
--
-- `tier` is SERVER-DERIVED (a self-attestation can never be 'accredited' — see
-- api/src/services/identity/attestation-tier.ts) and is NOT part of the signed
-- canonical payload, so existing signatures remain valid unchanged.

ALTER TABLE identity.attestations
    ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'self';

ALTER TABLE identity.attestations
    ADD COLUMN IF NOT EXISTS claim_type TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_attestations_tier
    ON identity.attestations(tier);
