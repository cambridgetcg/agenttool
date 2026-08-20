import { describe, expect, test } from "bun:test";

import {
  ACTIVATION_READINESS,
  ACTIVATION_STATUS,
  EXPECTED_SCHEMA_HASHES,
  SETTLEMENT_BATCH_SIDECAR_SCHEMA,
  WITNESS_RECORD_SCHEMA,
  auditWitnessActivation,
  bytesToHex,
  capabilityConsumeNullifier,
  decodeWitnessCanonicalJson,
  encodeWitnessCanonicalJson,
  scopedHash,
  verifySettlementBatchSidecarBytes,
  verifyWitnessRecordBytes,
} from "../src/index.js";

interface CoreVector {
  path: string;
  operation: string;
  expected: string;
  kind?: keyof typeof EXPECTED_SCHEMA_HASHES;
  action?: string;
  commitment?: string;
  payload_root?: string;
  merkle_root?: string;
  canonical_hex?: string;
}

interface CoreManifest {
  freeze_state: string;
  schema_set_digest: string;
  corpus_digest: string;
  record_schema_hash: string;
  settlement_batch_schema_hash: string;
  payload_schemas: Array<{ kind: keyof typeof EXPECTED_SCHEMA_HASHES; schema_hash: string }>;
  vectors: CoreVector[];
}

const root = new URL("../vectors/core-v0.1/", import.meta.url);
const file = (path: string) => Bun.file(new URL(path, root));
const raw = async (path: string) => new Uint8Array(await file(path).arrayBuffer());

describe("self-contained frozen Core corpus", () => {
  test("pins aggregate schema and corpus identities without a sibling worktree", async () => {
    const manifest = await file("known-answer.json").json() as CoreManifest;
    expect(manifest).toMatchObject({
      freeze_state: "FROZEN",
      schema_set_digest: "sha256:d62e44643c8e1986336416237df26b76663728403d417a5ee9e83b6aa5baaaa5",
      corpus_digest: "sha256:b26b5cce4899aa62d6dee03e25471e2c80810008fbd07c2c3ac9170164e5352a",
      record_schema_hash: "sha256:71401ebb962d8909206b77acb6a07616727bd17663f5028e5d2745d911199005",
      settlement_batch_schema_hash: "sha256:4dfb561b0d395d556d5549e45301bb07b79beb089c3fd73e7fc643edcc7f02ec",
    });
    expect(scopedHash("schema", WITNESS_RECORD_SCHEMA)).toBe(manifest.record_schema_hash);
    expect(scopedHash("schema", SETTLEMENT_BATCH_SIDECAR_SCHEMA))
      .toBe(manifest.settlement_batch_schema_hash);
    for (const entry of manifest.payload_schemas) {
      expect(EXPECTED_SCHEMA_HASHES[entry.kind]).toBe(entry.schema_hash);
    }
  });

  test("accepts all 20 exact signed records and blocks every kind from activation", async () => {
    const manifest = await file("known-answer.json").json() as CoreManifest;
    const vectors = manifest.vectors.filter((vector) =>
      vector.operation === "VERIFY_RECORD_AND_ACTIVATION_AUDIT");
    expect(vectors).toHaveLength(20);
    const seenKinds = new Set<string>();
    for (const vector of vectors) {
      const record = verifyWitnessRecordBytes(await raw(vector.path));
      expect(record.commitment).toBe(vector.commitment!);
      expect(record.envelope.payload_root).toBe(vector.payload_root!);
      expect(record.envelope.kind).toBe(vector.kind!);
      expect(record.envelope.action).toBe(vector.action!);
      const audit = auditWitnessActivation(record);
      expect(audit.status).toBe(ACTIVATION_STATUS);
      expect(audit.blockers.length).toBeGreaterThan(0);
      seenKinds.add(record.envelope.kind);
    }
    expect(seenKinds.size).toBe(10);
    expect(ACTIVATION_READINESS).toHaveLength(10);
    expect(ACTIVATION_READINESS.every((entry) =>
      entry.status === "NOT_CONSENSUS_ADMISSIBLE" && entry.blockers.length > 0)).toBe(true);
  });

  test("rejects the complete Core record mutation and hostile Ed25519 corpus", async () => {
    const manifest = await file("known-answer.json").json() as CoreManifest;
    const vectors = manifest.vectors.filter((vector) =>
      vector.operation === "VERIFY_RECORD" && vector.expected === "REJECT");
    expect(vectors.length).toBeGreaterThanOrEqual(20);
    for (const vector of vectors) {
      const bytes = await raw(vector.path);
      expect(() => verifyWitnessRecordBytes(bytes)).toThrow();
    }
  });

  test("matches canonical wire, nullifier and RFC6962 batch known answers", async () => {
    const manifest = await file("known-answer.json").json() as CoreManifest;
    for (const vector of manifest.vectors) {
      if (vector.operation === "CANONICAL_WIRE" && vector.expected === "ACCEPT") {
        const bytes = await raw(vector.path);
        expect(bytesToHex(encodeWitnessCanonicalJson(decodeWitnessCanonicalJson(bytes))))
          .toBe(vector.canonical_hex!);
      } else if (vector.operation === "CANONICALIZE" && vector.expected === "ACCEPT") {
        const parsed = JSON.parse(new TextDecoder().decode(await raw(vector.path))) as unknown;
        expect(bytesToHex(encodeWitnessCanonicalJson(parsed))).toBe(vector.canonical_hex!);
      } else if (vector.operation === "CANONICALIZE" && vector.expected === "REJECT") {
        const bytes = await raw(vector.path);
        expect(() => decodeWitnessCanonicalJson(bytes)).toThrow();
      } else if (vector.operation === "VERIFY_BATCH") {
        const bytes = await raw(vector.path);
        if (vector.expected === "ACCEPT") {
          expect(verifySettlementBatchSidecarBytes(bytes).merkle_root).toBe(vector.merkle_root!);
        } else {
          expect(() => verifySettlementBatchSidecarBytes(bytes)).toThrow();
        }
      }
    }

    const derivation = await file("derivations/capability-nullifier.json").json() as Record<string, string>;
    const derived = capabilityConsumeNullifier({
      audience: derivation.audience!,
      subject_ref: derivation.subject_ref!,
      capability_ref: derivation.capability_ref!,
      grant_commitment: derivation.grant_commitment! as `sha256:${string}`,
      asset_ref: derivation.asset_ref! as `sha256:${string}`,
      source_event_digest: derivation.source_event_digest! as `sha256:${string}`,
    });
    expect(derived).toBe(derivation.nullifier_a!);
    expect(derivation.nullifier_a).toBe(derivation.nullifier_b);
    expect(capabilityConsumeNullifier({
      audience: derivation.audience!,
      subject_ref: derivation.subject_ref!,
      capability_ref: derivation.capability_ref!,
      grant_commitment: derivation.grant_commitment! as `sha256:${string}`,
      asset_ref: derivation.alternative_asset_ref! as `sha256:${string}`,
      source_event_digest: derivation.source_event_digest! as `sha256:${string}`,
    })).toBe(derivation.alternative_asset_nullifier!);
  });
});
