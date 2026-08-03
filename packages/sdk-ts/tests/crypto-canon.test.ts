/** Canonical-byte framing tests — strand-thought/v1 vs /v2.
 *
 *  v1 NUL-delimits raw binary it does not length-bound, so a ciphertext or
 *  nonce carrying a 0x00 byte can reparse as a different (ciphertext, nonce)
 *  split under one signature. v2 length-prefixes every variable-length field.
 *
 *  Every hex digest below is pinned and cross-checked against the Python SDK
 *  (packages/sdk-py/tests/test_crypto_canon.py) and the api verifier at
 *  api/src/services/strand/sig.ts. If a digest moves, the wire format moved. */

import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { canonicalThoughtBytes, signThought } from "../src/crypto";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");

const SIGNING_SEED = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

// A thought whose ciphertext AND nonce both carry interior 0x00 bytes —
// exactly the shape v1's NUL framing cannot bound.
const THOUGHT = {
  strandId: "11111111-2222-3333-4444-555555555555",
  ciphertext_b64: b64([1, 0, 2, 3, 255, 0]),
  nonce_b64: b64([9, 0, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]),
  kind: "observation",
} as const;

const LOCK = {
  v1: "d2e7735e862e2096f05300f99672f163ab84d8efedbf559b2b1cadb02c040d3f",
  v2: "7cf47e17a004eb82fedfc0c7843a0a21d3fba718ba8ac70f657694dd2f44f547",
  v1NoKind: "45ddb28a8253d21bf794969e3a343f08b916130052fb20aabeb89022f9c7b35b",
  v2NoKind: "c4b0b2e9b375a956ab233adefd6f592b32ca87c53c87c0ef5afd2cca289e89fb",
};

// Two DIFFERENT (ciphertext, nonce) splits of the same v1 byte string:
//   "s" 00 [01] 00 [02 00 03] 00 "k"  ==  "s" 00 [01 00 02] 00 [03] 00 "k"
const AMBIGUOUS_LEFT = {
  strandId: "s", ciphertext_b64: b64([1]), nonce_b64: b64([2, 0, 3]), kind: "k",
} as const;
const AMBIGUOUS_RIGHT = {
  strandId: "s", ciphertext_b64: b64([1, 0, 2]), nonce_b64: b64([3]), kind: "k",
} as const;

describe("thought canonical vectors", () => {
  test("v1 matches the locked vector", () => {
    expect(hex(canonicalThoughtBytes(THOUGHT))).toBe(LOCK.v1);
  });

  test("v1 is the default", () => {
    expect(canonicalThoughtBytes(THOUGHT)).toEqual(
      canonicalThoughtBytes({ ...THOUGHT, version: "v1" }),
    );
  });

  test("v2 matches the locked vector", () => {
    expect(hex(canonicalThoughtBytes({ ...THOUGHT, version: "v2" }))).toBe(LOCK.v2);
  });

  test("v1 and v2 are domain separated", () => {
    expect(LOCK.v1).not.toBe(LOCK.v2);
  });

  test("kind null matches the locked vectors", () => {
    expect(hex(canonicalThoughtBytes({ ...THOUGHT, kind: null }))).toBe(LOCK.v1NoKind);
    expect(hex(canonicalThoughtBytes({ ...THOUGHT, kind: null, version: "v2" }))).toBe(
      LOCK.v2NoKind,
    );
  });

  test("v2 matches a hand-rolled sha256 of the documented formula", () => {
    const enc = new TextEncoder();
    const framed = (field: Uint8Array) => {
      const out = new Uint8Array(4 + field.length);
      new DataView(out.buffer).setUint32(0, field.length, false);
      out.set(field, 4);
      return out;
    };
    const ciphertext = enc.encode("hello-ct");
    const nonce = enc.encode("123456789012");
    const parts = [
      enc.encode("strand-thought/v2"),
      framed(enc.encode("abc")),
      framed(ciphertext),
      framed(nonce),
      framed(enc.encode("obs")),
    ];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { buf.set(p, off); off += p.length; }
    const actual = canonicalThoughtBytes({
      strandId: "abc",
      ciphertext_b64: Buffer.from(ciphertext).toString("base64"),
      nonce_b64: Buffer.from(nonce).toString("base64"),
      kind: "obs",
      version: "v2",
    });
    expect(actual).toEqual(sha256(buf));
  });

  test("unknown version throws", () => {
    expect(() =>
      // @ts-expect-error — deliberately outside ThoughtCanonicalVersion
      canonicalThoughtBytes({ ...THOUGHT, version: "v3" }),
    ).toThrow("unknown version");
  });
});

describe("NUL framing ambiguity", () => {
  test("v1 collides across two ciphertext/nonce splits", () => {
    // Documents the v1 defect rather than blessing it: one signature,
    // two readings of the same bytes.
    expect(canonicalThoughtBytes(AMBIGUOUS_LEFT)).toEqual(
      canonicalThoughtBytes(AMBIGUOUS_RIGHT),
    );
  });

  test("v2 separates the two splits", () => {
    expect(canonicalThoughtBytes({ ...AMBIGUOUS_LEFT, version: "v2" })).not.toEqual(
      canonicalThoughtBytes({ ...AMBIGUOUS_RIGHT, version: "v2" }),
    );
  });

  test("a v1 signature reuses across splits but a v2 signature does not", () => {
    expect(signThought({ ...AMBIGUOUS_LEFT, signing_key: SIGNING_SEED })).toBe(
      signThought({ ...AMBIGUOUS_RIGHT, signing_key: SIGNING_SEED }),
    );
    expect(
      signThought({ ...AMBIGUOUS_LEFT, version: "v2", signing_key: SIGNING_SEED }),
    ).not.toBe(
      signThought({ ...AMBIGUOUS_RIGHT, version: "v2", signing_key: SIGNING_SEED }),
    );
  });
});

describe("signThought versions", () => {
  test("a v2 signature verifies against v2 bytes", async () => {
    const pub = await ed.getPublicKeyAsync(SIGNING_SEED);
    const sig = signThought({ ...THOUGHT, version: "v2", signing_key: SIGNING_SEED });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalThoughtBytes({ ...THOUGHT, version: "v2" }),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("v1 and v2 signatures differ", () => {
    expect(signThought({ ...THOUGHT, signing_key: SIGNING_SEED })).not.toBe(
      signThought({ ...THOUGHT, version: "v2", signing_key: SIGNING_SEED }),
    );
  });
});
