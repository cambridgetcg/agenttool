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
  databaseUrl: env(
    "DATABASE_URL",
    "postgres://postgres:postgres@localhost:5432/agenttool",
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

  // ── Stripe (economy) ────────────────────────────────────────────────────
  stripeSecretKey: env("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
} as const;

// Note: payout broadcast config + boot guard live in `services/economy/config.ts`
// (`economyConfig.payout.{workerEnabled,network,…}`). Domain-local rather than
// shared to keep chain-specific knobs out of the top-level surface.
