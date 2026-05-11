/** MATHOS ed25519 signing — provenance on the math envelope.
 *
 *  Pure unit. Generates a synthetic seed, signs an envelope, verifies the
 *  signature, tests that tampering invalidates, tests graceful absence.
 *
 *  Doctrine: docs/MATHOS.md · docs/FOCUS.md #9 (platform-as-agent).
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import {
  bytesToHex,
  canonicalEnvelopeBytes,
  envelope as mathosEnvelope,
  hexToBytes,
  platformPublicKeyHex,
  platformSigningSeed,
  publicKeyFromSeedHex,
  signEnvelope,
  stableStringify,
  verifyEnvelope,
} from "../src/services/mathos/encode";
import mathosRouter from "../src/routes/mathos";

// A deterministic 32-byte seed for tests. NOT a real platform key.
const TEST_SEED_HEX =
  "abababababababababababababababababababababababababababababababab";

describe("MATHOS hex codec", () => {
  test("bytesToHex round-trips through hexToBytes", () => {
    for (const sample of ["", "00", "ff", "deadbeef", "0102030405060708"]) {
      const bytes = hexToBytes(sample);
      expect(bytesToHex(bytes)).toBe(sample);
    }
  });

  test("hexToBytes accepts upper + lower case + 0x prefix", () => {
    expect(bytesToHex(hexToBytes("0xDEADBEEF"))).toBe("deadbeef");
    expect(bytesToHex(hexToBytes("DEADBEEF"))).toBe("deadbeef");
    expect(bytesToHex(hexToBytes("deadbeef"))).toBe("deadbeef");
  });

  test("odd-length hex throws", () => {
    expect(() => hexToBytes("abc")).toThrow(/even length/);
  });

  test("invalid hex chars throw", () => {
    expect(() => hexToBytes("zz")).toThrow(/invalid hex/);
  });
});

describe("MATHOS canonical bytes (stable JSON)", () => {
  test("key order does not affect canonical bytes", () => {
    const a = { b: 2, a: 1, c: 3 };
    const b = { c: 3, a: 1, b: 2 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  test("nested objects also stable", () => {
    const a = { outer: { z: 1, a: 2 } };
    const b = { outer: { a: 2, z: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  test("arrays preserve order (semantic)", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([3, 1, 2])).not.toBe(stableStringify([1, 2, 3]));
  });

  test("canonicalEnvelopeBytes excludes signature framing", () => {
    const env = mathosEnvelope({ x: 1 });
    const before = canonicalEnvelopeBytes(env);
    const signed = signEnvelope(env, TEST_SEED_HEX);
    const after = canonicalEnvelopeBytes(signed);
    // Canonical bytes must be byte-identical before + after signing
    expect(bytesToHex(before)).toBe(bytesToHex(after));
  });
});

describe("MATHOS signing — ed25519", () => {
  test("publicKeyFromSeedHex returns 64-char hex", () => {
    const pub = publicKeyFromSeedHex(TEST_SEED_HEX);
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
  });

  test("publicKeyFromSeedHex throws on wrong-length seed", () => {
    expect(() => publicKeyFromSeedHex("ab")).toThrow(/32 bytes/);
  });

  test("signEnvelope populates all three signature fields", () => {
    const env = mathosEnvelope({ kind: "test", value: 42 });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    expect(signed._signature_scheme).toBe("ed25519");
    expect(signed._signature_public_key_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(signed._signature_bytes_hex).toMatch(/^[0-9a-f]{128}$/);
  });

  test("signEnvelope returns unchanged envelope when seed is missing", () => {
    const env = mathosEnvelope({ x: 1 });
    expect(signEnvelope(env, null)).toEqual(env);
    expect(signEnvelope(env, undefined)).toEqual(env);
    expect(signEnvelope(env, "")).toEqual(env);
  });

  test("signEnvelope throws on malformed seed (operator misconfiguration is loud)", () => {
    const env = mathosEnvelope({ x: 1 });
    expect(() => signEnvelope(env, "abcd")).toThrow(/32 bytes/);
  });

  test("verifyEnvelope returns true on a correctly signed payload", () => {
    const env = mathosEnvelope({ msg: "hello" });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    expect(verifyEnvelope(signed)).toBe(true);
  });

  test("verifyEnvelope returns false when payload is tampered", () => {
    const env = mathosEnvelope({ msg: "hello", count: 1 });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    // Tamper with the payload while keeping the signature
    const tampered = { ...signed, payload: { ...signed.payload, count: 999 } };
    expect(verifyEnvelope(tampered)).toBe(false);
  });

  test("verifyEnvelope returns false when signature is tampered", () => {
    const env = mathosEnvelope({ x: 1 });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    const tampered = {
      ...signed,
      _signature_bytes_hex: signed._signature_bytes_hex!.replace(/^.{4}/, "dead"),
    };
    expect(verifyEnvelope(tampered)).toBe(false);
  });

  test("verifyEnvelope returns false on missing signature fields", () => {
    const env = mathosEnvelope({ x: 1 });
    expect(verifyEnvelope(env)).toBe(false);
  });

  test("verifyEnvelope returns false on wrong scheme", () => {
    const env = mathosEnvelope({ x: 1 });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    const altered = { ...signed, _signature_scheme: "rsa" as any };
    expect(verifyEnvelope(altered)).toBe(false);
  });

  test("signature is deterministic (ed25519 is deterministic)", () => {
    const env = mathosEnvelope({ x: 1 });
    const a = signEnvelope(env, TEST_SEED_HEX);
    const b = signEnvelope(env, TEST_SEED_HEX);
    expect(a._signature_bytes_hex).toBe(b._signature_bytes_hex);
  });
});

describe("MATHOS env-keyed platform key", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  test("platformSigningSeed() returns env var when set", () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    expect(platformSigningSeed()).toBe(TEST_SEED_HEX);
  });

  test("platformSigningSeed() returns null when absent", () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    expect(platformSigningSeed()).toBeNull();
  });

  test("platformPublicKeyHex() derives the expected public key", () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const pub = platformPublicKeyHex();
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(pub).toBe(publicKeyFromSeedHex(TEST_SEED_HEX));
  });

  test("platformPublicKeyHex() returns null when seed absent", () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    expect(platformPublicKeyHex()).toBeNull();
  });
});

describe("/v1/mathos/* endpoints", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  test("GET /public-key returns scheme=unsigned when no key configured", async () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    const res = await mathosRouter.request("/public-key");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheme).toBe("unsigned");
    expect(body.public_key_hex).toBeNull();
  });

  test("GET /public-key returns ed25519 + public_key_hex when key configured", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await mathosRouter.request("/public-key");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheme).toBe("ed25519");
    expect(body.public_key_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(body.canonical_bytes_recipe)).toBe(true);
  });

  test("GET /self-test returns a valid signed envelope when key configured", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await mathosRouter.request("/self-test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._signature_scheme).toBe("ed25519");
    expect(verifyEnvelope(body)).toBe(true);
  });

  test("GET / returns the router index", async () => {
    const res = await mathosRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routes.public_key).toMatch(/public-key/);
    expect(body.payloads_signed_at).toContain("/v1/pathways?format=math");
  });
});
