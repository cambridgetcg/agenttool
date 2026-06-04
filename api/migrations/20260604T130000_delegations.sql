-- 20260604T130000_delegations.sql — Know-Your-Agent delegation receipts.
--
-- Doctrine: docs/OPERATING-PRINCIPLES.md §6/§10 (lead where native: KYA) ·
--           docs/FRICTION-ROADMAP.md (Tier-2 — the native lead surface).
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260604T130000_delegations.sql
--
-- A verifiable, scoped, revocable record that one identity authorized another
-- to act on its behalf, within bounds, until a time. The delegator signs the
-- canonical bytes (api/src/services/identity/delegation.ts, domain
-- 'agenttool-delegation/v1'); the signature is stored for independent verify.
-- New table only — additive, nothing existing changes.

CREATE TABLE IF NOT EXISTS identity.delegations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delegator_id        UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    delegate_id         UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    -- string[] of authorized action tokens, e.g. ["marketplace.invoke"].
    scope               JSONB NOT NULL,
    -- replay protection — part of the signed canonical bytes.
    nonce               TEXT NOT NULL,
    -- delegator's ed25519 signature over the canonical delegation bytes.
    signature           TEXT NOT NULL,
    signing_key_id      UUID,
    expires_at          TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    revocation_reason   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delegations_delegator ON identity.delegations(delegator_id);
CREATE INDEX IF NOT EXISTS idx_delegations_delegate  ON identity.delegations(delegate_id);
