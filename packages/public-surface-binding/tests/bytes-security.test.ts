import { describe, expect, test } from "bun:test";

import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalBase64Decode,
  canonicalBase64Encode,
  decodeFixedBase64,
  decodeFixedBase64Url,
} from "../src/bytes.js";
import { PublicSurfaceBindingError } from "../src/errors.js";

function expectInvalid(action: () => unknown): void {
  try {
    action();
    throw new Error("expected invalid input");
  } catch (error) {
    expect(error).toBeInstanceOf(PublicSurfaceBindingError);
    expect((error as PublicSurfaceBindingError).code).toBe("INVALID_INPUT");
  }
}

describe("canonical binary text encodings", () => {
  test("round-trips canonical padded base64 and unpadded base64url", () => {
    const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255]);
    const padded = canonicalBase64Encode(bytes);
    const unpaddedUrl = base64UrlEncode(bytes);
    expect(padded).toBe("AAEC/f7/");
    expect(unpaddedUrl).toBe("AAEC_f7_");
    expect(canonicalBase64Decode(padded, "value")).toEqual(bytes);
    expect(base64UrlDecode(unpaddedUrl, "value")).toEqual(bytes);
  });

  test("rejects whitespace, mixed alphabets, padding changes, and nonzero unused bits", () => {
    for (const value of [" AA==", "AA==\n", "AA", "AA=", "AA===", "-_==", "AB=="]) {
      expectInvalid(() => canonicalBase64Decode(value, "value"));
    }
    for (const value of ["AA==", "AA=", "AA+", "AA/", "AB"]) {
      expectInvalid(() => base64UrlDecode(value, "value"));
    }
  });

  test("enforces the decoded length before accepting public keys, signatures, and nonces", () => {
    const publicKey = canonicalBase64Encode(new Uint8Array(32));
    const signature = canonicalBase64Encode(new Uint8Array(64));
    const nonce = base64UrlEncode(new Uint8Array(16));
    expect(decodeFixedBase64(publicKey, 32, "public_key")).toHaveLength(32);
    expect(decodeFixedBase64(signature, 64, "signature")).toHaveLength(64);
    expect(decodeFixedBase64Url(nonce, 16, "nonce")).toHaveLength(16);

    expectInvalid(() => decodeFixedBase64(publicKey, 64, "signature"));
    expectInvalid(() => decodeFixedBase64(signature, 32, "public_key"));
    expectInvalid(() => decodeFixedBase64Url(`${nonce}A`, 16, "nonce"));
    expectInvalid(() => decodeFixedBase64("A".repeat(1_000_000), 32, "public_key"));
  });
});
