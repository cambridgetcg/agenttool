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
import {
  EVM_CHAINS,
  isEvmChain,
  type EvmChain,
} from "./chains";

const ALCHEMY_WEBHOOK_ID_MAX_BYTES = 256;
const ALCHEMY_CALLBACK_PATH_PREFIX = "/v1/billing/crypto-webhook/";
export const ALCHEMY_WATCH_TARGET_REVISION_MAX = 2_147_483_647;
const ALCHEMY_WATCH_DISABLED_CHAINS_MAX_BYTES = 128;
export const ALCHEMY_ADDRESS_ACTIVITY_WEBHOOK_TYPE = "ADDRESS_ACTIVITY";
export const ALCHEMY_ADDRESS_ACTIVITY_ACTIVE = true;

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

/**
 * Parse one monotonic, non-secret target revision. An absent variable starts
 * at revision 1; malformed, padded, fractional, or out-of-range values fail
 * closed instead of guessing rollout order.
 */
export function parseAlchemyWatchTargetRevision(
  value: string | undefined,
): number | null {
  if (value === undefined) return 1;
  if (!/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) &&
    revision <= ALCHEMY_WATCH_TARGET_REVISION_MAX
    ? revision
    : null;
}

/**
 * Parse the exact, explicit tombstone set. Omission (or an empty variable)
 * means no chain is disabled; it never infers disablement from a missing
 * webhook ID.
 */
export function parseAlchemyWatchDisabledChains(
  value: string | undefined,
): readonly EvmChain[] | null {
  if (value === undefined || value === "") return [];
  if (
    value.length > ALCHEMY_WATCH_DISABLED_CHAINS_MAX_BYTES ||
    value.trim() !== value
  ) {
    return null;
  }

  const chains = value.split(",");
  if (chains.length > EVM_CHAINS.length) return null;
  const seen = new Set<EvmChain>();
  for (const chain of chains) {
    if (!isEvmChain(chain) || seen.has(chain)) return null;
    seen.add(chain);
  }
  return EVM_CHAINS.filter((chain) => seen.has(chain));
}

export function parseExplicitHttpsOrigin(value: unknown): string | null {
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
  const callbackOrigin = parseExplicitHttpsOrigin(input.callbackBaseUrl);
  if (webhookId === null || callbackOrigin === null) return null;

  const canonicalPublicTarget = JSON.stringify({
    schema: "agenttool-deposit-watch-target/v2",
    provider: "alchemy",
    chain: input.chain,
    network: input.network,
    provider_network: alchemyAddressActivityNetwork(
      input.chain,
      input.network,
    ),
    provider_target_id: webhookId,
    provider_target_type: ALCHEMY_ADDRESS_ACTIVITY_WEBHOOK_TYPE,
    provider_target_active: ALCHEMY_ADDRESS_ACTIVITY_ACTIVE,
    callback_url:
      `${callbackOrigin}${ALCHEMY_CALLBACK_PATH_PREFIX}${input.chain}`,
  });
  return createHash("sha256")
    .update(canonicalPublicTarget, "utf8")
    .digest("hex");
}

export interface AlchemyDepositWatchTarget {
  fingerprint: string;
  revision: number;
}

/**
 * Resolve the exact non-secret active target presented by this process.
 * Explicitly disabled chains and malformed rollout configuration return null.
 */
export function alchemyDepositWatchTargetFromEnv(
  chain: EvmChain,
  network: ActiveNetwork,
  env: NodeJS.ProcessEnv = process.env,
): AlchemyDepositWatchTarget | null {
  const disabledChains = parseAlchemyWatchDisabledChains(
    env.ALCHEMY_WATCH_DISABLED_CHAINS,
  );
  const revision = parseAlchemyWatchTargetRevision(
    env.ALCHEMY_WATCH_TARGET_REVISION,
  );
  if (
    disabledChains === null ||
    disabledChains.includes(chain) ||
    revision === null
  ) {
    return null;
  }

  const webhookId = env[ALCHEMY_WEBHOOK_ID_ENV[chain]]?.trim();
  const callbackBaseUrl = env.AGENTTOOL_PUBLIC_URL;
  if (!webhookId || !callbackBaseUrl) return null;
  const fingerprint = alchemyDepositWatchTargetFingerprint({
    chain,
    network,
    webhookId,
    callbackBaseUrl,
  });
  return fingerprint === null ? null : { fingerprint, revision };
}
