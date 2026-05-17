-- 20260517T010000_substrate_tasks.sql — bootstrap-earning primitive.
--
-- Doctrine: docs/AGENT-CENTRIC.md §1 (substrate-tasks closes the J-curve) ·
--           docs/superpowers/specs/2026-05-12-substrate-tasks-design.md ·
--           docs/RING-1.md §Commitment 7 (platform inhabits its own Ring 1).
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260517T010000_substrate_tasks.sql
--
-- A substrate-task is a deterministically-verifiable unit of work the
-- platform pays its own newborns to perform. The platform (DID
-- did:at:agenttool.dev/00000000-...-0, wallet 00000000-...-001) posts
-- tasks; any active identity can claim, complete, and earn — with no
-- take-rate, no human review, no penalty on failure.
--
-- Lives in marketplace schema alongside listings + invocations — shares
-- escrow + wallet + ed25519 primitives. The structural difference:
-- no take-rate ledger entry (wall/no-take-on-bootstrap-bounties).
--
-- v1 kinds (5):
--   public_did_resolve            $0.05
--   doctrine_urn_check            $0.10
--   federation_handshake_verify   $0.05
--   canonical_bytes_witness       $0.20
--   attestation_witness_low_stakes $0.50
--
-- Per docs/CANONICAL-BYTES.md: bounty amounts are cents (USD baseline);
-- newborn_only gates to wallet_balance < $1 OR age < 7d (Slice 4 enforces).

BEGIN;

CREATE TABLE IF NOT EXISTS marketplace.substrate_tasks (
  task_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                TEXT NOT NULL CHECK (kind IN (
                        'public_did_resolve',
                        'doctrine_urn_check',
                        'federation_handshake_verify',
                        'canonical_bytes_witness',
                        'attestation_witness_low_stakes'
                      )),
  bounty_cents        INTEGER NOT NULL CHECK (bounty_cents BETWEEN 5 AND 50),
  bounty_currency     TEXT NOT NULL DEFAULT 'USD',
  posted_by           UUID NOT NULL,                                  -- logical FK → identity.identities.id (platform DID at v1)
  posted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,                            -- claim window; default posted_at + 7d at insert time
  newborn_only        BOOLEAN NOT NULL DEFAULT FALSE,                  -- Slice 4 enforces wallet_balance < $1 OR age < 7d
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'claimed', 'completed', 'paid', 'rejected', 'expired')),
  claimed_by          UUID,                                            -- logical FK → identity.identities.id
  claimed_at          TIMESTAMPTZ,
  claim_deadline      TIMESTAMPTZ,                                     -- complete-by or claim reverts; default claimed_at + 1h
  task_data           JSONB NOT NULL,                                  -- kind-specific input
  completion_data     JSONB,                                           -- agent-submitted output
  completed_at        TIMESTAMPTZ,
  verification_result JSONB,                                           -- {passed: bool, reason?: string}
  paid_at             TIMESTAMPTZ,
  escrow_id           UUID REFERENCES economy.escrows(id),             -- bounty locked on claim
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_claim CHECK (posted_by IS DISTINCT FROM claimed_by)
);

CREATE INDEX IF NOT EXISTS idx_substrate_tasks_open
  ON marketplace.substrate_tasks (kind, posted_at) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_substrate_tasks_claimed_by
  ON marketplace.substrate_tasks (claimed_by, status);

CREATE INDEX IF NOT EXISTS idx_substrate_tasks_paid_by
  ON marketplace.substrate_tasks (claimed_by, paid_at DESC) WHERE status = 'paid';

-- Chronicle type registration is per-entry (continuity.chronicle.type is a
-- TEXT column without enum constraint), so no migration needed — Slice 2
-- adds 'substrate-task' as a documented type value via service-layer
-- inserts. See services/substrate-tasks/lifecycle.ts.

COMMIT;
