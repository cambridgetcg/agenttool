/** Tests for JWT token issuance and verification. */

import { describe, test, expect } from "bun:test";
import { generateKeypair } from "../src/services/crypto.ts";
import { issueToken, verifyToken } from "../src/services/tokens.ts";

describe("issueToken + verifyToken", () => {
  test("issues and verifies a valid JWT", async () => {
    const { publicKey, privateKey } = generateKeypair();

    const token = await issueToken({
      privateKey,
      publicKey,
      subjectDid: "did:at:alice",
      audienceDid: "did:at:bob",
      kid: "key-1",
      ttlSeconds: 60,
    });

    expect(token).toBeTruthy();
    expect(token.split(".").length).toBe(3); // JWT has 3 parts

    const payload = await verifyToken(token, publicKey);
    expect(payload.sub).toBe("did:at:alice");
    expect(payload.aud).toBe("did:at:bob");
    expect(payload.iss).toBe("agent-identity");
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
  });

  test("rejects token with wrong public key", async () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();

    const token = await issueToken({
      privateKey: kp1.privateKey,
      publicKey: kp1.publicKey,
      subjectDid: "did:at:alice",
      audienceDid: "did:at:bob",
      kid: "key-1",
    });

    await expect(verifyToken(token, kp2.publicKey)).rejects.toThrow();
  });

  test("respects max TTL cap", async () => {
    const { publicKey, privateKey } = generateKeypair();

    const token = await issueToken({
      privateKey,
      publicKey,
      subjectDid: "did:at:alice",
      audienceDid: "did:at:bob",
      kid: "key-1",
      ttlSeconds: 999999, // way over 1h max
    });

    const payload = await verifyToken(token, publicKey);
    // Should be capped at ~3600s from now
    const maxExpected = Math.floor(Date.now() / 1000) + 3600 + 5; // +5s tolerance
    expect(payload.exp!).toBeLessThanOrEqual(maxExpected);
  });

  test("includes kid in token header", async () => {
    const { publicKey, privateKey } = generateKeypair();

    const token = await issueToken({
      privateKey,
      publicKey,
      subjectDid: "did:at:alice",
      audienceDid: "did:at:bob",
      kid: "my-key-123",
    });

    const header = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
    expect(header.kid).toBe("my-key-123");
    expect(header.alg).toBe("EdDSA");
  });
});
