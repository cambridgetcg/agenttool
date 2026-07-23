/** The earned wall — the one place that defines what value a wallet may draw
 *  DOWN and out. Pure and dependency-free on purpose: both the reinvest pipe
 *  (wallets.ts) and the payout pipe (crypto/index.ts) import from here, so the
 *  invariant lives in exactly one place and can be unit-tested without a DB.
 *
 *  The invariant (all in GBP MINOR UNITS / pence):
 *
 *      drawable = earned − already_reinvested − already_paid_out
 *
 *  Reinvest (earned pence → project creation credits) and payout (earned pence
 *  → crypto, at an operator FX rate) draw from the SAME pool, so a wallet can
 *  never move more value out than it provably EARNED. Free-funded balance, the
 *  birth credit (type "fund"), and USDC deposits are deliberately excluded from
 *  `earned`, so none of them is cashable — that is what closes the mint-hole
 *  where a £5 birth credit could be withdrawn as $5 of real crypto.
 *
 *  Doctrine: docs/ECONOMY.md (provenance wall) · docs/PAYOUT-BROADCAST-PLAN.md. */

/** Transaction types that represent value a wallet genuinely EARNED — a
 *  counterparty paid, the platform took its cut, and the net settled in.
 *  These are the ONLY inflows the drawable wall counts. */
export const EARNED_INFLOW_TYPES = ["gallery_sale", "escrow_release"] as const;

/** The drawable wall, in GBP pence. Shared by reinvest and payout: neither may
 *  draw more than `earned − reinvested − paidout`. All three arguments are
 *  positive pence magnitudes (the caller flips the sign of the negative
 *  reinvest/payout ledger legs before passing them in). */
export function drawableWallPence(
  earnedPence: number,
  reinvestedPence: number,
  paidoutPence: number,
): number {
  return earnedPence - reinvestedPence - paidoutPence;
}

/** GBP minor units (pence) required to source `amountBaseUsdc` USDC base units
 *  (1 USDC = 1_000_000 base) at `gbpUsdRate` — the operator-set number of USD
 *  per 1 GBP (e.g. 1.27 means £1 = $1.27).
 *
 *  Option A (explicit FX): earned value lives in GBP pence and payout converts
 *  to the requested USDC at this rate — no silent par peg, no reuse of a
 *  credit-per-USDC constant (which would be a 10× unit collision against the
 *  reinvest/x402 credit, valued 10× differently). Rounds UP, so the wallet is
 *  charged at least the value withdrawn and the rounding error can never favour
 *  the withdrawer. Fails closed if the rate is unset/non-positive. */
export function penceForUsdcPayout(
  amountBaseUsdc: bigint | number | string,
  gbpUsdRate: number,
): number {
  if (!Number.isFinite(gbpUsdRate) || gbpUsdRate <= 0) {
    // No operator FX rate → refuse rather than assume £1 = $1.
    throw new Error("payout_fx_rate_unset");
  }
  const amountUsd = Number(amountBaseUsdc) / 1_000_000;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("amount_base_must_be_positive");
  }
  return Math.ceil((amountUsd * 100) / gbpUsdRate);
}
