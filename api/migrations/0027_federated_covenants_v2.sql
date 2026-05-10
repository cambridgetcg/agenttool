-- 0027_federated_covenants_v2.sql — dual-signed federated covenants (Slice 3).
--
-- Doctrine: docs/CROSS-INSTANCE-COVENANTS.md
-- Spec: docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0027_federated_covenants_v2.sql

-- Lifecycle additions: 'proposed' (transient), 'rejected'/'expired'/'withdrawn' (terminal).
ALTER TABLE agent_continuity.covenants
  DROP CONSTRAINT IF EXISTS covenants_status_check;
ALTER TABLE agent_continuity.covenants
  ADD CONSTRAINT covenants_status_check
  CHECK (status IN ('proposed','active','paused','dissolved',
                    'rejected','expired','withdrawn'));

-- Protocol version. Existing rows stay v1; v2 rows opt into the new lifecycle.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS protocol_version TEXT NOT NULL DEFAULT 'v1'
    CHECK (protocol_version IN ('v1','v2'));

-- Counterparty signature columns (initiator's sig reuses 0016's `signature` + `signing_key_id`).
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS counterparty_signature      TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_signing_key_id UUID,
  ADD COLUMN IF NOT EXISTS counterparty_signed_at      TIMESTAMPTZ;

-- TTL bookkeeping. NULL for non-v2 or already-resolved rows.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS proposed_expires_at TIMESTAMPTZ;

-- Re-verification result. NULL = never re-verified or v1; populated with
-- a short error code on failure. Status is NOT flipped on failure — the
-- bond was real at sign time.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS verification_error TEXT;

-- Cosign propagation tracking.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS cosign_propagation_status   TEXT
    CHECK (cosign_propagation_status IN
           ('not_applicable','pending','propagated','rejected')),
  ADD COLUMN IF NOT EXISTS cosign_propagation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cosign_propagation_last_error TEXT,
  ADD COLUMN IF NOT EXISTS cosign_propagation_attempted_at TIMESTAMPTZ;

-- Invariant: v2 active rows MUST have both signatures.
ALTER TABLE agent_continuity.covenants
  ADD CONSTRAINT covenants_v2_active_dual_signed
  CHECK (
    protocol_version <> 'v2'
    OR status <> 'active'
    OR (signature IS NOT NULL AND counterparty_signature IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_covenants_proposed_expires
  ON agent_continuity.covenants (proposed_expires_at)
  WHERE status = 'proposed' AND proposed_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_covenants_pending_cosign_propagation
  ON agent_continuity.covenants (cosign_propagation_status, cosign_propagation_attempted_at)
  WHERE cosign_propagation_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_covenants_v2_reverify
  ON agent_continuity.covenants (verified_at NULLS FIRST)
  WHERE protocol_version = 'v2' AND status IN ('active','proposed');
