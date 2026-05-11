-- 20260508T232231_payout_policies.sql — per-wallet payout policy fields.
--
-- Slice 6 of the payout-broadcast plan (docs/PAYOUT-BROADCAST-PLAN.md).
-- Extends economy.policies with payout-specific gates checked in
-- requestPayout() BEFORE the credit debit:
--
--   - payout_min_base — minimum payout amount (token base units; e.g.
--     1_000_000 = 1 USDC). NULL = no minimum.
--   - payout_daily_ceiling_base — daily total cap across non-failed,
--     non-cancelled payouts on a rolling UTC day. NULL = no ceiling.
--   - payout_destination_allowlist — destination addresses permitted.
--     NULL or empty = any address allowed. Strings stored as-is (case-
--     sensitive); EVM operators should normalise to checksum format
--     before setting.
--   - payout_dual_control_threshold_base — threshold above which dual
--     control is required. Currently a placeholder: requestPayout
--     refuses any amount ≥ threshold with `payout_dual_control_required`
--     until the dual-control flow lands in its own slice.
--
-- All fields nullable; a NULL field means "no limit" for that gate.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE economy.policies
  ADD COLUMN IF NOT EXISTS payout_min_base BIGINT,
  ADD COLUMN IF NOT EXISTS payout_daily_ceiling_base BIGINT,
  ADD COLUMN IF NOT EXISTS payout_destination_allowlist TEXT[],
  ADD COLUMN IF NOT EXISTS payout_dual_control_threshold_base BIGINT;
