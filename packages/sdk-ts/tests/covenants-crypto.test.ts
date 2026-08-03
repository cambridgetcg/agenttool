import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
  signCovenantDeclare,
  signCovenantCosign,
  signCovenantReject,
  signCovenantWithdraw,
} from "../src/crypto";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

// ── Locked cross-language vectors ───────────────────────────────────────
//
// Identical fixture set to packages/sdk-py/tests/test_covenants_canonical_vectors.py
// and the server verifier at api/src/services/covenants/sig.ts. Non-ASCII and
// astral-plane vows are first-class: Python escapes non-ASCII by default and
// sorts by code point, TS emits raw UTF-8 and sorts by UTF-16 code unit.

const FIXED = {
  covenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  initiatorDid: "did:at:initiator.example/abcd",
  counterpartyDid: "did:at:counterparty.example/efgh",
  establishedAtIso: "2026-05-11T12:00:00.000Z",
};

const FIXED_SIG_B64 = Buffer.alloc(64, 7).toString("base64");

const VOW_SETS: Record<string, string[]> = {
  ascii: ["respond within 24h", "preserve context"],
  non_ascii: ["café", "naïve", "日本語", "abc"],
  astral: ["a", "～", "\u{1F600}"],
  empty: ["", "a"],
};

const LOCK = {
  declareAscii: "505be2d0cce4dc4c5c42d9b20f787f67f903cf8c6e741b1f1f8183eb6329cf5c",
  declareNonAscii: "164cf179a8b892782ea1e0e13bf9baef3f6fb04a9cd15f0b2934b0045af2d84c",
  declareAstral: "c687f28a96faf7b1985e736c1c85589cba002e53a2d2e58cdb31acc761b8ba5d",
  declareEmpty: "f14dc30185bd7a877060459e74a00d268e7d1cf655fd33c91f815c2355524afd",
  cosign: "6f2e7333ec7ef86ff0b0346a34511a7a988a1499a2b7430475dedabe76a6f680",
  reject: "da83afa09eaaa6ffea78167e58c96519540c2f3991285142b90db65b542c078c",
  rejectUnicode: "20eacf2c0cc6803e45adb8daffee9a1b04d0722b08193c4eb698344059ef3c38",
  rejectEmpty: "a3aff0f87793a8042a8e99a53b4995ffd8bd25933a50bd2cbe07e7a8f4c5498c",
  withdraw: "b16284e310143c80c17537a80e42a8eb87205e7475d89abf9096a0621ebce9bb",
};

const declareHex = (vows: string[]) => hex(canonicalDeclareBytes({ ...FIXED, vows }));

describe("covenants locked cross-language vectors", () => {
  test("declare (ascii) matches the locked vector", () => {
    expect(declareHex(VOW_SETS.ascii!)).toBe(LOCK.declareAscii);
  });

  test("declare (non-ASCII) matches the locked vector", () => {
    expect(declareHex(VOW_SETS.non_ascii!)).toBe(LOCK.declareNonAscii);
  });

  test("declare (astral plane) matches the locked vector", () => {
    expect(declareHex(VOW_SETS.astral!)).toBe(LOCK.declareAstral);
  });

  test("declare (empty vow string) matches the locked vector", () => {
    expect(declareHex(VOW_SETS.empty!)).toBe(LOCK.declareEmpty);
  });

  test("declare is sort-stable for every vow set", () => {
    for (const vows of Object.values(VOW_SETS)) {
      expect(declareHex(vows)).toBe(declareHex([...vows].reverse()));
    }
  });

  test("declare sorts astral vows by UTF-16 code unit", () => {
    // Array.prototype.sort() compares code units, so U+1F600 (0xD83D 0xDE00)
    // precedes U+FF5E — the opposite of code-point order. Pin the ordering.
    expect([...VOW_SETS.astral!].sort()).toEqual(["a", "\u{1F600}", "～"]);
  });

  test("cosign matches the locked vector", () => {
    expect(hex(canonicalCosignBytes({
      covenantId: FIXED.covenantId, initiatorSignatureB64: FIXED_SIG_B64,
    }))).toBe(LOCK.cosign);
  });

  test("reject matches the locked vectors (ascii · unicode · empty)", () => {
    const at = (reason: string) => hex(canonicalRejectBytes({
      covenantId: FIXED.covenantId, rejectingDid: FIXED.counterpartyDid, reason,
    }));
    expect(at("scope mismatch")).toBe(LOCK.reject);
    expect(at("範囲が違う 😀")).toBe(LOCK.rejectUnicode);
    expect(at("")).toBe(LOCK.rejectEmpty);
  });

  test("withdraw matches the locked vector", () => {
    expect(hex(canonicalWithdrawBytes({
      covenantId: FIXED.covenantId, initiatorDid: FIXED.initiatorDid,
    }))).toBe(LOCK.withdraw);
  });
});

