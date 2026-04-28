/** Application configuration from environment variables. */

export const config = {
  databaseUrl: env("DATABASE_URL", "postgresql://postgres:4oj7VvrI3mYMOB8T@db.ndovnywhgqatdpbkhiio.supabase.co:5432/postgres"),

  // Vault master key (32 bytes hex) for HKDF key derivation
  vaultMasterKey: env("VAULT_MASTER_KEY", ""),

  // agent-economy (billing authority — internal)
  economyUrl: env("ECONOMY_URL", "http://localhost:8004"),

  // Application
  port: Number(env("PORT", "3000")),
  host: env("HOST", "0.0.0.0"),
  logLevel: env("LOG_LEVEL", "info"),

  // Credit costs
  credits: {
    writeSecret: Number(env("CREDIT_WRITE_SECRET", "2")),
    readSecret: Number(env("CREDIT_READ_SECRET", "1")),
    listSecrets: Number(env("CREDIT_LIST_SECRETS", "1")),
    deleteSecret: Number(env("CREDIT_DELETE_SECRET", "1")),
    readAudit: Number(env("CREDIT_READ_AUDIT", "1")),
    bulkWrite: Number(env("CREDIT_BULK_WRITE", "2")),  // per secret
    policyUpdate: Number(env("CREDIT_POLICY_UPDATE", "1")),
  },

  plans: {
    free: { credits: 50, ratePerMin: 5 },
    seed: { credits: 2_500, ratePerMin: 30 },
    grow: { credits: 10_000, ratePerMin: 100 },
    scale: { credits: Infinity, ratePerMin: 500 },
  },

  // Rate limiting
  maxReadsPerMin: Number(env("MAX_READS_PER_MIN", "60")),
} as const;

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export type Plan = keyof typeof config.plans;
