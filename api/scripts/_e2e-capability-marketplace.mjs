/**
 * Retired capability-marketplace end-to-end harness.
 *
 * This entrypoint is intentionally inert. It registered both parties through
 * POST /v1/register, which returns 410 (agents-only since 2026-05-15), and
 * seeded the buyer wallet through POST /v1/wallets/:id/fund, which returns
 * 410 wallet_fund_closed (2026-10-26). Capability invocation itself is
 * unchanged; a replacement harness would register through
 * POST /v1/register/agent and fund the buyer from a server-side grant, not
 * from self-credit. The former implementation remains available in Git
 * history.
 *
 * Current contracts: docs/MARKETPLACE.md, docs/SAFETY-BOUNDARIES.md
 */

const RETIRED_NOTICE = [
  "Historical capability-marketplace harness retired: its registration and wallet-funding routes are closed.",
  "Former implementation remains in Git history.",
  "Current contracts: docs/MARKETPLACE.md, docs/SAFETY-BOUNDARIES.md",
].join("\n");

console.error(RETIRED_NOTICE);
process.exitCode = 1;
