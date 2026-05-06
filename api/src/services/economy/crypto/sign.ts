/** Signed-message verification — proves a wallet controls an on-chain
 *  address by recovering the signer from an EIP-191 personal_sign
 *  signature. This is the foundation for binding an agenttool wallet to
 *  the agent's *own* on-chain identity (its sovereign self).
 *
 *  Flow:
 *    1. Server issues a challenge (random nonce + wallet-id + timestamp).
 *    2. Agent signs the challenge with its on-chain private key — typically
 *       via MetaMask `personal_sign`, viem `signMessage`, or any wallet SDK.
 *    3. Agent POSTs {address, signature, message} back.
 *    4. Server recovers the address from the signature; if it matches the
 *       claimed address, the binding is recorded in onchain_identities.
 *
 *  EVM is supported here (EIP-191). Solana ed25519 verification is a
 *  one-liner with @noble/ed25519 once we surface it; deferred for the
 *  same reason as HD derivation. */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { toChecksumAddress } from "./hd";

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
