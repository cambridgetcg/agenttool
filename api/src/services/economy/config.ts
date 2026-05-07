/** Economy-domain configuration. Stripe + USDC + fees.
 *  (Stripe keys also live in the shared api/src/config.ts; the values are
 *  read from there to keep one source of truth.) */

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export const economyConfig = {
  // USDC on Base — HD wallet derivation seed and Alchemy transfer webhook.
  cryptoHdMnemonic: env("CRYPTO_HD_MNEMONIC", ""),
  alchemyWebhookSecret: env("ALCHEMY_WEBHOOK_SECRET", ""),
  // Helius (Solana) shared-secret webhook auth — sent in the Authorization
  // header on enhanced-webhook deliveries.
  heliusWebhookSecret: env("HELIUS_WEBHOOK_SECRET", ""),

  // Per-spend / per-escrow / monthly custody fees.
  fees: {
    spendPercent: envFloat("FEE_SPEND_PERCENT", 1.5),
    escrowPercent: envFloat("FEE_ESCROW_PERCENT", 2.5),
    custodyFeeMonthly: envFloat("CUSTODY_FEE_MONTHLY", 900), // credits (£9)
  },
} as const;
