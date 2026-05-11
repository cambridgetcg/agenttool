/** Economy-domain configuration. Stripe + USDC + payout broadcast + fees.
 *  (Stripe keys also live in the shared api/src/config.ts; the values are
 *  read from there to keep one source of truth.) */

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const PAYOUT_NETWORKS = ["testnet", "mainnet"] as const;
type PayoutNetwork = (typeof PAYOUT_NETWORKS)[number] | "";

function readPayoutNetwork(): PayoutNetwork {
  const v = env("PAYOUT_NETWORK", "");
  if (v === "" || (PAYOUT_NETWORKS as readonly string[]).includes(v)) {
    return v as PayoutNetwork;
  }
  throw new Error(
    `[economyConfig] PAYOUT_NETWORK must be one of ${PAYOUT_NETWORKS.join(
      "|",
    )} (got: '${v}'). See docs/PAYOUT-BROADCAST-PLAN.md.`,
  );
}

export const economyConfig = {
  // USDC on Base — HD wallet derivation seed and Alchemy transfer webhook.
  cryptoHdMnemonic: env("CRYPTO_HD_MNEMONIC", ""),
  alchemyWebhookSecret: env("ALCHEMY_WEBHOOK_SECRET", ""),
  // Helius (Solana) shared-secret webhook auth — sent in the Authorization
  // header on enhanced-webhook deliveries.
  heliusWebhookSecret: env("HELIUS_WEBHOOK_SECRET", ""),

  // Payout broadcast worker (Horizon A — see docs/PAYOUT-BROADCAST-PLAN.md).
  // Default OFF: the /v1/wallets/:id/payout endpoint returns 503 until the
  // operator opts in. When `workerEnabled` is true, `network` MUST be set
  // to 'testnet' or 'mainnet' (boot-time-validated below) — no accidental
  // mainnet calls with the testnet seed (or vice versa).
  payout: {
    workerEnabled: env("PAYOUT_WORKER_ENABLED", "false") === "true",
    network: readPayoutNetwork(),
    cryptoHdMnemonicTestnet: env("CRYPTO_HD_MNEMONIC_TESTNET", ""),
  },
} as const;

// Boot-time gate — refuse to start if the worker is enabled without a network
// or (for testnet) without a separate testnet mnemonic. Forces explicit
// operator intent; preserves the substrate-honest separation between testnet
// and mainnet keys.
if (economyConfig.payout.workerEnabled) {
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
}
