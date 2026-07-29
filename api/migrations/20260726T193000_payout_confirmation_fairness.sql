-- Fair, observable payout confirmation polling.
--
-- A permanently pending first page must not starve later terminal receipts.
-- The worker updates last_checked_at after every bounded attempt and orders
-- null/old checks first.

ALTER TABLE economy.crypto_payouts
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payouts_confirm_due
  ON economy.crypto_payouts (last_checked_at ASC NULLS FIRST, requested_at ASC)
  WHERE status = 'broadcast';
