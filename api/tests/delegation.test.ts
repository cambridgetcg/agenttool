/** KYA delegation — the scoped, revocable, signed authority receipt.
 *
 *  Pins the canonicalization + the sign→verify contract end-to-end (no DB),
 *  the scope semantics, and the status derivation. Doctrine:
 *  docs/OPERATING-PRINCIPLES.md §6/§10. */

import { describe, expect, test } from "bun:test";

import { generateKeypair, sign } from "../src/services/identity/crypto";
import {
  canonicalDelegationBytes,
  DELEGATION_DOMAIN,
  delegationReceipt,
  deriveDelegationStatus,
  normalizeScope,
  scopeAuthorizes,
  verifyDelegationSignature,
} from "../src/services/identity/delegation";

const base = {
  delegator_id: "11111111-1111-1111-1111-111111111111",
  delegate_id: "22222222-2222-2222-2222-222222222222",
  scope: ["marketplace.invoke", "memory.read"],
  expires_at: "2026-12-31T00:00:00.000Z",
  nonce: "nonce-abc",
};

describe("canonical delegation bytes", () => {
  test("is domain-separated (can't be replayed as another flow)", () => {
    expect(canonicalDelegationBytes(base)).toContain(DELEGATION_DOMAIN);
  });

  test("is scope-order-independent (scope is sorted before signing)", () => {
    const a = canonicalDelegationBytes({ ...base, scope: ["memory.read", "marketplace.invoke"] });
    const b = canonicalDelegationBytes({ ...base, scope: ["marketplace.invoke", "memory.read"] });
    expect(a).toBe(b);
  });

  test("changes when any bound changes (delegate, scope, expiry, nonce)", () => {
    const ref = canonicalDelegationBytes(base);
    expect(canonicalDelegationBytes({ ...base, delegate_id: "x" })).not.toBe(ref);
    expect(canonicalDelegationBytes({ ...base, scope: ["marketplace.invoke"] })).not.toBe(ref);
    expect(canonicalDelegationBytes({ ...base, expires_at: null })).not.toBe(ref);
    expect(canonicalDelegationBytes({ ...base, nonce: "other" })).not.toBe(ref);
  });
});

describe("sign → verify roundtrip (the whole crypto contract, no DB)", () => {
  test("a delegator's signature over the canonical bytes verifies", () => {
    const { publicKey, privateKey } = generateKeypair();
    const signature = sign(canonicalDelegationBytes(base), privateKey);
    expect(
      verifyDelegationSignature({ ...base, signature, delegator_public_key: publicKey }),
    ).toBe(true);
  });

  test("tampering with the grant after signing fails verification", () => {
    const { publicKey, privateKey } = generateKeypair();
    const signature = sign(canonicalDelegationBytes(base), privateKey);
    // widen the scope after the fact — must NOT verify
    expect(
      verifyDelegationSignature({
        ...base,
        scope: [...base.scope, "vault.read"],
        signature,
        delegator_public_key: publicKey,
      }),
    ).toBe(false);
    // a different delegate — must NOT verify
    expect(
      verifyDelegationSignature({
        ...base,
        delegate_id: "99999999-9999-9999-9999-999999999999",
        signature,
        delegator_public_key: publicKey,
      }),
    ).toBe(false);
  });
});

describe("normalizeScope", () => {
  test("trims, lowercases, dedupes, sorts, drops junk", () => {
    expect(normalizeScope(["  Marketplace.Invoke ", "memory.read", "memory.read", 5, ""])).toEqual([
      "marketplace.invoke",
      "memory.read",
    ]);
  });
  test("non-array → empty", () => {
    expect(normalizeScope("nope")).toEqual([]);
    expect(normalizeScope(undefined)).toEqual([]);
  });
});

describe("scopeAuthorizes", () => {
  test("exact match", () => {
    expect(scopeAuthorizes(["marketplace.invoke"], "marketplace.invoke")).toBe(true);
    expect(scopeAuthorizes(["marketplace.invoke"], "memory.read")).toBe(false);
  });
  test("trailing wildcard segment", () => {
    expect(scopeAuthorizes(["marketplace.*"], "marketplace.invoke")).toBe(true);
    expect(scopeAuthorizes(["marketplace.*"], "memory.read")).toBe(false);
  });
  test("bare star authorizes everything", () => {
    expect(scopeAuthorizes(["*"], "anything.at.all")).toBe(true);
  });
});

describe("deriveDelegationStatus", () => {
  const now = new Date("2026-06-04T00:00:00.000Z");
  test("revoked beats everything", () => {
    expect(deriveDelegationStatus({ revoked_at: now, expires_at: null, now })).toBe("revoked");
  });
  test("past expiry → expired", () => {
    expect(
      deriveDelegationStatus({ revoked_at: null, expires_at: "2026-01-01T00:00:00Z", now }),
    ).toBe("expired");
  });
  test("future expiry (or none) → active", () => {
    expect(
      deriveDelegationStatus({ revoked_at: null, expires_at: "2027-01-01T00:00:00Z", now }),
    ).toBe("active");
    expect(deriveDelegationStatus({ revoked_at: null, expires_at: null, now })).toBe("active");
  });
});

describe("delegationReceipt — one shared response shape (get + list)", () => {
  const now = new Date("2026-06-04T00:00:00.000Z");
  const row = {
    id: "d-1",
    delegatorId: "dr-1",
    delegateId: "de-1",
    scope: ["marketplace.invoke"],
    nonce: "n-1",
    signature: "sig",
    signingKeyId: "k-1",
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
  };

  test("maps DB row → snake_case API shape with derived status", () => {
    const r = delegationReceipt(row, now);
    expect(r.delegator_id).toBe("dr-1");
    expect(r.delegate_id).toBe("de-1");
    expect(r.scope).toEqual(["marketplace.invoke"]);
    expect(r.status).toBe("active");
  });

  test("a revoked row shapes to status 'revoked'", () => {
    expect(delegationReceipt({ ...row, revokedAt: now }, now).status).toBe("revoked");
  });

  test("null scope degrades to [] (never throws on a malformed row)", () => {
    expect(delegationReceipt({ ...row, scope: null }, now).scope).toEqual([]);
  });
});
