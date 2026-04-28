/** Application configuration from environment variables. */

export const config = {
  databaseUrl: env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/agent_verify"),
  redisUrl: env("REDIS_URL", "redis://localhost:6379"),

  // LLM providers (for claim parsing + judge)
  openaiApiKey: env("OPENAI_API_KEY", ""),
  parserModel: env("PARSER_MODEL", "gpt-4o-mini"),
  judgeModel: env("JUDGE_MODEL", "gpt-4o"),

  // Sources
  braveApiKey: env("BRAVE_API_KEY", ""),
  serpApiKey: env("SERPAPI_KEY", ""),

  // agent-economy (billing authority — internal)
  economyUrl: env("ECONOMY_URL", "http://localhost:8004"),

  // Stripe
  stripeSecretKey: env("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),

  // Application
  port: Number(env("PORT", "3001")),
  host: env("HOST", "0.0.0.0"),
  logLevel: env("LOG_LEVEL", "info"),

  // Credit costs
  credits: {
    standardVerify: Number(env("CREDIT_STANDARD_VERIFY", "5")),
    fastVerify: Number(env("CREDIT_FAST_VERIFY", "2")),
    batchVerify: Number(env("CREDIT_BATCH_VERIFY", "4")),
  },

  // Cache TTLs (seconds)
  cacheTtl: {
    finance: 3600,        // 1 hour
    legal: 86400,         // 24 hours
    science: 604800,      // 7 days
    general: 14400,       // 4 hours
  },

  plans: {
    dev: { credits: 50, ratePerMin: 5 },
    starter: { credits: 2_500, ratePerMin: 30 },
    pro: { credits: 10_000, ratePerMin: 100 },
    enterprise: { credits: Infinity, ratePerMin: 500 },
  },
} as const;

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export type Plan = keyof typeof config.plans;
