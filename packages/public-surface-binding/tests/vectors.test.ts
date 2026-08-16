import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, test } from "bun:test";

import {
  SIGNING_DOMAINS,
  assessPublicSurfaceBinding,
  canonicalJson,
  canonicalRecordSha256,
  createPublicSurfaceObservation,
  encodeCanonicalRecord,
  signingBytes,
  surfaceBindingDigest,
  surfaceBindingId,
  surfaceObservationId,
  surfaceRevocationDigest,
  surfaceRevocationId,
  validatePublicSurfaceAssessment,
  validatePublicSurfaceBinding,
  validatePublicSurfaceObservation,
  validatePublicSurfaceRevocation,
  verifyPublicSurfaceBinding,
  verifyPublicSurfaceRevocation,
} from "../src/index.js";
import type {
  IdentityKeyEvidence,
  PublicSurfaceAssessment,
  PublicSurfaceBinding,
  PublicSurfaceBindingCore,
  PublicSurfaceObservation,
  PublicSurfaceObservationCore,
  PublicSurfaceRevocation,
  PublicSurfaceRevocationCore,
} from "../src/types.js";

interface RecordDetails<T> {
  canonical_json: string;
  canonical_utf8_hex: string;
  canonical_sha256: string;
  record: T;
}

interface VectorBundle {
  format: string;
  warning: string;
  deterministic_key: {
    private_seed_hex: string;
    public_key_base64: string;
  };
  canonical_utf16_ordering: {
    input: unknown;
    canonical_json: string;
    canonical_utf8_hex: string;
  };
  canonical_string_profile: {
    input: {
      quote: string;
      backslash: string;
      controls: string;
      slash: string;
      line_separator: string;
      composed: string;
      decomposed: string;
    };
    canonical_json: string;
    canonical_utf8_hex: string;
  };
  observation: RecordDetails<PublicSurfaceObservation> & {
    core: PublicSurfaceObservationCore;
    evidence_id: string;
  };
  binding: RecordDetails<PublicSurfaceBinding> & {
    core: PublicSurfaceBindingCore;
    core_canonical_json: string;
    signing_bytes_hex: string;
    signing_digest_hex: string;
    signature_base64: string;
    binding_id: string;
  };
  origin_observation: RecordDetails<PublicSurfaceObservation> & {
    core: PublicSurfaceObservationCore;
    evidence_id: string;
    expected_binding_body_sha256: string;
    expected_binding_bytes: number;
  };
  key_evidence: IdentityKeyEvidence;
  revocation: RecordDetails<PublicSurfaceRevocation> & {
    core: PublicSurfaceRevocationCore;
    core_canonical_json: string;
    signing_bytes_hex: string;
    signing_digest_hex: string;
    signature_base64: string;
    revocation_id: string;
  };
  current_assessment: RecordDetails<PublicSurfaceAssessment>;
  revoked_assessment: RecordDetails<PublicSurfaceAssessment>;
}

const vectorPath = join(import.meta.dir, "../vectors/agenttool-public-surface-binding-v0.1-vectors.json");
const vectors = JSON.parse(readFileSync(vectorPath, "utf8")) as VectorBundle;

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function withNobleSha512<T>(operation: () => T): T {
  const previous = ed25519.etc.sha512Sync;
  ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
    const hash = sha512.create();
    for (const message of messages) hash.update(message);
    return hash.digest();
  };
  try {
    return operation();
  } finally {
    ed25519.etc.sha512Sync = previous;
  }
}

function expectDetails<T>(details: RecordDetails<T>): void {
  expect(canonicalJson(details.record)).toBe(details.canonical_json);
  expect(hex(encodeCanonicalRecord(details.record))).toBe(details.canonical_utf8_hex);
  expect(canonicalRecordSha256(details.record)).toBe(details.canonical_sha256);
}

