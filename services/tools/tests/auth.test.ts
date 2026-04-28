/** Tests for API key generation and verification. */

import { describe, expect, it } from "bun:test";
import { generateApiKey, verifyApiKey } from "../src/auth/keys";

describe("API key auth", () => {
  it("should generate a key with at_ prefix", () => {
    const { key, keyHash, keyPrefix } = generateApiKey();

    expect(key).toStartWith("at_");
    expect(key.length).toBeGreaterThan(20);
    expect(keyPrefix).toBe(key.slice(0, 11));
    expect(keyHash).toBeTruthy();
    expect(keyHash).not.toBe(key); // not stored plaintext
  });

  it("should verify a correct key against its hash", () => {
    const { key, keyHash } = generateApiKey();

    expect(verifyApiKey(key, keyHash)).toBe(true);
  });

  it("should reject an incorrect key", () => {
    const { keyHash } = generateApiKey();

    expect(verifyApiKey("at_wrongkey123", keyHash)).toBe(false);
  });

  it("should generate unique keys each time", () => {
    const a = generateApiKey();
    const b = generateApiKey();

    expect(a.key).not.toBe(b.key);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});
