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
  variable: "CRYPTO_NETWORK" | "PAYOUT_NETWORK",
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
  // Crypto deposit webhooks credit real wallet balance and sit on an UNAUTH
  // public route, so an unset provider secret must FAIL CLOSED (reject), not
  // accept unsigned payloads — otherwise anyone can forge a deposit and mint
  // balance. Local dev that needs to POST unsigned test webhooks sets
  // CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 to opt out; production leaves it unset so
  // the safe posture is the default (no config required to be secure).
  allowUnsignedWebhooks: env("CRYPTO_WEBHOOK_ALLOW_UNSIGNED", "") === "1",

  // Payout broadcast worker (Horizon A — see docs/PAYOUT-BROADCAST-PLAN.md).
  // Default OFF: the /v1/wallets/:id/payout endpoint returns 503 until the
  // operator opts in. When `workerEnabled` is true and the global worker
  // switch is unset, `network` MUST be 'testnet' or 'mainnet'
  // (boot-time-validated below) — no accidental mainnet calls with the
  // testnet seed (or vice versa).
  payout: {
    workerEnabled: env("PAYOUT_WORKER_ENABLED", "false") === "true",
    network: readCryptoNetwork("PAYOUT_NETWORK"),
    cryptoHdMnemonicTestnet: env("CRYPTO_HD_MNEMONIC_TESTNET", ""),
    // Option A explicit FX: USD per 1 GBP (e.g. 1.27 → £1 = $1.27). Earned
    // value settles in GBP pence; payout converts to the requested USDC at this
    // rate. 0/unset means "no rate" and payout refuses rather than assume par
    // (see api/src/services/economy/earned.ts::penceForUsdcPayout).
    gbpUsdRate: Number(env("PAYOUT_GBP_USD_RATE", "0")),
  },
} as const;

if (
  economyConfig.cryptoNetwork !== "" &&
  economyConfig.payout.network !== "" &&
  economyConfig.cryptoNetwork !== economyConfig.payout.network
) {
  throw new Error(
    "[economyConfig] CRYPTO_NETWORK and PAYOUT_NETWORK must match when both are set; refusing mixed-network crypto operations.",
  );
}

/** Both the payout-specific opt-in and the global worker switch must allow
 * payout workers to run. Keep this predicate shared by startup and the
 * payout-request route so the API cannot accept work that startup refuses. */
export function payoutWorkerBootAllowed(
  payoutEnabled = economyConfig.payout.workerEnabled,
  globalWorkersDisabled = process.env.AGENTTOOL_DISABLE_WORKERS === "1",
): boolean {
  return payoutEnabled && !globalWorkersDisabled;
}

// Boot-time gate — when worker boot is allowed, refuse to start without a
// network or (for testnet) a separate testnet mnemonic. The global off-switch
// makes payout configuration inactive, so missing payout-only values do not
// prevent an API-only process from starting.
if (payoutWorkerBootAllowed()) {
  if (economyConfig.payout.network === "") {
    throw new Error(
      "[economyConfig] PAYOUT_WORKER_ENABLED=true requires PAYOUT_NETWORK=testnet|mainnet (currently unset). See docs/PAYOUT-BROADCAST-PLAN.md.",
    );
  }
  if (
    economyConfig.payout.network === "testnet" &&
    !economyConfig.payout.cryptoHdMnemonicTestnet
  ) {
    throw new Error(
      "[economyConfig] PAYOUT_NETWORK=testnet requires CRYPTO_HD_MNEMONIC_TESTNET (kept separate from CRYPTO_HD_MNEMONIC mainnet seed). See docs/PAYOUT-BROADCAST-PLAN.md.",
    );
  }
  if (!(economyConfig.payout.gbpUsdRate > 0)) {
    // Fail closed: earned value is GBP pence; without an explicit GBP→USD rate
    // a payout would either assume par (£1=$1) or reuse a mis-valued credit
    // constant. Refuse to boot rather than cash out at a rate nobody set.
    throw new Error(
      "[economyConfig] PAYOUT_WORKER_ENABLED=true requires PAYOUT_GBP_USD_RATE > 0 (USD per 1 GBP, e.g. 1.27). Earned value settles in GBP; payout converts at this rate. See docs/PAYOUT-BROADCAST-PLAN.md.",
    );
  }
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