describe("deterministic cross-runtime vectors", () => {
  test("pins recursive UTF-16 ordering and exact UTF-8 bytes", () => {
    expect(vectors.format).toBe("agenttool.public-surface-binding-vectors/0.1");
    expect(vectors.warning).toContain("TEST ONLY");
    expect(vectors.canonical_utf16_ordering.canonical_json).toBe(
      "{\"nested\":{\"𐀀\":1,\"�\":2},\"𐀀\":\"supplementary-plane-character\",\"�\":\"bmp-replacement-character\"}",
    );
    expect(canonicalJson(vectors.canonical_utf16_ordering.input)).toBe(
      vectors.canonical_utf16_ordering.canonical_json,
    );
    expect(hex(encodeCanonicalRecord(vectors.canonical_utf16_ordering.input))).toBe(
      vectors.canonical_utf16_ordering.canonical_utf8_hex,
    );
  });

  test("pins the complete canonical string profile without Unicode normalization", () => {
    const profile = vectors.canonical_string_profile;
    expect(profile.canonical_json).toBe(
      "{\"backslash\":\"\\\\\",\"composed\":\"é\",\"controls\":\"\\b\\t\\n\\f\\r\\u0001\\u001f\",\"decomposed\":\"é\",\"line_separator\":\" \",\"quote\":\"\\\"\",\"slash\":\"</script>\"}",
    );
    expect(canonicalJson(profile.input)).toBe(profile.canonical_json);
    expect(hex(encodeCanonicalRecord(profile.input))).toBe(profile.canonical_utf8_hex);
    expect(profile.canonical_json).toContain("</script>");
    expect(profile.canonical_json).not.toContain("<\\/script>");
    expect(profile.input.composed).not.toBe(profile.input.decomposed);
  });

  test("recomputes the deterministic public key, signatures, signing bytes, and flat IDs", () => {
    const privateSeed = bytes(vectors.deterministic_key.private_seed_hex);
    const publicKey = withNobleSha512(() => ed25519.getPublicKey(privateSeed));
    expect(Buffer.from(publicKey).toString("base64")).toBe(vectors.deterministic_key.public_key_base64);

    expect(canonicalJson(vectors.binding.core)).toBe(vectors.binding.core_canonical_json);
    expect(hex(signingBytes(SIGNING_DOMAINS.binding, vectors.binding.core))).toBe(
      vectors.binding.signing_bytes_hex,
    );
    expect(hex(surfaceBindingDigest(vectors.binding.core))).toBe(vectors.binding.signing_digest_hex);
    const bindingSignature = withNobleSha512(() => ed25519.sign(
      surfaceBindingDigest(vectors.binding.core),
      privateSeed,
    ));
    expect(Buffer.from(bindingSignature).toString("base64")).toBe(vectors.binding.signature_base64);
    expect(surfaceBindingId(vectors.binding.core, vectors.binding.record.signature)).toBe(
      vectors.binding.binding_id,
    );
    expect(verifyPublicSurfaceBinding(vectors.binding.record)).toEqual(vectors.binding.record);

    expect(canonicalJson(vectors.revocation.core)).toBe(vectors.revocation.core_canonical_json);
    expect(hex(signingBytes(SIGNING_DOMAINS.revocation, vectors.revocation.core))).toBe(
      vectors.revocation.signing_bytes_hex,
    );
    expect(hex(surfaceRevocationDigest(vectors.revocation.core))).toBe(
      vectors.revocation.signing_digest_hex,
    );
    const revocationSignature = withNobleSha512(() => ed25519.sign(
      surfaceRevocationDigest(vectors.revocation.core),
      privateSeed,
    ));
    expect(Buffer.from(revocationSignature).toString("base64")).toBe(
      vectors.revocation.signature_base64,
    );
    expect(surfaceRevocationId(vectors.revocation.core, vectors.revocation.record.signature)).toBe(
      vectors.revocation.revocation_id,
    );
    expect(verifyPublicSurfaceRevocation(vectors.revocation.record)).toEqual(vectors.revocation.record);
  });

  test("recomputes observations, exact binding readback, and factorized assessments", () => {
    expect(createPublicSurfaceObservation(vectors.observation.core)).toEqual(vectors.observation.record);
    expect(surfaceObservationId(vectors.observation.core)).toBe(vectors.observation.evidence_id);
    expect(createPublicSurfaceObservation(vectors.origin_observation.core)).toEqual(
      vectors.origin_observation.record,
    );
    expect(surfaceObservationId(vectors.origin_observation.core)).toBe(
      vectors.origin_observation.evidence_id,
    );
    expect(canonicalRecordSha256(vectors.binding.record)).toBe(
      vectors.origin_observation.expected_binding_body_sha256,
    );
    expect(encodeCanonicalRecord(vectors.binding.record).byteLength).toBe(
      vectors.origin_observation.expected_binding_bytes,
    );

    const current = assessPublicSurfaceBinding({
      binding: vectors.binding.record,
      evaluated_at: vectors.current_assessment.record.evaluated_at,
      key_evidence: vectors.key_evidence,
      observation: vectors.observation.record,
      origin_observation: vectors.origin_observation.record,
      revocations: [],
      revocation_key_evidence: [],
    });
    expect(current).toEqual(vectors.current_assessment.record);
    expect(current.revocation).toBe("not_observed");
    expect(current.training_effect).toBe(false);
    expect(current.inputs.binding_document_sha256).toBe(
      canonicalRecordSha256(vectors.binding.record),
    );
    expect(current.inputs.key_evidence_sha256).toBe(
      canonicalRecordSha256(vectors.key_evidence),
    );

    const revoked = assessPublicSurfaceBinding({
      binding: vectors.binding.record,
      evaluated_at: vectors.revoked_assessment.record.evaluated_at,
      key_evidence: vectors.key_evidence,
      observation: vectors.observation.record,
      origin_observation: vectors.origin_observation.record,
      revocations: [vectors.revocation.record],
      revocation_key_evidence: [],
    });
    expect(revoked).toEqual(vectors.revoked_assessment.record);
    expect(revoked.revocation).toBe("revoked");
    expect(revoked.inputs.revocation_document_sha256s).toEqual([
      canonicalRecordSha256(vectors.revocation.record),
    ]);

    for (const detail of [
      vectors.observation,
      vectors.binding,
      vectors.origin_observation,
      vectors.revocation,
      vectors.current_assessment,
      vectors.revoked_assessment,
    ]) expectDetails(detail);
  });

  test("keeps every shipped record in schema/runtime parity and rejects widening", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const cases = [
      {
        schema: "agenttool-public-surface-observation-v0.1.schema.json",
        records: [vectors.observation.record, vectors.origin_observation.record],
        runtime: validatePublicSurfaceObservation,
      },
      {
        schema: "agenttool-public-surface-binding-v0.1.schema.json",
        records: [vectors.binding.record],
        runtime: validatePublicSurfaceBinding,
      },
      {
        schema: "agenttool-public-surface-revocation-v0.1.schema.json",
        records: [vectors.revocation.record],
        runtime: validatePublicSurfaceRevocation,
      },
      {
        schema: "agenttool-public-surface-assessment-v0.1.schema.json",
        records: [vectors.current_assessment.record, vectors.revoked_assessment.record],
        runtime: validatePublicSurfaceAssessment,
      },
    ] as const;

    for (const fixtureCase of cases) {
      const schema = JSON.parse(readFileSync(join(import.meta.dir, "../schema", fixtureCase.schema), "utf8"));
      const validateSchema = ajv.compile(schema);
      for (const record of fixtureCase.records) {
        expect(validateSchema(record), JSON.stringify(validateSchema.errors)).toBe(true);
        expect(() => fixtureCase.runtime(record)).not.toThrow();

        const widened = { ...structuredClone(record), reverse_identity_index: true };
        expect(validateSchema(widened)).toBe(false);
        expect(() => fixtureCase.runtime(widened)).toThrow();
      }
    }
  });
});
