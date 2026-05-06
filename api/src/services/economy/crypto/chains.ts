/** Chain registry — supported chains, USDC contract addresses, BIP44 coin
 *  types. All canonical here so adding a chain means changing one file. */

export const EVM_CHAINS = [
  "ethereum",
  "base",
  "polygon",
  "arbitrum",
  "optimism",
] as const;

export type EvmChain = (typeof EVM_CHAINS)[number];
export type Chain = EvmChain | "solana";

export const ALL_CHAINS: readonly Chain[] = [...EVM_CHAINS, "solana"] as const;

export function isEvmChain(chain: string): chain is EvmChain {
  return (EVM_CHAINS as readonly string[]).includes(chain);
}

export function isChain(chain: string): chain is Chain {
  return chain === "solana" || isEvmChain(chain);
}

/** EIP-155 chain ID for each EVM chain (used in EIP-712 / SIWE messages). */
export const EVM_CHAIN_IDS: Record<EvmChain, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
};

/** USDC contract address per EVM chain (native USDC, not bridged). */
export const USDC_ADDRESSES: Record<EvmChain, string> = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
};

/** USDC base-unit decimals (1 USDC = 10^6 base units on every chain). */
export const USDC_DECIMALS = 6;

/** 1 USDC → 100 credits (≈ $0.01/credit). The same conversion across every
 *  chain — agents pay in whichever chain costs them the least gas. */
export const CREDITS_PER_USDC = 100;

/** Tokens supported per chain. Foundation = USDC everywhere. Native gas
 *  tokens (ETH, MATIC, SOL) are recognised for receipt logs but not
 *  auto-converted to credits — agents top up in USDC for predictable rate. */
export const SUPPORTED_TOKENS: Record<Chain, readonly string[]> = {
  ethereum: ["USDC"],
  base: ["USDC"],
  polygon: ["USDC"],
  arbitrum: ["USDC"],
  optimism: ["USDC"],
  solana: ["USDC"],
};
