/** runtime KMS + trusted-crypto — wrap/unwrap round-trip tests.
 *
 *  Verifies that the KMS wrapper and trusted-crypto module correctly:
 *  - Generate and wrap DEKs under the master key
 *  - Unwrap DEKs and recover the same key
 *  - Wrap and unwrap signing keys under the DEK
 *  - Encrypt/decrypt round-trips produce matching plaintext
 *  - ed25519 sign/verify round-trips
 *  - DEK zeroing works
 *
 *  Doctrine: docs/HOSTED-RUNTIME-DESIGN.md */

import { describe, expect, test } from "bun:test";
import { randomBytes } from "@noble/ciphers/webcrypto";
import * as ed25519 from "@noble/ed25519";
import { base64 } from "@scure/base";

import {
  generateDekAndWrap,
  unwrapDek,
  wrapUnderDek,
  unwrapUnderDek,
  zeroBytes,
  generateSigningSeed,
  getMasterKeyId,
  _setMasterKeyForTesting,
} from "../src/services/runtime/kms";
import {
  prepareTrustedCrypto,
  trustedEncrypt,
  trustedDecrypt,
  trustedSign,
  zeroTrustedCrypto,
  type TrustedCryptoContext,
} from "../src/services/runtime/trusted-crypto";

// Set up KMS master key for all tests
const masterKey = randomBytes(32);
_setMasterKeyForTesting(masterKey, "test-kms-v1");

describe("KMS module", () => {
  test("generateDekAndWrap returns a 32-byte DEK and wrapped form", () => {
    const { dek, wrapped, keyId } = generateDekAndWrap();
    expect(dek.length).toBe(32);
    expect(wrapped).toBeTruthy();
    expect(keyId).toBe("test-kms-v1");
    zeroBytes(dek);
  });

  test("unwrapDek recovers the same DEK that was wrapped", () => {
    const { dek, wrapped } = generateDekAndWrap();
    const unwrapped = unwrapDek(wrapped);
    expect(unwrapped.length).toBe(32);
    expect(Buffer.from(unwrapped).equals(dek)).toBe(true);
    zeroBytes(dek);
    zeroBytes(unwrapped);
  });

  test("wrapUnderDek + unwrapUnderDek round-trips", () => {
    const { dek } = generateDekAndWrap();
    const secret = randomBytes(32);
    const wrapped = wrapUnderDek(dek, secret);
    const unwrapped = unwrapUnderDek(dek, wrapped);
    expect(Buffer.from(unwrapped).equals(secret)).toBe(true);
    zeroBytes(dek);
  });

  test("generateSigningSeed returns 32 bytes", () => {
    const seed = generateSigningSeed();
    expect(seed.length).toBe(32);
    zeroBytes(seed);
  });

  test("zeroBytes fills array with zeros", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    zeroBytes(bytes);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  test("different DEKs are generated each call", () => {
    const a = generateDekAndWrap();
    const b = generateDekAndWrap();
    expect(Buffer.from(a.dek).equals(b.dek)).toBe(false);
    zeroBytes(a.dek);
    zeroBytes(b.dek);
  });
});

describe("trusted-crypto module", () => {
  test("prepareTrustedCrypto generates signing key on first cycle", async () => {
    const { dek, wrapped } = generateDekAndWrap();
    const ctx = await prepareTrustedCrypto(wrapped, "runtime-test-1", null);
    expect(ctx.dek.length).toBe(32);
    expect(ctx.signingKey.length).toBe(32);
    expect(ctx.signingPublicKey.length).toBe(32);
    expect(ctx.signingKeyId).toMatch(/^trusted-/);
    expect(ctx.newWrappedSigningKey).not.toBeNull();
    zeroTrustedCrypto(ctx);
  });

  test("prepareTrustedCrypto unwraps existing signing key", async () => {
    const { dek, wrapped } = generateDekAndWrap();
    // First cycle: generate
    const ctx1 = await prepareTrustedCrypto(wrapped, "runtime-test-2", null);
    const persistedKey = ctx1.newWrappedSigningKey!;
    zeroTrustedCrypto(ctx1);

    // Second cycle: unwrap existing
    const ctx2 = await prepareTrustedCrypto(wrapped, "runtime-test-2", persistedKey);
    expect(ctx2.newWrappedSigningKey).toBeNull();

    // Verify same public key
    const ctx1Again = await prepareTrustedCrypto(wrapped, "runtime-test-2", persistedKey);
    expect(Buffer.from(ctx2.signingPublicKey).equals(ctx1Again.signingPublicKey)).toBe(true);
    zeroTrustedCrypto(ctx2);
    zeroTrustedCrypto(ctx1Again);
    zeroBytes(dek);
  });

  test("trustedEncrypt + trustedDecrypt round-trips", () => {
    const { dek, wrapped } = generateDekAndWrap();
    const plaintext = Buffer.from("Hello, trusted world!", "utf-8").toString("base64");
    const enc = trustedEncrypt(dek, plaintext);
    expect(enc.ciphertext).toBeTruthy();
    expect(enc.nonce).toBeTruthy();
    expect(enc.ciphertext).not.toBe(plaintext);

    const dec = trustedDecrypt(dek, enc.ciphertext, enc.nonce);
    expect(dec.plaintext).toBe(plaintext);
    zeroBytes(dek);
  });

  test("trustedSign produces verifiable ed25519 signatures", async () => {
    const { wrapped } = generateDekAndWrap();
    const ctx = await prepareTrustedCrypto(wrapped, "runtime-test-3", null);
    const message = Buffer.from("canonical thought bytes here").toString("base64");
    const result = await trustedSign(ctx.signingKey, message);
    expect(result.signature).toBeTruthy();

    // Verify with ed25519
    const sigBytes = base64.decode(result.signature);
    const msgBytes = Buffer.from(message, "base64");
    const valid = await ed25519.verify(sigBytes, msgBytes, ctx.signingPublicKey);
    expect(valid).toBe(true);

    zeroTrustedCrypto(ctx);
  });

  test("zeroTrustedCrypto zeros both DEK and signing key", async () => {
    const { wrapped } = generateDekAndWrap();
    const ctx = await prepareTrustedCrypto(wrapped, "runtime-test-4", null);
    zeroTrustedCrypto(ctx);
    expect(ctx.dek.every((b) => b === 0)).toBe(true);
    expect(ctx.signingKey.every((b) => b === 0)).toBe(true);
  });
});