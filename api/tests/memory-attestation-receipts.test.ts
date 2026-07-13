import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapi from "../src/routes/openapi";

const TIERS = readFileSync(
  join(import.meta.dir, "..", "src", "services", "memory", "tiers.ts"),
  "utf8",
);
const MEMORY_ROUTE = readFileSync(
  join(import.meta.dir, "..", "src", "routes", "memory", "memories.ts"),
  "utf8",
);
const SCHEMA = readFileSync(
  join(import.meta.dir, "..", "src", "db", "schema", "memory.ts"),
  "utf8",
);
const MIGRATION = readFileSync(
  join(
    import.meta.dir,
    "..",
    "migrations",
    "20260713T120000_attestation_receipt_integrity.sql",
  ),
  "utf8",
);

describe("paid memory-attestation receipt visibility and integrity", () => {
  test("detail, list, and foundation serializers expose paid receipt fields", () => {
    for (const field of [
      "signatureContext: memoryAttestations.signatureContext",
      "signedPayload: memoryAttestations.signedPayload",
      "sourceGrantId: memoryAttestations.sourceGrantId",
      "signature_context: row.signatureContext",
      "signed_payload: row.signedPayload",
      "source_grant_id: row.sourceGrantId",
    ]) {
      expect(TIERS).toContain(field);
    }
    expect(TIERS).toContain("listAttestationsByMemories(projectId, ids)");
    expect(MEMORY_ROUTE).toContain("attachAttestationReceipts(project.id, rows)");
    expect(MEMORY_ROUTE).toContain("memories: memoriesWithReceipts");
  });

  test("source grant is a foreign key with one paid receipt per grant", () => {
    expect(SCHEMA).toContain(".references(");
    expect(SCHEMA).toContain("() => memoryWitnessGrants.id");
    expect(SCHEMA).toContain('uniqueIndex("uniq_memory_attestations_source_grant_id")');
    expect(MIGRATION).toContain("fk_memory_attestations_source_grant");
    expect(MIGRATION).toContain("REFERENCES marketplace.memory_witness_grants(id)");
    expect(MIGRATION).toContain("uniq_memory_attestations_source_grant_id");
  });

  test("OpenAPI names nullable ordinary-v1 receipt fields", async () => {
    const response = await openapi.request("/");
    const document = (await response.json()) as {
      components: {
        schemas: Record<
          string,
          { properties?: Record<string, { type?: string | string[] }> }
        >;
      };
      paths: Record<string, { get?: { description?: string } }>;
    };
    const receipt = document.components.schemas.MemoryAttestation;
    expect(receipt?.properties?.signature_context?.type).toEqual(["string", "null"]);
    expect(receipt?.properties?.signed_payload?.type).toEqual(["string", "null"]);
    expect(receipt?.properties?.source_grant_id?.type).toEqual(["string", "null"]);
    expect(
      document.paths["/v1/memories/{id}/attestations"]?.get?.description,
    ).toContain("ordinary memory-attestation/v1 rows return null");
  });
});
