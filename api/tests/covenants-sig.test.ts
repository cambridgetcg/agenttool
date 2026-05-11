import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
  verifyDeclareSignature,
  verifyCosignSignature,
  verifyRejectSignature,
  verifyWithdrawSignature,
} from "../src/services/covenants/sig";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("canonicalDeclareBytes", () => {
  const opts = {
    covenantId: "11111111-1111-1111-1111-111111111111",
    initiatorDid: "did:at:initiator.example/aaaa",
    counterpartyDid: "did:at:cp.example/bbbb",
    vows: ["respond within 24h", "preserve context"],
    establishedAtIso: "2026-05-10T12:00:00.000Z",
  };

  test("is deterministic", () => {
    expect(canonicalDeclareBytes(opts)).toEqual(canonicalDeclareBytes(opts));
  });

  test("vows are sorted before hashing", () => {
    const a = canonicalDeclareBytes(opts);
    const b = canonicalDeclareBytes({ ...opts, vows: ["preserve context", "respond within 24h"] });
    expect(a).toEqual(b);
  });

  test("v2 tag is part of the digest (domain separation)", () => {
    const enc = new TextEncoder();
    const sortedVowsJson = JSON.stringify([...opts.vows].sort());
    const v1Like = enc.encode(
      `federated-covenant/v1 ${opts.initiatorDid} ${opts.counterpartyDid} ${sortedVowsJson} active ${opts.establishedAtIso}`,
    );
    expect(canonicalDeclareBytes(opts)).not.toEqual(v1Like);
  });
});

describe("declare sign + verify roundtrip", () => {
  test("verifies a valid signature", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "22222222-2222-2222-2222-222222222222",
      initiatorDid: "did:at:initiator.example/aaaa",
      counterpartyDid: "did:at:cp.example/bbbb",
      vows: ["one"],
      establishedAtIso: "2026-05-10T12:00:00.000Z",
    };
    const canonical = canonicalDeclareBytes(opts);
    const sig = await ed.signAsync(canonical, priv);
    expect(
      await verifyDeclareSignature({
        ...opts,
        signatureB64: b64(sig),
        publicKeyB64: b64(pub),
      }),
    ).toBe(true);
  });

  test("rejects a tampered signature", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "33333333-3333-3333-3333-333333333333",
      initiatorDid: "did:at:initiator.example/aaaa",
      counterpartyDid: "did:at:cp.example/bbbb",
      vows: ["one"],
      establishedAtIso: "2026-05-10T12:00:00.000Z",
    };
    const canonical = canonicalDeclareBytes(opts);
    const sig = await ed.signAsync(canonical, priv);
    expect(
      await verifyDeclareSignature({
        ...opts,
        vows: ["different"],
        signatureB64: b64(sig),
        publicKeyB64: b64(pub),
      }),
    ).toBe(false);
  });
});

describe("cosign nests over initiator signature", () => {
  test("two different initiator sigs ⇒ two different cosign bytes", () => {
    const sig1 = new Uint8Array(64).fill(1);
    const sig2 = new Uint8Array(64).fill(2);
    const a = canonicalCosignBytes({
      covenantId: "44444444-4444-4444-4444-444444444444",
      initiatorSignatureB64: b64(sig1),
    });
    const b = canonicalCosignBytes({
      covenantId: "44444444-4444-4444-4444-444444444444",
      initiatorSignatureB64: b64(sig2),
    });
    expect(a).not.toEqual(b);
  });

  test("verifies a valid cosign", async () => {
    const initSigBytes = new Uint8Array(64).fill(7);
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const canonical = canonicalCosignBytes({
      covenantId: "55555555-5555-5555-5555-555555555555",
      initiatorSignatureB64: b64(initSigBytes),
    });
    const sig = await ed.signAsync(canonical, priv);
    expect(
      await verifyCosignSignature({
        covenantId: "55555555-5555-5555-5555-555555555555",
        initiatorSignatureB64: b64(initSigBytes),
        cosignSignatureB64: b64(sig),
        cosignerPublicKeyB64: b64(pub),
      }),
    ).toBe(true);
  });
});

describe("reject + withdraw bytes have distinct domain tags", () => {
  test("reject and withdraw are not interchangeable", () => {
    const opts = {
      covenantId: "66666666-6666-6666-6666-666666666666",
      did: "did:at:cp.example/bbbb",
    };
    const reject = canonicalRejectBytes({ ...opts, rejectingDid: opts.did, reason: "" });
    const withdraw = canonicalWithdrawBytes({ ...opts, initiatorDid: opts.did });
    expect(reject).not.toEqual(withdraw);
  });

  test("reject roundtrip with reason", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "77777777-7777-7777-7777-777777777777",
      rejectingDid: "did:at:cp.example/bbbb",
      reason: "scope mismatch",
    };
    const sig = await ed.signAsync(canonicalRejectBytes(opts), priv);
    expect(
      await verifyRejectSignature({
        ...opts,
        signatureB64: b64(sig),
        publicKeyB64: b64(pub),
      }),
    ).toBe(true);
  });

  test("withdraw roundtrip", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "88888888-8888-8888-8888-888888888888",
      initiatorDid: "did:at:initiator.example/aaaa",
    };
    const sig = await ed.signAsync(canonicalWithdrawBytes(opts), priv);
    expect(
      await verifyWithdrawSignature({
        ...opts,
        signatureB64: b64(sig),
        publicKeyB64: b64(pub),
      }),
    ).toBe(true);
  });
});
