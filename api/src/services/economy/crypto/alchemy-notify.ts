/**
 * Pure Alchemy Notify configuration and network mapping.
 *
 * Provider I/O lives in `alchemy-watch-reconciler.ts`, behind durable
 * desired/observed state. Keeping this module pure prevents request handlers
 * from reviving the old synchronous PATCH + process-local-cache path.
 *
 * Doctrine: docs/CRYPTO-PAYMENT.md.
 */

import { createHash } from "node:crypto";

import type { ActiveNetwork } from "./network";
import type { EvmChain } from "./chains";

const ALCHEMY_WEBHOOK_ID_MAX_BYTES = 256;
const ALCHEMY_CALLBACK_PATH_PREFIX = "/v1/billing/crypto-webhook/";

export const ALCHEMY_WEBHOOK_ID_ENV: Record<EvmChain, string> = {
  ethereum: "ALCHEMY_WEBHOOK_ID_ETHEREUM",
  base: "ALCHEMY_WEBHOOK_ID_BASE",
  polygon: "ALCHEMY_WEBHOOK_ID_POLYGON",
  arbitrum: "ALCHEMY_WEBHOOK_ID_ARBITRUM",
  optimism: "ALCHEMY_WEBHOOK_ID_OPTIMISM",
};

const ADDRESS_ACTIVITY_NETWORKS: Record<
  EvmChain,
  Record<ActiveNetwork, string>
> = {
  ethereum: { mainnet: "ETH_MAINNET", testnet: "ETH_SEPOLIA" },
  base: { mainnet: "BASE_MAINNET", testnet: "BASE_SEPOLIA" },
  polygon: { mainnet: "MATIC_MAINNET", testnet: "MATIC_AMOY" },
  arbitrum: { mainnet: "ARB_MAINNET", testnet: "ARB_SEPOLIA" },
  optimism: { mainnet: "OPT_MAINNET", testnet: "OPT_SEPOLIA" },
};

export interface AlchemyNotifyConfig {
  authToken: string;
  webhookIds: Partial<Record<EvmChain, string>>;
}

export function alchemyNotifyConfig(
  env: NodeJS.ProcessEnv = process.env,
): AlchemyNotifyConfig {
  const webhookIds: Partial<Record<EvmChain, string>> = {};
  for (const [chain, name] of Object.entries(ALCHEMY_WEBHOOK_ID_ENV) as Array<
    [EvmChain, string]
  >) {
    const value = env[name]?.trim();
    if (value) webhookIds[chain] = value;
  }

  return {
    authToken: env.ALCHEMY_NOTIFY_AUTH_TOKEN?.trim() ?? "",
    webhookIds,
  };
}

export function alchemyAddressActivityNetwork(
  chain: EvmChain,
  network: ActiveNetwork,
): string {
  return ADDRESS_ACTIVITY_NETWORKS[chain][network];
}

function explicitHttpsOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() !== value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname === "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.pathname !== "/"
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function boundedWebhookId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    !/^[\x21-\x7e]+$/.test(value) ||
    new TextEncoder().encode(value).byteLength >
      ALCHEMY_WEBHOOK_ID_MAX_BYTES
  ) {
    return null;
  }
  return value;
}

/**
 * Stable identity for the public, non-secret facts an observation verifies.
 *
 * The digest deliberately excludes the Notify auth token and webhook signing
 * key. Neither a secret nor a secret-derived fingerprint may enter durable
 * watch state.
 */
export function alchemyDepositWatchTargetFingerprint(input: {
  chain: EvmChain;
  network: ActiveNetwork;
  webhookId: string;
  callbackBaseUrl: string;
}): string | null {
  const webhookId = boundedWebhookId(input.webhookId);
  const callbackOrigin = explicitHttpsOrigin(input.callbackBaseUrl);
  if (webhookId === null || callbackOrigin === null) return null;

  const canonicalPublicTarget = JSON.stringify({
    schema: "agenttool-deposit-watch-target/v1",
    provider: "alchemy",
    chain: input.chain,
    network: input.network,
    provider_network: alchemyAddressActivityNetwork(
      input.chain,
      input.network,
    ),
    provider_target_id: webhookId,
    callback_url:
      `${callbackOrigin}${ALCHEMY_CALLBACK_PATH_PREFIX}${input.chain}`,
  });
  return createHash("sha256")
    .update(canonicalPublicTarget, "utf8")
    .digest("hex");
}

/**
 * Resolve only the non-secret target inputs needed by the request path.
 * Control-plane credentials and ingress signing keys are intentionally not
 * read here.
 */
export function alchemyDepositWatchTargetFingerprintFromEnv(
  chain: EvmChain,
  network: ActiveNetwork,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const webhookId = alchemyNotifyConfig(env).webhookIds[chain];
  const callbackBaseUrl = env.AGENTTOOL_PUBLIC_URL;
  if (!webhookId || !callbackBaseUrl) return null;
  return alchemyDepositWatchTargetFingerprint({
    chain,
    network,
    webhookId,
    callbackBaseUrl,
  });
}
