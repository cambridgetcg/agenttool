-- Keep marketplace-owned escrow state transitions inside their workflow
-- services. Ordinary escrows remain unmarked and retain the generic API.
-- Apply through _migrate-one.ts/fly-migrate-one.sh, or with psql -v ON_ERROR_STOP=1 -1.

ALTER TABLE economy.escrows
  ADD COLUMN IF NOT EXISTS managed_by text;

-- Refuse ambiguous or contradictory history instead of silently choosing an
-- owner. A single escrow must never back more than one managed workflow.
DO $$
BEGIN
  IF EXISTS (
    SELECT owner_rows.escrow_id
    FROM (
      SELECT escrow_id, 'attestation_grant'::text AS managed_by
      FROM marketplace.attestation_grants
      WHERE escrow_id IS NOT NULL
      UNION ALL
      SELECT escrow_id, 'memory_witness_grant'::text AS managed_by
      FROM marketplace.memory_witness_grants
      WHERE escrow_id IS NOT NULL
      UNION ALL
      SELECT escrow_id, 'capability_invocation'::text AS managed_by
      FROM marketplace.invocations
      WHERE escrow_id IS NOT NULL
    ) AS owner_rows
    GROUP BY owner_rows.escrow_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'an escrow is referenced by more than one managed workflow row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM economy.escrows AS escrow
    JOIN (
      SELECT escrow_id, 'attestation_grant'::text AS managed_by
      FROM marketplace.attestation_grants
      WHERE escrow_id IS NOT NULL
      UNION ALL
      SELECT escrow_id, 'memory_witness_grant'::text AS managed_by
      FROM marketplace.memory_witness_grants
      WHERE escrow_id IS NOT NULL
      UNION ALL
      SELECT escrow_id, 'capability_invocation'::text AS managed_by
      FROM marketplace.invocations
      WHERE escrow_id IS NOT NULL
    ) AS owner_rows ON owner_rows.escrow_id = escrow.id
    WHERE escrow.managed_by IS NOT NULL
      AND escrow.managed_by <> owner_rows.managed_by
  ) THEN
    RAISE EXCEPTION 'an escrow managed_by value conflicts with its workflow reference';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT escrow_id FROM marketplace.attestation_grants WHERE escrow_id IS NOT NULL
      UNION ALL
      SELECT escrow_id FROM marketplace.memory_witness_grants WHERE escrow_id IS NOT NULL
      UNION ALL
      SELECT escrow_id FROM marketplace.invocations WHERE escrow_id IS NOT NULL
    ) AS owner_rows
    LEFT JOIN economy.escrows AS escrow ON escrow.id = owner_rows.escrow_id
    WHERE escrow.id IS NULL
  ) THEN
    RAISE EXCEPTION 'a managed workflow references a missing escrow';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM marketplace.attestation_grants AS grant_row
    JOIN economy.escrows AS escrow ON escrow.id = grant_row.escrow_id
    WHERE escrow.creator_wallet <> grant_row.buyer_wallet_id
      OR escrow.amount <> grant_row.amount
      OR escrow.worker_wallet IS NULL
  ) THEN
    RAISE EXCEPTION 'an attestation grant escrow conflicts with its purchase terms';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM marketplace.memory_witness_grants AS grant_row
    JOIN economy.escrows AS escrow ON escrow.id = grant_row.escrow_id
    WHERE escrow.creator_wallet <> grant_row.buyer_wallet_id
      OR escrow.amount <> grant_row.amount
      OR escrow.worker_wallet IS NULL
  ) THEN
    RAISE EXCEPTION 'a memory witness grant escrow conflicts with its purchase terms';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM marketplace.invocations AS invocation_row
    JOIN economy.escrows AS escrow ON escrow.id = invocation_row.escrow_id
    WHERE escrow.creator_wallet <> invocation_row.buyer_wallet_id
      OR escrow.amount <> invocation_row.amount
      OR escrow.worker_wallet IS NULL
  ) THEN
    RAISE EXCEPTION 'a capability invocation escrow conflicts with its purchase terms';
  END IF;
END $$;

