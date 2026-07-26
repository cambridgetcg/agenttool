/**
 * Retired Solana devnet payout harness.
 *
 * This entrypoint is intentionally inert while fresh payout admission and
 * every payout worker remain resting unconditionally. The former credentialed
 * implementation remains available in Git history.
 *
 * Current operations: docs/PAYOUT-BROADCAST-OPS.md
 * Historical plan: docs/PAYOUT-BROADCAST-PLAN.md
 */

const RESTING_NOTICE = [
  "Historical payout harness retired: payouts are resting unconditionally.",
  "Former implementation remains in Git history.",
  "Current operations: docs/PAYOUT-BROADCAST-OPS.md",
  "Historical plan: docs/PAYOUT-BROADCAST-PLAN.md",
].join("\n");

console.error(RESTING_NOTICE);
process.exitCode = 1;
