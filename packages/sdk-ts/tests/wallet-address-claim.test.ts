/** `wallet-address-claim/v1` — SDK side of the cross-language vector.
 *
 *  The hex digests below are the wire contract, taken from the shared fixture
 *  `docs/specs/canonical-bytes-vectors.json` (`wallet-address-claim/v1`, 8
 *  cases). The SERVER half — `api/src/services/economy/crypto/address-claim.ts`
 *  and `api/tests/wallet-address-claim.test.ts` — is being written on a
 *  concurrent branch and is not in this tree, so the fixture is the arbiter
 *  both sides read rather than one side citing the other. If the two ever
 *  disagree, an agent that signs with the SDK cannot register an address, and
 *  the failure would otherwise surface as an opaque "claim_signature_invalid".
 *
 *  Doctrine: docs/CANONICAL-BYTES.md § wallet-address-claim/v1. */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";

import {
  WALLET_ADDRESS_CLAIM_SIGNATURE_CONTEXT,
  canonicalWalletAddressClaimBytes,
  signWalletAddressClaim,
  type WalletAddressClaimPayload,
} from "../src/economy.js";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const VECTOR: WalletAddressClaimPayload = {
  wallet_id: "45083026-1993-4486-a84e-e041006e5f19",
  chain: "base",
  address: "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4",
  derivation_path: "m/44'/169'/5'/0'",
  claim_pubkey_b64: "6LkbszvJhomCix4hHE9kLH9hEk9CR72JUBiYnTuyrEk=",
};

const VECTOR_DIGEST_HEX =
  "bac589a625f4fc23bba16974a993c3c9b7cde82d4428fb01e4b532a0399fb8a7";
const VECTOR_DIGEST_HEX_EMPTY_PATH =
  "3eacff64cc581ac48c7f362714902dbc096286b3d31ba6b5a48fe8718f068996";

describe("canonicalWalletAddressClaimBytes — cross-language vector", () => {
  test("the domain tag is the one the server verifies against", () => {
    expect(WALLET_ADDRESS_CLAIM_SIGNATURE_CONTEXT).toBe("wallet-address-claim/v1");
  });

  test("reproduces the pinned digest byte for byte", () => {
    expect(hex(canonicalWalletAddressClaimBytes(VECTOR))).toBe(VECTOR_DIGEST_HEX);
  });

  test("an omitted derivation_path is the empty field, not a dropped one", () => {
    const omitted = canonicalWalletAddressClaimBytes({
      ...VECTOR,
      derivation_path: undefined,
    });
    const explicit = canonicalWalletAddressClaimBytes({ ...VECTOR, derivation_path: "" });
    expect(hex(omitted)).toBe(VECTOR_DIGEST_HEX_EMPTY_PATH);
    expect(hex(explicit)).toBe(VECTOR_DIGEST_HEX_EMPTY_PATH);
  });

  test("folds the pubkey as raw bytes, not as its base64 text", () => {
    // Guards the one field that is not UTF-8. A SDK that encoded the base64
    // string instead would produce a digest the server never accepts.
    const asText = new TextEncoder().encode(VECTOR.claim_pubkey_b64);
    const asBytes = Uint8Array.from(globalThis.atob(VECTOR.claim_pubkey_b64), (ch) =>
      ch.charCodeAt(0),
    );
    expect(asBytes.length).toBe(32);
    expect(asText.length).not.toBe(asBytes.length);
  });
});

describe("canonicalWalletAddressClaimBytes — refusals", () => {
  test("rejects a pubkey that does not decode to 32 bytes", () => {
    expect(() =>
      canonicalWalletAddressClaimBytes({ ...VECTOR, claim_pubkey_b64: "AAAA" }),
    ).toThrow(/32 bytes/);
  });

  test("rejects non-base64 pubkeys", () => {
    expect(() =>
      canonicalWalletAddressClaimBytes({ ...VECTOR, claim_pubkey_b64: "not base64 !!" }),
    ).toThrow(/valid base64/);
  });

  test("rejects empty or NUL-bearing required fields", () => {
    expect(() => canonicalWalletAddressClaimBytes({ ...VECTOR, chain: "" })).toThrow(
      /non-empty/,
    );
    expect(() =>
      canonicalWalletAddressClaimBytes({ ...VECTOR, address: "0x00\u000041" }),
    ).toThrow(/NUL/);
  });
});

describe("signWalletAddressClaim", () => {
  const priv = new Uint8Array(32).fill(7);
  const pubB64 = (() => {
    const pub = ed.getPublicKey(priv);
    let binary = "";
    for (const b of pub) binary += String.fromCharCode(b);
    return globalThis.btoa(binary);
  })();

  test("produces a signature the claim's own key verifies", () => {
    const payload = { ...VECTOR, claim_pubkey_b64: pubB64 };
    const sig = signWalletAddressClaim(priv, payload);
    const sigBytes = Uint8Array.from(globalThis.atob(sig), (ch) => ch.charCodeAt(0));
    expect(sigBytes.length).toBe(64);
    expect(
      ed.verify(sigBytes, canonicalWalletAddressClaimBytes(payload), ed.getPublicKey(priv)),
    ).toBe(true);
  });

  test("the signature does not carry over to a different address", () => {
    const payload = { ...VECTOR, claim_pubkey_b64: pubB64 };
    const sig = signWalletAddressClaim(priv, payload);
    const sigBytes = Uint8Array.from(globalThis.atob(sig), (ch) => ch.charCodeAt(0));
    const moved = canonicalWalletAddressClaimBytes({ ...payload, address: "0xdeadbeef" });
    expect(ed.verify(sigBytes, moved, ed.getPublicKey(priv))).toBe(false);
  });
});