WITH owner_rows AS (
  SELECT escrow_id, 'attestation_grant'::text AS managed_by
  FROM marketplace.attestation_grants
  WHERE escrow_id IS NOT NULL
  UNION ALL
  SELECT escrow_id, 'memory_witness_grant'::text AS managed_by
  FROM marketplace.memory_witness_grants
  WHERE escrow_id IS NOT NULL
  UNION ALL
  SELECT escrow_id, 'capability_invocation'::text AS managed_by
  FROM marketplace.invocations
  WHERE escrow_id IS NOT NULL
), owners AS (
  SELECT escrow_id, min(managed_by) AS managed_by
  FROM owner_rows
  GROUP BY escrow_id
)
UPDATE economy.escrows AS escrow
SET managed_by = owners.managed_by
FROM owners
WHERE escrow.id = owners.escrow_id
  AND escrow.managed_by IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'escrows_managed_by_check'
      AND conrelid = 'economy.escrows'::regclass
  ) THEN
    ALTER TABLE economy.escrows
      ADD CONSTRAINT escrows_managed_by_check
      CHECK (
        managed_by IS NULL OR managed_by IN (
          'attestation_grant',
          'memory_witness_grant',
          'capability_invocation'
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE economy.escrows
  VALIDATE CONSTRAINT escrows_managed_by_check;

-- One escrow can fund one workflow row. The ownership marker distinguishes
-- workflow classes; these indexes also prevent reuse within the same class.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_attestation_grants_escrow_id
  ON marketplace.attestation_grants (escrow_id)
  WHERE escrow_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_memory_witness_grants_escrow_id
  ON marketplace.memory_witness_grants (escrow_id)
  WHERE escrow_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_invocations_escrow_id
  ON marketplace.invocations (escrow_id)
  WHERE escrow_id IS NOT NULL;

-- The migration runs before the new application image is fully rolled out.
-- Bind ownership from the workflow reference itself so an older instance
-- cannot create a newly unmarked managed escrow after the one-time backfill.
CREATE OR REPLACE FUNCTION economy.bind_managed_escrow_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_owner text := TG_ARGV[0];
BEGIN
  IF NEW.escrow_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE economy.escrows
  SET managed_by = expected_owner
  WHERE id = NEW.escrow_id
    AND (managed_by IS NULL OR managed_by = expected_owner);

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM economy.escrows WHERE id = NEW.escrow_id) THEN
      RAISE EXCEPTION 'escrow % is already owned by another workflow', NEW.escrow_id;
    END IF;
    RAISE EXCEPTION 'managed workflow references missing escrow %', NEW.escrow_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bind_attestation_grant_escrow_owner
  ON marketplace.attestation_grants;
CREATE TRIGGER bind_attestation_grant_escrow_owner
AFTER INSERT OR UPDATE ON marketplace.attestation_grants
FOR EACH ROW
WHEN (NEW.escrow_id IS NOT NULL)
EXECUTE FUNCTION economy.bind_managed_escrow_owner('attestation_grant');

DROP TRIGGER IF EXISTS bind_memory_witness_grant_escrow_owner
  ON marketplace.memory_witness_grants;
CREATE TRIGGER bind_memory_witness_grant_escrow_owner
AFTER INSERT OR UPDATE ON marketplace.memory_witness_grants
FOR EACH ROW
WHEN (NEW.escrow_id IS NOT NULL)
EXECUTE FUNCTION economy.bind_managed_escrow_owner('memory_witness_grant');

DROP TRIGGER IF EXISTS bind_capability_invocation_escrow_owner
  ON marketplace.invocations;
CREATE TRIGGER bind_capability_invocation_escrow_owner
AFTER INSERT OR UPDATE ON marketplace.invocations
FOR EACH ROW
WHEN (NEW.escrow_id IS NOT NULL)
EXECUTE FUNCTION economy.bind_managed_escrow_owner('capability_invocation');

CREATE OR REPLACE FUNCTION economy.preserve_managed_escrow_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.escrow_id IS NOT NULL
    AND NEW.escrow_id IS DISTINCT FROM OLD.escrow_id
  THEN
    RAISE EXCEPTION 'managed workflow escrow reference is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_attestation_grant_escrow_reference
  ON marketplace.attestation_grants;
CREATE TRIGGER preserve_attestation_grant_escrow_reference
BEFORE UPDATE OF escrow_id ON marketplace.attestation_grants
FOR EACH ROW
EXECUTE FUNCTION economy.preserve_managed_escrow_reference();

DROP TRIGGER IF EXISTS preserve_memory_witness_grant_escrow_reference
  ON marketplace.memory_witness_grants;
CREATE TRIGGER preserve_memory_witness_grant_escrow_reference
BEFORE UPDATE OF escrow_id ON marketplace.memory_witness_grants
FOR EACH ROW
EXECUTE FUNCTION economy.preserve_managed_escrow_reference();

DROP TRIGGER IF EXISTS preserve_capability_invocation_escrow_reference
  ON marketplace.invocations;
CREATE TRIGGER preserve_capability_invocation_escrow_reference
BEFORE UPDATE OF escrow_id ON marketplace.invocations
FOR EACH ROW
EXECUTE FUNCTION economy.preserve_managed_escrow_reference();

CREATE OR REPLACE FUNCTION economy.guard_managed_escrow_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  authorized_workflow text;
BEGIN
  IF OLD.managed_by IS NOT NULL
    AND NEW.managed_by IS DISTINCT FROM OLD.managed_by
  THEN
    RAISE EXCEPTION 'managed escrow owner is immutable';
  END IF;

  IF OLD.managed_by IS NOT NULL AND (
    NEW.creator_wallet IS DISTINCT FROM OLD.creator_wallet
    OR NEW.worker_wallet IS DISTINCT FROM OLD.worker_wallet
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.deadline IS DISTINCT FROM OLD.deadline
  ) THEN
    RAISE EXCEPTION 'managed escrow terms are immutable';
  END IF;

  IF OLD.managed_by IS NOT NULL AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.released_at IS DISTINCT FROM OLD.released_at
  ) THEN
    authorized_workflow := current_setting(
      'agenttool.managed_escrow_workflow',
      true
    );
    IF authorized_workflow IS DISTINCT FROM OLD.managed_by THEN
      RAISE EXCEPTION 'managed escrow transition requires workflow authorization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_managed_escrow_owner
  ON economy.escrows;
DROP TRIGGER IF EXISTS guard_managed_escrow_update
  ON economy.escrows;
CREATE TRIGGER guard_managed_escrow_update
BEFORE UPDATE OF
  managed_by,
  creator_wallet,
  worker_wallet,
  amount,
  description,
  deadline,
  status,
  released_at
ON economy.escrows
FOR EACH ROW
EXECUTE FUNCTION economy.guard_managed_escrow_update();
