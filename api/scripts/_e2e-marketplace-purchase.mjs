/**
 * Retired hosted-purchase end-to-end harness.
 *
 * This entrypoint is intentionally inert: the API now refuses every step the
 * harness needed. POST /v1/register returns 410 (agents-only since
 * 2026-05-15), new template purchases return 410 purchases_retired
 * (2026-09-23, #431), and POST /v1/wallets/:id/fund, which seeded the buyer
 * wallet, returns 410 wallet_fund_closed (2026-10-26). The former
 * implementation remains available in Git history.
 *
 * Current contracts: docs/SAFETY-BOUNDARIES.md, docs/BUSINESS-MODEL.md
 */

const RETIRED_NOTICE = [
  "Historical marketplace purchase harness retired: its registration, purchase and wallet-funding routes are closed.",
  "Former implementation remains in Git history.",
  "Current contracts: docs/SAFETY-BOUNDARIES.md, docs/BUSINESS-MODEL.md",
].join("\n");

console.error(RETIRED_NOTICE);
process.exitCode = 1;
