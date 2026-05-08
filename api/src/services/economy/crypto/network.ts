/** Network-aware helpers for crypto operations. Switch between mainnet
 *  and testnet behavior based on `economyConfig.payout.network`. When the
 *  network is unset (the default), behavior is mainnet — preserving existing
 *  semantics for deployments that haven't opted into the payout broadcast
 *  worker yet.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md. */

import { economyConfig } from "../config";
import { EVM_CHAIN_IDS, USDC_ADDRESSES, type EvmChain } from "./chains";

/** Circle-issued canonical testnet USDC contracts. */
export const USDC_ADDRESSES_TESTNET: Record<EvmChain, string> = {
  ethereum: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia
  base: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",     // Base Sepolia
  polygon: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",  // Polygon Amoy
  arbitrum: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia
  optimism: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", // Optimism Sepolia
};

/** Solana USDC mint on devnet (mainnet mint lives in chains.ts). */
export const USDC_SOL_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** Alchemy URL subdomain per (chain, network). */
const ALCHEMY_NETWORKS: Record<EvmChain, { mainnet: string; testnet: string }> = {
  ethereum: { mainnet: "eth-mainnet", testnet: "eth-sepolia" },
  base:     { mainnet: "base-mainnet", testnet: "base-sepolia" },
  polygon:  { mainnet: "polygon-mainnet", testnet: "polygon-amoy" },
  arbitrum: { mainnet: "arb-mainnet", testnet: "arb-sepolia" },
  optimism: { mainnet: "opt-mainnet", testnet: "opt-sepolia" },
};

/** EIP-155 chain IDs for testnet variants. Mainnet IDs in chains.ts. */
export const EVM_TESTNET_CHAIN_IDS: Record<EvmChain, number> = {
  ethereum: 11155111, // Sepolia
  base:     84532,    // Base Sepolia
  polygon:  80002,    // Polygon Amoy
  arbitrum: 421614,   // Arbitrum Sepolia
  optimism: 11155420, // Optimism Sepolia
};

/** Confirmation thresholds (blocks of finality before status='confirmed'). */
export const EVM_CONFIRMATION_THRESHOLDS: Record<EvmChain, number> = {
  ethereum: 12,
  base:     12,
  polygon:  64, // historically deeper reorgs
  arbitrum: 12,
  optimism: 12,
};

export type ActiveNetwork = "mainnet" | "testnet";

/** The network this instance is operating against. Defaults to mainnet
 *  when `payout.network` is unset (preserves existing behavior). */
export function activeNetwork(): ActiveNetwork {
  return economyConfig.payout.network === "testnet" ? "testnet" : "mainnet";
}

/** The HD mnemonic for the active network. Throws if unset. */
export function activeMnemonic(): string {
  if (activeNetwork() === "testnet") {
    if (!economyConfig.payout.cryptoHdMnemonicTestnet) {
      throw new Error(
        "CRYPTO_HD_MNEMONIC_TESTNET is unset — cannot derive testnet keys.",
      );
    }
    return economyConfig.payout.cryptoHdMnemonicTestnet;
  }
  if (!economyConfig.cryptoHdMnemonic) {
    throw new Error("CRYPTO_HD_MNEMONIC is unset — cannot derive mainnet keys.");
  }
  return economyConfig.cryptoHdMnemonic;
}

/** USDC contract address on the active network. */
export function activeUsdcAddress(chain: EvmChain): string {
  if (activeNetwork() === "testnet") return USDC_ADDRESSES_TESTNET[chain];
  return USDC_ADDRESSES[chain];
}

/** EIP-155 chain ID on the active network. */
export function activeChainId(chain: EvmChain): number {
  if (activeNetwork() === "testnet") return EVM_TESTNET_CHAIN_IDS[chain];
  return EVM_CHAIN_IDS[chain];
}

/** Build the Alchemy RPC URL for a chain on the active network.
 *  Requires `ALCHEMY_API_KEY` env. Throws if missing. */
export function alchemyRpcUrl(chain: EvmChain): string {
  const apiKey = process.env.ALCHEMY_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "ALCHEMY_API_KEY is unset — required to build RPC URLs for payout broadcast.",
    );
  }
  const subdomain = ALCHEMY_NETWORKS[chain][activeNetwork()];
  return `https://${subdomain}.g.alchemy.com/v2/${apiKey}`;
}
