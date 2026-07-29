/** Fixed-point boundary helpers retained for a future payout design.
 *
 * They do not authorize cash-out. The former lifetime-label heuristic
 * (`gallery_sale + escrow_release - reinvest - payout`) was removed because it
 * did not conserve backing through ordinary debits, internally funded
 * transfers, refunds, or chargebacks. Fresh payout admission remains resting
 * until backing is represented as state across every wallet mutation.
 */

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
  let amountBase: bigint;
  try {
    amountBase = BigInt(amountBaseUsdc);
  } catch {
    throw new Error("amount_base_must_be_positive");
  }
  if (amountBase <= 0n) {
    throw new Error("amount_base_must_be_positive");
  }
  // The current wallet/ledger schema exposes integer minor units as JS
  // numbers. Until the FX rate is represented as fixed-point rational data,
  // refuse atomic amounts that cannot enter Number exactly.
  if (amountBase > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("payout_amount_exceeds_safe_conversion");
  }
  const pence = Math.ceil(
    (Number(amountBase) * 100) / (1_000_000 * gbpUsdRate),
  );
  if (!Number.isSafeInteger(pence) || pence <= 0) {
    throw new Error("payout_amount_exceeds_safe_conversion");
  }
  return pence;
}
