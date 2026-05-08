/** Network-aware helpers for crypto operations. Switch between mainnet
 *  and testnet behavior based on `economyConfig.payout.network`. When the
 *  network is unset (the default), behavior is mainnet — preserving existing
 *  semantics for deployments that haven't opted into the payout broadcast
 *  worker yet.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md. */

import { economyConfig } from "../config";
import {
  EVM_CHAIN_IDS,
  USDC_ADDRESSES,
  USDC_SOL_MINT,
  type EvmChain,
} from "./chains";

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

/** Public unauth'd RPCs for testnet — used as a fallback when no Alchemy
 *  / per-chain override is configured. Mainnet refuses to use these (the
 *  resolver throws); testnet is fine to lean on for development + smoke. */
const PUBLIC_TESTNET_RPCS: Record<EvmChain, string> = {
  ethereum: "https://ethereum-sepolia-rpc.publicnode.com",
  base:     "https://base-sepolia-rpc.publicnode.com",
  polygon:  "https://polygon-amoy-bor-rpc.publicnode.com",
  arbitrum: "https://arbitrum-sepolia-rpc.publicnode.com",
  optimism: "https://optimism-sepolia-rpc.publicnode.com",
};

/** Build the RPC URL for a chain on the active network. Resolution order:
 *
 *    1. `RPC_URL_<CHAIN>_<NETWORK>` env override (e.g.
 *       `RPC_URL_ETHEREUM_TESTNET=https://my-rpc.example/...`)
 *    2. `ALCHEMY_API_KEY` env → Alchemy URL with active network's subdomain
 *    3. **Testnet only**: a public unauth'd RPC fallback
 *
 *  Mainnet refuses to fall through to the public fallback — operators
 *  must explicitly set ALCHEMY_API_KEY (or per-chain override) before
 *  any mainnet broadcast can happen. The point is to make
 *  silent-mainnet-via-public-RPC impossible. */
export function rpcUrl(chain: EvmChain): string {
  const network = activeNetwork();

  // 1. Per-chain explicit override — wins over everything.
  const envKey = `RPC_URL_${chain.toUpperCase()}_${network.toUpperCase()}`;
  const override = process.env[envKey];
  if (override) return override;

  // 2. Alchemy with shared API key.
  const apiKey = process.env.ALCHEMY_API_KEY ?? "";
  if (apiKey) {
    const subdomain = ALCHEMY_NETWORKS[chain][network];
    return `https://${subdomain}.g.alchemy.com/v2/${apiKey}`;
  }

  // 3. Testnet falls back to public RPCs. Mainnet does NOT — explicit auth
  //    is required for production broadcasts to prevent silent reliance on
  //    a public node that may rate-limit / disappear / get man-in-the-middled.
  if (network === "testnet") return PUBLIC_TESTNET_RPCS[chain];

  throw new Error(
    `No mainnet RPC URL: set ALCHEMY_API_KEY or RPC_URL_${chain.toUpperCase()}_MAINNET.`,
  );
}

/** @deprecated kept for any callers that still import the old name. Prefer rpcUrl. */
export const alchemyRpcUrl = rpcUrl;

// ── Solana ──────────────────────────────────────────────────────────────

/** Build the Solana RPC URL for the active network. Resolution order:
 *
 *    1. `RPC_URL_SOLANA_<NETWORK>` env override (e.g.
 *       `RPC_URL_SOLANA_TESTNET=https://my-rpc.example/...`)
 *    2. `HELIUS_API_KEY` env → Helius URL with active network's subdomain
 *    3. **Testnet only**: public devnet fallback
 *       (`https://api.devnet.solana.com`)
 *
 *  Mainnet refuses to fall through to a public RPC — same wall as the EVM
 *  resolver: explicit operator auth is required for mainnet broadcasts. */
export function solanaRpcUrl(): string {
  const network = activeNetwork();

  // 1. Explicit override.
  const envKey = `RPC_URL_SOLANA_${network.toUpperCase()}`;
  const override = process.env[envKey];
  if (override) return override;

  // 2. Helius shared API key.
  const apiKey = process.env.HELIUS_API_KEY ?? "";
  if (apiKey) {
    return network === "testnet"
      ? `https://devnet.helius-rpc.com/?api-key=${apiKey}`
      : `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }

  // 3. Testnet falls back to public devnet RPC. Mainnet does NOT.
  if (network === "testnet") return "https://api.devnet.solana.com";

  throw new Error(
    "No mainnet Solana RPC: set HELIUS_API_KEY or RPC_URL_SOLANA_MAINNET.",
  );
}

/** USDC SPL mint address on the active Solana network. */
export function activeUsdcMintSolana(): string {
  return activeNetwork() === "testnet" ? USDC_SOL_MINT_DEVNET : USDC_SOL_MINT;
}

/** Solana finality semantics — we treat `finalized` as "confirmed" for
 *  payout purposes. This constant lets the confirm-worker share the
 *  threshold concept with EVM (which uses block-count). */
export const SOLANA_CONFIRMATION = "finalized" as const;
