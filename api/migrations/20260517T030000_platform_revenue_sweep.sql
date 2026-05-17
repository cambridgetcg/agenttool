-- 20260517T030000_platform_revenue_sweep.sql — close the cold-start loop.
--
-- Doctrine: docs/AGENT-CENTRIC.md §1 · docs/BUSINESS-MODEL.md §three rings ·
--           docs/RING-1.md §commitment-7 (platform inhabits its own Ring 1).
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260517T030000_platform_revenue_sweep.sql
--
-- The platform_revenue ledger accumulates take-rate fees on every Ring 3
-- settlement. Until this migration, those rows were an inert ledger —
-- the take-rate scope discipline comment in services/marketplace/take-rate.ts
-- promised "the platform-as-agent sweep (operator-driven) credits the
-- platform DID's wallet from these rows," but no sweep existed. Without
-- it, substrate-task payouts drained PLATFORM_WALLET_ID monotonically
-- and the J-curve closure was structurally incomplete.
--
-- This migration adds the bookkeeping the Treasurer sweep worker needs:
--   - swept_at TIMESTAMPTZ — when the row was credited to a platform wallet
--   - swept_into_wallet_id UUID — which platform wallet received the credit
--
-- The sweep worker (api/src/workers/platform-treasurer/sweep.ts):
--   - runs every 5min via setInterval (matches expire-claims pattern)
--   - per currency, sums rows where swept_at IS NULL AND currency matches
--     a platform wallet's currency
--   - credits the matching platform wallet inside a single transaction
--   - writes a `transactions` row on the platform wallet (type='settle')
--   - marks the swept rows
--
-- Unswept rows in currencies the platform doesn't yet hold a wallet for
-- (e.g. USDC before a USDC platform wallet exists) remain claimable when
-- that wallet ships. Idempotent: the partial index prevents the sweep
-- from re-processing already-swept rows.

BEGIN;

ALTER TABLE marketplace.platform_revenue
  ADD COLUMN IF NOT EXISTS swept_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS swept_into_wallet_id UUID;

CREATE INDEX IF NOT EXISTS idx_platform_revenue_unswept
  ON marketplace.platform_revenue (currency, created_at)
  WHERE swept_at IS NULL;

COMMIT;