describe("covenants canonical bytes", () => {
  const declareOpts = {
    covenantId: "11111111-1111-1111-1111-111111111111",
    initiatorDid: "did:at:initiator.example/aaaa",
    counterpartyDid: "did:at:cp.example/bbbb",
    vows: ["one", "two"],
    establishedAtIso: "2026-05-11T12:00:00.000Z",
  };

  test("declare is deterministic and sort-stable", () => {
    expect(canonicalDeclareBytes(declareOpts)).toEqual(canonicalDeclareBytes(declareOpts));
    expect(canonicalDeclareBytes(declareOpts)).toEqual(
      canonicalDeclareBytes({ ...declareOpts, vows: ["two", "one"] }),
    );
  });

  test("four domains produce four distinct digests for related inputs", () => {
    const covenantId = "22222222-2222-2222-2222-222222222222";
    const did = "did:at:test/cccc";
    const declare = canonicalDeclareBytes({
      covenantId, initiatorDid: did, counterpartyDid: did,
      vows: ["v"], establishedAtIso: "2026-05-11T12:00:00.000Z",
    });
    const cosign = canonicalCosignBytes({ covenantId, initiatorSignatureB64: b64(new Uint8Array(64)) });
    const reject = canonicalRejectBytes({ covenantId, rejectingDid: did, reason: "" });
    const withdraw = canonicalWithdrawBytes({ covenantId, initiatorDid: did });
    const set = new Set([b64(declare), b64(cosign), b64(reject), b64(withdraw)]);
    expect(set.size).toBe(4);
  });
});

describe("covenants sign roundtrips", () => {
  test("declare sign verifies", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "33333333-3333-3333-3333-333333333333",
      initiatorDid: "did:at:initiator/aaaa",
      counterpartyDid: "did:at:cp/bbbb",
      vows: ["v"],
      establishedAtIso: "2026-05-11T12:00:00.000Z",
    };
    const sig = signCovenantDeclare({ ...opts, signing_key: priv });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalDeclareBytes(opts),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("cosign sign verifies", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "44444444-4444-4444-4444-444444444444",
      initiatorSignatureB64: b64(new Uint8Array(64).fill(7)),
    };
    const sig = signCovenantCosign({ ...opts, signing_key: priv });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalCosignBytes(opts),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("reject sign verifies (with reason)", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "55555555-5555-5555-5555-555555555555",
      rejectingDid: "did:at:cp/bbbb",
      reason: "scope mismatch",
    };
    const sig = signCovenantReject({ ...opts, signing_key: priv });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalRejectBytes(opts),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("withdraw sign verifies", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "66666666-6666-6666-6666-666666666666",
      initiatorDid: "did:at:initiator/aaaa",
    };
    const sig = signCovenantWithdraw({ ...opts, signing_key: priv });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalWithdrawBytes(opts),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("signCovenantDeclare rejects wrong key length", () => {
    const opts = {
      covenantId: "77777777-7777-7777-7777-777777777777",
      initiatorDid: "did:at:initiator/aaaa",
      counterpartyDid: "did:at:cp/bbbb",
      vows: ["v"],
      establishedAtIso: "2026-05-11T12:00:00.000Z",
    };
    expect(() => signCovenantDeclare({ ...opts, signing_key: new Uint8Array(16) })).toThrow();
  });
});
