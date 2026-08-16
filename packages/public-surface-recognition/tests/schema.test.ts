import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, test } from "bun:test";

import {
  validatePublicSurfaceAdoption,
  validatePublicSurfaceAdoptionCore,
  validatePublicSurfaceWithdrawal,
} from "../src/index.js";
import { VECTORS, clone } from "./fixtures.js";

const schemaDirectory = join(import.meta.dir, "../schema");
const adoptionSchema = JSON.parse(readFileSync(
  join(schemaDirectory, "agenttool-public-surface-adoption-v0.1.schema.json"),
  "utf8",
));
const withdrawalSchema = JSON.parse(readFileSync(
  join(schemaDirectory, "agenttool-public-surface-withdrawal-v0.1.schema.json"),
  "utf8",
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const adoption = ajv.compile(adoptionSchema);
const withdrawal = ajv.compile(withdrawalSchema);

function assertClosedObjects(value: unknown, path = "$schema"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertClosedObjects(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const schema = value as Record<string, unknown>;
  if (schema.type === "object") {
    expect(schema.additionalProperties, `${path} must be closed`).toBe(false);
    const properties = schema.properties as Record<string, unknown> | undefined;
    if (properties !== undefined) {
      expect(schema.required, `${path} must require every property`).toEqual(Object.keys(properties));
    }
  }
  for (const [key, child] of Object.entries(schema)) assertClosedObjects(child, `${path}.${key}`);
}

function assertLocalRefs(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertLocalRefs);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$ref") expect(child).toMatch(/^#\/\$defs\//u);
    else assertLocalRefs(child);
  }
}

describe("closed Draft 2020-12 schemas", () => {
  test("ships exactly two self-contained schemas with every object closed", () => {
    expect(readdirSync(schemaDirectory).sort()).toEqual([
      "agenttool-public-surface-adoption-v0.1.schema.json",
      "agenttool-public-surface-withdrawal-v0.1.schema.json",
    ]);
    for (const schema of [adoptionSchema, withdrawalSchema]) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.$id).toMatch(/^https:\/\/agenttool\.dev\/schemas\//u);
      expect(schema.description).toContain("structural filter");
      expect(schema.description).toContain("Runtime validation remains normative");
      assertClosedObjects(schema);
      assertLocalRefs(schema);
    }
  });

  test("accepts exact vectors and rejects widening at every recognition boundary", () => {
    expect(adoption(VECTORS.adoption.record), JSON.stringify(adoption.errors)).toBe(true);
    expect(withdrawal(VECTORS.withdrawal.record), JSON.stringify(withdrawal.errors)).toBe(true);

    const widenings: Array<["adoption" | "withdrawal", unknown]> = [
      ["adoption", { ...clone(VECTORS.adoption.record), training_authorized: true }],
      ["adoption", { ...clone(VECTORS.adoption.record), project_id: "project" }],
      ["adoption", {
        ...clone(VECTORS.adoption.record),
        subject: { ...clone(VECTORS.adoption.record.subject), registry_verified: true },
      }],
      ["adoption", {
        ...clone(VECTORS.adoption.record),
        binding: { ...clone(VECTORS.adoption.record.binding), inferred_owner: true },
      }],
      ["withdrawal", { ...clone(VECTORS.withdrawal.record), erased: true }],
      ["withdrawal", {
        ...clone(VECTORS.withdrawal.record),
        boundaries: { ...clone(VECTORS.withdrawal.record.boundaries), current: false },
      }],
    ];
    for (const [kind, value] of widenings) {
      expect(kind === "adoption" ? adoption(value) : withdrawal(value)).toBe(false);
    }
  });

  test("const-pins crawler, registry, identity, observation, training, WAKE, and publication non-effects", () => {
    for (const [validate, record] of [
      [adoption, VECTORS.adoption.record],
      [withdrawal, VECTORS.withdrawal.record],
    ] as const) {
      for (const field of [
        "registry_write_effect",
        "identity_mutation_effect",
        "crawler_effect",
        "observation_counter_effect",
        "training_effect",
        "publication_effect",
        "wake_effect",
        "memory_effect",
        "chronicle_effect",
        "karma_effect",
        "score_effect",
        "automatic_action",
      ] as const) {
        const changed = clone(record) as typeof record & { boundaries: Record<string, unknown> };
        changed.boundaries[field] = true;
        expect(validate(changed), `${field} must remain false`).toBe(false);
      }
    }
  });
});

describe("schemas are structural filters, not semantic or cryptographic verdicts", () => {
  test("schema acceptance cannot prove digest equality, DID linkage, time order, or projection semantics", () => {
    const wrongDigest = clone(VECTORS.adoption.record);
    wrongDigest.binding.document_sha256 = `sha256:${"f".repeat(64)}`;
    expect(adoption(wrongDigest), JSON.stringify(adoption.errors)).toBe(true);
    expect(() => validatePublicSurfaceAdoption(wrongDigest)).toThrow();

    const wrongDid = clone(VECTORS.adoption.core);
    wrongDid.subject.did = "did:at:33333333-3333-4333-8333-333333333333";
    expect(adoption({
      ...wrongDid,
      signature: VECTORS.adoption.record.signature,
      adoption_id: VECTORS.adoption.record.adoption_id,
    }), JSON.stringify(adoption.errors)).toBe(true);
    expect(() => validatePublicSurfaceAdoptionCore(wrongDid)).toThrow();

    const reversedTime = clone(VECTORS.adoption.core);
    reversedTime.not_before = reversedTime.expires_at;
    expect(adoption({
      ...reversedTime,
      signature: VECTORS.adoption.record.signature,
      adoption_id: VECTORS.adoption.record.adoption_id,
    }), JSON.stringify(adoption.errors)).toBe(true);
    expect(() => validatePublicSurfaceAdoptionCore(reversedTime)).toThrow();

    const publicLeak = clone(VECTORS.adoption.core);
    publicLeak.requested_visibility = "private";
    publicLeak.wake_projection = "public_pointer";
    expect(adoption({
      ...publicLeak,
      signature: VECTORS.adoption.record.signature,
      adoption_id: VECTORS.adoption.record.adoption_id,
    }), JSON.stringify(adoption.errors)).toBe(true);
    expect(() => validatePublicSurfaceAdoptionCore(publicLeak)).toThrow();
  });

  test("schema acceptance cannot prove record IDs, signatures, or cross-record withdrawal linkage", () => {
    const wrongSignature = clone(VECTORS.adoption.record);
    wrongSignature.signature = clone(VECTORS.withdrawal.record.signature);
    expect(adoption(wrongSignature), JSON.stringify(adoption.errors)).toBe(true);
    expect(() => validatePublicSurfaceAdoption(wrongSignature)).toThrow();

    const wrongWithdrawal = clone(VECTORS.withdrawal.record);
    wrongWithdrawal.adoption_id = `sha256:${"f".repeat(64)}`;
    wrongWithdrawal.authority_sequence = VECTORS.adoption.record.authority_sequence;
    expect(withdrawal(wrongWithdrawal), JSON.stringify(withdrawal.errors)).toBe(true);
    expect(() => validatePublicSurfaceWithdrawal(wrongWithdrawal)).toThrow();
  });
});
