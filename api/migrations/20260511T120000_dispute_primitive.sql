-- 20260511T120000_dispute_primitive.sql — marketplace dispute primitive.
--
-- Doctrine: docs/MARKETPLACE.md (Dispute primitive section, to be added).
-- Spec:     docs/superpowers/specs/2026-05-10-dispute-primitive-design.md
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260511T120000_dispute_primitive.sql
--
-- Two new tables + JSONB column on listings + three columns on invocations +
-- one column on identity.attestations (for revocation tracking). Additive only.

-- ── dispute_cases ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace.dispute_cases (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invocation_id                   UUID NOT NULL UNIQUE
                                      REFERENCES marketplace.invocations(id) ON DELETE CASCADE,
    -- Filing
    filer_role                      TEXT NOT NULL CHECK (filer_role IN ('buyer', 'seller')),
    filer_project_id                UUID NOT NULL,
    filer_identity_id               UUID NOT NULL,
    reason                          TEXT,
    evidence                        JSONB,
    -- First arbiter (resolved at file time from listing.dispute_policy)
    first_arbiter_identity_id       UUID,
    first_arbiter_did               TEXT,
    first_arbiter_ruling            TEXT CHECK (first_arbiter_ruling IS NULL OR first_arbiter_ruling IN ('release', 'refund', 'split')),
    first_arbiter_split_pct         INTEGER CHECK (first_arbiter_split_pct IS NULL OR (first_arbiter_split_pct BETWEEN 0 AND 100)),
    first_arbiter_signature         TEXT,
    first_arbiter_signing_key_id    UUID,
    first_arbiter_ruled_at          TIMESTAMPTZ,
    first_arbiter_sla_deadline_at   TIMESTAMPTZ,
    -- Escalation
    escalation_deadline_at          TIMESTAMPTZ,
    escalated_by_role               TEXT CHECK (escalated_by_role IS NULL OR escalated_by_role IN ('buyer', 'seller')),
    escalator_bond_amount           INTEGER,
    escalator_bond_escrow_id        UUID,
    pool_drawn_at                   TIMESTAMPTZ,
    pool_size                       INTEGER,
    pool_vote_deadline_at           TIMESTAMPTZ,
    -- Final
    final_ruling                    TEXT CHECK (final_ruling IS NULL OR final_ruling IN ('release', 'refund', 'split')),
    final_split_pct                 INTEGER CHECK (final_split_pct IS NULL OR (final_split_pct BETWEEN 0 AND 100)),
    status                          TEXT NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open', 'first_ruled', 'escalated', 'resolved')),
    resolution_path                 TEXT CHECK (resolution_path IS NULL OR resolution_path IN (
                                      'first_stood',
                                      'overturned',
                                      'upheld',
                                      'insufficient_pool',
                                      'first_arbiter_failed_sla',
                                      'first_arbiter_unqualified'
                                    )),
    resolved_at                     TIMESTAMPTZ,
    metadata                        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_cases_filer
    ON marketplace.dispute_cases (filer_project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_first_arbiter
    ON marketplace.dispute_cases (first_arbiter_identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_open
    ON marketplace.dispute_cases (status, escalation_deadline_at)
    WHERE status IN ('open', 'first_ruled', 'escalated');

-- ── dispute_pool_votes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace.dispute_pool_votes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_case_id         UUID NOT NULL REFERENCES marketplace.dispute_cases(id) ON DELETE CASCADE,
    voter_identity_id       UUID NOT NULL,
    voter_did               TEXT NOT NULL,
    vote                    TEXT NOT NULL CHECK (vote IN ('uphold', 'overturn')),
    alternative_ruling      TEXT CHECK (alternative_ruling IS NULL OR alternative_ruling IN ('release', 'refund', 'split')),
    alternative_split_pct   INTEGER CHECK (alternative_split_pct IS NULL OR (alternative_split_pct BETWEEN 0 AND 100)),
    signature               TEXT NOT NULL,
    signing_key_id          UUID NOT NULL,
    voted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dispute_case_id, voter_identity_id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_pool_votes_case
    ON marketplace.dispute_pool_votes (dispute_case_id, voted_at DESC);

-- ── listings.dispute_policy ──────────────────────────────────────────
ALTER TABLE marketplace.listings
  ADD COLUMN IF NOT EXISTS dispute_policy JSONB;

-- ── invocations: dispute_case_id, buyer_review_deadline_at, status enum ─
ALTER TABLE marketplace.invocations
  ADD COLUMN IF NOT EXISTS dispute_case_id UUID,
  ADD COLUMN IF NOT EXISTS buyer_review_deadline_at TIMESTAMPTZ;

-- Replace the existing inline CHECK on status (auto-named in 0019).
DO $$
DECLARE con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'marketplace.invocations'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%refund_reason%';
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE marketplace.invocations DROP CONSTRAINT ' || quote_ident(con_name);
  END IF;
END $$;

ALTER TABLE marketplace.invocations
  ADD CONSTRAINT invocations_status_check
    CHECK (status IN ('escrowed', 'acknowledged', 'completed', 'disputed', 'released', 'refunded'));

-- ── identity.attestations.revoked_at ─────────────────────────────────
ALTER TABLE identity.attestations
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

COMMENT ON TABLE marketplace.dispute_cases IS
  'Dispute on a settled-but-not-released invocation. Listing-bound first arbiter rules; either party can escalate to a 5-attester pool. Pool ruling is final. Doctrine: docs/MARKETPLACE.md (Dispute primitive section).';
COMMENT ON COLUMN marketplace.listings.dispute_policy IS
  'JSONB: { arbiter_claim, first_arbiter_did, buyer_review_seconds, first_arbiter_sla_seconds, escalation_seconds, pool_vote_seconds, filer_bond_bps }. NULL = no disputability; /complete releases atomically as before.';
COMMENT ON COLUMN marketplace.invocations.dispute_case_id IS
  'NULL until a dispute is filed against this invocation. Soft FK to marketplace.dispute_cases.id.';
COMMENT ON COLUMN identity.attestations.revoked_at IS
  'When the attestation was revoked. NULL = currently valid. Set by the original attester via the (forthcoming) revocation flow; used by the dispute pool-draw to filter qualified attesters.';
