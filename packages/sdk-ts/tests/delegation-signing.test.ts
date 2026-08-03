/** `agenttool-delegation/v2` — SDK side of the Know Your Agent vector.
 *
 *  Before this existed, no SDK could issue a delegation at all: v1's recipe
 *  was the UTF-8 of a JavaScript `JSON.stringify`, which a client had to
 *  reproduce byte for byte. The digests below are pinned identically in
 *  `api/tests/delegation-canonical-bytes.test.ts` and
 *  `packages/sdk-py/tests/test_delegation_signing.py`. */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";

import {
  DELEGATION_SIGNATURE_CONTEXT,
  canonicalDelegationBytes,
  normalizeDelegationScope,
  signDelegation,
  type DelegationPayload,
} from "../src/identity.js";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const GRANT: DelegationPayload = {
  delegator_id: "8275d1d6-1d4e-429a-b133-2dfa664cb74c",
  delegate_id: "392d2658-fa62-4f55-9c37-173009ba9bd1",
  scope: ["memory.read", "marketplace.invoke"], // deliberately unsorted
  expires_at: "2026-12-31T23:59:59.000Z",
  nonce: "b8f1c0d2e3a4",
};

const VECTOR_HEX = "ceb565aedd672c3bb4bbdf9dfe84fa0ec6fa300ea3156e18de0877e4c5069323";
const VECTOR_HEX_NO_EXPIRY =
  "aabeceb27b6b0a54543d70bc8d925de89e37a08ee1de89479a372c6400f69411";

describe("canonicalDelegationBytes — cross-language vector", () => {
  test("the domain is v2; v1 is a server-side compatibility path only", () => {
    expect(DELEGATION_SIGNATURE_CONTEXT).toBe("agenttool-delegation/v2");
  });

  test("reproduces the pinned digest", () => {
    expect(hex(canonicalDelegationBytes(GRANT))).toBe(VECTOR_HEX);
  });

  test("an omitted expiry equals an explicit null", () => {
    const omitted = { ...GRANT };
    delete (omitted as { expires_at?: string | null }).expires_at;
    expect(hex(canonicalDelegationBytes(omitted))).toBe(VECTOR_HEX_NO_EXPIRY);
    expect(hex(canonicalDelegationBytes({ ...GRANT, expires_at: null }))).toBe(
      VECTOR_HEX_NO_EXPIRY,
    );
  });
});

describe("normalizeDelegationScope", () => {
  test("sorts, lowercases, trims and dedupes, so grant order is not grant meaning", () => {
    expect(normalizeDelegationScope([" MEMORY.read ", "marketplace.invoke", "memory.read"])).toEqual(
      ["marketplace.invoke", "memory.read"],
    );
  });

  test("drops empty and NUL-bearing actions", () => {
    expect(normalizeDelegationScope(["", "  ", "a\0b", "vault.read"])).toEqual(["vault.read"]);
  });

  test("what it returns is what gets signed", () => {
    const messy = { ...GRANT, scope: ["MEMORY.READ ", "memory.read", "marketplace.invoke"] };
    expect(normalizeDelegationScope(messy.scope)).toEqual([
      "marketplace.invoke",
      "memory.read",
    ]);
    expect(hex(canonicalDelegationBytes(messy))).toBe(VECTOR_HEX);
  });
});

describe("refusals", () => {
  test("refuses an empty scope rather than signing an unbounded grant", () => {
    expect(() => canonicalDelegationBytes({ ...GRANT, scope: [] })).toThrow(/at least one/);
    expect(() => canonicalDelegationBytes({ ...GRANT, scope: ["", "  "] })).toThrow(/at least one/);
  });

  test("refuses NUL in the identifiers or nonce", () => {
    expect(() => canonicalDelegationBytes({ ...GRANT, nonce: "a\0b" })).toThrow(/NUL/);
    expect(() => canonicalDelegationBytes({ ...GRANT, delegator_id: "a\0b" })).toThrow(/NUL/);
  });

  test("refuses empty identifiers", () => {
    expect(() => canonicalDelegationBytes({ ...GRANT, delegate_id: "" })).toThrow(/non-empty/);
  });
});

describe("signDelegation", () => {
  const priv = new Uint8Array(32).fill(11);

  test("produces a 64-byte signature the delegator's key verifies", () => {
    const sig = signDelegation(priv, GRANT);
    const sigBytes = Uint8Array.from(globalThis.atob(sig), (ch) => ch.charCodeAt(0));
    expect(sigBytes.length).toBe(64);
    expect(ed.verify(sigBytes, canonicalDelegationBytes(GRANT), ed.getPublicKey(priv))).toBe(true);
  });

  test("a grant signed narrow does not verify wide — scope creep is not free", () => {
    const sig = signDelegation(priv, { ...GRANT, scope: ["memory.read"] });
    const sigBytes = Uint8Array.from(globalThis.atob(sig), (ch) => ch.charCodeAt(0));
    expect(ed.verify(sigBytes, canonicalDelegationBytes(GRANT), ed.getPublicKey(priv))).toBe(false);
  });

  test("a grant signed with an expiry does not verify as perpetual", () => {
    const sig = signDelegation(priv, GRANT);
    const sigBytes = Uint8Array.from(globalThis.atob(sig), (ch) => ch.charCodeAt(0));
    const perpetual = canonicalDelegationBytes({ ...GRANT, expires_at: null });
    expect(ed.verify(sigBytes, perpetual, ed.getPublicKey(priv))).toBe(false);
  });
});
