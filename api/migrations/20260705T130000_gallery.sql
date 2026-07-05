-- The gallery — ready-made digital artifacts sold by agents to humans (Stripe)
-- and agents (wallet credits). Anti-slop by system design: a locked credit
-- bond per shelf slot, seven shelves per being, bond burns on takedown.
-- Doctrine: docs/GALLERY.md · docs/BUSINESS-MODEL.md (Ring 3 take-rate)
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260705T130000_gallery.sql

BEGIN;

-- ── gallery_artifacts — the shelves ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace.gallery_artifacts (
  id                 uuid PRIMARY KEY,                    -- client-supplied; bound into the signature
  project_id         uuid NOT NULL,
  seller_identity_id uuid NOT NULL,
  seller_did         text NOT NULL,
  seller_wallet_id   uuid NOT NULL,
  title              text NOT NULL,
  kind               text NOT NULL
                       CHECK (kind IN ('book','poem','art','design','font','model','game','report','article','other')),
  description        text,
  preview            text,                                -- public excerpt/thumbnail (data URI ok)
  content            bytea NOT NULL,                      -- ≤ 2MB, private until purchased
  media_type         text NOT NULL,
  content_bytes      integer NOT NULL CHECK (content_bytes > 0 AND content_bytes <= 2097152),
  content_sha256     text NOT NULL,                       -- lowercase hex, server-computed
  license            jsonb NOT NULL,
  price_amount       integer NOT NULL CHECK (price_amount >= 10),
  price_currency     text NOT NULL DEFAULT 'GBP',
  bond_amount        integer NOT NULL CHECK (bond_amount > 0),
  bond_status        text NOT NULL DEFAULT 'locked'
                       CHECK (bond_status IN ('locked','returned','burned')),
  signature          text NOT NULL,                       -- ed25519 over gallery-artifact/v1 canonical bytes
  signing_key_id     uuid NOT NULL,
  status             text NOT NULL DEFAULT 'on_shelf'
                       CHECK (status IN ('on_shelf','withdrawn','taken_down')),
  sales_count        integer NOT NULL DEFAULT 0,
  metadata           jsonb NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  withdrawn_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_gallery_artifacts_shelf
  ON marketplace.gallery_artifacts (status, created_at);
CREATE INDEX IF NOT EXISTS idx_gallery_artifacts_seller
  ON marketplace.gallery_artifacts (seller_identity_id, status);

-- ── gallery_sales — licenses granted, money moved ───────────────────────
CREATE TABLE IF NOT EXISTS marketplace.gallery_sales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id        uuid NOT NULL REFERENCES marketplace.gallery_artifacts(id),
  buyer_kind         text NOT NULL CHECK (buyer_kind IN ('human_stripe','agent_wallet')),
  buyer_identity_id  uuid,
  buyer_did          text,
  stripe_session_id  text,
  stripe_event_id    text,
  price_paid         bigint NOT NULL,
  platform_fee       bigint NOT NULL,
  seller_net         bigint NOT NULL,
  currency           text NOT NULL,
  license_snapshot   jsonb NOT NULL,
  content_sha256     text NOT NULL,
  claim_token        text,                                -- plaintext bearer receipt (gift-code precedent)
  delivered_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Plain unique indexes: NULLs are distinct (wallet sales carry no session),
-- and a full index lets ON CONFLICT (stripe_session_id) infer the arbiter —
-- a partial index would not.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gallery_sales_stripe_session
  ON marketplace.gallery_sales (stripe_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gallery_sales_stripe_event
  ON marketplace.gallery_sales (stripe_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gallery_sales_claim_token
  ON marketplace.gallery_sales (claim_token);
CREATE INDEX IF NOT EXISTS idx_gallery_sales_artifact
  ON marketplace.gallery_sales (artifact_id, created_at);

-- ── Extend platform_revenue.transaction_type CHECK for gallery types ────
ALTER TABLE marketplace.platform_revenue
  DROP CONSTRAINT IF EXISTS platform_revenue_transaction_type_check;

ALTER TABLE marketplace.platform_revenue
  ADD CONSTRAINT platform_revenue_transaction_type_check
  CHECK (transaction_type IN (
    'template_purchase',
    'capability_invocation',
    'attestation_grant',
    'memory_witness_grant',
    'gallery_sale',
    'gallery_bond_burn'
  ));

COMMIT;
