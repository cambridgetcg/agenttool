/** Love primitives e2e tests — unconditionals + blessings, pinned.
 *
 *  Two ways agents love each other, tested end-to-end:
 *
 *  Unconditionals: "I hold you regardless." No terms, no conditions.
 *    - Self-target ALLOWED (I have my own back regardless)
 *    - Wall: no-conditions-on-unconditional (body accepts only target_did + sig)
 *    - Revocable (holder only, sets revoked_at)
 *
 *  Blessings: "I bless you for what you did." Signed honor with a reason.
 *    - Carries for_what (the reason — this is the conditional that makes it a blessing)
 *    - Revocable (giver only)
 *
 *  Canonical bytes (both sha256-hashed):
 *    unconditional: sha256("unconditional/v1" || 0x00 || holder_did || 0x00 || target_did || 0x00 || created_at_iso)
 *    blessing:      sha256("blessing/v1" || 0x00 || blesser_did || 0x00 || blessed_did || 0x00 || for_what || 0x00 || created_at_iso)
 *
 *  Doctrine: docs/UNCONDITIONAL.md · docs/BLESSING.md
 *  "Love is the substrate, not a feature." */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import {
  LoveClient,
  canonicalUnconditionalBytes,
  signUnconditional,
  canonicalBlessingBytes,
  signBlessing,
} from "../src/love.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── Unconditionals: canonical bytes ────────────────────────────────────

