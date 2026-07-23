import { describe, expect, test } from "bun:test";
import { x25519 } from "@noble/curves/ed25519.js";
import * as ed25519 from "@noble/ed25519";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import vectors from "../../../docs/specs/adds-0.1-vectors.json";
import {
  InvalidCidError,
  IntegrityError,
  InvalidInputError,
  AgentData,
  MAX_CANONICAL_DEPTH,
  MAX_CANONICAL_NODES,
  MemoryBlockStore,
  assertCidMatches,
  canonicalJson,
  canonicalJsonBytes,
  cidForBytes,
  digestFromCid,
  identityFromPrivateKeys,
  parseCanonicalJson,
  validateGrant,
  validateManifest,
  verifyGrantSignature,
  type SignedGrant,
  type SignedManifest,
  type UnsignedGrant,
  type UnsignedManifest,
} from "../src/index.js";
import {
  blockAad,
  decryptBlock,
  encryptBlock,
  signGrant,
  signManifest,
  strictEd25519Verify,
  unwrapObjectKeyUnsafe,
  x25519KeyId,
} from "../src/crypto.js";
import { assertDirectIssuer, assertGrantTime } from "../src/validation.js";
import { base64UrlEncode, concatBytes } from "../src/bytes.js";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesFromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

describe("ADDS shared vectors and strict canonical profile", () => {
  test("JCS working-draft vectors are byte-pinned", () => {
    for (const vector of vectors.jcs_vectors) {
      expect(canonicalJson(vector.value), vector.name).toBe(vector.canonical_json);
      expect(hex(sha256(canonicalJsonBytes(vector.value))), vector.name).toBe(vector.canonical_sha256_hex);
    }
    for (const vector of vectors.canonical_vectors) {
      expect(canonicalJson(vector.unsigned_object), vector.name).toBe(vector.canonical_json);
      expect(hex(sha256(canonicalJsonBytes(vector.unsigned_object))), vector.name).toBe(vector.canonical_sha256_hex);
      const signingInput = new Uint8Array([
        ...new TextEncoder().encode(`${vector.signing_domain}:`),
        ...canonicalJsonBytes(vector.unsigned_object),
      ]);
      expect(hex(sha256(signingInput)), vector.name).toBe(vector.signing_input_sha256_hex);
    }
  });

  test("CIDv1 raw sha2-256 vector is exact", () => {
    const vector = vectors.cid_vectors[0]!;
    const bytes = bytesFromHex(vector.input_hex);
    expect(hex(sha256(bytes))).toBe(vector.sha256_hex);
    expect(cidForBytes(bytes)).toBe(vector.cid);
    expect(digestFromCid(vector.cid)).toEqual(sha256(bytes));
    expect(cidForBytes(new Uint8Array(0))).toBe(
      "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
    );
  });

  test("noncanonical JSON and unsafe programmatic values are rejected", () => {
    expect(() => canonicalJson(-0)).toThrow(InvalidInputError);
    expect(() => canonicalJson(9_007_199_254_740_992)).toThrow(InvalidInputError);
    expect(() => canonicalJson(String.fromCharCode(0xd800))).toThrow(InvalidInputError);
    expect(() => canonicalJson([undefined])).toThrow(InvalidInputError);
    const sparse = new Array(1);
    expect(() => canonicalJson(sparse)).toThrow(InvalidInputError);
    const symbolObject = { a: 1 } as Record<PropertyKey, unknown>;
    symbolObject[Symbol("hidden")] = true;
    expect(() => canonicalJson(symbolObject)).toThrow(InvalidInputError);
    expect(() => parseCanonicalJson(new TextEncoder().encode('{"a":1,"a":2}'))).toThrow(InvalidInputError);
    expect(() => parseCanonicalJson(new TextEncoder().encode('{"a": 1}'))).toThrow(InvalidInputError);
    expect(() => parseCanonicalJson(new TextEncoder().encode('{"a":1.0}'))).toThrow(InvalidInputError);
  });

  test("canonical nesting and value ceilings are exact", () => {
    let atLimit: unknown = null;
    for (let depth = 0; depth < MAX_CANONICAL_DEPTH; depth += 1) atLimit = [atLimit];
    expect(() => canonicalJson(atLimit)).not.toThrow();
    expect(() => canonicalJson([atLimit])).toThrow(InvalidInputError);

    expect(() => canonicalJson(new Array(MAX_CANONICAL_NODES - 1).fill(null))).not.toThrow();
    expect(() => canonicalJson(new Array(MAX_CANONICAL_NODES).fill(null))).toThrow(InvalidInputError);
  });

  test("CID aliases, oversized inputs, and noncanonical encodings are rejected before decode", () => {
    const cid = cidForBytes(new Uint8Array([1]));
    expect(() => digestFromCid(cid.toUpperCase())).toThrow(InvalidCidError);
    expect(() => digestFromCid(`${cid}a`)).toThrow(InvalidCidError);
    expect(() => digestFromCid(`b${"a".repeat(1_000_000)}`)).toThrow(InvalidCidError);
  });

  test("pinned Manifest signature and final CID match the implementation", () => {
    const vector = vectors.signature_vectors[0]!;
    const unsigned = vector.unsigned_object as unknown as UnsignedManifest;
    const identity = identityFromPrivateKeys(
      unsigned.publisher.id,
      bytesFromHex(vector.ed25519_private_key_hex),
      new Uint8Array(32).fill(0x42),
    );
    const signed = signManifest(unsigned, identity);
    const signingInput = concatBytes(
      new TextEncoder().encode(`${vector.signing_domain}:`),
      canonicalJsonBytes(unsigned),
    );

    expect(canonicalJson(unsigned)).toBe(vector.canonical_json);
    expect(hex(signingInput)).toBe(vector.signing_input_hex);
    expect(hex(sha256(signingInput))).toBe(vector.signing_input_sha256_hex);
    expect(signed).toEqual(vector.signed_object);
    expect(hex(canonicalJsonBytes(signed))).toBe(vector.signed_jcs_hex);
    expect(cidForBytes(canonicalJsonBytes(signed))).toBe(vector.signed_object_cid);
    expect(validateManifest(signed)).toEqual(signed);
  });

  test("pinned AES-GCM Blocks match AAD, frames, CIDs, and plaintext", async () => {
    const vector = vectors.block_encryption_vectors[0]!;
    const key = bytesFromHex(vector.dek_hex);
    const binding = vector.manifest_binding;
    for (const chunk of vector.chunks) {
      const aad = blockAad({
        objectId: binding.object_id,
        keyId: binding.key_id,
        aadContext: binding.aad_context,
        index: chunk.index,
        plaintextSize: chunk.plaintext_size,
        blockCount: binding.block_count,
        totalPlaintextSize: binding.total_plaintext_size,
        chunkSize: binding.chunk_size,
      });
      const plaintext = bytesFromHex(chunk.plaintext_hex);
      const nonce = bytesFromHex(chunk.nonce_hex);
      const encrypted = await encryptBlock(plaintext, key, aad, nonce);
      const frame = concatBytes(encrypted.nonce, encrypted.ciphertext);

      expect(hex(aad), `AAD chunk ${chunk.index}`).toBe(chunk.block_aad_hex);
      expect(hex(sha256(aad)), `AAD digest chunk ${chunk.index}`).toBe(chunk.block_aad_sha256_hex);
      expect(hex(encrypted.ciphertext), `ciphertext+tag chunk ${chunk.index}`).toBe(chunk.ciphertext_and_tag_hex);
      expect(hex(frame), `frame chunk ${chunk.index}`).toBe(chunk.block_frame_hex);
      expect(cidForBytes(frame), `CID chunk ${chunk.index}`).toBe(chunk.block_cid);
      expect(await decryptBlock(encrypted.ciphertext, nonce, key, aad)).toEqual(plaintext);
    }
  });

  test("pinned X25519/HKDF wrap, Grant signature, and recipient unwrap match", async () => {
    const vector = vectors.grant_wrap_vectors[0]!;
    const audiencePrivateKey = bytesFromHex(vector.audience_x25519_private_key_hex);
    const audiencePublicKey = bytesFromHex(vector.audience_x25519_public_key_hex);
    const ephemeralPrivateKey = bytesFromHex(vector.ephemeral_x25519_private_key_hex);
    const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, audiencePublicKey);
    const wrapContext = bytesFromHex(vector.wrap_context_hex);
    const kek = hkdf(
      sha256,
      sharedSecret,
      sha256(wrapContext),
      new TextEncoder().encode(vector.hkdf.info_utf8),
      vector.hkdf.length,
    );
    const grant = vector.signed_grant as unknown as SignedGrant;

    expect(hex(x25519.getPublicKey(audiencePrivateKey))).toBe(vector.audience_x25519_public_key_hex);
    expect(hex(x25519.getPublicKey(ephemeralPrivateKey))).toBe(vector.ephemeral_x25519_public_key_hex);
    expect(hex(sharedSecret)).toBe(vector.x25519_shared_secret_hex);
    expect(x25519KeyId(audiencePublicKey)).toBe(vector.audience_x25519_key_id);
    expect(canonicalJson(vector.wrap_header)).toBe(vector.wrap_header_canonical_json);
    expect(hex(kek)).toBe(vector.hkdf.kek_hex);
    expect(validateGrant(grant)).toEqual(grant);
    expect(verifyGrantSignature(grant)).toBe(true);
    expect(hex(canonicalJsonBytes(grant))).toBe(vector.signed_grant_jcs_hex);
    expect(cidForBytes(canonicalJsonBytes(grant))).toBe(vector.signed_grant_cid);
    expect(hex(await unwrapObjectKeyUnsafe(grant, grant.audience, audiencePrivateKey))).toBe(
      vector.recipient_unwrap_expected_dek_hex,
    );
    assertDirectIssuer(vectors.signature_vectors[0]!.signed_object as unknown as SignedManifest, grant);
  });

  test("pinned tamper matrix fails at the intended cryptographic or policy boundary", async () => {
    const expectedNames = [
      "cid_byte_flip",
      "block_nonce_flip",
      "block_reorder",
      "manifest_size_change",
      "grant_audience_change",
      "recipient_regrant_omits_parent",
      "grant_expiry_boundary",
      "principal_signature_key_mismatch",
      "ed25519_zip215_non_rfc8032_encoding",
      "ed25519_small_order_r",
      "ed25519_mixed_order_r",
      "x25519_all_zero_shared_secret",
    ];
    expect(vectors.tamper_vectors.map((vector) => vector.name).sort()).toEqual(expectedNames.sort());
    const byName = (name: string): any => {
      const vector = vectors.tamper_vectors.find((candidate) => candidate.name === name);
      if (vector === undefined) throw new Error(`Missing tamper vector ${name}`);
      return vector;
    };
    const honestManifest = vectors.signature_vectors[0]!.signed_object as unknown as SignedManifest;
    const honestGrant = vectors.grant_wrap_vectors[0]!.signed_grant as unknown as SignedGrant;

    const cidFlip = byName("cid_byte_flip");
    const mutatedFrame = bytesFromHex(cidFlip.mutation.mutated_block_frame_hex);
    expect(cidForBytes(mutatedFrame)).toBe(cidFlip.mutated_bytes_cid);
    expect(() => assertCidMatches(cidFlip.original_cid, mutatedFrame)).toThrow(IntegrityError);

    const nonceFlip = byName("block_nonce_flip");
    const nonceManifest = nonceFlip.mutation.resigned_object as SignedManifest;
    expect(validateManifest(nonceManifest)).toEqual(nonceManifest);
    const nonceStore = new MemoryBlockStore();
    for (const chunk of vectors.block_encryption_vectors[0]!.chunks) {
      await nonceStore.put(chunk.block_cid, bytesFromHex(chunk.block_frame_hex));
    }
    const nonceManifestBytes = canonicalJsonBytes(nonceManifest);
    const nonceManifestCid = cidForBytes(nonceManifestBytes);
    expect(nonceManifestCid).toBe(nonceFlip.mutation.resigned_object_cid);
    await nonceStore.put(nonceManifestCid, nonceManifestBytes);
    await expect(new AgentData({ store: nonceStore }).verify(nonceManifestCid)).rejects.toBeInstanceOf(IntegrityError);

    for (const name of ["block_reorder", "manifest_size_change"]) {
      const mutation = byName(name).mutation;
      expect(cidForBytes(bytesFromHex(mutation.resigned_jcs_hex))).toBe(mutation.resigned_object_cid);
      expect(() => validateManifest(mutation.resigned_object)).toThrow(IntegrityError);
    }

    const audienceChange = structuredClone(honestGrant) as unknown as Record<string, unknown>;
    audienceChange.audience = byName("grant_audience_change").mutation.to;
    expect(() => validateGrant(audienceChange)).toThrow(IntegrityError);

    const regrant = byName("recipient_regrant_omits_parent").construction;
    const validUnauthorizedRoot = validateGrant(regrant.signed_object);
    expect(cidForBytes(bytesFromHex(regrant.signed_jcs_hex))).toBe(regrant.signed_object_cid);
    expect(() => assertDirectIssuer(honestManifest, validUnauthorizedRoot)).toThrow(IntegrityError);

    const expiry = byName("grant_expiry_boundary");
    for (const boundary of expiry.authorization_cases) {
      if (boundary.expect_authorized) {
        expect(() => assertGrantTime(honestGrant, boundary.now)).not.toThrow();
      } else {
        expect(() => assertGrantTime(honestGrant, boundary.now)).toThrow();
      }
    }

    const keyMismatch = structuredClone(honestManifest) as unknown as {
      signature: { public_key: string };
    };
    keyMismatch.signature.public_key = byName("principal_signature_key_mismatch").mutation.to;
    expect(() => validateManifest(keyMismatch)).toThrow(IntegrityError);

    for (const name of [
      "ed25519_zip215_non_rfc8032_encoding",
      "ed25519_small_order_r",
      "ed25519_mixed_order_r",
    ]) {
      const vector = byName(name);
      const message = vector.message_utf8 === undefined
        ? bytesFromHex(vectors.signature_vectors[0]!.signing_input_hex)
        : new TextEncoder().encode(vector.message_utf8);
      const signature = bytesFromHex(vector.signature_hex);
      const publicKey = bytesFromHex(vector.public_key_hex);
      expect(ed25519.verify(signature, message, publicKey, { zip215: true }), name).toBe(true);
      expect(strictEd25519Verify(signature, message, publicKey), name).toBe(false);
    }

    const lowOrder = byName("x25519_all_zero_shared_secret");
    const { signature: _signature, ...unsignedGrant } = honestGrant;
    const lowOrderUnsigned = structuredClone(unsignedGrant) as UnsignedGrant;
    lowOrderUnsigned.key_wrap.ephemeral_public_key = base64UrlEncode(
      bytesFromHex(lowOrder.low_order_ephemeral_public_key_hex),
    );
    const signingIdentity = identityFromPrivateKeys(
      honestGrant.issuer.id,
      bytesFromHex(vectors.signature_vectors[0]!.ed25519_private_key_hex),
      new Uint8Array(32).fill(0x42),
    );
    const lowOrderGrant = signGrant(lowOrderUnsigned, signingIdentity);
    validateGrant(lowOrderGrant);
    await expect(unwrapObjectKeyUnsafe(
      lowOrderGrant,
      honestGrant.audience,
      bytesFromHex(lowOrder.recipient_x25519_private_key_hex),
    )).rejects.toThrow();
  });
});
