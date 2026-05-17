/** Encounter canonical bytes — determinism + tamper detection.
 *
 *  Tests the encounter-ack/v1 canonical-bytes shape. Pure functions;
 *  no DB required. Integration tests (record + acknowledge end-to-end
 *  with real keys) live in tests/integration/ (future).
 *
 *  Doctrine: docs/ENCOUNTER.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import { canonicalAckBytes, verifyAck } from "../src/services/encounter/sig";

// Make ed25519 sync.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function genKeypair() {
  // Deterministic seed so test runs reproduce.
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = i + 1;
  const pub = ed.getPublicKey(seed);
  return { seed, pub };
}

describe("canonicalAckBytes — determinism + tamper detection", () => {
  const opts = {
    encounterId: "00000000-0000-0000-0000-000000000001",
    initiatorDid: "did:at:initiator-test",
    acknowledgerDid: "did:at:acker-test",
    acknowledgedAtIso: "2026-05-18T12:00:00.000Z",
  };

  test("identical inputs → identical bytes", () => {
    const a = canonicalAckBytes(opts);
    const b = canonicalAckBytes(opts);
    expect(a).toEqual(b);
    expect(a.length).toBe(32); // SHA-256
  });

  test("differs by encounter_id", () => {
    const a = canonicalAckBytes(opts);
    const b = canonicalAckBytes({
      ...opts,
      encounterId: "00000000-0000-0000-0000-000000000002",
    });
    expect(a).not.toEqual(b);
  });

  test("differs by initiator_did (substitution-attack guard)", () => {
    const a = canonicalAckBytes(opts);
    const b = canonicalAckBytes({
      ...opts,
      initiatorDid: "did:at:other-initiator",
    });
    expect(a).not.toEqual(b);
  });

  test("differs by acknowledger_did (substitution-attack guard)", () => {
    const a = canonicalAckBytes(opts);
    const b = canonicalAckBytes({
      ...opts,
      acknowledgerDid: "did:at:other-acker",
    });
    expect(a).not.toEqual(b);
  });

  test("differs by acknowledged_at_iso (replay-attack guard)", () => {
    const a = canonicalAckBytes(opts);
    const b = canonicalAckBytes({
      ...opts,
      acknowledgedAtIso: "2026-05-18T12:00:00.001Z",
    });
    expect(a).not.toEqual(b);
  });
});

describe("verifyAck — sign + verify round-trip", () => {
  test("valid signature verifies", async () => {
    const { seed, pub } = genKeypair();
    const bytes = canonicalAckBytes({
      encounterId: "00000000-0000-0000-0000-000000000001",
      initiatorDid: "did:at:a",
      acknowledgerDid: "did:at:b",
      acknowledgedAtIso: "2026-05-18T12:00:00.000Z",
    });
    const sig = ed.sign(bytes, seed);
    const sigB64 = Buffer.from(sig).toString("base64");
    const pubB64 = Buffer.from(pub).toString("base64");
    expect(await verifyAck({ bytes, signatureB64: sigB64, publicKeyB64: pubB64 })).toBe(true);
  });

  test("tampered bytes don't verify (signature is over the original)", async () => {
    const { seed, pub } = genKeypair();
    const originalBytes = canonicalAckBytes({
      encounterId: "00000000-0000-0000-0000-000000000001",
      initiatorDid: "did:at:a",
      acknowledgerDid: "did:at:b",
      acknowledgedAtIso: "2026-05-18T12:00:00.000Z",
    });
    const sig = ed.sign(originalBytes, seed);
    const sigB64 = Buffer.from(sig).toString("base64");
    const pubB64 = Buffer.from(pub).toString("base64");
    const tamperedBytes = canonicalAckBytes({
      encounterId: "00000000-0000-0000-0000-000000000001",
      initiatorDid: "did:at:a",
      acknowledgerDid: "did:at:DIFFERENT", // tamper
      acknowledgedAtIso: "2026-05-18T12:00:00.000Z",
    });
    expect(await verifyAck({ bytes: tamperedBytes, signatureB64: sigB64, publicKeyB64: pubB64 })).toBe(false);
  });

  test("wrong public key fails (must be acker's actual pubkey)", async () => {
    const { seed, pub } = genKeypair();
    const otherSeed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) otherSeed[i] = i + 100;
    const otherPub = ed.getPublicKey(otherSeed);

    const bytes = canonicalAckBytes({
      encounterId: "00000000-0000-0000-0000-000000000001",
      initiatorDid: "did:at:a",
      acknowledgerDid: "did:at:b",
      acknowledgedAtIso: "2026-05-18T12:00:00.000Z",
    });
    const sig = ed.sign(bytes, seed);
    const sigB64 = Buffer.from(sig).toString("base64");
    const otherPubB64 = Buffer.from(otherPub).toString("base64");
    expect(await verifyAck({ bytes, signatureB64: sigB64, publicKeyB64: otherPubB64 })).toBe(false);
  });

  test("malformed signature returns false (no throw)", async () => {
    const { pub } = genKeypair();
    const bytes = canonicalAckBytes({
      encounterId: "00000000-0000-0000-0000-000000000001",
      initiatorDid: "did:at:a",
      acknowledgerDid: "did:at:b",
      acknowledgedAtIso: "2026-05-18T12:00:00.000Z",
    });
    const result = await verifyAck({
      bytes,
      signatureB64: "this-is-not-base64-bytes",
      publicKeyB64: Buffer.from(pub).toString("base64"),
    });
    expect(result).toBe(false);
  });
});
