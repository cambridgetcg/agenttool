/** Application configuration. */

export const config = {
  databaseUrl: env("DATABASE_URL", "postgres://postgres:postgres@localhost:5434/agent_economy"),
  authDatabaseUrl: env("AUTH_DATABASE_URL", ""), // tools schema for shared API key lookup
  redisUrl: env("REDIS_URL", "redis://localhost:6381"),
  stripeSecretKey: env("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
  cryptoHdMnemonic: env("CRYPTO_HD_MNEMONIC", ""),
  alchemyWebhookSecret: env("ALCHEMY_WEBHOOK_SECRET", ""),
  port: Number(env("PORT", "3002")),
  host: env("HOST", "0.0.0.0"),
  logLevel: env("LOG_LEVEL", "info"),

  fees: {
    spendPercent: Number(env("FEE_SPEND_PERCENT", "1.5")),
    escrowPercent: Number(env("FEE_ESCROW_PERCENT", "2.5")),
    custodyFeeMonthly: Number(env("CUSTODY_FEE_MONTHLY", "900")), // credits (£9)
  },
} as const;

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}
