/** `wallet-address-claim/v1` — the identity half of agent-held wallet custody.
 *
 *  Pure unit tests over the canonical bytes and their verification. The
 *  chain-native half (verifyEvmSignature / verifySolanaSignature) and the
 *  registration route's wallet checks are exercised elsewhere; nothing here
 *  touches a database. */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import * as ed from "@noble/ed25519";

import {
  WALLET_ADDRESS_CLAIM_DOMAIN,
  addressesEqual,
  canonicalAddressClaimBytes,
  verifyAddressClaim,
  type AddressClaim,
} from "../src/services/economy/crypto/address-claim";

const priv = new Uint8Array(32).fill(7);
const pub = ed.getPublicKey(priv);
const pubB64 = Buffer.from(pub).toString("base64");

const claim: AddressClaim = {
  walletId: "45083026-1993-4486-a84e-e041006e5f19",
  chain: "base",
  address: "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4",
  derivationPath: "m/44'/169'/5'/0'",
  claimPubkeyB64: pubB64,
};

function sign(c: AddressClaim): string {
  return Buffer.from(ed.sign(canonicalAddressClaimBytes(c), priv)).toString("base64");
}

/** The wire contract, shared with `packages/sdk-ts/tests/wallet-address-claim.test.ts`.
 *  If these drift, an agent signing with the SDK cannot register an address and
 *  the failure surfaces only as an opaque "claim_signature_invalid". */
const VECTOR_DIGEST_HEX =
  "bac589a625f4fc23bba16974a993c3c9b7cde82d4428fb01e4b532a0399fb8a7";
const VECTOR_DIGEST_HEX_EMPTY_PATH =
  "3eacff64cc581ac48c7f362714902dbc096286b3d31ba6b5a48fe8718f068996";
const VECTOR_PUBKEY_B64 = "6LkbszvJhomCix4hHE9kLH9hEk9CR72JUBiYnTuyrEk=";

describe("canonicalAddressClaimBytes — cross-language vector", () => {
  const vector: AddressClaim = { ...claim, claimPubkeyB64: VECTOR_PUBKEY_B64 };

  test("reproduces the digest the TS SDK pins", () => {
    expect(Buffer.from(canonicalAddressClaimBytes(vector)).toString("hex")).toBe(
      VECTOR_DIGEST_HEX,
    );
  });

  test("reproduces the empty-derivation-path digest the TS SDK pins", () => {
    expect(
      Buffer.from(canonicalAddressClaimBytes({ ...vector, derivationPath: "" })).toString("hex"),
    ).toBe(VECTOR_DIGEST_HEX_EMPTY_PATH);
  });
});

describe("canonicalAddressClaimBytes — recipe 1", () => {
  test("is a 32-byte sha256 digest", () => {
    expect(canonicalAddressClaimBytes(claim)).toHaveLength(32);
  });

  test("matches the recipe spelled out in the doc-comment, byte for byte", () => {
    const enc = new TextEncoder();
    const NUL = new Uint8Array([0]);
    const parts = [
      enc.encode(WALLET_ADDRESS_CLAIM_DOMAIN),
      NUL, enc.encode(claim.walletId),
      NUL, enc.encode(claim.chain),
      NUL, enc.encode(claim.address),
      NUL, enc.encode(claim.derivationPath),
      NUL, new Uint8Array(Buffer.from(claim.claimPubkeyB64, "base64")),
    ];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { buf.set(p, off); off += p.length; }
    const expected = new Uint8Array(createHash("sha256").update(buf).digest());
    expect(canonicalAddressClaimBytes(claim)).toEqual(expected);
  });

  test("every field is bound — changing any one changes the digest", () => {
    const base = Buffer.from(canonicalAddressClaimBytes(claim)).toString("hex");
    const mutations: AddressClaim[] = [
      { ...claim, walletId: "45083026-1993-4486-a84e-e041006e5f18" },
      { ...claim, chain: "polygon" },
      { ...claim, address: "0x5B38Da6a701c568545dCfcB03FcB875f56beddC5" },
      { ...claim, derivationPath: "m/44'/169'/5'/1'" },
      { ...claim, claimPubkeyB64: Buffer.from(ed.getPublicKey(new Uint8Array(32).fill(9))).toString("base64") },
    ];
    for (const m of mutations) {
      expect(Buffer.from(canonicalAddressClaimBytes(m)).toString("hex")).not.toBe(base);
    }
  });

  test("an undisclosed derivation path is a present empty field, not a missing one", () => {
    // Field count must never vary, or two different claims could collide.
    const empty = canonicalAddressClaimBytes({ ...claim, derivationPath: "" });
    expect(empty).toHaveLength(32);
    expect(Buffer.from(empty).toString("hex")).not.toBe(
      Buffer.from(canonicalAddressClaimBytes(claim)).toString("hex"),
    );
  });

  test("NUL separation resists field-boundary smuggling", () => {
    // "base" + address vs "base<addr>" + "" must not hash alike.
    const a = canonicalAddressClaimBytes({ ...claim, chain: "base", address: "0xAA" });
    const b = canonicalAddressClaimBytes({ ...claim, chain: "base0xAA", address: "" });
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });
});

describe("verifyAddressClaim", () => {
  test("accepts a signature over the exact claim", () => {
    expect(verifyAddressClaim(claim, sign(claim))).toBe(true);
  });

  test("rejects a signature made for a different wallet", () => {
    const other = { ...claim, walletId: "00000000-0000-0000-0000-000000000000" };
    expect(verifyAddressClaim(claim, sign(other))).toBe(false);
  });

  test("rejects a signature made for a different address", () => {
    const other = { ...claim, address: "0xdeadbeef00000000000000000000000000000000" };
    expect(verifyAddressClaim(claim, sign(other))).toBe(false);
  });

  test("rejects a valid signature re-labelled with someone else's key", () => {
    // The pubkey is folded into its own bytes precisely to stop this.
    const impostor = Buffer.from(ed.getPublicKey(new Uint8Array(32).fill(9))).toString("base64");
    expect(verifyAddressClaim({ ...claim, claimPubkeyB64: impostor }, sign(claim))).toBe(false);
  });

  test("refuses rather than throws on malformed input", () => {
    expect(verifyAddressClaim(claim, "")).toBe(false);
    expect(verifyAddressClaim({ ...claim, claimPubkeyB64: "" }, sign(claim))).toBe(false);
    expect(verifyAddressClaim(claim, "not-base64-!!!")).toBe(false);
    expect(verifyAddressClaim({ ...claim, claimPubkeyB64: "AAAA" }, sign(claim))).toBe(false);
  });
});

describe("addressesEqual", () => {
  test("EVM comparison ignores EIP-55 checksum casing", () => {
    expect(addressesEqual("base", "0xAbC123", "0xabc123")).toBe(true);
  });

  test("Solana base58 comparison stays case-significant", () => {
    // Different base58 casing is a different address, not a formatting variant.
    expect(addressesEqual("solana", "7dHbWXmci", "7dhbwxmci")).toBe(false);
    expect(addressesEqual("solana", "7dHbWXmci", "7dHbWXmci")).toBe(true);
  });
});
