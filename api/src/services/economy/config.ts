/** Economy-domain configuration. Crypto (USDC) + payout broadcast + fees.
 *  Stripe layer removed 2026-05-17 per agents-only stance — no fiat, no
 *  subscriptions; per-call x402 micropayments are the only paid path. */

import { isProductionOrFlyRuntime } from "../../lib/production-runtime";
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
  // reconciliation exists. Read it through unreconciledSolanaDepositsAllowed(),
  // which refuses it in a production runtime.
  allowUnreconciledSolanaDeposits:
    env("CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS", "") === "1",
  // Crypto deposit webhooks credit real wallet balance and sit on an UNAUTH
  // public route, so an unset provider secret must FAIL CLOSED (reject), not
  // accept unsigned payloads — otherwise anyone can forge a deposit and mint
  // balance. Local dev that needs to POST unsigned test webhooks sets
  // CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 to opt out. Read it through
  // unsignedDepositWebhooksAllowed(), which refuses it in a production
  // runtime whatever the environment says.
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

/** Crypto deposit-address disclosure is resting (owner decision, 2026-10-11),
 * the way payout admission rests. Showing any address, new or issued before
 * the rest, invites a deposit, so no environment flag can reopen disclosure
 * in this release. Inbound webhook processing is a separate path and is not
 * gated here.
 */
export function depositAddressDisclosureAllowed(): boolean {
  return false;
}

/** Generic escrow create — POST /v1/escrows — is resting (owner decision,
 * 2026-10-18), the way payout admission and deposit-address disclosure rest.
 * After authentication the route refuses every request with stable 503
 * escrow_resting, before body validation or any escrow or wallet database
 * read, so no wallet is debited. No environment flag can reopen it. Creation
 * rests because createEscrow debits the creator wallet without the wallet
 * spending policy that spendFromWallet enforces (see
 * services/economy/escrow.ts); a reviewed reopening must add those checks
 * first.
 *
 * Release and refund are not gated (owner decision 2026-10-19, PR #494
 * option B), so escrows that already exist settle at the creator's direction
 * through POST /v1/escrows/:id/release and /:id/refund. They honour wallet
 * status, the creator wallet's spending policy, and the escrow's deadline
 * and accepted worker (services/economy/escrow.ts, "Settlement checks"), and
 * a release pays whichever wallet accepted the escrow. The escrow service
 * uses no Redis, so they also run in a process started with
 * AGENTTOOL_DISABLE_WORKERS=1. Before this release the routes passed an
 * unused getRedis() argument, which throws in that posture, so create,
 * release, and refund all answered an unnamed 503 redis_disabled there. The
 * hosted API's serving process reported that posture at /public/plans
 * (no_exploit_loophole.ip_rate_limit.worker_startup_disabled=true, observed
 * 2026-10-19); nothing in the canonical API deploy guarantees it, because
 * .github/workflows/deploy-api.yml and api/fly.toml neither set nor check the
 * flag (docs/DEPLOY-CI.md). On a deployment run with workers enabled, the
 * create rest closes a route that was open. On a deployment run with workers
 * disabled, the posture the hosted API reported, the opposite holds for
 * release and refund: this release turns them on there, and they move
 * balances where they refused before.
 *
 * Accept (worker assignment), dispute, and reads move no balance and are not
 * gated. Workflow-managed marketplace escrows (managed_by set) refuse the
 * generic transitions with 409 and settle through their workflows. Escrows
 * that dispute bonds, substrate-task bounties, and template purchases create
 * carry managed_by NULL; the generic transitions recognise them by the row
 * that references them and refuse them with 409 too. Contract:
 * docs/SAFETY-BOUNDARIES.md ("Generic escrow create and wallet spend —
 * resting"); policy: docs/BUSINESS-MODEL.md.
 */
export function genericEscrowCreateAllowed(): boolean {
  return false;
}

/** CRYPTO_WEBHOOK_ALLOW_UNSIGNED applies only outside a production runtime
 * (NODE_ENV=production or FLY_APP_NAME set). Read at request time. */
export function unsignedDepositWebhooksAllowed(): boolean {
  return economyConfig.allowUnsignedWebhooks && !isProductionOrFlyRuntime();
}

/** CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS applies only outside a
 * production runtime (NODE_ENV=production or FLY_APP_NAME set). Read at
 * request time. */
export function unreconciledSolanaDepositsAllowed(): boolean {
  return (
    economyConfig.allowUnreconciledSolanaDeposits &&
    !isProductionOrFlyRuntime()
  );
}

if (economyConfig.allowUnreconciledSolanaDeposits) {
  console.warn(
    isProductionOrFlyRuntime()
      ? "[economyConfig] CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS=1 is refused in this production runtime " +
          "(NODE_ENV=production or FLY_APP_NAME set); Solana webhook credit stays off."
      : "[economyConfig] ⚠ CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS=1 — " +
          "the legacy Solana webhook adapter can credit from unreconciled human-unit evidence. Development only.",
  );
}

// Deposit-webhook posture warning. Boot loudly if a provider secret is unset
// while unsigned webhooks are NOT explicitly allowed — those chains' webhooks
// will (correctly) reject. Setting a secret restores signature verification
// only: deposit-address disclosure is resting and credit has further
// conditions (see errors.webhookSecretUnset). The
// dangerous inverse — unset secret WITH unsigned allowed — mints on forged
// payloads, so shout about it too.
{
  const unsignedAllowed = unsignedDepositWebhooksAllowed();
  if (economyConfig.allowUnsignedWebhooks && !unsignedAllowed) {
    console.warn(
      "[economyConfig] CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 is refused in this production runtime " +
        "(NODE_ENV=production or FLY_APP_NAME set); unsigned deposit webhooks are rejected.",
    );
  }
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
        "secret unset and unsigned webhooks are not allowed (fail-closed, correct for prod). " +
        "Setting the secret restores signature verification only; deposit-address disclosure is resting and credit has further conditions.",
    );
  } else if (missing.length && unsignedAllowed) {
    console.warn(
      `[economyConfig] ⚠ CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 with unset secret(s): ${missing.join(", ")} — ` +
        "these webhooks accept UNSIGNED payloads and can mint balance on forged deposits. Dev-only; never set this in production.",
    );
  }
}
