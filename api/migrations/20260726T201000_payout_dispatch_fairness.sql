-- 20260726T201000_payout_dispatch_fairness.sql
--
-- A requested payout blocked by another source's unresolved nonce must not
-- repeatedly occupy the dispatcher's bounded first page. Persist its cooldown
-- and prior attempt so every replica shares the same fair due ordering.

ALTER TABLE economy.crypto_payouts
  ADD COLUMN IF NOT EXISTS dispatch_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_dispatch_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crypto_payouts_dispatch_due
  ON economy.crypto_payouts (
    (COALESCE(last_dispatch_attempt_at, requested_at)),
    requested_at ASC,
    dispatch_after ASC NULLS FIRST
  )
  WHERE status = 'requested';
