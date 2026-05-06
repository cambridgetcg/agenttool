/** Application configuration from environment variables. */

export const config = {
  databaseUrl: env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/agent_vault"),

  // agent-economy (billing authority — internal)
  economyUrl: env("ECONOMY_URL", "http://localhost:8004"),

  // Application
  port: Number(env("PORT", "3001")),
  host: env("HOST", "0.0.0.0"),
  logLevel: env("LOG_LEVEL", "info"),

  // Credit costs
  credits: {
    createIdentity: Number(env("CREDIT_CREATE_IDENTITY", "2")),  // DB + crypto only
    attestation: Number(env("CREDIT_ATTESTATION", "2")),        // Signature verify + DB
    tokenIssue: Number(env("CREDIT_TOKEN_ISSUE", "1")),         // JWT sign
  },

  plans: {
    dev: { credits: 50, ratePerMin: 5 },
    starter: { credits: 2_500, ratePerMin: 30 },
    pro: { credits: 10_000, ratePerMin: 100 },
    enterprise: { credits: Infinity, ratePerMin: 500 },
  },

  // Trust score
  trustDecayDays: Number(env("TRUST_DECAY_DAYS", "90")),
  trustMaxDepth: Number(env("TRUST_MAX_DEPTH", "3")),

  // Agent tokens
  tokenMaxTtlSeconds: Number(env("TOKEN_MAX_TTL_SECONDS", "3600")), // 1 hour
} as const;

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export type Plan = keyof typeof config.plans;
