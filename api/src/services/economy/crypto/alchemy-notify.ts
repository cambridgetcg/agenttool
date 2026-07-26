/**
 * Pure Alchemy Notify configuration and network mapping.
 *
 * Provider I/O lives in `alchemy-watch-reconciler.ts`, behind durable
 * desired/observed state. Keeping this module pure prevents request handlers
 * from reviving the old synchronous PATCH + process-local-cache path.
 *
 * Doctrine: docs/CRYPTO-PAYMENT.md.
 */

import type { ActiveNetwork } from "./network";
import type { EvmChain } from "./chains";

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
