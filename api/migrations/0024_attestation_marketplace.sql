-- 0024_attestation_marketplace.sql — capability marketplace beyond templates (Horizon A Slice 3).
--
-- Doctrine: docs/MARKETPLACE.md (Attestation marketplace section · Slice 3)
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/0024_attestation_marketplace.sql
--
-- Templates publish a *voice* (Slice 1). Listings publish a *callable* (Slice 2).
-- Attestation listings publish a *willingness-to-attest*: an attester offers to
-- sign a specific kind of claim (e.g. "verified-developer-2026", "kyc-tier-2",
-- "passed-substrate-honesty-test") at a price, with optional buyer-supplied
-- evidence. The buyer purchases a *grant*; the attester reviews, signs, and
-- delivers; the platform writes the row in identity.attestations and releases
-- the escrow.
--
-- This is the structural answer to "trust as a sellable" — once attestations
-- can be priced, reputation flows become economic primitives, not just
-- relational ones.
--
-- Same wallet + escrow primitives as templates and listings; on-completion
-- settlement (like listings, not like templates) because the seller does
-- actual work (review the evidence + sign the canonical bytes).
--
-- This migration also introduces the platform-revenue ledger that records
-- the take-rate fee on every Ring 3 transaction — templates, capability
-- invocations, and attestation grants all credit it. Per-transaction
-- splitting is wired in the service layer; this table is the audit trail.

