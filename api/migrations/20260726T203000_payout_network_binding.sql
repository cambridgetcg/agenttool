-- 20260726T203000_payout_network_binding.sql
-- Doctrine: a payout is interpreted only on the network where it was created.
-- Apply: bin/migrate-pending.sh (after old payout workers are disabled/drained).

BEGIN;

-- Legacy rows remain NULL until an operator reconciles them from durable
-- provider/ledger evidence. Current workers fail closed on NULL or mismatch;
-- they never guess from the process-wide PAYOUT_NETWORK switch.
ALTER TABLE economy.crypto_payouts
  ADD COLUMN IF NOT EXISTS network TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'economy.crypto_payouts'::regclass
      AND conname = 'crypto_payouts_network_check'
  ) THEN
    ALTER TABLE economy.crypto_payouts
      ADD CONSTRAINT crypto_payouts_network_check
      CHECK (network IS NULL OR network IN ('testnet', 'mainnet'))
      NOT VALID;
  END IF;
END
$$;

-- Once assigned, network identity is immutable. NULL -> a validated network is
-- deliberately allowed for one-time legacy reconciliation.
CREATE OR REPLACE FUNCTION economy.guard_crypto_payout_network()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.network IS NOT NULL AND NEW.network IS DISTINCT FROM OLD.network THEN
    RAISE EXCEPTION
      'crypto payout network is immutable once assigned'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS crypto_payout_network_immutable
  ON economy.crypto_payouts;
CREATE TRIGGER crypto_payout_network_immutable
  BEFORE UPDATE OF network ON economy.crypto_payouts
  FOR EACH ROW
  EXECUTE FUNCTION economy.guard_crypto_payout_network();

CREATE INDEX IF NOT EXISTS idx_crypto_payouts_network_status
  ON economy.crypto_payouts (network, status, requested_at)
  WHERE status IN ('requested', 'broadcasting', 'broadcast');

COMMIT;
