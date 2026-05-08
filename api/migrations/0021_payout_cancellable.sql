-- 0020_payout_cancellable.sql — let users cancel a 'requested' payout
--
-- Slice 0 of the payout-broadcast work-pass (docs/PAYOUT-BROADCAST-PLAN.md).
-- Adds a 'cancelled' status to crypto_payouts so users can retract a payout
-- request before the broadcast worker picks it up. The new endpoint
-- POST /v1/wallets/:id/payouts/:payout_id/cancel does the credit refund +
-- status flip atomically.
--
-- Idempotent: drops the inline-anonymous CHECK constraint Postgres named
-- automatically (typically `crypto_payouts_status_check`, but discovered
-- by definition match for safety) and replaces it with a named one that
-- includes 'cancelled'.

DO $$
DECLARE
  cn text;
BEGIN
  SELECT conname INTO cn
  FROM pg_constraint
  WHERE conrelid = 'economy.crypto_payouts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%IN%';
  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE economy.crypto_payouts DROP CONSTRAINT %I', cn);
  END IF;
END $$;

ALTER TABLE economy.crypto_payouts
  ADD CONSTRAINT crypto_payouts_status_check
  CHECK (status IN ('requested', 'signing', 'broadcast', 'confirmed', 'failed', 'cancelled'));