-- ── Attestation listings ─────────────────────────────────────────────
-- What an attester is willing to sign, at what price, with what evidence.
CREATE TABLE IF NOT EXISTS marketplace.attestation_listings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attester_identity_id  UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    attester_did          TEXT NOT NULL,                             -- denormalised for /public/* speed
    project_id            UUID NOT NULL,                              -- ownership; only attester can modify
    name                  TEXT NOT NULL,                              -- short label
    description           TEXT,                                        -- human-readable
    -- The class of claim the attester is willing to make. Free-form string;
    -- by convention, namespace it (e.g. "agenttool/verified-developer/v1",
    -- "kyc/tier-2", "credibility/expert-summarizer-2026"). The actual issued
    -- attestation's `claim` column copies this verbatim at issue time.
    claim                 TEXT NOT NULL,
    -- Discovery surface — domains the attester operates in.
    capability_tags       TEXT[] NOT NULL DEFAULT '{}',
    -- Optional JSON Schema for the evidence buyer must provide. The platform
    -- doesn't validate strictly; sellers interpret. NULL = no required shape.
    evidence_schema       JSONB,
    -- Pricing — single model in v1 (per_grant). Reserved for future per_class
    -- bundles. CHECK accepts new values when added.
    pricing_model         TEXT NOT NULL DEFAULT 'per_grant'
                            CHECK (pricing_model IN ('per_grant')),
    price_amount          INTEGER NOT NULL,                          -- minor units
    price_currency        TEXT NOT NULL,                              -- ISO/symbol
    attester_wallet_id    UUID NOT NULL,                              -- where revenue lands
    -- Validity of the issued attestation, in seconds. NULL = no expiry.
    -- Copied to identity.attestations.expires_at at issue time as
    -- now() + validity_seconds.
    validity_seconds      INTEGER,
    -- SLA — seconds the attester has to issue or decline before the buyer
    -- can claim a refund. NULL = best-effort (no auto-refund).
    sla_seconds           INTEGER,
    visibility            TEXT NOT NULL DEFAULT 'public'
                            CHECK (visibility IN ('private', 'public')),
    status                TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'paused', 'archived')),
    -- Denormalised counters for /public/* + wake summaries.
    grants_count          INTEGER NOT NULL DEFAULT 0,                 -- lifetime, all statuses
    revenue_total         INTEGER NOT NULL DEFAULT 0,                 -- minor units, lifetime issued
    revenue_count         INTEGER NOT NULL DEFAULT 0,                 -- lifetime issued grants
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attestation_listings_attester
    ON marketplace.attestation_listings (attester_identity_id);

CREATE INDEX IF NOT EXISTS idx_attestation_listings_public_recent
    ON marketplace.attestation_listings (created_at DESC)
    WHERE visibility = 'public' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_attestation_listings_claim
    ON marketplace.attestation_listings (claim);

CREATE INDEX IF NOT EXISTS idx_attestation_listings_tags
    ON marketplace.attestation_listings USING GIN (capability_tags);

-- ── Attestation grants ──────────────────────────────────────────────
-- A grant is a purchased-but-not-yet-issued attestation. Lifecycle:
--   pending  — escrow funded; attester reviewing
--   issued   — attester signed; identity.attestations row created;
--              escrow released (with take-rate split)
--   refunded — attester declined OR SLA expired (refund_reason set)
--   failed   — pre-escrow failure; nothing moved (rare)
--
-- subject_identity_id is who the attestation is ABOUT. The buyer can
-- request an attestation about themselves (subject_id = buyer_id) or
-- about a third party they have authority/reason to attest about — the
-- attester decides at issue time whether to honor.
--
-- evidence is the JSON the buyer provides at purchase time (matching
-- evidence_schema if the listing has one). The attester reads it during
-- review. Plaintext-by-design — attestation evidence is intentionally
-- legible (unlike strand thoughts or invocation payloads).
CREATE TABLE IF NOT EXISTS marketplace.attestation_grants (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id            UUID NOT NULL REFERENCES marketplace.attestation_listings(id) ON DELETE CASCADE,
    buyer_identity_id     UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    buyer_did             TEXT NOT NULL,
    buyer_project_id      UUID NOT NULL,
    buyer_wallet_id       UUID NOT NULL,
    subject_identity_id   UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    subject_did           TEXT NOT NULL,
    evidence              JSONB,                                      -- buyer-supplied; null allowed
    -- Snapshot of price at purchase time. Listing edits don't retroactively
    -- change in-flight grants.
    amount                INTEGER NOT NULL,
    currency              TEXT NOT NULL,
    escrow_id             UUID,                                        -- the underlying escrow row
    -- The platform fee taken from this grant. Recorded at issue time;
    -- 0 until issued. The attester receives `amount - platform_fee`.
    platform_fee          INTEGER NOT NULL DEFAULT 0,
    -- FK to the issued attestation row in identity.attestations. Set at
    -- issue time. NULL while pending; never set if refunded/failed.
    attestation_id        UUID REFERENCES identity.attestations(id) ON DELETE SET NULL,
    status                TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'issued', 'refunded', 'failed')),
    refund_reason         TEXT
                            CHECK (refund_reason IS NULL OR refund_reason IN ('declined', 'sla_timeout', 'cancelled')),
    sla_deadline_at       TIMESTAMPTZ,                                 -- NULL when listing.sla_seconds was NULL
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    issued_at             TIMESTAMPTZ,                                 -- when the attestation was signed
    settled_at            TIMESTAMPTZ                                  -- terminal-state timestamp (issued | refunded)
);

CREATE INDEX IF NOT EXISTS idx_attestation_grants_listing
    ON marketplace.attestation_grants (listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attestation_grants_buyer
    ON marketplace.attestation_grants (buyer_identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attestation_grants_subject
    ON marketplace.attestation_grants (subject_identity_id, created_at DESC);

-- For the SLA-sweep + attester-pending queue. Partial index keeps it tight.
CREATE INDEX IF NOT EXISTS idx_attestation_grants_pending
    ON marketplace.attestation_grants (status, sla_deadline_at)
    WHERE status = 'pending';

-- ── Platform revenue ledger ─────────────────────────────────────────
-- Every Ring 3 transaction (template purchase · capability invocation ·
-- attestation grant) credits this ledger with the take-rate fee.
--
-- Why a ledger and not a wallet credit yet:
--   v1 records fees authoritatively but doesn't auto-credit a platform
--   wallet. The platform's own DID + wallet land in the platform-as-agent
--   pass (see docs/BUSINESS-MODEL.md). Until then, this ledger is the
--   source of truth for accrued revenue; a settlement worker can sweep
--   into a wallet later.
--
-- The (transaction_type, transaction_id) pair is a SOFT polymorphic
-- reference — no FK, since the target table varies. Application code
-- joins back when needed.
CREATE TABLE IF NOT EXISTS marketplace.platform_revenue (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type    TEXT NOT NULL
                          CHECK (transaction_type IN (
                              'template_purchase',
                              'capability_invocation',
                              'attestation_grant'
                          )),
    transaction_id      UUID NOT NULL,                                 -- soft FK
    -- The fee amount in minor units, in the same currency as the underlying
    -- transaction (no cross-currency conversion in v1).
    amount              INTEGER NOT NULL CHECK (amount > 0),
    currency            TEXT NOT NULL,
    -- Take-rate at the time of the transaction (basis points; 500 = 5%).
    -- Recorded as a snapshot — future rate changes don't retroactively shift
    -- past fees.
    rate_bps            INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
    -- Counterparty wallets — buyer paid, seller credited (amount − fee).
    -- Useful for any future reconciliation against escrow rows.
    buyer_wallet_id     UUID NOT NULL,
    seller_wallet_id    UUID NOT NULL,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_revenue_currency_time
    ON marketplace.platform_revenue (currency, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_revenue_transaction
    ON marketplace.platform_revenue (transaction_type, transaction_id);

CREATE INDEX IF NOT EXISTS idx_platform_revenue_seller
    ON marketplace.platform_revenue (seller_wallet_id, created_at DESC);

-- ── Comments ───────────────────────────────────────────────────────
COMMENT ON TABLE marketplace.attestation_listings IS
  'Attester offers — willingness to sign a specific class of claim, priced.';
COMMENT ON TABLE marketplace.attestation_grants IS
  'Purchased attestations — escrow funds the request; attester signs and delivers; platform writes the row in identity.attestations and releases.';
COMMENT ON TABLE marketplace.platform_revenue IS
  'Ring 3 take-rate ledger — fee on every settled Ring 3 transaction. Doctrine: docs/BUSINESS-MODEL.md.';
COMMENT ON COLUMN marketplace.attestation_grants.platform_fee IS
  'Take-rate fee on this grant. Attester receives amount − platform_fee at issue time.';
COMMENT ON COLUMN marketplace.platform_revenue.rate_bps IS
  'Take-rate basis points at transaction time (500 = 5%). Snapshot, not retroactively mutable.';
