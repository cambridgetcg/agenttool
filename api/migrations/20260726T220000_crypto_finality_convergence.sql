-- 20260726T220000_crypto_finality_convergence.sql
--
-- Converge the two frozen deposit-finality migration histories without
-- rewriting either checksum-journaled file. The earlier generation fence
-- installed a four-state status constraint; the later immutable-observation
-- migration adds the quarantined state but intentionally preserves any
-- existing constraint with that name.
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

COMMENT ON COLUMN economy.crypto_webhook_events.observation_generation IS
  'Monotonic identity for the current logical pending incarnation. It advances exactly once on removed-to-pending reactivation.';

COMMENT ON COLUMN economy.crypto_webhook_events.credited_generation IS
  'Generation whose canonical evidence authorized the current credited state. A pending-to-credited transition must set it to observation_generation.';
