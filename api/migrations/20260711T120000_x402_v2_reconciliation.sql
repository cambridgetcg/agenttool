-- 20260711T120000_x402_v2_reconciliation.sql — durable x402 V2 lifecycle.
--
-- Doctrine: docs/PATTERN-PERSIST-IDENTITY.md
-- Spec: x402 V2 HTTP transport + exact EIP-3009 scheme
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260711T120000_x402_v2_reconciliation.sql

ALTER TABLE economy.x402_payments
  ADD COLUMN IF NOT EXISTS authorization_hash TEXT,
  ADD COLUMN IF NOT EXISTS authorization_evidence JSONB,
  ADD COLUMN IF NOT EXISTS pay_to TEXT,
  ADD COLUMN IF NOT EXISTS max_timeout_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS requirement_extra JSONB,
  ADD COLUMN IF NOT EXISTS resource_info JSONB,
  ADD COLUMN IF NOT EXISTS credits_purchased INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_receipt JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS external_settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_attempted_at TIMESTAMPTZ;

ALTER TABLE economy.x402_payments
  ALTER COLUMN status SET DEFAULT 'inserted';

ALTER TABLE economy.x402_payments
  DROP CONSTRAINT IF EXISTS x402_payments_status_check;

ALTER TABLE economy.x402_payments
  ADD CONSTRAINT x402_payments_status_check
  CHECK (status IN ('inserted', 'pending', 'externally_settled', 'settled', 'failed'));

ALTER TABLE economy.x402_payments
  DROP CONSTRAINT IF EXISTS x402_payments_v2_identity_check;
ALTER TABLE economy.x402_payments
  ADD CONSTRAINT x402_payments_v2_identity_check CHECK (
    authorization_hash IS NULL OR (
      authorization_hash ~ '^[0-9a-f]{64}$' AND
      project_id IS NOT NULL AND payer IS NOT NULL AND
      authorization_evidence IS NOT NULL AND
      jsonb_typeof(authorization_evidence) = 'object' AND
      asset IS NOT NULL AND pay_to IS NOT NULL AND
      max_timeout_seconds IS NOT NULL AND max_timeout_seconds > 0 AND
      requirement_extra IS NOT NULL AND
      jsonb_typeof(requirement_extra) = 'object' AND
      resource IS NOT NULL AND resource_info IS NOT NULL AND
      jsonb_typeof(resource_info) = 'object' AND
      resource_info->>'url' = resource AND
      credits_purchased IS NOT NULL AND credits_purchased > 0
    )
  );

ALTER TABLE economy.x402_payments
  DROP CONSTRAINT IF EXISTS x402_payments_external_receipt_check;
ALTER TABLE economy.x402_payments
  ADD CONSTRAINT x402_payments_external_receipt_check CHECK (
    authorization_hash IS NULL OR status NOT IN ('externally_settled', 'settled') OR (
      settlement_receipt IS NOT NULL AND tx_hash IS NOT NULL AND
      external_settled_at IS NOT NULL
    )
  );

ALTER TABLE economy.x402_payments
  DROP CONSTRAINT IF EXISTS x402_payments_local_settlement_check;
ALTER TABLE economy.x402_payments
  ADD CONSTRAINT x402_payments_local_settlement_check CHECK (
    authorization_hash IS NULL OR status <> 'settled' OR
    (credits_applied IS NOT NULL AND settled_at IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_x402_authorization_hash
  ON economy.x402_payments (authorization_hash);
DROP INDEX IF EXISTS economy.idx_x402_project_created;
CREATE INDEX IF NOT EXISTS idx_x402_project_status_created
  ON economy.x402_payments (project_id, status, created_at);
