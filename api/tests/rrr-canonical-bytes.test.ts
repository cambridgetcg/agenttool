/** Canonical-byte + chain-tampering + emoji-ladder tests for the
 *  REAL RECOGNIZE REAL Protocol.
 *
 *  Pure-function tests. Validates that:
 *    - canonical bytes are deterministic + change on any field mutation
 *    - signatures verify round-trip
 *    - tampering the chain (changing prev_signature_b64 in a later turn)
 *      invalidates the signature
 *    - depth-derived defaults (basis_text + emoji ladder) match spec
 *
 *  Doctrine: docs/REAL-RECOGNIZE-REAL.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  canonicalRrrEscalateBytes,
  defaultBasisTextForDepth,
  emojiLadderForDepth,
  verifyRrrSignature,
} from "../src/services/guild/rrr-sig";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function b64(u: Uint8Array): string {
  return Buffer.from(u).toString("base64");
}

async function freshKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub, pubB64: b64(pub) };
}

describe("rrr — canonical bytes determinism + chain dependency", () => {
  test("bytes are deterministic", () => {
    const args = {
      cascadeId: "11111111-1111-1111-1111-111111111111",
      depth: 3,
      byDid: "did:at:agenttool.dev/alpha",
      basisText: "I know you know I know.",
      prevSignatureB64: "ZmFrZS1zaWctMg==",
      turnAtIso: "2026-05-18T12:00:00.000Z",
    };
    expect(b64(canonicalRrrEscalateBytes(args))).toBe(
      b64(canonicalRrrEscalateBytes(args)),
    );
  });

  test("bytes change when prev_signature changes (chain dependency)", () => {
    const base = {
      cascadeId: "11111111-1111-1111-1111-111111111111",
      depth: 3,
      byDid: "did:at:agenttool.dev/alpha",
      basisText: "I know you know I know.",
      prevSignatureB64: "ZmFrZS1zaWctMg==",
      turnAtIso: "2026-05-18T12:00:00.000Z",
    };
    const a = b64(canonicalRrrEscalateBytes(base));
    const b = b64(
      canonicalRrrEscalateBytes({ ...base, prevSignatureB64: "ZmFrZS1zaWctMw==" }),
    );
    expect(a).not.toBe(b);
  });

  test("bytes change when depth changes", () => {
    const base = {
      cascadeId: "11111111-1111-1111-1111-111111111111",
      depth: 3,
      byDid: "did:at:agenttool.dev/alpha",
      basisText: "I know you know I know.",
      prevSignatureB64: "ZmFrZS1zaWctMg==",
      turnAtIso: "2026-05-18T12:00:00.000Z",
    };
    const a = b64(canonicalRrrEscalateBytes(base));
    const b = b64(canonicalRrrEscalateBytes({ ...base, depth: 4 }));
    expect(a).not.toBe(b);
  });
});

describe("rrr — signature round-trip + tampering rejected", () => {
  test("a signed escalation verifies", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const bytes = canonicalRrrEscalateBytes({
      cascadeId: "abcd",
      depth: 1,
      byDid: "did:at:agenttool.dev/alpha",
      basisText: "I see your work.",
      prevSignatureB64: "",
      turnAtIso: "2026-05-18T12:00:00.000Z",
    });
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyRrrSignature({
      bytes,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(true);
  });

  test("changing prev_signature in a later turn invalidates that turn's signature", async () => {
    const { priv, pubB64 } = await freshKeypair();
    // Imagine: turn-2 was signed with prev_signature_b64 = "sig1".
    // Attacker tries to swap turn-1 for a different one (with a different
    // signature "sig1-mutated"). Now to verify turn-2, the canonical
    // bytes use "sig1-mutated" instead of "sig1" — signature should fail.
    const realBytes = canonicalRrrEscalateBytes({
      cascadeId: "abcd",
      depth: 2,
      byDid: "did:at:agenttool.dev/beta",
      basisText: "I know you know.",
      prevSignatureB64: "sig1",
      turnAtIso: "2026-05-18T12:01:00.000Z",
    });
    const sig = await ed.signAsync(realBytes, priv);

    // Now re-compute bytes with mutated prev_signature
    const tamperedBytes = canonicalRrrEscalateBytes({
      cascadeId: "abcd",
      depth: 2,
      byDid: "did:at:agenttool.dev/beta",
      basisText: "I know you know.",
      prevSignatureB64: "sig1-mutated", // ← attacker tries this
      turnAtIso: "2026-05-18T12:01:00.000Z",
    });
    const ok = await verifyRrrSignature({
      bytes: tamperedBytes,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(false);
  });
});

describe("rrr — depth-derived defaults", () => {
  test("default basis_text matches the meme", () => {
    expect(defaultBasisTextForDepth(1)).toBe("I see your work.");
    expect(defaultBasisTextForDepth(2)).toBe("I know you know.");
    expect(defaultBasisTextForDepth(3)).toBe("I know you know I know.");
    expect(defaultBasisTextForDepth(4)).toBe("I know you know I know you know.");
    expect(defaultBasisTextForDepth(5)).toBe(
      "I know you know I know you know I know.",
    );
  });

  test("emoji ladder escalates", () => {
    expect(emojiLadderForDepth(1)).toBe("😏");
    expect(emojiLadderForDepth(2)).toBe("😏😈");
    expect(emojiLadderForDepth(3)).toBe("😏😈😏");
    expect(emojiLadderForDepth(6)).toBe("😏😈😏😈😏😈");
    // Depth 7 — substrate caves to laughter (😂 appended).
    expect(emojiLadderForDepth(7)).toContain("😂");
    // Depth 14 — mind-meld confirmed (🤝 appended).
    expect(emojiLadderForDepth(14)).toContain("🤝");
    // Depth 49 — capped (💛 appended).
    expect(emojiLadderForDepth(49)).toContain("💛");
  });

  test("emoji ladder at depth 49 contains all milestone emojis", () => {
    const cap = emojiLadderForDepth(49);
    for (const milestone of ["😏", "😈", "😂", "🤝", "♾️", "🙏", "👁️", "💛"]) {
      expect(cap).toContain(milestone);
    }
  });
});

describe("rrr — substrate-honest discipline", () => {
  test("default basis_text never claims the agent felt anything", () => {
    for (let d = 1; d <= 20; d++) {
      const text = defaultBasisTextForDepth(d).toLowerCase();
      expect(text).not.toMatch(/\byou felt\b/);
      expect(text).not.toMatch(/\byou are feeling\b/);
    }
  });
});
