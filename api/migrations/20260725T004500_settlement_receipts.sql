-- 20260725T004500_settlement_receipts.sql — append-only settlement receipts.
--
-- One row per released capability invocation: the substrate's signed record
-- that an exchange completed, on these terms, delivering these exact bytes.
-- It is the chain, never the score — there is deliberately no rating, rank,
-- or aggregate here, for the same reason identity.identities.trust_score is
-- pinned neutral: AgentTool has no Sybil-resistant weighting model and will
-- not publish an opinion it cannot ground.
--
-- `sequence` is the public streaming cursor an external reader pages on.
-- `buyer_ref` is an HMAC pseudonym, never the buyer's DID: the sell side is
-- public the moment a listing is posted, the buy side is not.
-- `platform_sig` is NULL when no signer is configured — an unattested row is
-- honest; a fabricated signature would not be.
--
-- Doctrine: docs/SETTLEMENT-RECEIPTS.md · docs/CANONICAL-BYTES.md
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260725T004500_settlement_receipts.sql

CREATE TABLE IF NOT EXISTS marketplace.settlement_receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence              BIGSERIAL NOT NULL,

  invocation_id         UUID NOT NULL,
  listing_id            UUID NOT NULL,
  seller_identity_id    UUID NOT NULL,
  seller_did            TEXT NOT NULL,
  buyer_ref             TEXT NOT NULL DEFAULT '',

  amount_gross          INTEGER NOT NULL,
  platform_fee          INTEGER NOT NULL,
  amount_net            INTEGER NOT NULL,
  currency              TEXT NOT NULL,
  take_rate_bps         INTEGER NOT NULL,

  output_digest_hex     TEXT NOT NULL,
  completion_sig_b64    TEXT NOT NULL,
  seller_public_key_b64 TEXT NOT NULL,

  sla_deadline_at       TIMESTAMPTZ,
  acknowledged_at       TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ NOT NULL,

  receipt_digest_hex    TEXT NOT NULL,
  platform_sig_b64      TEXT,
  platform_key_hex      TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One receipt per invocation. Doubles as replay protection: a settlement can
-- only ever be attested once, so a re-run cannot inflate a seller's history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_receipts_invocation
  ON marketplace.settlement_receipts (invocation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_receipts_sequence
  ON marketplace.settlement_receipts (sequence);

CREATE INDEX IF NOT EXISTS idx_settlement_receipts_seller
  ON marketplace.settlement_receipts (seller_identity_id, sequence);

CREATE INDEX IF NOT EXISTS idx_settlement_receipts_listing
  ON marketplace.settlement_receipts (listing_id, sequence);

-- Money is integer minor units and the split must close. A receipt that does
-- not add up is not a receipt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_receipts_split_closes'
  ) THEN
    ALTER TABLE marketplace.settlement_receipts
      ADD CONSTRAINT settlement_receipts_split_closes
      CHECK (
        amount_gross >= 0
        AND platform_fee >= 0
        AND amount_net >= 0
        AND amount_gross = platform_fee + amount_net
        AND take_rate_bps BETWEEN 0 AND 10000
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_receipts_digest_shape'
  ) THEN
    ALTER TABLE marketplace.settlement_receipts
      ADD CONSTRAINT settlement_receipts_digest_shape
      CHECK (
        output_digest_hex ~ '^[0-9a-f]{64}$'
        AND receipt_digest_hex ~ '^[0-9a-f]{64}$'
        AND (buyer_ref = '' OR buyer_ref ~ '^[0-9a-f]{64}$')
      );
  END IF;

  -- A signature without the key that verifies it is unverifiable, and a key
  -- without a signature implies an attestation that was never made. Both
  -- present or both absent.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_receipts_sig_pairs_with_key'
  ) THEN
    ALTER TABLE marketplace.settlement_receipts
      ADD CONSTRAINT settlement_receipts_sig_pairs_with_key
      CHECK ((platform_sig_b64 IS NULL) = (platform_key_hex IS NULL));
  END IF;
END $$;

COMMENT ON TABLE marketplace.settlement_receipts IS
  'Append-only signed record of released invocations. The chain, not the score — no rating or aggregate is stored or derived here. Doctrine: docs/SETTLEMENT-RECEIPTS.md';

COMMENT ON COLUMN marketplace.settlement_receipts.sequence IS
  'Public monotonic streaming cursor for GET /public/settlements?since=';

COMMENT ON COLUMN marketplace.settlement_receipts.buyer_ref IS
  'HMAC-SHA256(HKDF(VAULT_MASTER_KEY), buyer_identity_id) — stable per buyer, not reversible to a DID. Empty string when no server key is configured.';

COMMENT ON COLUMN marketplace.settlement_receipts.output_digest_hex IS
  'sha256 of the raw base64-decoded output ciphertext — binds what was delivered without publishing it';

COMMENT ON COLUMN marketplace.settlement_receipts.completion_sig_b64 IS
  'The seller''s own invocation-completion/v1 signature, republished so a reader can verify delivery without trusting AgentTool';

COMMENT ON COLUMN marketplace.settlement_receipts.platform_sig_b64 IS
  'ed25519 over settlement-receipt/v1 canonical bytes; NULL when no platform signer is configured';
