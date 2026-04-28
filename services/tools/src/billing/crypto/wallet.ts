/** HD wallet — deterministic USDC deposit address per project (Base L2). */

import { HDNodeWallet, Mnemonic } from "ethers";
import { config } from "../../config";

/**
 * Derive a deterministic deposit address for a project.
 * Uses BIP-44 path: m/44'/8453'/0'/0/{index}
 * (8453 = Base chain ID, used as coin type for namespacing)
 *
 * We derive the index from the project UUID by hashing it to a 31-bit integer.
 */
export function getDepositAddress(projectId: string): { address: string; path: string } {
  if (!config.cryptoHdMnemonic) {
    throw new Error("CRYPTO_HD_MNEMONIC is not configured");
  }

  const index = projectIdToIndex(projectId);
  const path = `m/44'/8453'/0'/0/${index}`;

  const mnemonic = Mnemonic.fromPhrase(config.cryptoHdMnemonic);
  const wallet = HDNodeWallet.fromMnemonic(mnemonic, path);

  return { address: wallet.address, path };
}

/**
 * Derive a consistent index (0 to 2^31-1) from a UUID string.
 * Simple: take first 8 hex chars of UUID, parse as int, mask to 31 bits.
 */
function projectIdToIndex(projectId: string): number {
  const hex = projectId.replace(/-/g, "").slice(0, 8);
  return parseInt(hex, 16) & 0x7fffffff;
}

/** Base L2 USDC contract address (bridged via Coinbase). */
export const USDC_BASE_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Convert USDC amount (6 decimals) to credits. 1 credit = £0.008 ≈ $0.01. */
export function usdcToCredits(amountRaw: bigint): number {
  // USDC has 6 decimals. amountRaw / 1e6 = USD amount.
  // $0.01 per credit → credits = USD amount × 100 = amountRaw / 10_000
  return Number(amountRaw / 10_000n);
}
