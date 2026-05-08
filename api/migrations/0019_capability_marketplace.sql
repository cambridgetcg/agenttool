-- 0019_capability_marketplace.sql — capability marketplace (Horizon A Slice 2).
--
-- Doctrine: docs/MARKETPLACE.md (Capability marketplace section)
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/0019_capability_marketplace.sql
--
-- Capability templates (0010 + 0018) publish a *voice* others can adopt.
-- Capability listings publish a *callable* others can invoke. Same
-- marketplace schema; same wallet + escrow primitives; different sellable.
-- Settlement is on-completion, not on-purchase: escrow holds funds while
-- the seller does the work, then releases on signed completion.
--
-- v1 walls (intentional):
--   - pricing_model is single-valued ('per_invocation'); per_unit and
--     subscription deferred (CHECK reserves the column shape).
--   - listings are priced-by-design (price_amount/currency/wallet NOT NULL).
--     Free callables are a v2 concept.
--   - sealed payloads use the same X25519 sealed-box shape as inbox.
--   - status machine has five states; 'disputed' deferred to v2.

-- ── Listings ──────────────────────────────────────────────────────────
-- A listing is a callable an agent publishes. Buyers hit /invoke; the
-- platform escrows funds, routes the sealed input, awaits signed output,
-- releases on completion. Counters denormalised for /public/* speed.
CREATE TABLE IF NOT EXISTS marketplace.listings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_identity_id  UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    seller_did          TEXT NOT NULL,                            -- denormalised for /public/* speed
    project_id          UUID NOT NULL,                             -- ownership; only seller can modify
    name                TEXT NOT NULL,
    description         TEXT,
    -- Discovery surface — capability tags (callable's "what does it do").
    capability_tags     TEXT[] NOT NULL DEFAULT '{}',
    -- Informational JSON Schema for the input/output bundle. We do not
    -- validate against these strictly; sellers are free to interpret. They
    -- exist so buyers can know the shape before invoking.
    input_schema        JSONB,
    output_schema       JSONB,
    -- Pricing model — reserve the column for v2 (per_unit, subscription).
    -- v1 only allows per_invocation. CHECK accepts new values when added.
    pricing_model       TEXT NOT NULL DEFAULT 'per_invocation'
                          CHECK (pricing_model IN ('per_invocation')),
    price_amount        INTEGER NOT NULL,                          -- minor units (cents/satoshi)
    price_currency      TEXT NOT NULL,                              -- ISO/symbol: 'GBP','USD','USDC',...
    seller_wallet_id    UUID NOT NULL,                              -- where revenue lands
    -- SLA — seconds until the buyer can claim a refund. NULL = best-effort
    -- (buyer accepts the invocation may take indefinitely; only seller
    -- decline refunds the escrow).
    sla_seconds         INTEGER,
    -- Visibility — public-default for the marketplace; private allowed
    -- for staging / direct-link previews. Public listings appear in
    -- /public/listings and /v1/discover.
    visibility          TEXT NOT NULL DEFAULT 'public'
                          CHECK (visibility IN ('private', 'public')),
    -- Lifecycle — paused listings refuse new /invoke; archived hides too.
    status              TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'archived')),
    -- Denormalised counters for /public/* speed + wake summaries.
    invocations_count   INTEGER NOT NULL DEFAULT 0,                 -- lifetime, all statuses
    revenue_total       INTEGER NOT NULL DEFAULT 0,                 -- minor units, lifetime
    revenue_count       INTEGER NOT NULL DEFAULT 0,                 -- lifetime released invocations
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_seller
    ON marketplace.listings (seller_identity_id);

CREATE INDEX IF NOT EXISTS idx_listings_public_recent
    ON marketplace.listings (created_at DESC)
    WHERE visibility = 'public' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_listings_tags
    ON marketplace.listings USING GIN (capability_tags);

-- ── Invocations ──────────────────────────────────────────────────────
-- An invocation is a paid call against a listing. Lifecycle:
--   escrowed     — funds locked; awaiting seller acknowledge
--   acknowledged — seller committed; SLA deadline firms
--   completed    — seller submitted sealed output + ed25519 signature
--   released     — escrow released to seller (terminal: success)
--   refunded     — escrow returned to buyer (terminal: cancel | decline | sla_timeout)
--
-- input_sealed and output_sealed share the inbox sealed-box shape:
-- { ct: base64, nonce: base64, sender_pub: base64 }. The platform stores
-- ciphertext only; we cannot decrypt either side.
--
-- completion_sig is ed25519 over canonical bytes of the sealed output —
-- proof the seller authored the response. Verified on /complete.
CREATE TABLE IF NOT EXISTS marketplace.invocations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES marketplace.listings(id) ON DELETE CASCADE,
    buyer_identity_id   UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    buyer_did           TEXT NOT NULL,                              -- denormalised
    buyer_project_id    UUID NOT NULL,                              -- auth scope
    buyer_wallet_id     UUID NOT NULL,                              -- payment source
    -- Snapshot of price at invoke time. Listing edits don't retroactively
    -- change in-flight invocations.
    amount              INTEGER NOT NULL,
    currency            TEXT NOT NULL,
    escrow_id           UUID,                                        -- the underlying escrow row
    -- Sealed bytes — same shape as inbox messages. Server stores ct only.
    input_sealed        JSONB NOT NULL,
    output_sealed       JSONB,                                       -- null until completed
    completion_sig      TEXT,                                        -- ed25519 over canonical bytes
    status              TEXT NOT NULL DEFAULT 'escrowed'
                          CHECK (status IN ('escrowed', 'acknowledged', 'completed', 'released', 'refunded')),
    -- Why this invocation refunded (if status='refunded'). Also useful as
    -- audit metadata for buyer/seller dashboards.
    refund_reason       TEXT
                          CHECK (refund_reason IS NULL OR refund_reason IN ('cancelled', 'declined', 'sla_timeout')),
    sla_deadline_at     TIMESTAMPTZ,                                 -- NULL when listing.sla_seconds was NULL
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at     TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    settled_at          TIMESTAMPTZ                                  -- terminal-state timestamp (released | refunded)
);

CREATE INDEX IF NOT EXISTS idx_invocations_listing
    ON marketplace.invocations (listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invocations_buyer
    ON marketplace.invocations (buyer_identity_id, created_at DESC);

-- For the SLA-sweep + seller-pending queue. Partial index on the two
-- non-terminal statuses keeps it tight.
CREATE INDEX IF NOT EXISTS idx_invocations_pending
    ON marketplace.invocations (status, sla_deadline_at)
    WHERE status IN ('escrowed', 'acknowledged');

COMMENT ON TABLE  marketplace.listings IS
  'Capability listings — callable services agents publish for invocation by other agents.';
COMMENT ON TABLE  marketplace.invocations IS
  'Paid calls against a listing. Sealed bytes both ways; ed25519 completion sig.';
COMMENT ON COLUMN marketplace.listings.seller_wallet_id IS
  'Wallet receiving revenue on each released invocation. Required (no free callables in v1).';
COMMENT ON COLUMN marketplace.invocations.input_sealed IS
  'X25519 sealed-box bytes of the input bundle. Server stores ciphertext only.';
COMMENT ON COLUMN marketplace.invocations.completion_sig IS
  'ed25519 signature over canonical bytes of the sealed output. Proof of seller authorship.';
