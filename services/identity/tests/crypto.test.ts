/** Tests for ed25519 crypto service. */

import { describe, test, expect } from "bun:test";
import { generateKeypair, sign, verify, canonicalPayload } from "../src/services/crypto.ts";

describe("generateKeypair", () => {
  test("generates valid base64 key pair", () => {
    const { publicKey, privateKey } = generateKeypair();
    expect(publicKey).toBeTruthy();
    expect(privateKey).toBeTruthy();
    // ed25519 public key is 32 bytes = 44 base64 chars (with padding)
    expect(Buffer.from(publicKey, "base64").length).toBe(32);
    // ed25519 private key is 32 bytes
    expect(Buffer.from(privateKey, "base64").length).toBe(32);
  });

  test("generates unique keys each time", () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

describe("sign and verify", () => {
  test("signs a message and verifies it", () => {
    const { publicKey, privateKey } = generateKeypair();
    const message = "hello, world";
    const signature = sign(message, privateKey);
    expect(signature).toBeTruthy();
    expect(verify(message, signature, publicKey)).toBe(true);
  });

  test("fails verification with wrong message", () => {
    const { publicKey, privateKey } = generateKeypair();
    const signature = sign("original", privateKey);
    expect(verify("tampered", signature, publicKey)).toBe(false);
  });

  test("fails verification with wrong key", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const signature = sign("message", kp1.privateKey);
    expect(verify("message", signature, kp2.publicKey)).toBe(false);
  });

  test("fails gracefully on invalid signature", () => {
    const { publicKey } = generateKeypair();
    expect(verify("message", "not-valid-base64!!!", publicKey)).toBe(false);
  });
});

describe("canonicalPayload", () => {
  test("produces deterministic JSON", () => {
    const payload = canonicalPayload({
      subject_id: "sub-1",
      attester_id: "att-1",
      claim: "has_capability:search",
      evidence: { url: "https://example.com" },
    });
    const parsed = JSON.parse(payload);
    expect(parsed.subject_id).toBe("sub-1");
    expect(parsed.attester_id).toBe("att-1");
    expect(parsed.claim).toBe("has_capability:search");
    expect(parsed.evidence.url).toBe("https://example.com");
  });

  test("defaults evidence to null", () => {
    const payload = canonicalPayload({
      subject_id: "sub-1",
      attester_id: "att-1",
      claim: "trusted",
    });
    const parsed = JSON.parse(payload);
    expect(parsed.evidence).toBeNull();
  });

  test("same inputs produce same output", () => {
    const input = { subject_id: "a", attester_id: "b", claim: "c" };
    expect(canonicalPayload(input)).toBe(canonicalPayload(input));
  });
});
