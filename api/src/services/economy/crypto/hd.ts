/** HD wallet derivation — BIP44 EVM addresses from a single root mnemonic.
 *
 *  Every wallet gets a deterministic deposit address per chain. The
 *  derivation is reproducible: given the same CRYPTO_HD_MNEMONIC and
 *  wallet UUID, the address is always the same. This is load-bearing
 *  for the webhook → wallet attribution flow.
 *
 *  EVM derivation path: m/44'/60'/0'/0/<wallet-index>
 *  where wallet-index = first 31 bits of SHA-256(walletId), keeping it in
 *  the unhardened range (BIP44 convention reserves bit 31 for hardened).
 *
 *  Solana uses SLIP-0010 (ed25519) which is structurally different from
 *  BIP32 secp256k1; deferred to Phase 3c — see deriveSolanaAddress. */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import type { Chain, EvmChain } from "./chains";

const COIN_TYPE_EVM = 60; // BIP44 — used for ALL EVM chains by convention
const COIN_TYPE_SOLANA = 501;

let cachedSeed: Uint8Array | null = null;
let cachedSeedFor: string = "";

function getSeed(mnemonic: string): Uint8Array {
  if (cachedSeed && cachedSeedFor === mnemonic) return cachedSeed;
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error(
      "CRYPTO_HD_MNEMONIC is not a valid BIP-39 mnemonic. " +
        "Generate one with: `bunx -y @scure/bip39 generate` or any standard wallet.",
    );
  }
  cachedSeed = mnemonicToSeedSync(mnemonic);
  cachedSeedFor = mnemonic;
  return cachedSeed;
}

/** Map a wallet UUID to a stable BIP44 address index (0 ≤ idx < 2^31). */
export function walletIndex(walletId: string): number {
  const bytes = new TextEncoder().encode(walletId);
  const h = sha256(bytes);
  const idx = ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
  return idx & 0x7fffffff;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

/** EIP-55 mixed-case checksum encoding. */
export function toChecksumAddress(addr: string): string {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(a)));
  let out = "0x";
  for (let i = 0; i < a.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? a[i]!.toUpperCase() : a[i];
  }
  return out;
}

export interface DerivedAddress {
  address: string;
  derivation_path: string;
}

/** Derive an EVM deposit address for (mnemonic, walletId). The address is
 *  the same on every EVM chain (Ethereum, Base, Polygon, Arbitrum, Optimism)
 *  — the wallet's native account, with USDC tokens read by chain-specific
 *  webhooks. */
export function deriveEvmAddress(
  mnemonic: string,
  walletId: string,
): DerivedAddress {
  const seed = getSeed(mnemonic);
  const idx = walletIndex(walletId);
  const path = `m/44'/${COIN_TYPE_EVM}'/0'/0/${idx}`;
  const hd = HDKey.fromMasterSeed(seed);
  const child = hd.derive(path);
  if (!child.privateKey) {
    throw new Error("HD derivation produced no private key");
  }
  const pub = secp256k1.getPublicKey(child.privateKey, false); // 65 bytes uncompressed
  const addr = keccak_256(pub.slice(1)).slice(-20);
  return {
    address: toChecksumAddress("0x" + bytesToHex(addr)),
    derivation_path: path,
  };
}

/** Solana deposit derivation — Phase 3c.
 *  Solana uses SLIP-0010 (ed25519 hardened-only derivation). Implementing
 *  it correctly is ~50 LOC of careful crypto; deferred to keep the
 *  foundation commit reviewable. The schema, routes, and webhook scaffold
 *  all support Solana — only this derivation function is gated. */
export function deriveSolanaAddress(_mnemonic: string, _walletId: string): never {
  throw new Error(
    "Solana deposit address derivation pending Phase 3c (SLIP-0010 ed25519). " +
      "EVM chains (ethereum, base, polygon, arbitrum, optimism) are live.",
  );
}

/** Single entry point for routes — dispatches by chain family. */
export function deriveDepositAddress(
  mnemonic: string,
  chain: Chain,
  walletId: string,
): DerivedAddress {
  if (chain === "solana") return deriveSolanaAddress(mnemonic, walletId);
  // All EVM chains share the same address.
  return deriveEvmAddress(mnemonic, walletId);
}

/** True if we can derive a deposit address for this chain right now. */
export function isChainSupported(chain: Chain): boolean {
  if (chain === "solana") return false;
  return true;
}

/** Reference to suppress unused-import warnings for future Solana hookup. */
export const _futureSolanaCoinType = COIN_TYPE_SOLANA;

export type { EvmChain };
