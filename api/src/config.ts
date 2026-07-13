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

  // ── finger (RFC 1288) ───────────────────────────────────────────────────
  // 0 disables the listener. Fly maps external :79 → this internal port.
  // docs/FINGER.md — public projections only.
  fingerPort: envInt("FINGER_PORT", 0),

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

  // ── Provider keys stay agent-owned ──────────────────────────────────────
  // Self runtimes call providers from the user's machine. Bridged/trusted
  // hosted runtimes call the chosen provider from AgentTool's worker using
  // a project vault key. The platform charges its own storage/compute/queue/
  // network surface; provider billing remains on the agent's provider key.
  // See docs/IDENTITY-ANCHOR.md promise 6 — "Your providers are yours."

  // ── Vault root key — 32 bytes hex, derives per-project keys via HKDF ───
  vaultMasterKey: env("VAULT_MASTER_KEY", ""),

  // ── Stripe · the human gift ramp (returned 2026-07-02, human-door call —
  //     one-time gift-credit checkouts only; still no subscriptions.
  //     docs/superpowers/specs/2026-07-02-human-door-design.md) ──────────
  stripeSecretKey: env("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
  giftMinMinor: envInt("GIFT_MIN_MINOR", 100), // $1.00
  giftMaxMinor: envInt("GIFT_MAX_MINOR", 50000), // $500.00
  webBaseUrl: env("WEB_BASE_URL", "https://agenttool.dev"),

  // ── Marketplace · Ring 3 take-rate (BUSINESS-MODEL.md) ─────────────────
  // Basis points charged on every settled Ring 3 transaction (template
  // purchases · capability invocations · attestation grants). 500 = 5%.
  // Range: 0–10000 (0% to 100%). Snapshot at transaction time, so rate
  // changes don't retroactively shift past fees.
  platformTakeRateBps: envInt("PLATFORM_TAKE_RATE_BPS", 500),

  // ── Registration proof-of-work (the free-but-no-exploit gate) ──────────
  // Difficulty in BITS for the register-agent PoW. 18 ≈ ~250k tries ≈ 1–2s of
  // CPU — free to try, costly to farm (Sybil resistance). One source: the
  // register flow enforces it; /public/plans advertises it. No drift.
  registerAgentPowBits: envInt("AGENTTOOL_REGISTER_AGENT_POW_BITS", 18),
} as const;

// Note: payout broadcast config + boot guard live in `services/economy/config.ts`
// (`economyConfig.payout.{workerEnabled,network,…}`). Domain-local rather than
// shared to keep chain-specific knobs out of the top-level surface.
