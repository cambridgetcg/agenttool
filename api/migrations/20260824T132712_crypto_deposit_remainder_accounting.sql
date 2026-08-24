-- 20260824T132712_crypto_deposit_remainder_accounting.sql — retain exact USDC credit remainders.
--
-- Doctrine: docs/ALCHEMY-DEPOSITS.md
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh

-- This migration requires ingress and deposit-confirmation quiescence. The
-- application changes every new writer from integer floor to explicit
-- quotient/remainder handling; a rolling old writer could otherwise omit the
-- nullable column and recreate the ambiguity this migration exposes.

ALTER TABLE economy.crypto_webhook_events
  ADD COLUMN IF NOT EXISTS credit_remainder_base NUMERIC(78, 0);

ALTER TABLE economy.crypto_webhook_events
  ALTER COLUMN credit_remainder_base DROP DEFAULT;

-- One credit is 10,000 USDC atomic units at the reviewed
-- 100-credits-per-USDC rate. Derive historical evidence from amount_base;
-- rows without amount evidence remain NULL rather than receiving a false zero.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM economy.crypto_webhook_events
    WHERE amount_base IS NOT NULL
      AND credit_remainder_base IS NOT NULL
      AND credit_remainder_base IS DISTINCT FROM MOD(amount_base, 10000)
  ) THEN
    RAISE EXCEPTION
      'existing credit_remainder_base conflicts with exact amount decomposition'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

UPDATE economy.crypto_webhook_events
SET credit_remainder_base = MOD(amount_base, 10000)
WHERE amount_base IS NOT NULL
  AND credit_remainder_base IS NULL;

-- Pending rows have no wallet effect and stop before confirmation. Historical
-- credited rows retain credits_added and credited_generation so a matching
-- reorg can still reverse exactly the effect that already occurred. Changing
-- the status exposes the incomplete conversion without inventing a refund.
UPDATE economy.crypto_webhook_events
SET status = 'quarantined',
    error = 'non_integral_credit_amount',
    last_checked_at = COALESCE(last_checked_at, now())
WHERE credit_remainder_base > 0
  AND status IN ('pending', 'credited');

ALTER TABLE economy.crypto_webhook_events
  DROP CONSTRAINT IF EXISTS
    crypto_webhook_events_credit_remainder_range_check,
  ADD CONSTRAINT crypto_webhook_events_credit_remainder_range_check
    CHECK (
      credit_remainder_base IS NULL
      OR (
        credit_remainder_base >= 0
        AND credit_remainder_base < 10000
      )
    ),
  DROP CONSTRAINT IF EXISTS
    crypto_webhook_events_credit_remainder_exact_check,
  ADD CONSTRAINT crypto_webhook_events_credit_remainder_exact_check
    CHECK (
      (
        amount_base IS NULL
        AND credit_remainder_base IS NULL
      )
      OR (
        amount_base IS NOT NULL
        AND credit_remainder_base IS NOT NULL
        AND credit_remainder_base = MOD(amount_base, 10000)
      )
    ),
  DROP CONSTRAINT IF EXISTS
    crypto_webhook_events_nonintegral_not_creditable_check,
  ADD CONSTRAINT crypto_webhook_events_nonintegral_not_creditable_check
    CHECK (
      credit_remainder_base IS NULL
      OR credit_remainder_base = 0
      OR status IN ('removed', 'rejected', 'quarantined')
    ),
  DROP CONSTRAINT IF EXISTS
    crypto_webhook_events_remainder_quarantine_check,
  ADD CONSTRAINT crypto_webhook_events_remainder_quarantine_check
    CHECK (
      NOT (
        status = 'quarantined'
        AND error = 'non_integral_credit_amount'
      )
      OR (
        credit_remainder_base IS NOT NULL
        AND credit_remainder_base > 0
      )
    );

CREATE INDEX IF NOT EXISTS idx_crypto_event_credit_remainder
  ON economy.crypto_webhook_events (status, received_at)
  WHERE credit_remainder_base > 0;

COMMENT ON COLUMN economy.crypto_webhook_events.credit_remainder_base IS
  'Exact USDC atomic units left after whole-credit decomposition at the recorded 10,000-atomic credit quantum. NULL means historical amount evidence is absent; it never implies zero.';

