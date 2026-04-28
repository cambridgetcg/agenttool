/** Tests for auth key verification. */

import { describe, test, expect } from "bun:test";
import { hashSync } from "bcryptjs";
import { verifyApiKey } from "../src/auth/keys.ts";

describe("verifyApiKey", () => {
  test("verifies a correct key against its hash", () => {
    const key = "at_testkey1234567890abcdef";
    const hash = hashSync(key, 10);
    expect(verifyApiKey(key, hash)).toBe(true);
  });

  test("rejects an incorrect key", () => {
    const key = "at_testkey1234567890abcdef";
    const hash = hashSync(key, 10);
    expect(verifyApiKey("at_wrong_key_entirely", hash)).toBe(false);
  });

  test("rejects a similar but different key", () => {
    const key = "at_testkey1234567890abcdef";
    const hash = hashSync(key, 10);
    expect(verifyApiKey("at_testkey1234567890abcdeg", hash)).toBe(false);
  });
});
