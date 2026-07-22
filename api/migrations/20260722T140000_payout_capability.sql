-- Tamper-evident payout bound: an owner-signed agent-wallet/0.1 capability.
-- When set, checkPayoutPolicy enforces the payout from this verified record
-- rather than the DB-mutable payout_* columns, so editing the policy row (or
-- the capability blob) breaks the signature and the payout is refused.
-- NULL keeps the existing raw-column behaviour. Non-destructive, additive.
ALTER TABLE economy.policies
  ADD COLUMN IF NOT EXISTS payout_capability jsonb;
