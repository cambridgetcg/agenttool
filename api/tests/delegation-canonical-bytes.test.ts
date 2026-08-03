/** `agenttool-delegation/v2` — Know Your Agent, on the house recipe.
 *
 *  The hex digests here are the wire contract, pinned identically in
 *  `packages/sdk-ts/tests/delegation-signing.test.ts` and
 *  `packages/sdk-py/tests/test_delegation_signing.py`. A drift between them
 *  means an SDK-signed grant is rejected at issue with nothing but
 *  "Invalid delegation signature" to go on.
 *
 *  v1 (`JSON.stringify`) is kept verifiable for receipts issued before v2 and
 *  is exercised here so that compatibility is a tested property, not a hope. */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import * as ed from "@noble/ed25519";

import {
  DELEGATION_DOMAIN,
  DELEGATION_DOMAIN_V2,
  canonicalDelegationBytes,
  canonicalDelegationBytesV2,
  normalizeScope,
  verifyDelegationSignature,
  verifyDelegationSignatureAny,
  verifyDelegationSignatureV2,
  type DelegationGrant,
} from "../src/services/identity/delegation";

const priv = new Uint8Array(32).fill(11);
const pub = ed.getPublicKey(priv);
const pubB64 = Buffer.from(pub).toString("base64");

const GRANT: DelegationGrant = {
  delegator_id: "8275d1d6-1d4e-429a-b133-2dfa664cb74c",
  delegate_id: "392d2658-fa62-4f55-9c37-173009ba9bd1",
  scope: ["memory.read", "marketplace.invoke"], // deliberately unsorted
  expires_at: "2026-12-31T23:59:59.000Z",
  nonce: "b8f1c0d2e3a4",
};

const VECTOR_HEX = "ceb565aedd672c3bb4bbdf9dfe84fa0ec6fa300ea3156e18de0877e4c5069323";
const VECTOR_HEX_NO_EXPIRY =
  "aabeceb27b6b0a54543d70bc8d925de89e37a08ee1de89479a372c6400f69411";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const signV2 = (g: DelegationGrant) =>
  Buffer.from(ed.sign(canonicalDelegationBytesV2(g), priv)).toString("base64");

describe("agenttool-delegation/v2 — cross-language vector", () => {
  test("reproduces the digest both SDKs pin", () => {
    expect(hex(canonicalDelegationBytesV2(GRANT))).toBe(VECTOR_HEX);
  });

  test("reproduces the no-expiry digest both SDKs pin", () => {
    expect(hex(canonicalDelegationBytesV2({ ...GRANT, expires_at: null }))).toBe(
      VECTOR_HEX_NO_EXPIRY,
    );
  });

  test("matches recipe 1 spelled out by hand", () => {
    const enc = new TextEncoder();
    const NUL = new Uint8Array([0]);
    const scope = normalizeScope(GRANT.scope);
    const fields = [
      GRANT.delegator_id,
      GRANT.delegate_id,
      String(scope.length),
      ...scope,
      GRANT.expires_at ?? "",
      GRANT.nonce,
    ];
    const parts = [enc.encode(DELEGATION_DOMAIN_V2)];
    for (const f of fields) parts.push(NUL, enc.encode(f));
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) { buf.set(p, off); off += p.length; }
    expect(hex(canonicalDelegationBytesV2(GRANT))).toBe(
      createHash("sha256").update(buf).digest("hex"),
    );
  });
});

