-- 0023_payout_broadcasting_status.sql — align status CHECK with worker.
--
-- Slice 1 of the payout-broadcast work-pass (docs/PAYOUT-BROADCAST-PLAN.md).
-- The state machine is:
--   requested ─► broadcasting ─► broadcast ─► confirmed
--                                       │
--                                       └─► failed
-- Plus a `cancelled` terminal (added in 0021).
--
-- The earlier CHECK (0021) listed `signing` as the intermediate name, but
-- the worker (api/src/workers/payout/broadcast-worker.ts) actually uses
-- `broadcasting` per the plan's state machine. Without this alignment, the
-- worker's first status update fails with `crypto_payouts_status_check`
-- and the row sticks at 'requested' forever.
--
-- Idempotent: drops the existing CHECK by name + replaces with the corrected
-- enum. `signing` is dropped (it was never written by any caller).

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
  CHECK (status IN ('requested', 'broadcasting', 'broadcast', 'confirmed', 'failed', 'cancelled'));
