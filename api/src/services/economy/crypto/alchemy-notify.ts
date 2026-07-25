/**
 * Narrow Alchemy Notify adapter for keeping AgentTool deposit addresses on
 * the provider's Address Activity webhook watchlists.
 *
 * This module manages existing webhook subscriptions only. It does not create
 * or delete Alchemy apps/webhooks, reveal credentials, ingest events, sign
 * transactions, or broadcast anything.
 *
 * Doctrine: docs/CRYPTO-PAYMENT.md.
 */

import { isAddress } from "viem";

import type { ActiveNetwork } from "./network";
import type { EvmChain } from "./chains";

const UPDATE_ADDRESSES_URL =
  "https://dashboard.alchemy.com/api/update-webhook-addresses";
const DEFAULT_TIMEOUT_MS = 10_000;

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

const acceptedRegistrations = new Set<string>();

export interface AlchemyNotifyConfig {
  authToken: string;
  webhookIds: Partial<Record<EvmChain, string>>;
  timeoutMs: number;
}

export class AlchemyNotifyConfigurationError extends Error {
  readonly code = "alchemy_notify_unconfigured";

  constructor(message: string) {
    super(message);
    this.name = "AlchemyNotifyConfigurationError";
  }
}

export class AlchemyNotifyUnavailableError extends Error {
  readonly code = "alchemy_notify_unavailable";
  readonly status: number | null;

  constructor(status: number | null) {
    super(
      status === null
        ? "Alchemy address-watch registration did not complete."
        : `Alchemy address-watch registration returned HTTP ${status}.`,
    );
    this.name = "AlchemyNotifyUnavailableError";
    this.status = status;
  }
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
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export function alchemyAddressActivityNetwork(
  chain: EvmChain,
  network: ActiveNetwork,
): string {
  return ADDRESS_ACTIVITY_NETWORKS[chain][network];
}

export async function ensureAlchemyAddressWatched(options: {
  chain: EvmChain;
  address: string;
  config?: AlchemyNotifyConfig;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!isAddress(options.address)) {
    throw new TypeError("Alchemy watch registration requires a valid EVM address.");
  }

  const config = options.config ?? alchemyNotifyConfig();
  if (!config.authToken) {
    throw new AlchemyNotifyConfigurationError(
      "ALCHEMY_NOTIFY_AUTH_TOKEN is unset; refusing to claim automatic EVM deposit detection.",
    );
  }
  const webhookId = config.webhookIds[options.chain];
  if (!webhookId) {
    throw new AlchemyNotifyConfigurationError(
      `${ALCHEMY_WEBHOOK_ID_ENV[options.chain]} is unset; refusing to claim automatic ${options.chain} deposit detection.`,
    );
  }
  if (
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 1 ||
    config.timeoutMs > 60_000
  ) {
    throw new AlchemyNotifyConfigurationError(
      "Alchemy Notify timeout must be an integer between 1 and 60000 milliseconds.",
    );
  }

  // Repeated GETs should not repeatedly mutate the provider control plane.
  // This cache is deliberately only an in-process optimization for the real
  // default transport; explicit configs/transports remain fully testable. A
  // durable desired/observed outbox is still required for cross-replica truth.
  const cacheKey = `${options.chain}\0${webhookId}\0${options.address.toLowerCase()}`;
  const cacheable = options.config === undefined && options.fetchImpl === undefined;
  if (cacheable && acceptedRegistrations.has(cacheKey)) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(UPDATE_ADDRESSES_URL, {
      method: "PATCH",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-alchemy-token": config.authToken,
      },
      body: JSON.stringify({
        webhook_id: webhookId,
        addresses_to_add: [options.address],
        addresses_to_remove: [],
      }),
    });

    if (!response.ok) {
      // Do not read or reflect the provider body. It is not needed for the
      // retry decision and an upstream response is not a safe error channel.
      throw new AlchemyNotifyUnavailableError(response.status);
    }
    if (cacheable) acceptedRegistrations.add(cacheKey);
  } catch (error) {
    if (
      error instanceof AlchemyNotifyConfigurationError ||
      error instanceof AlchemyNotifyUnavailableError
    ) {
      throw error;
    }
    throw new AlchemyNotifyUnavailableError(null);
  } finally {
    clearTimeout(timer);
  }
}

export const ALCHEMY_NOTIFY_UPDATE_URL = UPDATE_ADDRESSES_URL;
