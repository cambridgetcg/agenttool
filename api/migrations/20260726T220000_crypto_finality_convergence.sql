-- 20260726T220000_crypto_finality_convergence.sql
--
-- Converge the two frozen deposit-finality migration histories without
-- rewriting either checksum-journaled file. The earlier generation fence
-- installed a four-state status constraint and allowed reactivation only from
-- removed; the later immutable-observation model can install a distinct live
-- block generation from other non-credited states while retaining the row id.
--
-- Doctrine: docs/CRYPTO-PAYMENT.md
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh

-- Keep the later rollout-safe default. Current writers always choose a state
-- explicitly; `credited` prevents an older immediate-credit replica from
-- leaving its balance effect mislabeled as pending. The credited-generation
-- constraint still makes a generation-unaware write fail closed.
ALTER TABLE economy.crypto_webhook_events
  ALTER COLUMN status SET DEFAULT 'credited';

ALTER TABLE economy.crypto_webhook_events
  DROP CONSTRAINT IF EXISTS crypto_webhook_events_status_check,
  ADD CONSTRAINT crypto_webhook_events_status_check
    CHECK (
      status IN (
        'pending',
        'credited',
        'removed',
        'rejected',
        'quarantined'
      )
    );

-- A different immutable live observation must advance the row incarnation
-- exactly once before it becomes pending. This includes pending A -> pending B
-- and rejected/quarantined -> pending B. Preserve the rolling-upgrade bridge
-- from T200000 for a legacy removed -> pending writer that omits the increment.
-- Every other generation rewrite fails before a wallet effect can commit.
CREATE OR REPLACE FUNCTION
  economy.enforce_crypto_webhook_observation_generation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    IF (
      OLD.status = 'removed'
      AND NEW.observation_generation = OLD.observation_generation
    ) THEN
      NEW.observation_generation := OLD.observation_generation + 1;
      NEW.credited_generation := NULL;
    ELSIF NEW.observation_generation IS DISTINCT FROM
      OLD.observation_generation
    THEN
      IF NEW.observation_generation IS DISTINCT FROM
        OLD.observation_generation + 1
      THEN
        RAISE EXCEPTION
          'a distinct pending incarnation must advance observation_generation exactly once'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.credited_generation IS NOT NULL THEN
        RAISE EXCEPTION
          'a distinct pending incarnation must clear credited_generation'
          USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION
        'a transition to pending must advance observation_generation'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.observation_generation IS DISTINCT FROM
    OLD.observation_generation
  THEN
    RAISE EXCEPTION
      'observation_generation may change only for a distinct pending incarnation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN economy.crypto_webhook_events.observation_generation IS
  'Monotonic identity for the current logical pending incarnation. A distinct pending block generation advances it exactly once; legacy removed-to-pending writers are upgraded by the database trigger.';

COMMENT ON COLUMN economy.crypto_webhook_events.credited_generation IS
  'Generation whose canonical evidence authorized the current credited state. A pending-to-credited transition must set it to observation_generation.';
