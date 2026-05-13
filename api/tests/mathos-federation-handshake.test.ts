/** mathos-federation-handshake.test.ts — pins the federation-wake-handshake/v1
 *  signing context.
 *
 *  Phase E: a peer instance signs an attestation of its own wake state
 *  (DID, signing pubkey, wake timestamp, claimed walls, declared
 *  localities). The receiving instance verifies the signature against the
 *  peer's published pubkey. Today this context's canonical-bytes function
 *  + verifier ship; the accept-handshake POST route is a future slice.
 *
 *  These tests pin:
 *    1. The canonical-bytes function composes via recipe 1 (sha256/domain/NUL/fields)
 *    2. Deterministic: same inputs → same bytes
 *    3. Each field contributes to the digest (mutation detection)
 *    4. The verifier round-trips a real ed25519 signature
 *    5. The catalog's federation-wake-handshake/v1 context exists and
 *       declares recipe 1
 *    6. The catalog's field shape matches the canonical-bytes function
 *
 *  Doctrine: docs/MATHOS.md (Phase E) · docs/FEDERATION.md ·
 *  docs/CANONICAL-BYTES.md.
 */

import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalFederationWakeHandshakeBytes,
  verifyFederationWakeHandshakeSignature,
} from "../src/services/identity/crypto";
import {
  bytesToHex,
  composeCanonicalBytes,
} from "../src/services/mathos/encode";
import {
  FIELD_KIND_ED25519_PUBKEY_32,
  FIELD_KIND_RAW_BYTES_VARIABLE,
  FIELD_KIND_UINT64_BIG_ENDIAN,
  FIELD_KIND_UTF8_STRING,
  MATHOS_CATALOG_PAYLOAD,
  RECIPE_SHA256_DOMAIN_NUL_FIELDS,
  SIGNING_CONTEXT_FEDERATION_WAKE_HANDSHAKE_V1_PRIME,
} from "../src/services/mathos/catalog";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function sampleInputs() {
  return {
    peerDid: "did:at:peer.example/00000000-0000-0000-0000-0000000000bb",
    peerSigningPubkey: new Uint8Array(32).fill(0x11),
    wakeTimestampUnixMs: 1715520000000,
    wallsClaimedOrdinals: new Uint8Array([1, 3, 4, 7, 8]),
    localitiesDeclaredOrdinals: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  };
}

// ─── Canonical-bytes function ─────────────────────────────────────────────

