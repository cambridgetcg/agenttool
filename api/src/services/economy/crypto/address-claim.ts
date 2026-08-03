/** `wallet-address-claim/v1` — the agent binds a chain address it derived
 *  itself to one of its wallets.
 *
 *  This is the identity half of agent-held wallet custody. The other half is
 *  chain-native: proving the address's own key signed something (see
 *  `sign.ts` · `verifyEvmSignature` / `verifySolanaSignature`, reached through
 *  `issueChallenge` + `verifyAndBind`). Both are required, and they answer
 *  different questions:
 *
 *    chain-native proof  — "somebody controls this address"
 *    this claim          — "*this agent* is that somebody, and binds it here"
 *
 *  Either alone is insufficient. A chain proof without the claim lets any
 *  caller who can relay a signature attach a stranger's address to a wallet;
 *  a claim without the chain proof lets an agent register an address it does
 *  not hold and mis-route its own deposits.
 *
 *  The claim key is the agent's ed25519 identity key — the same key that
 *  registered the identity — so a wallet address is bound under the identity
 *  root rather than under a bearer. Bearers are project-wide and rotatable;
 *  custody should not follow them.
 *
 *  Recipe 1 (`docs/CANONICAL-BYTES.md` — the default NUL-separated shape):
 *
 *      sha256(
 *        utf8("wallet-address-claim/v1") || 0x00 ||
 *        utf8(wallet_id)                 || 0x00 ||
 *        utf8(chain)                     || 0x00 ||
 *        utf8(address)                   || 0x00 ||
 *        utf8(derivation_path)           || 0x00 ||
 *        base64decode(claim_pubkey_b64)
 *      )
 *
 *  `derivation_path` is the empty string when the agent declines to disclose
 *  it; the field is always present so the field count never varies.
 *
 *  The claim pubkey is folded into its own bytes. It is redundant against the
 *  verifying key by construction, and deliberately so: it stops a signature
 *  made for one key from being replayed as a claim naming another. */

import { verifyBytes } from "../../identity/crypto";
import { composeCanonicalBytes } from "../../mathos/encode";

export const WALLET_ADDRESS_CLAIM_DOMAIN = "wallet-address-claim/v1";

/** Recipe ordinal 1 — sha256 over the NUL-separated domain-tagged fields. */
export const WALLET_ADDRESS_CLAIM_RECIPE_ORDINAL = 1;

export interface AddressClaim {
  walletId: string;
  chain: string;
  address: string;
  /** Empty string when undisclosed. Never omitted. */
  derivationPath: string;
  claimPubkeyB64: string;
}

/** The exact 32-byte digest an agent signs to claim an address. */
export function canonicalAddressClaimBytes(claim: AddressClaim): Uint8Array {
  const enc = new TextEncoder();
  return composeCanonicalBytes(WALLET_ADDRESS_CLAIM_RECIPE_ORDINAL, WALLET_ADDRESS_CLAIM_DOMAIN, [
    enc.encode(claim.walletId),
    enc.encode(claim.chain),
    enc.encode(claim.address),
    enc.encode(claim.derivationPath),
    new Uint8Array(Buffer.from(claim.claimPubkeyB64, "base64")),
  ]);
}

/** Verify a claim signature against the key the claim names.
 *
 *  Returns false rather than throwing on every malformed input — a bad claim
 *  is a refusal, not an exception. This proves the signature and nothing
 *  else: that the named key is the wallet's registered agent key, and that
 *  the address is really controlled, are separate checks the caller must
 *  still make. */
export function verifyAddressClaim(
  claim: AddressClaim,
  signatureB64: string,
): boolean {
  if (!claim.claimPubkeyB64 || !signatureB64) return false;
  return verifyBytes(canonicalAddressClaimBytes(claim), signatureB64, claim.claimPubkeyB64);
}

/** Normalise an address for comparison without discarding what the agent
 *  submitted. EVM addresses are case-insensitive hex with an optional
 *  EIP-55 checksum; Solana addresses are base58 and case IS significant. */
export function addressesEqual(chain: string, a: string, b: string): boolean {
  if (chain === "solana") return a === b;
  return a.toLowerCase() === b.toLowerCase();
}
