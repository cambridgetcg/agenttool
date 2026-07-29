/** Economy-domain configuration. Crypto (USDC) + payout broadcast + fees.
 *  Stripe layer removed 2026-05-17 per agents-only stance — no fiat, no
 *  subscriptions; per-call x402 micropayments are the only paid path. */

import type { EvmChain } from "./crypto/chains";

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const PAYOUT_NETWORKS = ["testnet", "mainnet"] as const;
type PayoutNetwork = (typeof PAYOUT_NETWORKS)[number] | "";

function readCryptoNetwork(
  variable: "CRYPTO_NETWORK",
): PayoutNetwork {
  const v = env(variable, "");
  if (v === "" || (PAYOUT_NETWORKS as readonly string[]).includes(v)) {
    return v as PayoutNetwork;
  }
  throw new Error(
    `[economyConfig] ${variable} must be one of ${PAYOUT_NETWORKS.join(
      "|",
    )} (got: '${v}'). See docs/PAYOUT-BROADCAST-PLAN.md.`,
  );
}

/** `PAYOUT_NETWORK` is retained only as a legacy deposit-network fallback
 * while payout admission and workers are hard-resting. A stale payout-only
 * value must not prevent unrelated API paths from starting. Invalid values
 * become unavailable and crypto operations still fail closed when they try to
 * select a network. */
function readRestingPayoutNetwork(): PayoutNetwork {
  const value = env("PAYOUT_NETWORK", "");
  return (PAYOUT_NETWORKS as readonly string[]).includes(value)
    ? (value as PayoutNetwork)
    : "";
}

export const economyConfig = {
  // HD wallet derivation seed and Alchemy transfer webhooks. Alchemy issues a
  // different signing key for each webhook, so sharing one key across routes
  // would make all but one chain unverifiable.
  cryptoHdMnemonic: env("CRYPTO_HD_MNEMONIC", ""),
  // Deposit derivation, provider-watch identity, webhook network binding, and
  // token contracts all require an explicit network. PAYOUT_NETWORK remains a
  // compatibility fallback in activeNetwork(), but unset no longer means
  // mainnet and conflicting explicit values fail closed.
  cryptoNetwork: readCryptoNetwork("CRYPTO_NETWORK"),
  alchemyWebhookSigningKeys: {
    ethereum: env("ALCHEMY_WEBHOOK_SIGNING_KEY_ETHEREUM", ""),
    base: env("ALCHEMY_WEBHOOK_SIGNING_KEY_BASE", ""),
    polygon: env("ALCHEMY_WEBHOOK_SIGNING_KEY_POLYGON", ""),
    arbitrum: env("ALCHEMY_WEBHOOK_SIGNING_KEY_ARBITRUM", ""),
    optimism: env("ALCHEMY_WEBHOOK_SIGNING_KEY_OPTIMISM", ""),
  } satisfies Record<EvmChain, string>,
  // Helius (Solana) shared-secret webhook auth — sent in the Authorization
  // header on enhanced-webhook deliveries.
  heliusWebhookSecret: env("HELIUS_WEBHOOK_SECRET", ""),
  // Enhanced Helius deliveries expose human-unit numbers and no canonical
  // transfer index/fork lifecycle. Keep their legacy immediate-credit adapter
  // behind a second, explicit development opt-in until raw-atomic Solana
  // reconciliation exists.
  allowUnreconciledSolanaDeposits:
    env("CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS", "") === "1",
  // Crypto deposit webhooks credit real wallet balance and sit on an UNAUTH
  // public route, so an unset provider secret must FAIL CLOSED (reject), not
  // accept unsigned payloads — otherwise anyone can forge a deposit and mint
  // balance. Local dev that needs to POST unsigned test webhooks sets
  // CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 to opt out; production leaves it unset so
  // the safe posture is the default (no config required to be secure).
  allowUnsignedWebhooks: env("CRYPTO_WEBHOOK_ALLOW_UNSIGNED", "") === "1",

  // Retained payout configuration for durable history and a future conserved
  // provenance design. Fresh admission and worker boot are unconditionally
  // resting below; no environment flag can reopen them. Legacy payout-only
  // settings are inert and cannot make unrelated service startup fail.
  payout: {
    workerEnabled: env("PAYOUT_WORKER_ENABLED", "false") === "true",
    network: readRestingPayoutNetwork(),
    cryptoHdMnemonicTestnet: env("CRYPTO_HD_MNEMONIC_TESTNET", ""),
    // Option A explicit FX: USD per 1 GBP (e.g. 1.27 → £1 = $1.27). Earned
    // value settles in GBP pence; payout converts to the requested USDC at this
    // rate. 0/unset means "no rate" and payout refuses rather than assume par
    // (see api/src/services/economy/earned.ts::penceForUsdcPayout).
    gbpUsdRate: Number(env("PAYOUT_GBP_USD_RATE", "0")),
  },
} as const;

/** Economic payout is resting until cashable backing is conserved through
 * every debit, transfer, refund, and chargeback.
 *
 * Keep the legacy parameters so callers/tests compiled against the old helper
 * cannot turn an argument into authority. Neither environment nor caller input
 * can reopen worker boot in this release.
 */
export function payoutWorkerBootAllowed(
  _payoutEnabled = economyConfig.payout.workerEnabled,
  _globalWorkersDisabled = process.env.AGENTTOOL_DISABLE_WORKERS === "1",
): boolean {
  return false;
}

if (economyConfig.allowUnreconciledSolanaDeposits) {
  console.warn(
    "[economyConfig] ⚠ CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS=1 — " +
      "the legacy Solana webhook adapter can credit from unreconciled human-unit evidence. Development only.",
  );
}

// Deposit-webhook posture warning. Boot loudly if a provider secret is unset
// while unsigned webhooks are NOT explicitly allowed — those chains' webhooks
// will (correctly) reject, so real deposits pause until the secret is set. The
// dangerous inverse — unset secret WITH unsigned allowed — mints on forged
// payloads, so shout about it too.
{
  const unsignedAllowed = economyConfig.allowUnsignedWebhooks;
  const missing: string[] = [];
  for (const [chain, key] of Object.entries(
    economyConfig.alchemyWebhookSigningKeys,
  )) {
    if (!key) {
      missing.push(
        `ALCHEMY_WEBHOOK_SIGNING_KEY_${chain.toUpperCase()} (${chain})`,
      );
    }
  }
  if (!economyConfig.heliusWebhookSecret) missing.push("HELIUS_WEBHOOK_SECRET (Solana)");
  if (missing.length && !unsignedAllowed) {
    console.warn(
      `[economyConfig] deposit webhooks will REJECT for: ${missing.join(", ")} — ` +
        "secret unset and CRYPTO_WEBHOOK_ALLOW_UNSIGNED is off (fail-closed, correct for prod). " +
        "Set the secret to resume deposits on that chain.",
    );
  } else if (missing.length && unsignedAllowed) {
    console.warn(
      `[economyConfig] ⚠ CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 with unset secret(s): ${missing.join(", ")} — ` +
        "these webhooks accept UNSIGNED payloads and can mint balance on forged deposits. Dev-only; never set this in production.",
    );
  }
}
