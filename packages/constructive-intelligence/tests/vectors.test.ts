import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { domainSeparatedId } from "../src/canonical.js";
import { createReceiptEnvelope, validateReceiptBody } from "../src/contracts.js";
import type { EvidencePin } from "../src/types.js";

interface VectorFile {
  pin_vectors: Array<{
    domain: string;
    core: Omit<EvidencePin, "pin_id">;
    expected_id: string;
  }>;
  receipt_vectors: Array<{
    domain: string;
    body: unknown;
    expected_id: string;
  }>;
}

test("published pin and receipt vectors are stable", () => {
  const vectors = JSON.parse(readFileSync(
    join(import.meta.dir, "../vectors/constructive-evidence-v1.json"),
    "utf8",
  )) as VectorFile;
  const pinVector = vectors.pin_vectors[0];
  const receiptVector = vectors.receipt_vectors[0];
  if (!pinVector || !receiptVector) throw new Error("vectors are missing");
  expect(domainSeparatedId(pinVector.domain, pinVector.core)).toBe(pinVector.expected_id);
  const pin = { pin_id: pinVector.expected_id, ...pinVector.core } as EvidencePin;
  const body = validateReceiptBody(receiptVector.body, pin);
  expect(domainSeparatedId(receiptVector.domain, body)).toBe(receiptVector.expected_id);
  expect(createReceiptEnvelope(body).evidence_id).toBe(receiptVector.expected_id);
});

test("schema is closed and describes all integration-boundary fields", () => {
  const schema = JSON.parse(readFileSync(
    join(import.meta.dir, "../schema/constructive-evidence-receipt-v1.schema.json"),
    "utf8",
  )) as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };
  expect(schema.additionalProperties).toBe(false);
  expect(Object.keys(schema.properties).sort()).toEqual([...schema.required].sort());
  for (const field of [
    "artifact_digest",
    "canonical_subject_roots",
    "conflict_disclosures",
    "deliverable_key",
    "evidence_level_and_scope",
    "method_or_adapter_digest",
    "source_system",
    "source_record_or_event_id",
    "source_revision",
    "supersedes",
  ]) {
    expect(schema.required).toContain(field);
  }
});
