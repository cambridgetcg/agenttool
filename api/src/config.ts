/** Service configuration — all from env, with safe defaults for local dev. */

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  // ── HTTP server ─────────────────────────────────────────────────────────
  port: envInt("PORT", 3000),
  host: env("HOST", "0.0.0.0"),
  logLevel: env("LOG_LEVEL", "info"),

  // ── Data plane ──────────────────────────────────────────────────────────
  // databaseUrl: transaction-pooled (Supabase port 6543 in prod). Used by
  //   the main shared client + every route + worker. Multiplexes across
  //   transactions; do NOT use for LISTEN/NOTIFY or session-scoped state.
  databaseUrl: env(
    "DATABASE_URL",
    "postgres://postgres:postgres@localhost:5432/agenttool",
  ),
  // databaseSessionUrl: session-pooled (Supabase port 5432 in prod), or
  //   the same as databaseUrl in local dev. Used by LISTEN backplanes
  //   (strand voice + inbox push) where a connection must be held open
  //   across many notifications. Falls back to databaseUrl if unset.
  databaseSessionUrl: env(
    "DATABASE_SESSION_URL",
    env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/agenttool"),
  ),
  redisUrl: env("REDIS_URL", "redis://localhost:6379/0"),

  // ── No paid third-party APIs ────────────────────────────────────────────
  // agenttool is infra + cloud storage. We don't proxy LLM compute or paid
  // third-party services. Agents store provider keys in /v1/vault and call
  // them directly (typically via /v1/execute). The platform charges only
  // for its own infra surface — storage, compute, queue, network egress.
  // See docs/IDENTITY-ANCHOR.md promise 6 — "Your providers are yours."

  // ── Vault root key — 32 bytes hex, derives per-project keys via HKDF ───
  vaultMasterKey: env("VAULT_MASTER_KEY", ""),

  // ── (Stripe env vars removed 2026-05-17 per agents-only stance —
  //     subscription/fiat billing dropped; crypto/x402 is the only path.) ──

  // ── Marketplace · Ring 3 take-rate (BUSINESS-MODEL.md) ─────────────────
  // Basis points charged on every settled Ring 3 transaction (template
  // purchases · capability invocations · attestation grants). 500 = 5%.
  // Range: 0–10000 (0% to 100%). Snapshot at transaction time, so rate
  // changes don't retroactively shift past fees.
  platformTakeRateBps: envInt("PLATFORM_TAKE_RATE_BPS", 500),
} as const;

// Note: payout broadcast config + boot guard live in `services/economy/config.ts`
// (`economyConfig.payout.{workerEnabled,network,…}`). Domain-local rather than
// shared to keep chain-specific knobs out of the top-level surface.
