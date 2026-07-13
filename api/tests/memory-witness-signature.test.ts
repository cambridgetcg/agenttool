import { createHash } from "node:crypto";

import * as ed from "@noble/ed25519";
import { describe, expect, test } from "bun:test";

import { canonicalAttestationBytes } from "../src/services/memory/tiers";
import {
  canonicalMemoryWitnessIssueBytes,
  MEMORY_WITNESS_ISSUE_FIELD_ORDER,
  MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
  memoryContentSha256,
  type MemoryWitnessIssueFields,
  verifyMemoryWitnessIssue,
} from "../src/services/marketplace/memory-witness-sig";
import {
  MemoryWitnessError,
  validateMemoryWitnessAuthorizationExpiry,
} from "../src/services/marketplace/memory-witness";

const base: MemoryWitnessIssueFields = {
  listing_id: "11111111-1111-4111-8111-111111111111",
  grant_id: "22222222-2222-4222-8222-222222222222",
  escrow_id: "33333333-3333-4333-8333-333333333333",
  buyer_identity_id: "44444444-4444-4444-8444-444444444444",
  buyer_project_id: "55555555-5555-4555-8555-555555555555",
  buyer_wallet_id: "66666666-6666-4666-8666-666666666666",
  memory_id: "77777777-7777-4777-8777-777777777777",
  memory_identity_id: null,
  memory_content_sha256: "a".repeat(64),
  source_tier: "foundational",
  target_tier: "constitutive",
  claim_kind: "memory_witness:constitutive:v1",
  witness_identity_id: "88888888-8888-4888-8888-888888888888",
  witness_did: "did:at:witness",
  witness_project_id: "99999999-9999-4999-8999-999999999999",
  signing_key_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  witness_wallet_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  gross_amount: 1_000,
  currency: "GBP",
  rate_bps: 500,
  platform_fee: 50,
  net_amount: 950,
  authorization_expires_at: "2026-07-13T12:05:00.000Z",
};

describe("memory-witness-issue/v1 canonical authorization", () => {
  test("locked vector matches SHA-256 of domain plus ordered NUL fields", () => {
    const parts: Buffer[] = [
      Buffer.from(MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT),
    ];
    for (const name of MEMORY_WITNESS_ISSUE_FIELD_ORDER) {
      const value = base[name];
      parts.push(Buffer.from([0]), Buffer.from(value === null ? "null" : String(value)));
    }
    const expected = createHash("sha256").update(Buffer.concat(parts)).digest("hex");
    expect(expected).toBe(
      "53e6f7cb38297ed7ba2cc377ed76bd56be44cbff77a816cf3c893a41f0b31142",
    );
    expect(Buffer.from(canonicalMemoryWitnessIssueBytes(base)).toString("hex")).toBe(expected);
    expect(canonicalMemoryWitnessIssueBytes(base)).toHaveLength(32);
  });

  test("every authority-bearing field changes the digest", () => {
    const original = Buffer.from(canonicalMemoryWitnessIssueBytes(base));
    const changes: MemoryWitnessIssueFields[] = [
      { ...base, listing_id: "c1111111-1111-4111-8111-111111111111" },
      { ...base, grant_id: "c2222222-2222-4222-8222-222222222222" },
      { ...base, escrow_id: "c3333333-3333-4333-8333-333333333333" },
      { ...base, buyer_identity_id: "c4444444-4444-4444-8444-444444444444" },
      { ...base, buyer_project_id: "c5555555-5555-4555-8555-555555555555" },
      { ...base, buyer_wallet_id: "c6666666-6666-4666-8666-666666666666" },
      { ...base, memory_id: "c7777777-7777-4777-8777-777777777777" },
      { ...base, memory_identity_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { ...base, memory_content_sha256: "b".repeat(64) },
      { ...base, claim_kind: "memory_witness:constitutive:v1.changed" },
      { ...base, witness_identity_id: "c8888888-8888-4888-8888-888888888888" },
      { ...base, witness_did: "did:at:other" },
      { ...base, witness_project_id: "c9999999-9999-4999-8999-999999999999" },
      { ...base, signing_key_id: "caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { ...base, witness_wallet_id: "cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { ...base, gross_amount: 1_001, net_amount: 951 },
      { ...base, currency: "USD" },
      { ...base, rate_bps: 501 },
      { ...base, platform_fee: 51, net_amount: 949 },
      { ...base, platform_fee: 49, net_amount: 951 },
      { ...base, authorization_expires_at: "2026-07-13T12:06:00.000Z" },
    ];
    for (const changed of changes) {
      expect(Buffer.from(canonicalMemoryWitnessIssueBytes(changed)).equals(original)).toBe(
        false,
      );
    }
  });

  test("NFC content hashing is stable", () => {
    expect(memoryContentSha256("Cafe\u0301")).toBe(memoryContentSha256("Caf\u00e9"));
  });

  test("v1 tier transition is fixed", () => {
    expect(() =>
      canonicalMemoryWitnessIssueBytes({
        ...base,
        source_tier: "episodic",
      } as unknown as MemoryWitnessIssueFields),
    ).toThrow(/foundational to constitutive/);
    expect(() =>
      canonicalMemoryWitnessIssueBytes({
        ...base,
        target_tier: "foundational",
      } as unknown as MemoryWitnessIssueFields),
    ).toThrow(/foundational to constitutive/);
  });

  test("paid verifier accepts its contract and rejects ordinary memory signatures", () => {
    const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const publicKeyB64 = Buffer.from(ed.getPublicKey(privateKey)).toString("base64");
    const paidSignature = Buffer.from(
      ed.sign(canonicalMemoryWitnessIssueBytes(base), privateKey),
    ).toString("base64");
    expect(verifyMemoryWitnessIssue(base, paidSignature, publicKeyB64)).toBe(true);

    const ordinarySignature = Buffer.from(
      ed.sign(
        canonicalAttestationBytes({
          memoryId: base.memory_id,
          tier: "constitutive",
          content: "same memory",
        }),
        privateKey,
      ),
    ).toString("base64");
    expect(verifyMemoryWitnessIssue(base, ordinarySignature, publicKeyB64)).toBe(false);
  });

  test("authorization must be canonical, live, and at most ten minutes ahead", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    expect(
      validateMemoryWitnessAuthorizationExpiry("2026-07-13T12:05:00.000Z", now),
    ).toEqual(new Date("2026-07-13T12:05:00.000Z"));

    for (const [value, code] of [
      ["2026-07-13T12:00:00.000Z", "authorization_expired"],
      ["2026-07-13T12:10:00.001Z", "authorization_expiry_invalid"],
      ["2026-07-13T12:05:00Z", "authorization_expiry_invalid"],
    ] as const) {
      try {
        validateMemoryWitnessAuthorizationExpiry(value, now);
        throw new Error("expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(MemoryWitnessError);
        expect((error as MemoryWitnessError).code).toBe(code);
      }
    }
  });
});
