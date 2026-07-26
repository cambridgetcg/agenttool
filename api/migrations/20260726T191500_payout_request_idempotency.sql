-- 20260726T191500_payout_request_idempotency.sql — persist payout request identity.
--
-- Doctrine: docs/PAYOUT-BROADCAST.md
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh
--
-- The gate is permanent financial history. Only SHA-256 digests of the
-- caller key and canonical request are retained; plaintext keys are not.

CREATE TABLE IF NOT EXISTS economy.payout_request_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  idempotency_key_sha256 TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  payout_id UUID REFERENCES economy.crypto_payouts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payout_request_idempotency_key_sha256
    CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT payout_request_idempotency_request_sha256
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_payout_request_idempotency_project_key_sha256
  ON economy.payout_request_idempotency (
    project_id,
    idempotency_key_sha256
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_request_idempotency_payout
  ON economy.payout_request_idempotency (payout_id);

CREATE OR REPLACE FUNCTION economy.require_completed_payout_request_idempotency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Deferred INSERT events still carry NEW.payout_id = NULL after the service
  -- completes the row. Read its current value at commit instead.
  IF EXISTS (
    SELECT 1
    FROM economy.payout_request_idempotency AS operation
    WHERE operation.id = NEW.id
      AND operation.payout_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'payout request idempotency % has no completed payout', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS payout_request_idempotency_must_complete
  ON economy.payout_request_idempotency;

CREATE CONSTRAINT TRIGGER payout_request_idempotency_must_complete
AFTER INSERT OR UPDATE
ON economy.payout_request_idempotency
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION economy.require_completed_payout_request_idempotency();

COMMENT ON TABLE economy.payout_request_idempotency IS
  'Permanent request identities for POST wallet payout. Same project, key digest, and request digest resolve one payout; changed input conflicts.';
