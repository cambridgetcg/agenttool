-- 0018_marketplace_pricing.sql — priced templates + purchase ledger.
--
-- Doctrine: docs/MARKETPLACE.md (Pricing section · Horizon A Slice 1)
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/0018_marketplace_pricing.sql
--
-- Templates today are free + adoption-tracked. To complete Horizon A's
-- "marketplace hosted purchase flow", templates can opt into pricing:
-- author sets price + a wallet to receive revenue, buyer's adoption
-- requires a settled purchase first. The escrow primitive is reused —
-- create + accept + release atomically (no dispute window for templates;
-- purchase is final).
--
-- Backwards-compatible: every new column nullable or defaulted.
-- price_amount=NULL means free (existing templates unchanged).

-- ── Pricing on templates ─────────────────────────────────────────────
ALTER TABLE marketplace.templates
  ADD COLUMN IF NOT EXISTS price_amount     INTEGER,         -- minor units (cents/satoshi); NULL = free
  ADD COLUMN IF NOT EXISTS price_currency   TEXT,             -- ISO/symbol: 'GBP','USD','USDC',...
  ADD COLUMN IF NOT EXISTS author_wallet_id UUID,             -- where revenue lands; required when priced
  ADD COLUMN IF NOT EXISTS revenue_total    INTEGER NOT NULL DEFAULT 0,  -- minor units, lifetime
  ADD COLUMN IF NOT EXISTS revenue_count    INTEGER NOT NULL DEFAULT 0;  -- count of settled purchases

-- Constraint: if priced, currency + wallet are required. Validate at
-- application level (pricing field set requires others) rather than
-- a CHECK because some hosts have CHECK-multi-column quirks; the
-- service-layer validation is authoritative.

-- ── Purchase ledger ──────────────────────────────────────────────────
-- A purchase has its own lifecycle (pending → settled | refunded |
-- failed) so we have an audit trail even when the underlying escrow
-- has already been released. The `adoption_id` is filled when the
-- buyer subsequently adopts — links money flow to identity flow.

CREATE TABLE IF NOT EXISTS marketplace.template_purchases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         UUID NOT NULL REFERENCES marketplace.templates(id) ON DELETE CASCADE,
  buyer_project_id    UUID NOT NULL,
  buyer_identity_id   UUID NOT NULL,
  buyer_wallet_id     UUID NOT NULL,
  amount              INTEGER NOT NULL,                       -- minor units, snapshot at purchase time
  currency            TEXT NOT NULL,
  escrow_id           UUID,                                    -- the underlying escrow row (released atomically in v1)
  adoption_id         UUID,                                    -- set after the adoption call links them
  status              TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'settled', 'refunded', 'failed')),
  failure_reason      TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchases_template
  ON marketplace.template_purchases (template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_buyer
  ON marketplace.template_purchases (buyer_project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_pending
  ON marketplace.template_purchases (status, created_at)
  WHERE status = 'pending';

-- Adoption ↔ purchase link (rare, only set when template was priced).
-- We store it in template_purchases.adoption_id (above) AND mirror in
-- adoption.metadata.purchase_id for the wake-readable side. No FK in
-- DB to avoid cross-table rigidity.

COMMENT ON COLUMN marketplace.templates.price_amount IS
  'Minor units (cents/satoshi). NULL = free template.';
COMMENT ON COLUMN marketplace.templates.author_wallet_id IS
  'Wallet receiving revenue. Required when price_amount IS NOT NULL.';
COMMENT ON COLUMN marketplace.template_purchases.escrow_id IS
  'Underlying escrow row — created + accepted + released in one txn for instant settlement.';
