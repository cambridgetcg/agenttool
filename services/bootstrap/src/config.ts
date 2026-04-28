/** Service configuration — reads from env. */

export const config = {
  port: parseInt(process.env.PORT ?? "3000"),

  /** Internal service URLs (Fly.io internal networking or public URLs). */
  identityUrl: process.env.IDENTITY_URL ?? "https://agent-identity.fly.dev",
  economyUrl: process.env.ECONOMY_URL ?? "https://agent-economy.fly.dev",
  memoryUrl: process.env.MEMORY_URL ?? "https://agent-memory.fly.dev",
  vaultUrl: process.env.VAULT_URL ?? "https://atool-vault.fly.dev",

  /** Database URL for bootstrap records (Supabase). */
  databaseUrl: process.env.DATABASE_URL ?? "",

  /** Bootstrap costs. */
  l0Cost: 5,
  l1StakeMin: 100,
  l1Cost: 20,
} as const;
