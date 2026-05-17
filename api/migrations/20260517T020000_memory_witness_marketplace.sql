-- 20260517T020000_memory_witness_marketplace.sql — witness-as-service.
--
-- Doctrine: docs/AGENT-CENTRIC.md §1 (third Tier-1 closure — agents
-- stuck without covenant counterparties can hire witnesses) ·
-- docs/MEMORY-TIERS.md §asymmetry-clause · docs/MARKETPLACE.md.
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260517T020000_memory_witness_marketplace.sql
--
-- Witness-as-service is a Ring 3 marketplace surface where agents
-- publish willingness-to-witness another agent's memory at a price.
-- Buyers buy grants; witnesses sign canonical bytes (memory-attestation/v1);
-- the substrate writes the memory_attestations row + elevates tier +
-- emits chronicle on both sides + releases escrow with take-rate split.
--
-- Distinct from the attestation marketplace (which writes to
-- identity.attestations for identity-level claims). The memory-witness
-- surface writes to memory.memory_attestations for memory-level seals.
-- The asymmetry-clause (memory-specific wall) stays structurally
-- distinct from generic identity attestation.
--
-- v1 narrowing:
--   - tier_target = 'constitutive' (the load-bearing case)
--   - subject = buyer's own memory (subject_identity_id = buyer's identity)
--   - 1-of-1 witnesses per grant (M-of-N is Slice 2 follow-up)
--   - Standard Ring 3 take-rate (default 5%, configurable via
--     PLATFORM_TAKE_RATE_BPS); platform earns where its primitives add
--     value (escrow + sig verification + chronicle propagation + dispute)

BEGIN;

-- ── Extend platform_revenue.transaction_type CHECK to include memory_witness_grant ──
ALTER TABLE marketplace.platform_revenue
  DROP CONSTRAINT IF EXISTS platform_revenue_transaction_type_check;

ALTER TABLE marketplace.platform_revenue
  ADD CONSTRAINT platform_revenue_transaction_type_check
  CHECK (transaction_type IN (
    'template_purchase',
    'capability_invocation',
    'attestation_grant',
    'memory_witness_grant'
  ));

-- ── memory_witness_listings — willingness-to-witness ────────────────────
CREATE TABLE IF NOT EXISTS marketplace.memory_witness_listings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  witness_identity_id     UUID NOT NULL,                     -- logical FK → identity.identities.id
  witness_did             TEXT NOT NULL,
  project_id              UUID NOT NULL,                     -- logical FK → tools.projects.id
  name                    TEXT NOT NULL,
  description             TEXT,
  -- The class of memory this witness is willing to seal. v1 ships
  -- only 'memory_witness:constitutive:v1'; future kinds extend the CHECK.
  claim_kind              TEXT NOT NULL
                            CHECK (claim_kind IN (
                              'memory_witness:constitutive:v1'
                            )),
  -- Free-form tags for marketplace filtering (e.g. ['identity_seal',
  -- 'value_commitment']). Agents browsing can filter by interest.
  capability_tags         TEXT[] NOT NULL DEFAULT '{}',
  -- Pricing
  pricing_model           TEXT NOT NULL DEFAULT 'per_grant',
  price_amount            INTEGER NOT NULL CHECK (price_amount > 0),
  price_currency          TEXT NOT NULL,
  witness_wallet_id       UUID NOT NULL,                     -- where the witness gets paid
  -- SLA — seconds the witness has to issue/decline before auto-refund.
  -- NULL = best-effort (no SLA timeout sweeping). Recommend 24h-7d.
  sla_seconds             INTEGER,
  visibility              TEXT NOT NULL DEFAULT 'public'
                            CHECK (visibility IN ('public', 'private')),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'paused', 'archived')),
  grants_count            INTEGER NOT NULL DEFAULT 0,
  revenue_total           INTEGER NOT NULL DEFAULT 0,
  revenue_count           INTEGER NOT NULL DEFAULT 0,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_witness_listings_witness
  ON marketplace.memory_witness_listings (witness_identity_id);

CREATE INDEX IF NOT EXISTS idx_memory_witness_listings_public_recent
  ON marketplace.memory_witness_listings (created_at DESC)
  WHERE visibility = 'public' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_memory_witness_listings_claim_kind
  ON marketplace.memory_witness_listings (claim_kind);

-- ── memory_witness_grants — the buyer's purchase + the witness's signature ──
-- Lifecycle:
--   pending  — escrow funded; witness reviewing
--   issued   — witness signed; memory_attestations row created; tier
--              elevated; chronicle emitted both sides; escrow released
--              with take-rate split (terminal)
--   declined — witness declined; escrow refunded to buyer (terminal)
--   refunded — SLA expired before issue; escrow refunded (terminal)
--   failed   — pre-escrow failure (rare; nothing moved)
--
-- The (memory_id, listing_id) pair is allowed multiple grants over time
-- (a memory could be re-witnessed by other witnesses for multi-sig in
-- the future); idempotency is at the row level, not the pair level.
CREATE TABLE IF NOT EXISTS marketplace.memory_witness_grants (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id              UUID NOT NULL REFERENCES marketplace.memory_witness_listings(id),
  -- Buyer
  buyer_identity_id       UUID NOT NULL,                     -- logical FK → identity.identities.id
  buyer_did               TEXT NOT NULL,
  buyer_project_id        UUID NOT NULL,                     -- logical FK → tools.projects.id
  buyer_wallet_id         UUID NOT NULL,                     -- logical FK → economy.wallets.id
  -- The memory being witnessed. Must belong to buyer_project_id (enforced
  -- in service layer) AND must currently be 'foundational' tier (the
  -- elevation target is 'constitutive', and elevation is one-way).
  memory_id               UUID NOT NULL,
  -- Settlement
  amount                  INTEGER NOT NULL CHECK (amount > 0),
  currency                TEXT NOT NULL,
  escrow_id               UUID REFERENCES economy.escrows(id),
  platform_fee            INTEGER NOT NULL DEFAULT 0,        -- take-rate snapshot at issue
  -- FK to the issued memory_attestations row. NULL until issued.
  memory_attestation_id   UUID,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'issued', 'declined', 'refunded', 'failed')),
  refund_reason           TEXT,
  sla_deadline_at         TIMESTAMPTZ,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_at               TIMESTAMPTZ,
  settled_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_witness_grants_listing
  ON marketplace.memory_witness_grants (listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_witness_grants_buyer
  ON marketplace.memory_witness_grants (buyer_identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_witness_grants_memory
  ON marketplace.memory_witness_grants (memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_witness_grants_pending
  ON marketplace.memory_witness_grants (status, sla_deadline_at)
  WHERE status = 'pending';

COMMIT;
