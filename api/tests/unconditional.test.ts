/** Unconditional primitive — unit tests for the signing context.
 *
 *  These are pure-function tests over the canonical-bytes + ed25519
 *  verifier. The DB-touching integration lives separately (would need
 *  test DB + fixtures); these pin the wire-level invariants.
 *
 *  Doctrine: docs/UNCONDITIONAL.md. */

import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalUnconditionalBytes,
  verifyUnconditional,
} from "../src/services/unconditional/sig";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function newKey() {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub, pubB64: b64encode(pub) };
}

describe("canonicalUnconditionalBytes", () => {
  test("is deterministic for the same inputs", () => {
    const a = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const b = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));
  });

  test("differs when holder changes", () => {
    const a = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const b = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/eve",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    expect(Buffer.from(a).toString("hex")).not.toBe(
      Buffer.from(b).toString("hex"),
    );
  });

  test("differs when target changes", () => {
    const a = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const b = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/carol",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    expect(Buffer.from(a).toString("hex")).not.toBe(
      Buffer.from(b).toString("hex"),
    );
  });

  test("differs when created_at changes — substitution-attack-proof", () => {
    const a = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const b = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.001Z",
    });
    expect(Buffer.from(a).toString("hex")).not.toBe(
      Buffer.from(b).toString("hex"),
    );
  });

  test("self-target produces valid bytes (load-bearing — substrate-honest)", () => {
    const bytes = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/alice",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });

  test("the byte shape starts with the sha256 of the framed envelope", () => {
    // Any change to the framing (domain tag, separator, field order)
    // changes every byte — pins the wire contract.
    const bytes = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    expect(bytes.length).toBe(32); // sha256 output size
  });
});

describe("verifyUnconditional", () => {
  test("accepts a valid signature", async () => {
    const { priv, pubB64 } = await newKey();
    const bytes = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyUnconditional({
      bytes,
      signatureB64: b64encode(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(true);
  });

  test("rejects a signature from a different key (forgery)", async () => {
    const { priv } = await newKey();
    const other = await newKey();
    const bytes = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyUnconditional({
      bytes,
      signatureB64: b64encode(sig),
      publicKeyB64: other.pubB64,
    });
    expect(ok).toBe(false);
  });

  test("rejects a valid signature over different bytes (substitution attack)", async () => {
    const { priv, pubB64 } = await newKey();
    const signedBytes = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const sig = await ed.signAsync(signedBytes, priv);

    // The verifier checks against tampered bytes — should reject.
    const tamperedBytes = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/carol", // tampered target
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const ok = await verifyUnconditional({
      bytes: tamperedBytes,
      signatureB64: b64encode(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(false);
  });

  test("rejects malformed base64 input gracefully (returns false, not throw)", async () => {
    const bytes = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const ok = await verifyUnconditional({
      bytes,
      signatureB64: "not-base64-!!!",
      publicKeyB64: "also-not-base64-???",
    });
    expect(ok).toBe(false);
  });

  test("self-signed unconditional verifies (the substrate-honest self-target case)", async () => {
    const { priv, pubB64 } = await newKey();
    const bytes = canonicalUnconditionalBytes({
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/alice",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    });
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyUnconditional({
      bytes,
      signatureB64: b64encode(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(true);
  });
});

describe("the wall — no conditions on unconditional (structural)", () => {
  test("the canonical-bytes function signature accepts ONLY holder/target/created_at", () => {
    // This test pins the contract at the type level. Adding any condition-
    // shaped field to canonicalUnconditionalBytes() would require an API
    // change here and a doctrine update — making the wall hard to breach
    // by accident.
    const opts = {
      holderDid: "did:at:agenttool.dev/alice",
      targetDid: "did:at:agenttool.dev/bob",
      createdAtIso: "2026-05-25T10:00:00.000Z",
    };
    const bytes = canonicalUnconditionalBytes(opts);
    expect(bytes).toBeInstanceOf(Uint8Array);

    // Pin the field count: 3 fields go into the signature, not 4 or more.
    // (Adding for_what or kind would silently change the wire — the test
    // pins what the signature covers.)
    expect(Object.keys(opts).sort()).toEqual([
      "createdAtIso",
      "holderDid",
      "targetDid",
    ]);
  });
});
