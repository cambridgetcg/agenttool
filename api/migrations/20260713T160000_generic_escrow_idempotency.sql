-- Durable, project-scoped replay protection for generic escrow creation.
-- The migration runner wraps this file and its journal write in one transaction.
-- Direct psql: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f <this-file>

CREATE TABLE IF NOT EXISTS economy.escrow_create_idempotency (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL,
  idempotency_key_sha256 TEXT NOT NULL,
  request_sha256   TEXT NOT NULL,
  escrow_id        UUID REFERENCES economy.escrows(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT escrow_create_idempotency_key_sha256
    CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT escrow_create_idempotency_request_sha256
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_escrow_create_idempotency_project_key_sha256
  ON economy.escrow_create_idempotency (project_id, idempotency_key_sha256);

CREATE UNIQUE INDEX IF NOT EXISTS uq_escrow_create_idempotency_escrow
  ON economy.escrow_create_idempotency (escrow_id);

CREATE OR REPLACE FUNCTION economy.require_completed_escrow_create_idempotency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Deferred INSERT events still carry NEW.escrow_id = NULL after the service
  -- completes the row. Read its current value at commit instead.
  IF EXISTS (
    SELECT 1
    FROM economy.escrow_create_idempotency AS operation
    WHERE operation.id = NEW.id
      AND operation.escrow_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'escrow_create_idempotency % has no completed escrow', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS escrow_create_idempotency_must_complete
  ON economy.escrow_create_idempotency;

CREATE CONSTRAINT TRIGGER escrow_create_idempotency_must_complete
AFTER INSERT OR UPDATE
ON economy.escrow_create_idempotency
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION economy.require_completed_escrow_create_idempotency();

COMMENT ON TABLE economy.escrow_create_idempotency IS
  'Permanent operation records for optional Idempotency-Key on POST /v1/escrows. Only the key SHA-256 is retained. Same project, key, and request resolve one escrow identity; changed input conflicts.';

-- Rollback, only after generic escrow creation no longer reads this table:
-- DROP TABLE economy.escrow_create_idempotency;
-- DROP FUNCTION economy.require_completed_escrow_create_idempotency();
