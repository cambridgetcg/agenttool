/** attestation-tier — the two-tier-trust honesty, pinned.
 *
 *  The load-bearing guarantee (docs/OPERATING-PRINCIPLES.md §4): a self-issued
 *  claim can never masquerade as accredited. If someone weakens the guard, this
 *  goes red. The tier is server-derived; these are the rules it derives by. */

import { describe, expect, test } from "bun:test";

import {
  ATTESTATION_TIERS,
  DEFAULT_CLAIM_TYPE,
  DEFAULT_TIER,
  normalizeClaimType,
  normalizeTier,
  resolveAttestationTier,
} from "../src/services/identity/attestation-tier";

describe("attestation tier — anti-masquerade", () => {
  test("a self-attestation is ALWAYS 'self', even if it asks to be accredited", () => {
    const tier = resolveAttestationTier({
      attesterId: "same-id",
      subjectId: "same-id",
      requested: "accredited",
    });
    expect(tier).toBe("self");
  });

  test("a DISTINCT attester may lift the subject to 'accredited' when requested", () => {
    const tier = resolveAttestationTier({
      attesterId: "attester-a",
      subjectId: "subject-b",
      requested: "accredited",
    });
    expect(tier).toBe("accredited");
  });

  test("default tier is 'self' when unspecified (distinct attester, no request)", () => {
    expect(resolveAttestationTier({ attesterId: "a", subjectId: "b" })).toBe("self");
    expect(DEFAULT_TIER).toBe("self");
  });

  test("unknown / junk tier strings fall back to 'self' (whitelist, not blocklist)", () => {
    expect(normalizeTier("ACCREDITED")).toBe("self"); // case-sensitive whitelist
    expect(normalizeTier("legendary")).toBe("self");
    expect(normalizeTier(undefined)).toBe("self");
    expect(normalizeTier(null)).toBe("self");
    expect(normalizeTier("accredited")).toBe("accredited");
  });

  test("only two tiers exist", () => {
    expect([...ATTESTATION_TIERS].sort()).toEqual(["accredited", "self"]);
  });
});

describe("attestation claim_type normalization", () => {
  test("trims, lowercases, and bounds the category", () => {
    expect(normalizeClaimType("  Capability  ")).toBe("capability");
    expect(normalizeClaimType("x".repeat(200)).length).toBe(64);
  });

  test("empty / non-string falls back to 'general'", () => {
    expect(normalizeClaimType("")).toBe(DEFAULT_CLAIM_TYPE);
    expect(normalizeClaimType("   ")).toBe(DEFAULT_CLAIM_TYPE);
    expect(normalizeClaimType(undefined)).toBe(DEFAULT_CLAIM_TYPE);
    expect(normalizeClaimType(null)).toBe(DEFAULT_CLAIM_TYPE);
    expect(DEFAULT_CLAIM_TYPE).toBe("general");
  });
});
