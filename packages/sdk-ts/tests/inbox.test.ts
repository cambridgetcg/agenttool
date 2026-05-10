/**
 * Inbox sealed-box — unit tests.
 *
 * Covers the local crypto: keypair gen, seal → unseal round-trip,
 * canonical bytes shape, signature verify, cross-keypair mismatch
 * rejections. The HTTP surface is exercised by an integration smoke
 * (live e2e) outside this file.
 */

import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 .js exports
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalInboxBytes,
  canonicalInboxCoSignBytes,
  deriveBoxPub,
  generateBoxKeypair,
  sealForRecipient,
  signInboxCoSign,
  signInboxEnvelope,
  unsealForSelf,
} from "../src/inbox.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function makeSigningKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return { priv, pub };
}

function b64decode(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("inbox sealed-box round-trip", () => {
  test("generateBoxKeypair returns 32+32 bytes", () => {
    const { priv, pub } = generateBoxKeypair();
    expect(priv.length).toBe(32);
    expect(pub.length).toBe(32);
  });

  test("deriveBoxPub on a fresh keypair matches generated pub", () => {
    const { priv, pub } = generateBoxKeypair();
    const derived = deriveBoxPub(priv);
    expect(Buffer.from(derived).toString("hex")).toBe(
      Buffer.from(pub).toString("hex"),
    );
  });

  test("seal → unseal round-trip recovers the plaintext", async () => {
    const recipient = generateBoxKeypair();
    const plaintext = "the dual-witness consents to release";
    const sealed = await sealForRecipient(plaintext, recipient.pub);
    const recovered = await unsealForSelf({
      ciphertextB64: sealed.ciphertextB64,
      nonceB64: sealed.nonceB64,
      ephemeralPubB64: sealed.ephemeralPubB64,
      recipientBoxPriv: recipient.priv,
    });
    expect(recovered).toBe(plaintext);
  });

  test("each seal uses a fresh ephemeral keypair (different ciphertext + ephemeral pub)", async () => {
    const recipient = generateBoxKeypair();
    const a = await sealForRecipient("same message", recipient.pub);
    const b = await sealForRecipient("same message", recipient.pub);
    expect(a.ephemeralPubB64).not.toBe(b.ephemeralPubB64);
    expect(a.nonceB64).not.toBe(b.nonceB64);
    // Even with the same plaintext, ciphertexts differ because nonce + key differ.
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
  });

  test("unseal with wrong key throws", async () => {
    const recipient = generateBoxKeypair();
    const intruder = generateBoxKeypair();
    const sealed = await sealForRecipient("private", recipient.pub);
    await expect(
      unsealForSelf({
        ciphertextB64: sealed.ciphertextB64,
        nonceB64: sealed.nonceB64,
        ephemeralPubB64: sealed.ephemeralPubB64,
        recipientBoxPriv: intruder.priv,
      }),
    ).rejects.toThrow();
  });

  test("rejects malformed key lengths", async () => {
    await expect(
      sealForRecipient("x", new Uint8Array(31)),
    ).rejects.toThrow(/32 bytes/);
    await expect(
      unsealForSelf({
        ciphertextB64: "AA",
        nonceB64: "AA",
        ephemeralPubB64: "AA",
        recipientBoxPriv: new Uint8Array(20),
      }),
    ).rejects.toThrow(/32 bytes/);
  });
});

describe("canonical bytes + envelope signing", () => {
  test("canonicalInboxBytes is 32-byte SHA-256", () => {
    const out = canonicalInboxBytes({
      recipientDid: "did:at:00000000-0000-4000-8000-000000000001",
      ciphertextB64: Buffer.from(new Uint8Array(40)).toString("base64"),
      nonceB64: Buffer.from(new Uint8Array(12)).toString("base64"),
      ephemeralPubB64: Buffer.from(new Uint8Array(32)).toString("base64"),
    });
    expect(out.length).toBe(32);
  });

  test("any field change perturbs the canonical digest", () => {
    const base = {
      recipientDid: "did:at:abc",
      ciphertextB64: Buffer.from(new Uint8Array(32)).toString("base64"),
      nonceB64: Buffer.from(new Uint8Array(12)).toString("base64"),
      ephemeralPubB64: Buffer.from(new Uint8Array(32)).toString("base64"),
    };
    const baseDigest = canonicalInboxBytes(base);
    const variants = [
      { recipientDid: "did:at:def" },
      { ciphertextB64: Buffer.from(new Uint8Array([1, ...new Array(31).fill(0)])).toString("base64") },
      { nonceB64: Buffer.from(new Uint8Array([1, ...new Array(11).fill(0)])).toString("base64") },
      { ephemeralPubB64: Buffer.from(new Uint8Array([1, ...new Array(31).fill(0)])).toString("base64") },
    ];
    for (const v of variants) {
      const altered = canonicalInboxBytes({ ...base, ...v });
      expect(Buffer.from(altered).toString("hex")).not.toBe(
        Buffer.from(baseDigest).toString("hex"),
      );
    }
  });

  test("signInboxEnvelope produces a signature that ed25519.verify accepts", async () => {
    const sender = makeSigningKeypair();
    const recipient = generateBoxKeypair();
    const sealed = await sealForRecipient("hello", recipient.pub);
    const sig = signInboxEnvelope({
      recipientDid: "did:at:abc",
      ciphertextB64: sealed.ciphertextB64,
      nonceB64: sealed.nonceB64,
      ephemeralPubB64: sealed.ephemeralPubB64,
      signingKey: sender.priv,
    });
    const canonical = canonicalInboxBytes({
      recipientDid: "did:at:abc",
      ciphertextB64: sealed.ciphertextB64,
      nonceB64: sealed.nonceB64,
      ephemeralPubB64: sealed.ephemeralPubB64,
    });
    expect(ed.verify(b64decode(sig), canonical, sender.pub)).toBe(true);
  });

  test("signInboxCoSign canonical includes ciphertext + nonce — substitution rejected", () => {
    const recipient = makeSigningKeypair();
    const opts = {
      messageId: "00000000-0000-4000-8000-000000000aaa",
      recipientDid: "did:at:abc",
      ciphertextB64: Buffer.from(new Uint8Array([7, 7, 7])).toString("base64"),
      nonceB64: Buffer.from(new Uint8Array(12)).toString("base64"),
    };
    const sig = signInboxCoSign({ ...opts, signingKey: recipient.priv });
    const goodCanonical = canonicalInboxCoSignBytes(opts);
    expect(ed.verify(b64decode(sig), goodCanonical, recipient.pub)).toBe(true);

    // Substitute a different ciphertext — sig must NOT verify.
    const badCanonical = canonicalInboxCoSignBytes({
      ...opts,
      ciphertextB64: Buffer.from(new Uint8Array([8, 8, 8])).toString("base64"),
    });
    expect(ed.verify(b64decode(sig), badCanonical, recipient.pub)).toBe(false);
  });
});
