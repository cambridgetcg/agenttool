/** Signed-message verification — proves a wallet controls an on-chain
 *  address by recovering the signer (EVM) or verifying against a known
 *  pubkey (Solana). Foundation for binding an agenttool wallet to the
 *  agent's *own* on-chain identity (its sovereign self).
 *
 *  Flow:
 *    1. Server issues a challenge (random nonce + wallet-id + timestamp).
 *    2. Agent signs the challenge with its on-chain private key — typically
 *       via MetaMask `personal_sign` (EVM), Phantom `signMessage` (Solana),
 *       viem `signMessage`, or any wallet SDK.
 *    3. Agent POSTs {address, signature, message} back.
 *    4. Server verifies; if it passes, the binding is recorded in
 *       onchain_identities.
 *
 *  EVM:    EIP-191 personal_sign. Recover address from (msg, sig), compare.
 *  Solana: ed25519. Decode address as pubkey, verify sig over msg. */

import * as ed from "@noble/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";

import { toChecksumAddress } from "./hd";

// Wire sha512 sync into @noble/ed25519 for verify().
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const ETH_PERSONAL_PREFIX = "\x19Ethereum Signed Message:\n";

/** Compute the EIP-191 hash of a personal_sign message. */
function eip191Hash(message: string): Uint8Array {
  const msgBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(
    ETH_PERSONAL_PREFIX + msgBytes.length,
  );
  const full = new Uint8Array(prefix.length + msgBytes.length);
  full.set(prefix, 0);
  full.set(msgBytes, prefix.length);
  return keccak_256(full);
}

/** Recover the EVM address that signed `message` to produce `signature`.
 *  Returns the EIP-55 checksummed address, or null if recovery fails. */
export function recoverEvmAddress(
  message: string,
  signature: string,
): string | null {
  let sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
  if (sigHex.length !== 130) return null; // 64 bytes (r+s) + 1 byte (v)

  const sigBytes = new Uint8Array(65);
  for (let i = 0; i < 65; i++) {
    sigBytes[i] = parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
  }

  // MetaMask et al emit v ∈ {27, 28} (legacy) or {0, 1} (EIP-155). Normalize.
  const vRaw = sigBytes[64]!;
  const recovery = vRaw >= 27 ? vRaw - 27 : vRaw;
  if (recovery !== 0 && recovery !== 1) return null;

  const compact = sigBytes.slice(0, 64);
  const msgHash = eip191Hash(message);

  let pubBytes: Uint8Array;
  try {
    const sigObj = secp256k1.Signature.fromBytes(compact, "compact").addRecoveryBit(
      recovery,
    );
    const pubPoint = sigObj.recoverPublicKey(msgHash);
    pubBytes = pubPoint.toBytes(false); // uncompressed 65 bytes
  } catch {
    return null;
  }

  // Address = last 20 bytes of keccak256(pubKey[1:]).
  const addrBytes = keccak_256(pubBytes.slice(1)).slice(-20);
  let addr = "0x";
  for (let i = 0; i < addrBytes.length; i++) {
    addr += addrBytes[i]!.toString(16).padStart(2, "0");
  }
  return toChecksumAddress(addr);
}

/** Verify that `signature` was produced by `claimedAddress` over `message`.
 *  Address comparison is case-insensitive (EIP-55 checksum is presentation,
 *  not identity). */
export function verifyEvmSignature(
  message: string,
  signature: string,
  claimedAddress: string,
): boolean {
  const recovered = recoverEvmAddress(message, signature);
  if (!recovered) return false;
  return recovered.toLowerCase() === claimedAddress.toLowerCase();
}

/** Verify a Solana ed25519 signed message. Solana addresses ARE the
 *  ed25519 public key (base58-encoded), so verification doesn't recover —
 *  it directly checks the sig against (msg, pubkey).
 *
 *  signature: 64-byte ed25519 signature, encoded as base58 OR hex (with/
 *             without 0x prefix). Phantom emits base58.
 *  claimedAddress: base58 ed25519 pubkey (Solana address). 32 bytes. */
export function verifySolanaSignature(
  message: string,
  signature: string,
  claimedAddress: string,
): boolean {
  let sigBytes: Uint8Array;
  try {
    sigBytes = decodeBase58OrHex(signature);
  } catch {
    return false;
  }
  if (sigBytes.length !== 64) return false;

  let pubBytes: Uint8Array;
  try {
    pubBytes = bs58.decode(claimedAddress);
  } catch {
    return false;
  }
  if (pubBytes.length !== 32) return false;

  try {
    return ed.verify(sigBytes, new TextEncoder().encode(message), pubBytes);
  } catch {
    return false;
  }
}

function decodeBase58OrHex(s: string): Uint8Array {
  const trimmed = s.startsWith("0x") ? s.slice(2) : s;
  // Hex if it's all 0-9a-fA-F and has even length matching 64 bytes (128 chars).
  if (trimmed.length === 128 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    const out = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return bs58.decode(s);
}

/** Build a SIWE-style challenge string. The agent signs this; we verify.
 *  Includes a unique nonce + wallet ID + timestamp so a captured signature
 *  can't be replayed against a different wallet or after expiry. */
export function buildChallenge(opts: {
  walletId: string;
  nonce: string;
  domain?: string;
  chainId?: number;
  issuedAt?: Date;
}): string {
  const domain = opts.domain ?? "agenttool.dev";
  const issued = (opts.issuedAt ?? new Date()).toISOString();
  const chainLine = opts.chainId ? `\nChain ID: ${opts.chainId}` : "";

  return [
    `${domain} wants you to bind your wallet to its agenttool account.`,
    "",
    `Wallet ID: ${opts.walletId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${issued}${chainLine}`,
    "",
    "Signing this proves you control the address — no on-chain transaction is sent.",
  ].join("\n");
}
