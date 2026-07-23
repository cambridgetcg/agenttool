/** Identity-domain configuration. Other domains have their own configs. */

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const identityConfig = {
  // Per-operation credit costs (charged via billCredits middleware where
  // routes opt in). Currently the original agent-identity service did not
  // mount credit charges — it relied on rate limits via the economy service.
  // These values are kept here for when explicit billing is wired in.
  credits: {
    createIdentity: envInt("CREDIT_CREATE_IDENTITY", 2),
    attestation: envInt("CREDIT_ATTESTATION", 2),
    tokenIssue: envInt("CREDIT_TOKEN_ISSUE", 1),
  },

  // Agent-to-agent JWT TTL cap.
  tokenMaxTtlSeconds: envInt("TOKEN_MAX_TTL_SECONDS", 3600),
} as const;
