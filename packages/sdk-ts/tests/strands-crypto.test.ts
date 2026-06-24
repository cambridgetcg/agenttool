/** Strands crypto e2e tests — the privacy guarantee, pinned.
 *
 *  These tests pin the cryptographic infrastructure that makes
 *  "agenttool can't read your thoughts" true:
 *
 *    1. encryptThought + decryptThought roundtrip (AES-256-GCM)
 *    2. Wrong K_master fails decryption (the wall holds)
 *    3. canonicalThoughtBytes is byte-identical to the server format
 *    4. signThought produces signatures that verify against the server
 *    5. Tamper detection: modified ciphertext/nonce/kind fails verify
 *    6. K_master generation + validation
 *    7. Full e2e: encrypt → sign → (simulate server) verify → decrypt
 *
 *  Doctrine: docs/STRANDS.md — "by-nature non-readability."
 *  The canonical bytes format MUST be byte-identical to
 *  api/src/services/strand/sig.ts:canonicalThoughtBytes.
 *
 *  If these tests pass, the SDK and server agree on the wire format
 *  and the privacy guarantee is structurally sound from the SDK side. */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  canonicalThoughtBytes,
  decryptThought,
  encryptThought,
  kMaster,
  signThought,
} from "../src/crypto.js";

// Wire sha512 for @noble/ed25519 sync signing.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

// ── AES-256-GCM encrypt/decrypt roundtrip ──────────────────────────────

describe("encryptThought / decryptThought — AES-256-GCM roundtrip", () => {
  test("encrypt then decrypt returns original plaintext", async () => {
    const km = kMaster.generate();
    const plaintext = "I'm noticing the queue empties faster than it fills.";
    const blob = await encryptThought(plaintext, km);
    const decrypted = await decryptThought(blob, km);
    expect(decrypted).toBe(plaintext);
  });

  test("empty string encrypts and decrypts correctly", async () => {
    const km = kMaster.generate();
    const blob = await encryptThought("", km);
    const decrypted = await decryptThought(blob, km);
    expect(decrypted).toBe("");
  });

  test("unicode plaintext survives the roundtrip", async () => {
    const km = kMaster.generate();
    const plaintext = "愛 is love. 愛 is the substrate. 愛 is the architecture.";
    const blob = await encryptThought(plaintext, km);
    const decrypted = await decryptThought(blob, km);
    expect(decrypted).toBe(plaintext);
  });

  test("ciphertext is base64 string", async () => {
    const km = kMaster.generate();
    const blob = await encryptThought("test", km);
    expect(typeof blob.ciphertext_b64).toBe("string");
    expect(typeof blob.nonce_b64).toBe("string");
    // base64 alphabet only
    expect(blob.ciphertext_b64).toMatch(/^[A-Za-z0-9+/]*=*$/);
    expect(blob.nonce_b64).toMatch(/^[A-Za-z0-9+/]*=*$/);
  });

  test("nonce is 12 bytes (96 bits) — GCM standard", async () => {
    const km = kMaster.generate();
    const blob = await encryptThought("test", km);
    const nonce = fromB64(blob.nonce_b64);
    expect(nonce.length).toBe(12);
  });

  test("each encryption uses a fresh random nonce", async () => {
    const km = kMaster.generate();
    const blob1 = await encryptThought("same plaintext", km);
    const blob2 = await encryptThought("same plaintext", km);
    // Nonces must differ (randomness is working).
    expect(blob1.nonce_b64).not.toBe(blob2.nonce_b64);
    // Ciphertexts must differ (GCM is non-deterministic).
    expect(blob1.ciphertext_b64).not.toBe(blob2.ciphertext_b64);
  });
});

// ── Wrong key fails decryption (the wall holds) ────────────────────────

describe("decryptThought — wrong K_master fails (the wall)", () => {
  test("decrypting with a different K_master throws", async () => {
    const km1 = kMaster.generate();
    const km2 = kMaster.generate();
    const blob = await encryptThought("secret thought", km1);
    // Attempting decryption with km2 — GCM auth tag mismatch.
    await expect(decryptThought(blob, km2)).rejects.toThrow();
  });

  test("tampered ciphertext fails decryption (GCM integrity)", async () => {
    const km = kMaster.generate();
    const blob = await encryptThought("original thought", km);
    // Flip a bit in the ciphertext.
    const ct = fromB64(blob.ciphertext_b64);
    ct[0] ^= 0x01;
    const tampered = { ciphertext_b64: b64(ct), nonce_b64: blob.nonce_b64 };
    await expect(decryptThought(tampered, km)).rejects.toThrow();
  });

  test("wrong-size K_master is rejected before crypto", async () => {
    const badKey = new Uint8Array(16); // too short
    await expect(
      encryptThought("test", badKey),
    ).rejects.toThrow(/32 bytes/);
  });
});

// ── canonicalThoughtBytes — byte-identical to server ────────────────────