describe("agenttool-delegation/v2 — what the bytes bind", () => {
  test("scope order does not change the grant", () => {
    const reordered = { ...GRANT, scope: ["marketplace.invoke", "memory.read"] };
    expect(hex(canonicalDelegationBytesV2(reordered))).toBe(VECTOR_HEX);
  });

  test("scope duplicates do not change the grant", () => {
    const dupes = { ...GRANT, scope: ["memory.read", "MEMORY.READ ", "marketplace.invoke"] };
    expect(hex(canonicalDelegationBytesV2(dupes))).toBe(VECTOR_HEX);
  });

  test("every field is bound", () => {
    const mutations: DelegationGrant[] = [
      { ...GRANT, delegator_id: "8275d1d6-1d4e-429a-b133-2dfa664cb74d" },
      { ...GRANT, delegate_id: "392d2658-fa62-4f55-9c37-173009ba9bd0" },
      { ...GRANT, scope: ["memory.read"] },
      { ...GRANT, scope: [...GRANT.scope, "vault.read"] },
      { ...GRANT, expires_at: "2027-01-01T00:00:00.000Z" },
      { ...GRANT, nonce: "b8f1c0d2e3a5" },
    ];
    for (const m of mutations) {
      expect(hex(canonicalDelegationBytesV2(m))).not.toBe(VECTOR_HEX);
    }
  });

  test("the bound scope count stops a variable-length run being re-partitioned", () => {
    // Without the count, ["a","b"] + expires "" and ["a"] + expires "b" could
    // compose the same NUL-separated stream. With it, they cannot.
    const twoActions = { ...GRANT, scope: ["a", "b"], expires_at: null };
    const oneActionExpiryB = { ...GRANT, scope: ["a"], expires_at: "b" };
    expect(hex(canonicalDelegationBytesV2(twoActions))).not.toBe(
      hex(canonicalDelegationBytesV2(oneActionExpiryB)),
    );
  });

  test("a NUL-bearing action is dropped, never allowed to smuggle a separator", () => {
    expect(normalizeScope(["memory.read", "a\0b"])).toEqual(["memory.read"]);
  });

  test("refuses to compose when a non-scope field carries NUL", () => {
    expect(() => canonicalDelegationBytesV2({ ...GRANT, nonce: "a\0b" })).toThrow(/U\+0000/);
  });
});

describe("verification", () => {
  test("a v2 signature verifies as v2 and reports its domain", () => {
    const sig = signV2(GRANT);
    expect(verifyDelegationSignatureV2({ ...GRANT, signature: sig, delegator_public_key: pubB64 })).toBe(true);
    expect(
      verifyDelegationSignatureAny({ ...GRANT, signature: sig, delegator_public_key: pubB64 }),
    ).toBe(DELEGATION_DOMAIN_V2);
  });

  test("a v1 signature still verifies, and is reported as v1", () => {
    const v1Bytes = canonicalDelegationBytes(GRANT);
    const sig = Buffer.from(ed.sign(new TextEncoder().encode(v1Bytes), priv)).toString("base64");
    expect(verifyDelegationSignature({ ...GRANT, signature: sig, delegator_public_key: pubB64 })).toBe(true);
    expect(
      verifyDelegationSignatureAny({ ...GRANT, signature: sig, delegator_public_key: pubB64 }),
    ).toBe(DELEGATION_DOMAIN);
  });

  test("the two domains do not verify as each other", () => {
    const v2Sig = signV2(GRANT);
    expect(verifyDelegationSignature({ ...GRANT, signature: v2Sig, delegator_public_key: pubB64 })).toBe(false);
  });

  test("a signature for a narrower grant does not verify a wider one", () => {
    const narrow = { ...GRANT, scope: ["memory.read"] };
    const sig = signV2(narrow);
    expect(
      verifyDelegationSignatureAny({ ...GRANT, signature: sig, delegator_public_key: pubB64 }),
    ).toBeNull();
  });

  test("verification returns null rather than throwing on malformed input", () => {
    expect(
      verifyDelegationSignatureAny({
        ...GRANT,
        nonce: "a\0b",
        signature: signV2(GRANT),
        delegator_public_key: pubB64,
      }),
    ).toBeNull();
    expect(
      verifyDelegationSignatureAny({ ...GRANT, signature: "", delegator_public_key: pubB64 }),
    ).toBeNull();
  });
});
