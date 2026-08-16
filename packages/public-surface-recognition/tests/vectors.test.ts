import * as ed25519 from "@noble/ed25519";
import {
  canonicalJson,
  canonicalRecordSha256,
  encodeCanonicalRecord,
  publicSurfaceBindingDocumentSha256,
  signingBytes,
  verifyPublicSurfaceBinding,
} from "@agenttool/public-surface-binding";
import { describe, expect, test } from "bun:test";

import {
  PACKAGE_VERSION,
  SIGNING_DOMAINS,
  publicSurfaceAdoptionDigest,
  publicSurfaceAdoptionDocumentSha256,
  publicSurfaceAdoptionId,
  publicSurfaceWithdrawalDigest,
  publicSurfaceWithdrawalId,
  sealPublicSurfaceAdoption,
  sealPublicSurfaceWithdrawal,
  verifyPublicSurfaceAdoption,
  verifyPublicSurfaceAdoptionForBinding,
  verifyPublicSurfaceWithdrawal,
  verifyPublicSurfaceWithdrawalForAdoption,
} from "../src/index.js";
import {
  ROOT_SIGNER,
  VECTORS,
  hex,
  hexBytes,
  withNobleSha512,
  type RecordDetails,
} from "./fixtures.js";

function expectDetails<T>(details: RecordDetails<T>): void {
  expect(canonicalJson(details.record)).toBe(details.canonical_json);
  expect(hex(encodeCanonicalRecord(details.record))).toBe(details.canonical_utf8_hex);
  expect(canonicalRecordSha256(details.record)).toBe(details.canonical_sha256);
}

describe("deterministic cross-runtime vectors", () => {
  test("pins the deterministic root, exact signing bytes, digests, signatures, and IDs", () => {
    expect(VECTORS.format).toBe("agenttool.public-surface-recognition-vectors/0.1");
    expect(VECTORS.package_version).toBe(PACKAGE_VERSION);
    expect(VECTORS.warning).toContain("TEST ONLY");

    const privateSeed = hexBytes(VECTORS.deterministic_root.private_seed_hex);
    const publicKey = withNobleSha512(() => ed25519.getPublicKey(privateSeed));
    expect(Buffer.from(publicKey).toString("base64")).toBe(
      VECTORS.deterministic_root.public_key_base64,
    );

    expect(VECTORS.adoption.signature_domain).toBe(SIGNING_DOMAINS.adoption);
    expect(VECTORS.adoption.id_domain).toBe(SIGNING_DOMAINS.adoption_id);
    expect(canonicalJson(VECTORS.adoption.core)).toBe(VECTORS.adoption.core_canonical_json);
    expect(hex(signingBytes(SIGNING_DOMAINS.adoption, VECTORS.adoption.core))).toBe(
      VECTORS.adoption.signing_bytes_hex,
    );
    expect(hex(publicSurfaceAdoptionDigest(VECTORS.adoption.core))).toBe(
      VECTORS.adoption.signing_digest_hex,
    );
    const adoptionSignature = withNobleSha512(() => ed25519.sign(
      publicSurfaceAdoptionDigest(VECTORS.adoption.core),
      privateSeed,
    ));
    expect(Buffer.from(adoptionSignature).toString("base64")).toBe(
      VECTORS.adoption.signature_base64,
    );
    expect(publicSurfaceAdoptionId(
      VECTORS.adoption.core,
      VECTORS.adoption.record.signature,
    )).toBe(VECTORS.adoption.adoption_id);

    expect(VECTORS.withdrawal.signature_domain).toBe(SIGNING_DOMAINS.withdrawal);
    expect(VECTORS.withdrawal.id_domain).toBe(SIGNING_DOMAINS.withdrawal_id);
    expect(canonicalJson(VECTORS.withdrawal.core)).toBe(VECTORS.withdrawal.core_canonical_json);
    expect(hex(signingBytes(SIGNING_DOMAINS.withdrawal, VECTORS.withdrawal.core))).toBe(
      VECTORS.withdrawal.signing_bytes_hex,
    );
    expect(hex(publicSurfaceWithdrawalDigest(VECTORS.withdrawal.core))).toBe(
      VECTORS.withdrawal.signing_digest_hex,
    );
    const withdrawalSignature = withNobleSha512(() => ed25519.sign(
      publicSurfaceWithdrawalDigest(VECTORS.withdrawal.core),
      privateSeed,
    ));
    expect(Buffer.from(withdrawalSignature).toString("base64")).toBe(
      VECTORS.withdrawal.signature_base64,
    );
    expect(publicSurfaceWithdrawalId(
      VECTORS.withdrawal.core,
      VECTORS.withdrawal.record.signature,
    )).toBe(VECTORS.withdrawal.withdrawal_id);
  });

  test("pins the exact source binding, adoption document, and withdrawal linkage", () => {
    const binding = verifyPublicSurfaceBinding(VECTORS.source_binding.record);
    expect(binding.binding_id).toBe(VECTORS.source_binding.binding_id);
    expect(publicSurfaceBindingDocumentSha256(binding)).toBe(
      VECTORS.source_binding.document_sha256,
    );

    const adoption = verifyPublicSurfaceAdoption(VECTORS.adoption.record);
    expect(verifyPublicSurfaceAdoptionForBinding(adoption, binding)).toEqual(adoption);
    expect(publicSurfaceAdoptionDocumentSha256(adoption)).toBe(
      VECTORS.withdrawal.record.adoption_document_sha256,
    );

    const withdrawal = verifyPublicSurfaceWithdrawal(VECTORS.withdrawal.record);
    expect(verifyPublicSurfaceWithdrawalForAdoption(withdrawal, adoption)).toEqual(withdrawal);
    expect(Object.isFrozen(adoption)).toBe(true);
    expect(Object.isFrozen(adoption.binding.document)).toBe(true);
    expect(Object.isFrozen(withdrawal)).toBe(true);
  });

  test("sealing is deterministic, idempotent, and does not mutate caller inputs", async () => {
    const adoptionInput = structuredClone(VECTORS.adoption.core);
    const adoptionBefore = structuredClone(adoptionInput);
    const firstAdoption = await sealPublicSurfaceAdoption(adoptionInput, ROOT_SIGNER);
    const secondAdoption = await sealPublicSurfaceAdoption(adoptionInput, ROOT_SIGNER);
    expect(firstAdoption).toEqual(VECTORS.adoption.record);
    expect(secondAdoption).toEqual(firstAdoption);
    expect(adoptionInput).toEqual(adoptionBefore);
    expect(Object.isFrozen(adoptionInput)).toBe(false);

    const withdrawalInput = structuredClone(VECTORS.withdrawal.core);
    const withdrawalBefore = structuredClone(withdrawalInput);
    const firstWithdrawal = await sealPublicSurfaceWithdrawal(withdrawalInput, ROOT_SIGNER);
    const secondWithdrawal = await sealPublicSurfaceWithdrawal(withdrawalInput, ROOT_SIGNER);
    expect(firstWithdrawal).toEqual(VECTORS.withdrawal.record);
    expect(secondWithdrawal).toEqual(firstWithdrawal);
    expect(withdrawalInput).toEqual(withdrawalBefore);
    expect(Object.isFrozen(withdrawalInput)).toBe(false);
  });

  test("pins the full canonical recognition documents", () => {
    expectDetails(VECTORS.adoption);
    expectDetails(VECTORS.withdrawal);
  });
});
