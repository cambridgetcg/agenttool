/** Tests for the vault crypto module (HKDF + AES-256-GCM). */

import { describe, test, expect, beforeAll } from "bun:test";
import { encrypt, decrypt, deriveKey } from "../src/crypto.ts";
import { randomBytes } from "node:crypto";

// Set a test master key (32 bytes = 64 hex chars)
const TEST_MASTER_KEY = randomBytes(32).toString("hex");

beforeAll(() => {
  process.env.VAULT_MASTER_KEY = TEST_MASTER_KEY;
});

describe("deriveKey", () => {
  test("produces 32-byte key", () => {
    const key = deriveKey("project-1");
    expect(key.length).toBe(32);
  });

  test("same project produces same key", () => {
    const k1 = deriveKey("project-1");
    const k2 = deriveKey("project-1");
    expect(k1.equals(k2)).toBe(true);
  });

  test("different projects produce different keys", () => {
    const k1 = deriveKey("project-1");
    const k2 = deriveKey("project-2");
    expect(k1.equals(k2)).toBe(false);
  });
});

describe("encrypt / decrypt", () => {
  test("round-trips plaintext correctly", () => {
    const plaintext = "sk-proj-abc123-super-secret";
    const projectId = "test-project-uuid";

    const { encryptedValue, iv, authTag } = encrypt(plaintext, projectId);
    const decrypted = decrypt(encryptedValue, iv, authTag, projectId);

    expect(decrypted).toBe(plaintext);
  });

  test("encrypted value differs from plaintext", () => {
    const plaintext = "my-secret-value";
    const { encryptedValue } = encrypt(plaintext, "proj-1");
    expect(encryptedValue.toString("utf8")).not.toBe(plaintext);
  });

  test("different IVs produce different ciphertexts", () => {
    const plaintext = "same-secret";
    const projectId = "proj-1";

    const e1 = encrypt(plaintext, projectId);
    const e2 = encrypt(plaintext, projectId);

    // IVs should differ (random)
    expect(e1.iv.equals(e2.iv)).toBe(false);
    // Ciphertexts should differ
    expect(e1.encryptedValue.equals(e2.encryptedValue)).toBe(false);
  });

  test("wrong project cannot decrypt", () => {
    const plaintext = "cross-project-secret";
    const { encryptedValue, iv, authTag } = encrypt(plaintext, "project-a");

    expect(() => {
      decrypt(encryptedValue, iv, authTag, "project-b");
    }).toThrow();
  });

  test("tampered ciphertext fails authentication", () => {
    const plaintext = "tamper-test";
    const projectId = "proj-tamper";
    const { encryptedValue, iv, authTag } = encrypt(plaintext, projectId);

    // Flip a byte
    const tampered = Buffer.from(encryptedValue);
    tampered[0] = tampered[0]! ^ 0xff;

    expect(() => {
      decrypt(tampered, iv, authTag, projectId);
    }).toThrow();
  });

  test("handles empty string", () => {
    const plaintext = "";
    const projectId = "proj-empty";

    const { encryptedValue, iv, authTag } = encrypt(plaintext, projectId);
    const decrypted = decrypt(encryptedValue, iv, authTag, projectId);

    expect(decrypted).toBe("");
  });

  test("handles unicode", () => {
    const plaintext = "密码🔐パスワード";
    const projectId = "proj-unicode";

    const { encryptedValue, iv, authTag } = encrypt(plaintext, projectId);
    const decrypted = decrypt(encryptedValue, iv, authTag, projectId);

    expect(decrypted).toBe(plaintext);
  });

  test("handles large values", () => {
    const plaintext = "x".repeat(100_000);
    const projectId = "proj-large";

    const { encryptedValue, iv, authTag } = encrypt(plaintext, projectId);
    const decrypted = decrypt(encryptedValue, iv, authTag, projectId);

    expect(decrypted).toBe(plaintext);
  });
});