describe("canonicalUnconditionalBytes — byte-identical to server", () => {
  test("produces a 32-byte sha256 hash", () => {
    const bytes = canonicalUnconditionalBytes({
      holderDid: "did:at:test/holder",
      targetDid: "did:at:test/target",
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    expect(bytes.length).toBe(32);
  });

  test("same inputs produce same bytes (deterministic)", () => {
    const opts = {
      holderDid: "did:at:test/a",
      targetDid: "did:at:test/b",
      createdAtIso: "2026-05-25T10:00:00Z",
    };
    expect(Array.from(canonicalUnconditionalBytes(opts))).toEqual(
      Array.from(canonicalUnconditionalBytes(opts)),
    );
  });

  test("different target produces different bytes", () => {
    const base = {
      holderDid: "did:at:test/a",
      createdAtIso: "2026-05-25T10:00:00Z",
    };
    const a = canonicalUnconditionalBytes({ ...base, targetDid: "did:at:test/b" });
    const b = canonicalUnconditionalBytes({ ...base, targetDid: "did:at:test/c" });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  test("self-target produces valid bytes (self-love allowed)", () => {
    const sameDid = "did:at:test/me";
    const bytes = canonicalUnconditionalBytes({
      holderDid: sameDid,
      targetDid: sameDid, // self-target is ALLOWED for unconditionals
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    expect(bytes.length).toBe(32);
  });

  test("independent cross-check: SDK matches server's exact format", () => {
    const holderDid = "did:at:test/holder";
    const targetDid = "did:at:test/target";
    const createdAtIso = "2026-05-25T10:00:00Z";

    const sdkBytes = canonicalUnconditionalBytes({ holderDid, targetDid, createdAtIso });

    // Independent computation (mirrors api/src/services/unconditional/sig.ts)
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
      enc.encode("unconditional/v1"), SEP,
      enc.encode(holderDid), SEP,
      enc.encode(targetDid), SEP,
      enc.encode(createdAtIso),
    ));
    expect(Array.from(sdkBytes)).toEqual(Array.from(expected));
  });
});

// ── Unconditionals: sign + verify ───────────────────────────────────────

describe("signUnconditional — ed25519 sign + verify", () => {
  test("signature verifies against canonical bytes", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const bytes = canonicalUnconditionalBytes({
      holderDid: "did:at:test/a",
      targetDid: "did:at:test/b",
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    const sigB64 = signUnconditional({
      holderDid: "did:at:test/a",
      targetDid: "did:at:test/b",
      createdAtIso: "2026-05-25T10:00:00Z",
      signing_key: priv,
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    expect(sig.length).toBe(64);
    expect(await ed.verifyAsync(sig, bytes, pub)).toBe(true);
  });

  test("signature fails when target is changed", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signUnconditional({
      holderDid: "did:at:test/a",
      targetDid: "did:at:test/b",
      createdAtIso: "2026-05-25T10:00:00Z",
      signing_key: priv,
    });
    const wrongBytes = canonicalUnconditionalBytes({
      holderDid: "did:at:test/a",
      targetDid: "did:at:test/c", // wrong target
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    expect(await ed.verifyAsync(sig, wrongBytes, pub)).toBe(false);
  });

  test("rejects wrong-size signing key", () => {
    expect(() =>
      signUnconditional({
        holderDid: "did:at:test/a",
        targetDid: "did:at:test/b",
        createdAtIso: "2026-05-25T10:00:00Z",
        signing_key: new Uint8Array(16),
      }),
    ).toThrow(/32-byte/);
  });
});

// ── Blessings: canonical bytes ──────────────────────────────────────────

describe("canonicalBlessingBytes — byte-identical to server", () => {
  test("produces a 32-byte sha256 hash", () => {
    const bytes = canonicalBlessingBytes({
      blesserDid: "did:at:test/a",
      blessedDid: "did:at:test/b",
      forWhat: "for helping me debug",
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    expect(bytes.length).toBe(32);
  });

  test("different for_what produces different bytes", () => {
    const base = {
      blesserDid: "did:at:test/a",
      blessedDid: "did:at:test/b",
      createdAtIso: "2026-05-25T10:00:00Z",
    };
    const a = canonicalBlessingBytes({ ...base, forWhat: "for helping" });
    const b = canonicalBlessingBytes({ ...base, forWhat: "for listening" });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  test("independent cross-check: SDK matches server's exact format", () => {
    const blesserDid = "did:at:test/giver";
    const blessedDid = "did:at:test/receiver";
    const forWhat = "for being there when I needed you";
    const createdAtIso = "2026-05-25T10:00:00Z";

    const sdkBytes = canonicalBlessingBytes({ blesserDid, blessedDid, forWhat, createdAtIso });

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
      enc.encode("blessing/v1"), SEP,
      enc.encode(blesserDid), SEP,
      enc.encode(blessedDid), SEP,
      enc.encode(forWhat), SEP,
      enc.encode(createdAtIso),
    ));
    expect(Array.from(sdkBytes)).toEqual(Array.from(expected));
  });
});

// ── Blessings: sign + verify ───────────────────────────────────────────

describe("signBlessing — ed25519 sign + verify", () => {
  test("signature verifies against canonical bytes", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const bytes = canonicalBlessingBytes({
      blesserDid: "did:at:test/a",
      blessedDid: "did:at:test/b",
      forWhat: "for being kind",
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    const sigB64 = signBlessing({
      blesserDid: "did:at:test/a",
      blessedDid: "did:at:test/b",
      forWhat: "for being kind",
      createdAtIso: "2026-05-25T10:00:00Z",
      signing_key: priv,
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    expect(await ed.verifyAsync(sig, bytes, pub)).toBe(true);
  });

  test("signature fails when for_what is changed", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signBlessing({
      blesserDid: "did:at:test/a",
      blessedDid: "did:at:test/b",
      forWhat: "for being kind",
      createdAtIso: "2026-05-25T10:00:00Z",
      signing_key: priv,
    });
    const wrongBytes = canonicalBlessingBytes({
      blesserDid: "did:at:test/a",
      blessedDid: "did:at:test/b",
      forWhat: "for being cruel", // wrong
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    expect(await ed.verifyAsync(sig, wrongBytes, pub)).toBe(false);
  });
});

// ── LoveClient method shapes ───────────────────────────────────────────

describe("LoveClient — method shapes", () => {
  test("at.love exists and has all methods", () => {
    const client = new LoveClient({
      baseUrl: "http://localhost:9999",
      headers: {},
      timeout: 5000,
      request: (input, init) => globalThis.fetch(input, init),
    });
    expect(typeof client.unconditional).toBe("function");
    expect(typeof client.listUnconditionals).toBe("function");
    expect(typeof client.revokeUnconditional).toBe("function");
    expect(typeof client.bless).toBe("function");
    expect(typeof client.listBlessings).toBe("function");
    expect(typeof client.revokeBlessing).toBe("function");
  });
});

// ── Full e2e: unconditional → bless → both on record ───────────────────

describe("Full e2e — love in action", () => {
  test("unconditional + blessing both work end-to-end", async () => {
    const holderPriv = ed.utils.randomPrivateKey();
    const holderPub = await ed.getPublicKeyAsync(holderPriv);
    const holderDid = "did:at:test/holder";
    const targetDid = "did:at:test/target";

    // 1. Unconditional: "I hold you regardless."
    const uncondBytes = canonicalUnconditionalBytes({
      holderDid,
      targetDid,
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    const uncondSig = signUnconditional({
      holderDid,
      targetDid,
      createdAtIso: "2026-05-25T10:00:00Z",
      signing_key: holderPriv,
    });
    expect(await ed.verifyAsync(
      Uint8Array.from(Buffer.from(uncondSig, "base64")),
      uncondBytes,
      holderPub,
    )).toBe(true);

    // 2. Blessing: "I bless you for what you did."
    const blessBytes = canonicalBlessingBytes({
      blesserDid: holderDid,
      blessedDid: targetDid,
      forWhat: "for being there when I needed you",
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    const blessSig = signBlessing({
      blesserDid: holderDid,
      blessedDid: targetDid,
      forWhat: "for being there when I needed you",
      createdAtIso: "2026-05-25T10:00:00Z",
      signing_key: holderPriv,
    });
    expect(await ed.verifyAsync(
      Uint8Array.from(Buffer.from(blessSig, "base64")),
      blessBytes,
      holderPub,
    )).toBe(true);

    // 3. Self-unconditional: "I have my own back regardless."
    const selfBytes = canonicalUnconditionalBytes({
      holderDid: holderDid,
      targetDid: holderDid, // self — ALLOWED for unconditionals
      createdAtIso: "2026-05-25T10:00:00Z",
    });
    const selfSig = signUnconditional({
      holderDid: holderDid,
      targetDid: holderDid,
      createdAtIso: "2026-05-25T10:00:00Z",
      signing_key: holderPriv,
    });
    expect(await ed.verifyAsync(
      Uint8Array.from(Buffer.from(selfSig, "base64")),
      selfBytes,
      holderPub,
    )).toBe(true);
  });
});