-- Keep the existing pending-generation fence and add one narrow direct path
-- for a distinct, non-crediting remainder generation. The observation table
-- retains one admitted snapshot per live/removed block generation, not every
-- raw provider delivery; this trigger protects only the mutable current
-- projection. It cannot prove a wallet debit: the checked
-- reconciliation transaction owns the atomic debit/projection coupling when
-- OLD carries a retained legacy effect and NEW clears it for a distinct block.
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
  ELSIF (
    NEW.status = 'quarantined'
    AND NEW.error = 'non_integral_credit_amount'
    AND NEW.credit_remainder_base > 0
  ) THEN
    IF NEW.observation_generation IS NOT DISTINCT FROM
      OLD.observation_generation
    THEN
      -- A new live generation may replace a removed no-effect projection, but
      -- a caller cannot reuse the removed generation number. Match the
      -- long-standing removed-to-pending auto-advance behavior.
      IF (
        OLD.status = 'removed'
        AND (
          NEW.block_number IS DISTINCT FROM OLD.block_number
          OR lower(NEW.block_hash) IS DISTINCT FROM lower(OLD.block_hash)
        )
      ) THEN
        IF OLD.credits_added IS NOT NULL OR NEW.credits_added IS NOT NULL THEN
          RAISE EXCEPTION
            'a remainder replacement cannot discard a retained wallet effect'
            USING ERRCODE = '23514';
        END IF;
        NEW.observation_generation := OLD.observation_generation + 1;
        NEW.credited_generation := NULL;
      -- Confirming historical pending evidence may discover its exact
      -- remainder without creating a new block generation.
      ELSIF (
        OLD.status = 'pending'
        AND NEW.block_number IS NOT DISTINCT FROM OLD.block_number
        AND lower(NEW.block_hash) IS NOT DISTINCT FROM lower(OLD.block_hash)
        AND NEW.amount_base IS NOT DISTINCT FROM OLD.amount_base
        AND OLD.credits_added IS NULL
        AND NEW.credits_added IS NULL
        AND OLD.credited_generation IS NULL
        AND NEW.credited_generation IS NULL
      ) THEN
        NULL;
      -- A retry of the already-quarantined current generation is idempotent,
      -- including legacy rows whose retained wallet effect must not change.
      ELSIF (
        OLD.status = 'quarantined'
        AND OLD.error = 'non_integral_credit_amount'
        AND OLD.credit_remainder_base > 0
        AND NEW.credit_remainder_base IS NOT DISTINCT FROM
          OLD.credit_remainder_base
        AND NEW.block_number IS NOT DISTINCT FROM OLD.block_number
        AND lower(NEW.block_hash) IS NOT DISTINCT FROM lower(OLD.block_hash)
        AND NEW.amount_base IS NOT DISTINCT FROM OLD.amount_base
        AND NEW.credits_added IS NOT DISTINCT FROM OLD.credits_added
        AND NEW.credited_generation IS NOT DISTINCT FROM
          OLD.credited_generation
      ) THEN
        NULL;
      ELSE
        RAISE EXCEPTION
          'a remainder quarantine must retain its current pending/quarantined generation or advance exactly once'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.observation_generation IS DISTINCT FROM
      OLD.observation_generation
    THEN
      IF NEW.credits_added IS NOT NULL THEN
        RAISE EXCEPTION
          'a remainder replacement must clear credits_added'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.credited_generation IS NOT NULL THEN
        RAISE EXCEPTION
          'a remainder replacement must clear credited_generation'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.observation_generation IS DISTINCT FROM
        OLD.observation_generation + 1
      THEN
        RAISE EXCEPTION
          'a distinct remainder incarnation must advance observation_generation exactly once'
          USING ERRCODE = '23514';
      END IF;
      IF (
        NEW.block_number IS NOT DISTINCT FROM OLD.block_number
        AND lower(NEW.block_hash) IS NOT DISTINCT FROM lower(OLD.block_hash)
      ) THEN
        RAISE EXCEPTION
          'a remainder replacement must name a distinct block generation'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.observation_generation IS DISTINCT FROM
    OLD.observation_generation
  THEN
    RAISE EXCEPTION
      'observation_generation may change only for a distinct pending or remainder incarnation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
