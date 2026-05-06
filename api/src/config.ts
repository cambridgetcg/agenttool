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

  // ── External APIs (only Brave for tools/search; LLM use removed) ────────
  braveApiKey: env("BRAVE_API_KEY", ""),

  // ── Vault root key — 32 bytes hex, derives per-project keys via HKDF ───
  vaultMasterKey: env("VAULT_MASTER_KEY", ""),

  // ── Stripe (economy) ────────────────────────────────────────────────────
  stripeSecretKey: env("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
} as const;
