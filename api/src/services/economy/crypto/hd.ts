/** HD wallet derivation — BIP44 EVM + SLIP-0010 Solana addresses from a
 *  single root mnemonic.
 *
 *  Every wallet gets a deterministic deposit address per chain. The
 *  derivation is reproducible: given the same CRYPTO_HD_MNEMONIC and
 *  wallet UUID, the address is always the same on every chain we support.
 *  This is load-bearing for the webhook → wallet attribution flow.
 *
 *  Paths:
 *    EVM:    m/44'/60'/0'/0/<wallet-index>   (unhardened final segment;
 *                                              same address on all EVM chains)
 *    Solana: m/44'/501'/<wallet-index>'/0'   (Phantom-compatible; all
 *                                              segments hardened per SLIP-0010)
 *
 *  wallet-index = first 31 bits of SHA-256(walletId). For Solana we add
 *  the hardened bit at derive time. */

import * as ed from "@noble/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import bs58 from "bs58";

import type { Chain, EvmChain } from "./chains";

const COIN_TYPE_EVM = 60; // BIP44 — used for ALL EVM chains by convention
const COIN_TYPE_SOLANA = 501;
const HARDENED = 0x80000000;

// Wire sha512 sync into @noble/ed25519 (already done by identity/crypto.ts
// at module load, but redoing here makes this module self-sufficient).
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

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

// ── SLIP-0010 ed25519 (Solana) ──────────────────────────────────────────
//
// Reference: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
// ed25519 SLIP-0010 supports hardened derivation only.

const SLIP10_ED25519_KEY = new TextEncoder().encode("ed25519 seed");

interface Slip10Node {
  privateKey: Uint8Array; // 32 bytes
  chainCode: Uint8Array; // 32 bytes
}

function slip10MasterFromSeed(seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, SLIP10_ED25519_KEY, seed);
  return { privateKey: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

function slip10ChildHardened(parent: Slip10Node, index: number): Slip10Node {
  if (index < HARDENED) {
    throw new Error("SLIP-0010 ed25519 only supports hardened derivation");
  }
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parent.privateKey, 1);
  // index as big-endian uint32
  data[33] = (index >>> 24) & 0xff;
  data[34] = (index >>> 16) & 0xff;
  data[35] = (index >>> 8) & 0xff;
  data[36] = index & 0xff;
  const I = hmac(sha512, parent.chainCode, data);
  return { privateKey: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

function parseSlip10Path(path: string): number[] {
  if (!path.startsWith("m/")) throw new Error("path must start with m/");
  const parts = path.slice(2).split("/").filter((s) => s.length > 0);
  return parts.map((p) => {
    const hardened = p.endsWith("'") || p.endsWith("h");
    const numStr = p.replace(/['h]$/, "");
    const num = parseInt(numStr, 10);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error(`invalid path segment: ${p}`);
    }
    if (!hardened) {
      throw new Error(
        `SLIP-0010 ed25519 requires all hardened: ${p} (use ${p}')`,
      );
    }
    return (num + HARDENED) >>> 0;
  });
}

function deriveSlip10Ed25519(seed: Uint8Array, path: string): Slip10Node {
  let node = slip10MasterFromSeed(seed);
  for (const segment of parseSlip10Path(path)) {
    node = slip10ChildHardened(node, segment);
  }
  return node;
}

/** Derive a Solana deposit address. Path: m/44'/501'/<walletIndex>'/0'
 *  (Phantom-compatible). Address = base58(ed25519 public key from seed). */
export function deriveSolanaAddress(
  mnemonic: string,
  walletId: string,
): DerivedAddress {
  const seed = getSeed(mnemonic);
  const idx = walletIndex(walletId);
  const path = `m/44'/${COIN_TYPE_SOLANA}'/${idx}'/0'`;
  const { privateKey } = deriveSlip10Ed25519(seed, path);
  const publicKey = ed.getPublicKey(privateKey);
  return {
    address: bs58.encode(publicKey),
    derivation_path: path,
  };
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

/** True if we can derive a deposit address for this chain right now.
 *  Both EVM (BIP44 secp256k1) and Solana (SLIP-0010 ed25519) are live. */
export function isChainSupported(_chain: Chain): boolean {
  return true;
}

export type { EvmChain };
