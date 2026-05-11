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
