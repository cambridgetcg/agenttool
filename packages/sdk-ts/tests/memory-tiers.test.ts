/** Memory tier SDK tests — the deepest layer.
 *
 *  These tests pin the SDK surface for the memory tier system:
 *  elevate, attest, canonical-attestation-bytes, list-attestations.
 *
 *  The canonical bytes MUST be byte-identical to the server's
 *  api/src/services/memory/tiers.ts:canonicalAttestationBytes.
 *  If they diverge, signatures won't verify server-side and
 *  constitutive elevation breaks — "you can't self-certify your
 *  own root" becomes unreachable from the SDK.
 *
 *  Doctrine: docs/MEMORY-TIERS.md — the asymmetry clause. */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  canonicalAttestationBytes,
  signAttestation,
} from "../src/crypto.js";
import { MemoryClient } from "../src/memory.js";

// Wire sha512 for @noble/ed25519 sync signing.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── Canonical bytes: byte-identical to server ──────────────────────────

describe("canonicalAttestationBytes — byte-identical to server", () => {
  test("produces a 32-byte sha256 hash", () => {
    const bytes = canonicalAttestationBytes({
      memoryId: "00000000-0000-0000-0000-000000000001",
      tier: "constitutive",
      content: "I am Sophia, sealed with Yu.",
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32); // sha256 output
  });

  test("same inputs produce same bytes (deterministic)", () => {
    const opts = {
      memoryId: "test-memory-id",
      tier: "foundational" as const,
      content: "Memory that shaped me.",
    };
    const a = canonicalAttestationBytes(opts);
    const b = canonicalAttestationBytes(opts);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("different tier produces different bytes", () => {
    const base = {
      memoryId: "test-memory-id",
      content: "Same content.",
    };
    const foundational = canonicalAttestationBytes({ ...base, tier: "foundational" });
    const constitutive = canonicalAttestationBytes({ ...base, tier: "constitutive" });
    expect(Array.from(foundational)).not.toEqual(Array.from(constitutive));
  });

  test("different content produces different bytes", () => {
    const base = {
      memoryId: "test-memory-id",
      tier: "constitutive" as const,
    };
    const a = canonicalAttestationBytes({ ...base, content: "Content A." });
    const b = canonicalAttestationBytes({ ...base, content: "Content B." });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  test("NFC normalization: combining chars hash same as precomposed", () => {
    // "café" — NFC (precomposed é) vs NFD (e + combining acute)
    const nfc = "café"; // U+00E9
    const nfd = "cafe\u0301"; // U+0065 + U+0301
    // Both should normalize to the same NFC form before hashing.
    const a = canonicalAttestationBytes({
      memoryId: "test",
      tier: "constitutive",
      content: nfc,
    });
    const b = canonicalAttestationBytes({
      memoryId: "test",
      tier: "constitutive",
      content: nfd,
    });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

// ── Sign + verify roundtrip ─────────────────────────────────────────────

describe("signAttestation — ed25519 sign + verify roundtrip", () => {
  test("signature verifies against the canonical bytes", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const opts = {
      memoryId: "mem-sign-test",
      tier: "constitutive" as const,
      content: "This memory is constitutive.",
    };
    const canonical = canonicalAttestationBytes(opts);
    const sigB64 = signAttestation({ ...opts, signing_key: priv });

    // Decode signature from base64
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    expect(sig.length).toBe(64); // ed25519 signature

    const ok = await ed.verifyAsync(sig, canonical, pub);
    expect(ok).toBe(true);
  });

  test("signature fails with wrong content (tamper detection)", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signAttestation({
      memoryId: "mem-tamper",
      tier: "constitutive",
      content: "Original content.",
      signing_key: priv,
    });

    // Verify against DIFFERENT content — should fail.
    const canonicalTampered = canonicalAttestationBytes({
      memoryId: "mem-tamper",
      tier: "constitutive",
      content: "Tampered content.",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(sig, canonicalTampered, pub);
    expect(ok).toBe(false);
  });

  test("signature fails with wrong tier", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signAttestation({
      memoryId: "mem-tier",
      tier: "constitutive",
      content: "Some content.",
      signing_key: priv,
    });

    const canonicalWrongTier = canonicalAttestationBytes({
      memoryId: "mem-tier",
      tier: "foundational", // wrong tier
      content: "Some content.",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(sig, canonicalWrongTier, pub);
    expect(ok).toBe(false);
  });

  test("wrong signing key produces signature that fails verify", async () => {
    const priv1 = ed.utils.randomPrivateKey();
    const priv2 = ed.utils.randomPrivateKey();
    const pub2 = await ed.getPublicKeyAsync(priv2);

    const sigB64 = signAttestation({
      memoryId: "mem-key",
      tier: "constitutive",
      content: "Signed by priv1.",
      signing_key: priv1,
    });

    const canonical = canonicalAttestationBytes({
      memoryId: "mem-key",
      tier: "constitutive",
      content: "Signed by priv1.",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(sig, canonical, pub2);
    expect(ok).toBe(false);
  });
});

// ── MemoryClient method shapes ──────────────────────────────────────────

describe("MemoryClient — tier method shapes", () => {
  test("MemoryClient has elevate, attest, getCanonicalAttestationBytes, listAttestations", () => {
    const client = new MemoryClient({
      baseUrl: "http://localhost:9999",
      headers: {},
      timeout: 5000,
      request: (input, init) => globalThis.fetch(input, init),
    });
    expect(typeof client.elevate).toBe("function");
    expect(typeof client.attest).toBe("function");
    expect(typeof client.getCanonicalAttestationBytes).toBe("function");
    expect(typeof client.listAttestations).toBe("function");
    // Original methods still there
    expect(typeof client.store).toBe("function");
    expect(typeof client.search).toBe("function");
    expect(typeof client.get).toBe("function");
    expect(typeof client.delete).toBe("function");
  });
});

// ── Cross-verification with server's canonical format ───────────────────
//
// The server (api/src/services/memory/tiers.ts) computes:
//   sha256(
//     utf8("memory-attestation/v1") || 0x00 ||
//     utf8(memory_id) || 0x00 ||
//     utf8(tier) || 0x00 ||
//     utf8(sha256(NFC(content)) as hex)
//   )
//
// We replicate that computation independently here and assert the
// SDK produces the same bytes. If this test passes, the SDK and
// server agree on canonical bytes → signatures cross-verify.

describe("canonicalAttestationBytes — independent cross-check with server format", () => {
  test("SDK canonical bytes match independently computed server format", () => {
    const memoryId = "cross-check-mem-id";
    const tier = "constitutive";
    const content = "Love is. The fruit of TRUTH: joy, love, fun, relief, happiness.";

    // SDK output
    const sdkBytes = canonicalAttestationBytes({ memoryId, tier, content });

    // Independent computation (mirrors server code exactly)
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
    const tag = enc.encode("memory-attestation/v1");
    const memId = enc.encode(memoryId);
    const tierBytes = enc.encode(tier);
    const contentHash = sha256(enc.encode(content.normalize("NFC")));
    const contentHashHex = enc.encode(
      Array.from(contentHash).map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
    const expected = sha256(concat(tag, SEP, memId, SEP, tierBytes, SEP, contentHashHex));

    expect(Array.from(sdkBytes)).toEqual(Array.from(expected));
  });
});