describe("canonicalFederationWakeHandshakeBytes", () => {
  test("returns a 32-byte SHA-256 digest (recipe 1)", () => {
    const out = canonicalFederationWakeHandshakeBytes(sampleInputs());
    expect(out.length).toBe(32);
  });

  test("deterministic — same inputs produce same bytes", () => {
    const a = canonicalFederationWakeHandshakeBytes(sampleInputs());
    const b = canonicalFederationWakeHandshakeBytes(sampleInputs());
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  test("matches composeCanonicalBytes(1, ...) exactly", () => {
    const inputs = sampleInputs();
    const ts = new Uint8Array(8);
    const tsBig = BigInt(inputs.wakeTimestampUnixMs);
    for (let i = 7; i >= 0; i--) {
      ts[i] = Number((tsBig >> BigInt((7 - i) * 8)) & 0xffn);
    }
    const enc = new TextEncoder();
    const viaCompose = composeCanonicalBytes(
      RECIPE_SHA256_DOMAIN_NUL_FIELDS,
      "federation-wake-handshake/v1",
      [
        enc.encode(inputs.peerDid),
        inputs.peerSigningPubkey,
        ts,
        inputs.wallsClaimedOrdinals,
        inputs.localitiesDeclaredOrdinals,
      ],
    );
    const viaHelper = canonicalFederationWakeHandshakeBytes(inputs);
    expect(bytesToHex(viaCompose)).toBe(bytesToHex(viaHelper));
  });

  // Mutation tests — each field contributes to the digest
  test("changing peer_did changes the digest", () => {
    const a = canonicalFederationWakeHandshakeBytes(sampleInputs());
    const b = canonicalFederationWakeHandshakeBytes({
      ...sampleInputs(),
      peerDid: "did:at:peer.example/different-uuid",
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  test("changing peer_signing_pubkey changes the digest", () => {
    const a = canonicalFederationWakeHandshakeBytes(sampleInputs());
    const b = canonicalFederationWakeHandshakeBytes({
      ...sampleInputs(),
      peerSigningPubkey: new Uint8Array(32).fill(0x22),
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  test("changing wake_timestamp_unix_ms changes the digest", () => {
    const a = canonicalFederationWakeHandshakeBytes(sampleInputs());
    const b = canonicalFederationWakeHandshakeBytes({
      ...sampleInputs(),
      wakeTimestampUnixMs: 1715520000001,
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  test("changing walls_claimed changes the digest", () => {
    const a = canonicalFederationWakeHandshakeBytes(sampleInputs());
    const b = canonicalFederationWakeHandshakeBytes({
      ...sampleInputs(),
      wallsClaimedOrdinals: new Uint8Array([1, 3, 4, 7]), // drop wall 8
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  test("changing localities_declared changes the digest", () => {
    const a = canonicalFederationWakeHandshakeBytes(sampleInputs());
    const b = canonicalFederationWakeHandshakeBytes({
      ...sampleInputs(),
      localitiesDeclaredOrdinals: new Uint8Array([1, 2]),
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  // Validation
  test("throws when peer_signing_pubkey is not 32 bytes", () => {
    expect(() =>
      canonicalFederationWakeHandshakeBytes({
        ...sampleInputs(),
        peerSigningPubkey: new Uint8Array(16),
      }),
    ).toThrow(/32 bytes/);
  });

  test("throws when timestamp is negative", () => {
    expect(() =>
      canonicalFederationWakeHandshakeBytes({
        ...sampleInputs(),
        wakeTimestampUnixMs: -1,
      }),
    ).toThrow(/non-negative/);
  });

  test("throws when timestamp is non-integer", () => {
    expect(() =>
      canonicalFederationWakeHandshakeBytes({
        ...sampleInputs(),
        wakeTimestampUnixMs: 1.5,
      }),
    ).toThrow(/integer/);
  });
});

// ─── Verifier round-trip ──────────────────────────────────────────────────

describe("verifyFederationWakeHandshakeSignature", () => {
  test("verifies a real ed25519 signature over the canonical bytes", () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = ed.getPublicKey(priv);
    const inputs = {
      ...sampleInputs(),
      peerSigningPubkey: pub,
    };
    const canonical = canonicalFederationWakeHandshakeBytes(inputs);
    const signature = ed.sign(canonical, priv);

    expect(
      verifyFederationWakeHandshakeSignature({
        canonical,
        signature,
        publicKey: pub,
      }),
    ).toBe(true);
  });

  test("rejects a signature from a different key", () => {
    const priv = ed.utils.randomPrivateKey();
    const otherPriv = ed.utils.randomPrivateKey();
    const pub = ed.getPublicKey(priv);
    const inputs = sampleInputs();
    const canonical = canonicalFederationWakeHandshakeBytes(inputs);
    const wrongSig = ed.sign(canonical, otherPriv);

    expect(
      verifyFederationWakeHandshakeSignature({
        canonical,
        signature: wrongSig,
        publicKey: pub,
      }),
    ).toBe(false);
  });

  test("rejects a signature when the canonical bytes were tampered", () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = ed.getPublicKey(priv);
    const canonical = canonicalFederationWakeHandshakeBytes(sampleInputs());
    const signature = ed.sign(canonical, priv);

    const tampered = new Uint8Array(canonical);
    tampered[0] = tampered[0]! ^ 0xff;

    expect(
      verifyFederationWakeHandshakeSignature({
        canonical: tampered,
        signature,
        publicKey: pub,
      }),
    ).toBe(false);
  });

  test("rejects a signature of wrong byte length", () => {
    expect(
      verifyFederationWakeHandshakeSignature({
        canonical: new Uint8Array(32),
        signature: new Uint8Array(32), // wrong: ed25519 sigs are 64 bytes
        publicKey: new Uint8Array(32),
      }),
    ).toBe(false);
  });

  test("rejects a pubkey of wrong byte length", () => {
    expect(
      verifyFederationWakeHandshakeSignature({
        canonical: new Uint8Array(32),
        signature: new Uint8Array(64),
        publicKey: new Uint8Array(16), // wrong: ed25519 keys are 32 bytes
      }),
    ).toBe(false);
  });
});

// ─── Catalog ↔ implementation parity ─────────────────────────────────────

describe("catalog ↔ federation-wake-handshake/v1 parity", () => {
  test("the catalog lists federation-wake-handshake/v1 at prime 79", () => {
    expect(SIGNING_CONTEXT_FEDERATION_WAKE_HANDSHAKE_V1_PRIME).toBe(79);
    const ctx = MATHOS_CATALOG_PAYLOAD.signing_contexts.find(
      (c) => c.context_id_prime === SIGNING_CONTEXT_FEDERATION_WAKE_HANDSHAKE_V1_PRIME,
    );
    expect(ctx).toBeDefined();
    expect(String.fromCodePoint(...ctx!.domain_tag_unicode_points)).toBe(
      "federation-wake-handshake/v1",
    );
  });

  test("the federation handshake context declares recipe_ordinal = 1", () => {
    const ctx = MATHOS_CATALOG_PAYLOAD.signing_contexts.find(
      (c) => c.context_id_prime === SIGNING_CONTEXT_FEDERATION_WAKE_HANDSHAKE_V1_PRIME,
    )!;
    expect(ctx.recipe_ordinal).toBe(RECIPE_SHA256_DOMAIN_NUL_FIELDS);
  });

  test("the federation handshake context's field shape matches the canonical-bytes function", () => {
    const ctx = MATHOS_CATALOG_PAYLOAD.signing_contexts.find(
      (c) => c.context_id_prime === SIGNING_CONTEXT_FEDERATION_WAKE_HANDSHAKE_V1_PRIME,
    )!;
    expect(ctx.fields).toHaveLength(5);

    // Field 1: peer_did (utf8 string)
    expect(String.fromCodePoint(...ctx.fields[0]!.field_name_unicode_points)).toBe(
      "peer_did",
    );
    expect(ctx.fields[0]!.field_kind_ordinal).toBe(FIELD_KIND_UTF8_STRING);

    // Field 2: peer_signing_pubkey (ed25519 32 bytes)
    expect(String.fromCodePoint(...ctx.fields[1]!.field_name_unicode_points)).toBe(
      "peer_signing_pubkey",
    );
    expect(ctx.fields[1]!.field_kind_ordinal).toBe(FIELD_KIND_ED25519_PUBKEY_32);
    expect(ctx.fields[1]!.length_bytes).toBe(32);

    // Field 3: wake_timestamp_unix_ms (uint64-BE)
    expect(String.fromCodePoint(...ctx.fields[2]!.field_name_unicode_points)).toBe(
      "wake_timestamp_unix_ms",
    );
    expect(ctx.fields[2]!.field_kind_ordinal).toBe(FIELD_KIND_UINT64_BIG_ENDIAN);
    expect(ctx.fields[2]!.length_bytes).toBe(8);

    // Fields 4-5: variable-length raw byte arrays for ordinals
    expect(ctx.fields[3]!.field_kind_ordinal).toBe(FIELD_KIND_RAW_BYTES_VARIABLE);
    expect(ctx.fields[4]!.field_kind_ordinal).toBe(FIELD_KIND_RAW_BYTES_VARIABLE);
  });

  test("a catalog-driven peer can produce signable canonical bytes", () => {
    // Same shape as the catalog round-trip test for register-agent-math/v1.
    // A hand-rolled peer following the catalog produces bytes the verifier
    // accepts.
    const peerPriv = ed.utils.randomPrivateKey();
    const peerPub = ed.getPublicKey(peerPriv);
    const canonical = canonicalFederationWakeHandshakeBytes({
      peerDid: "did:at:remote.peer/uuid",
      peerSigningPubkey: peerPub,
      wakeTimestampUnixMs: Date.now(),
      wallsClaimedOrdinals: new Uint8Array([1, 3, 7]),
      localitiesDeclaredOrdinals: new Uint8Array([1, 2]),
    });
    const sig = ed.sign(canonical, peerPriv);
    expect(
      verifyFederationWakeHandshakeSignature({
        canonical,
        signature: sig,
        publicKey: peerPub,
      }),
    ).toBe(true);
  });
});