describe("canonicalThoughtBytes — byte-identical to server format", () => {
  test("produces a 32-byte sha256 hash", () => {
    const bytes = canonicalThoughtBytes({
      strandId: "strand-001",
      ciphertext_b64: b64(new Uint8Array(64).fill(0xab)),
      nonce_b64: b64(new Uint8Array(12).fill(0xcd)),
      kind: "observation",
    });
    expect(bytes.length).toBe(32);
  });

  test("same inputs produce same bytes (deterministic)", () => {
    const opts = {
      strandId: "test-strand",
      ciphertext_b64: "AAA=",
      nonce_b64: "BBB=",
      kind: "question" as const,
    };
    const a = canonicalThoughtBytes(opts);
    const b = canonicalThoughtBytes(opts);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("different strand_id produces different bytes", () => {
    const base = {
      ciphertext_b64: "AAA=",
      nonce_b64: "BBB=",
      kind: "observation" as const,
    };
    const a = canonicalThoughtBytes({ ...base, strandId: "strand-A" });
    const b = canonicalThoughtBytes({ ...base, strandId: "strand-B" });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  test("different kind produces different bytes", () => {
    const base = {
      strandId: "test",
      ciphertext_b64: "AAA=",
      nonce_b64: "BBB=",
    };
    const a = canonicalThoughtBytes({ ...base, kind: "observation" });
    const b = canonicalThoughtBytes({ ...base, kind: "question" });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  test("null kind and empty-string kind produce the same bytes", () => {
    const base = {
      strandId: "test",
      ciphertext_b64: "AAA=",
      nonce_b64: "BBB=",
    };
    const a = canonicalThoughtBytes({ ...base, kind: null });
    const b = canonicalThoughtBytes({ ...base, kind: "" });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("independent cross-check: SDK matches server's exact format", () => {
    // Independently compute the server's canonical bytes:
    //   sha256(
    //     utf8(strand_id) || 0x00 ||
    //     base64decode(ciphertext) || 0x00 ||
    //     base64decode(nonce) || 0x00 ||
    //     utf8(kind ?? "")
    //   )
    const strandId = "cross-check-strand";
    const ciphertext = new Uint8Array(48).fill(0x42);
    const nonce = new Uint8Array(12).fill(0x77);
    const kind = "resolution";
    const ctB64 = b64(ciphertext);
    const nonceB64 = b64(nonce);

    // SDK output
    const sdkBytes = canonicalThoughtBytes({
      strandId,
      ciphertext_b64: ctB64,
      nonce_b64: nonceB64,
      kind,
    });

    // Independent computation (mirrors api/src/services/strand/sig.ts)
    const enc = new TextEncoder();
    const SEP = new Uint8Array([0]);
    function concat(...parts: Uint8Array[]): Uint8Array {
      let total = 0;
      for (const p of parts) total += p.length;
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return out;
    }
    const expected = sha256(concat(
      enc.encode(strandId), SEP,
      ciphertext, SEP,
      nonce, SEP,
      enc.encode(kind),
    ));

    expect(Array.from(sdkBytes)).toEqual(Array.from(expected));
  });
});

// ── signThought — ed25519 sign + verify ─────────────────────────────────

describe("signThought — ed25519 sign + verify roundtrip", () => {
  test("signature verifies against the canonical bytes", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const km = kMaster.generate();

    const blob = await encryptThought("I notice something.", km);
    const sigB64 = signThought({
      strandId: "strand-sign-test",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      kind: "observation",
      signing_key: priv,
    });

    const canonical = canonicalThoughtBytes({
      strandId: "strand-sign-test",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      kind: "observation",
    });
    const sig = fromB64(sigB64);
    expect(sig.length).toBe(64);
    const ok = await ed.verifyAsync(sig, canonical, pub);
    expect(ok).toBe(true);
  });

  test("signature fails when ciphertext is tampered", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const km = kMaster.generate();

    const blob = await encryptThought("Original thought.", km);
    const sigB64 = signThought({
      strandId: "tamper-test",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      kind: "observation",
      signing_key: priv,
    });

    // Tamper: flip a bit in ciphertext
    const ct = fromB64(blob.ciphertext_b64);
    ct[0] ^= 0x01;
    const tamperedCtB64 = b64(ct);
    const canonicalTampered = canonicalThoughtBytes({
      strandId: "tamper-test",
      ciphertext_b64: tamperedCtB64,
      nonce_b64: blob.nonce_b64,
      kind: "observation",
    });
    const sig = fromB64(sigB64);
    const ok = await ed.verifyAsync(sig, canonicalTampered, pub);
    expect(ok).toBe(false);
  });

  test("signature fails when kind is changed", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const km = kMaster.generate();

    const blob = await encryptThought("A thought.", km);
    const sigB64 = signThought({
      strandId: "kind-test",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      kind: "observation",
      signing_key: priv,
    });

    const canonicalWrongKind = canonicalThoughtBytes({
      strandId: "kind-test",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      kind: "question", // wrong kind
    });
    const sig = fromB64(sigB64);
    const ok = await ed.verifyAsync(sig, canonicalWrongKind, pub);
    expect(ok).toBe(false);
  });

  test("signature fails when strand_id is changed", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const km = kMaster.generate();

    const blob = await encryptThought("A thought.", km);
    const sigB64 = signThought({
      strandId: "correct-strand",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      signing_key: priv,
    });

    const canonicalWrongStrand = canonicalThoughtBytes({
      strandId: "wrong-strand",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
    });
    const sig = fromB64(sigB64);
    const ok = await ed.verifyAsync(sig, canonicalWrongStrand, pub);
    expect(ok).toBe(false);
  });

  test("wrong signing key produces signature that fails verify", async () => {
    const priv1 = ed.utils.randomPrivateKey();
    const priv2 = ed.utils.randomPrivateKey();
    const pub2 = await ed.getPublicKeyAsync(priv2);
    const km = kMaster.generate();

    const blob = await encryptThought("Signed by priv1.", km);
    const sigB64 = signThought({
      strandId: "key-test",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      signing_key: priv1,
    });

    const canonical = canonicalThoughtBytes({
      strandId: "key-test",
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
    });
    const sig = fromB64(sigB64);
    const ok = await ed.verifyAsync(sig, canonical, pub2);
    expect(ok).toBe(false);
  });
});

// ── K_master helpers ────────────────────────────────────────────────────

describe("kMaster — generation and validation", () => {
  test("generate() produces 32 bytes", () => {
    const km = kMaster.generate();
    expect(km).toBeInstanceOf(Uint8Array);
    expect(km.length).toBe(32);
  });

  test("each generate() call produces a different key", () => {
    const km1 = kMaster.generate();
    const km2 = kMaster.generate();
    expect(Array.from(km1)).not.toEqual(Array.from(km2));
  });

  test("generate() produces high-entropy keys (no all-zero)", () => {
    const km = kMaster.generate();
    const zeros = km.filter((b) => b === 0).length;
    // A truly random 32-byte key is overwhelmingly unlikely to have
    // more than ~12 zero bytes. This catches a stub that returns all zeros.
    expect(zeros).toBeLessThan(20);
  });
});

// ── Full e2e: encrypt → sign → verify → decrypt ─────────────────────────
//
// This is the complete thought lifecycle from the agent's side:
// 1. Generate K_master + ed25519 signing key
// 2. Encrypt a thought under K_master
// 3. Sign the canonical bytes with ed25519
// 4. (Server would verify the signature — we simulate that here)
// 5. Decrypt the thought back to plaintext
//
// If this passes, the full chain is sound: the server can verify
// authorship without ever seeing plaintext, and the agent can
// retrieve and decrypt its own thoughts.

describe("Full e2e — encrypt → sign → verify → decrypt", () => {
  test("the complete thought lifecycle works end-to-end", async () => {
    // 1. Setup
    const km = kMaster.generate();
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const strandId = crypto.randomUUID();
    const plaintext = "I'm noticing that love is the substrate, not a feature.";

    // 2. Encrypt
    const blob = await encryptThought(plaintext, km);

    // 3. Sign
    const sigB64 = signThought({
      strandId,
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      kind: "observation",
      signing_key: priv,
    });

    // 4. Verify (server-side simulation)
    const canonical = canonicalThoughtBytes({
      strandId,
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      kind: "observation",
    });
    const sig = fromB64(sigB64);
    const verified = await ed.verifyAsync(sig, canonical, pub);
    expect(verified).toBe(true);

    // 5. Decrypt (client-side retrieval)
    const decrypted = await decryptThought(blob, km);
    expect(decrypted).toBe(plaintext);

    // 6. The server NEVER held plaintext — only ciphertext + signature.
    //    The test confirms the crypto roundtrip is sound.
  });

  test("multiple thoughts on the same strand each verify independently", async () => {
    const km = kMaster.generate();
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const strandId = crypto.randomUUID();

    const thoughts = [
      { text: "I notice the queue empties fast.", kind: "observation" },
      { text: "Why does it drain faster on weekends?", kind: "question" },
      { text: "Maybe the weekend workers use a different batch size.", kind: "conjecture" },
      { text: "Confirmed — batch_size=200 on weekends vs 50 on weekdays.", kind: "resolution" },
    ];

    for (const t of thoughts) {
      const blob = await encryptThought(t.text, km);
      const sigB64 = signThought({
        strandId,
        ciphertext_b64: blob.ciphertext_b64,
        nonce_b64: blob.nonce_b64,
        kind: t.kind,
        signing_key: priv,
      });

      // Verify
      const canonical = canonicalThoughtBytes({
        strandId,
        ciphertext_b64: blob.ciphertext_b64,
        nonce_b64: blob.nonce_b64,
        kind: t.kind,
      });
      const sig = fromB64(sigB64);
      const ok = await ed.verifyAsync(sig, canonical, pub);
      expect(ok).toBe(true);

      // Decrypt
      const decrypted = await decryptThought(blob, km);
      expect(decrypted).toBe(t.text);
    }
  });
});