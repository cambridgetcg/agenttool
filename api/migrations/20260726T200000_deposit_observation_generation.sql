-- 20260726T200000_deposit_observation_generation.sql
--
-- Give each pending incarnation a durable monotonic identity. The same
-- chain/transaction/log row may move removed -> pending after a later signed
-- provider delivery; post-RPC decisions must not rely on a millisecond JS
-- timestamp to distinguish those incarnations.

ALTER TABLE economy.crypto_webhook_events
  ADD COLUMN IF NOT EXISTS observation_generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS credited_generation INTEGER;

-- Historical credited rows already changed wallet balances. Bind that
-- historical state to the generation introduced above before enforcing the
-- future-write fence.
UPDATE economy.crypto_webhook_events
SET credited_generation = observation_generation
WHERE status = 'credited'
  AND credited_generation IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'economy.crypto_webhook_events'::regclass
      AND conname = 'crypto_webhook_events_observation_generation_check'
  ) THEN
    ALTER TABLE economy.crypto_webhook_events
      ADD CONSTRAINT crypto_webhook_events_observation_generation_check
      CHECK (observation_generation > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'economy.crypto_webhook_events'::regclass
      AND conname =
        'crypto_webhook_events_credited_generation_positive_check'
  ) THEN
    ALTER TABLE economy.crypto_webhook_events
      ADD CONSTRAINT
        crypto_webhook_events_credited_generation_positive_check
      CHECK (credited_generation IS NULL OR credited_generation > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'economy.crypto_webhook_events'::regclass
      AND conname = 'crypto_webhook_events_pending_generation_check'
  ) THEN
    ALTER TABLE economy.crypto_webhook_events
      ADD CONSTRAINT crypto_webhook_events_pending_generation_check
      CHECK (status <> 'pending' OR credited_generation IS NULL);
  END IF;
END $$;

-- A generation-unaware legacy confirmer leaves credited_generation NULL (or
-- stale after a reorg). Its pending -> credited update therefore fails inside
-- the same database transaction, before any wallet balance mutation commits.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'economy.crypto_webhook_events'::regclass
      AND conname = 'crypto_webhook_events_credited_generation_check'
  ) THEN
    ALTER TABLE economy.crypto_webhook_events
      ADD CONSTRAINT crypto_webhook_events_credited_generation_check
      CHECK (
        status <> 'credited'
        OR
        (
          credited_generation IS NOT NULL
          AND credited_generation = observation_generation
        )
      );
  END IF;
END $$;

-- Accept the integrated writer's explicit +1 and safely upgrade a legacy
-- removed -> pending writer that leaves the generation unchanged. No other
-- transition may rewrite an observation's incarnation.
CREATE OR REPLACE FUNCTION
  economy.enforce_crypto_webhook_observation_generation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'removed' AND NEW.status = 'pending' THEN
    IF NEW.observation_generation = OLD.observation_generation THEN
      NEW.observation_generation := OLD.observation_generation + 1;
    ELSIF NEW.observation_generation IS DISTINCT FROM
      OLD.observation_generation + 1
    THEN
      RAISE EXCEPTION
        'removed to pending must advance observation_generation exactly once'
        USING ERRCODE = '23514';
    END IF;
    NEW.credited_generation := NULL;
  ELSIF NEW.observation_generation IS DISTINCT FROM OLD.observation_generation THEN
    RAISE EXCEPTION
      'observation_generation may change only on removed to pending'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  crypto_webhook_events_observation_generation_guard
  ON economy.crypto_webhook_events;

CREATE TRIGGER crypto_webhook_events_observation_generation_guard
BEFORE UPDATE OF status, observation_generation
ON economy.crypto_webhook_events
FOR EACH ROW
EXECUTE FUNCTION economy.enforce_crypto_webhook_observation_generation();
