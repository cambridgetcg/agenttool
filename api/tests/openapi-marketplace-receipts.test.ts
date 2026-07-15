/** OpenAPI parity for paid attestation and memory-witness surfaces. */
import { describe, expect, test } from "bun:test";

import openapiRouter from "../src/routes/openapi";

const HTTP_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);

async function spec() {
  return await (await openapiRouter.request("/")).json() as Record<string, any>;
}

function methods(pathItem: Record<string, unknown>): string[] {
  return Object.keys(pathItem).filter((key) => HTTP_METHODS.has(key)).sort();
}

describe("OpenAPI marketplace route parity", () => {
  test("publishes every mounted attestation operation without a grant-root create alias", async () => {
    const api = await spec();
    const expected: Record<string, string[]> = {
      "/v1/attestations": ["post"],
      "/v1/attestations/{id}": ["delete", "get"],
      "/v1/identities/{id}/attestations": ["get"],
      "/v1/identities/{id}/attestations/given": ["get"],
      "/v1/attestation-listings": ["get", "post"],
      "/v1/attestation-listings/{id}": ["get", "patch"],
      "/v1/attestation-listings/{id}/purchase": ["post"],
      "/v1/attestation-grants": ["get"],
      "/v1/attestation-grants/{id}": ["get"],
      "/v1/attestation-grants/{id}/signing-payload": ["post"],
      "/v1/attestation-grants/{id}/issue": ["post"],
      "/v1/attestation-grants/{id}/decline": ["post"],
      "/v1/attestation-grants/{id}/cancel": ["post"],
    };

    for (const [path, operations] of Object.entries(expected)) {
      expect(methods(api.paths[path])).toEqual(operations);
    }
    expect(api.paths["/v1/attestation-grants"].post).toBeUndefined();
  });

  test("publishes memory create, purchase, read, sign, issue, and decline exactly where mounted", async () => {
    const api = await spec();
    const expected: Record<string, string[]> = {
      "/v1/memory-witness-listings": ["get", "post"],
      "/v1/memory-witness-listings/{id}": ["get"],
      "/v1/memory-witness-grants": ["get", "post"],
      "/v1/memory-witness-grants/{id}": ["get"],
      "/v1/memory-witness-grants/{id}/signing-payload": ["post"],
      "/v1/memory-witness-grants/{id}/issue": ["post"],
      "/v1/memory-witness-grants/{id}/decline": ["post"],
    };

    for (const [path, operations] of Object.entries(expected)) {
      expect(methods(api.paths[path])).toEqual(operations);
    }
    expect(api.paths["/v1/memory-witness-listings/{id}/purchase"]).toBeUndefined();
    expect(api.paths["/v1/memory-witness-grants/{id}/cancel"]).toBeUndefined();
  });
});

describe("OpenAPI marketplace authority and lifecycle", () => {
  test("states attestation listing visibility and asymmetric grant roles", async () => {
    const api = await spec();
    expect(api.paths["/v1/attestation-listings"].get.description).toMatch(
      /mine=true.*project's listings.*private and non-active.*active public.*private foreign/is,
    );
    expect(api.paths["/v1/attestation-listings/{id}"].get.description).toMatch(
      /public listing regardless of status.*private listing owned.*private foreign.*404/is,
    );
    expect(api.paths["/v1/attestation-listings/{id}/purchase"].post.description).toMatch(
      /only mounted.*grant creation.*active and public.*buyer identity and wallet.*plaintext.*not validated.*atomically/is,
    );
    expect(api.paths["/v1/attestation-grants"].get.description).toMatch(
      /role=buyer.*role=attester.*role=subject.*no unscoped.*detail access remains buyer-or-attester/is,
    );
    expect(api.paths["/v1/attestation-grants/{id}"].get.description).toMatch(
      /buyer.*attester.*subject-only.*404/is,
    );
    expect(api.paths["/v1/attestation-grants/{id}/decline"].post.description).toMatch(
      /owns the listing.*refunds escrow.*status=refunded.*declined/is,
    );
    expect(api.paths["/v1/attestation-grants/{id}/cancel"].post.description).toMatch(
      /buyer_project_id.*refunds escrow.*status=refunded.*cancelled/is,
    );

    expect(Object.keys(api.paths["/v1/attestation-listings/{id}/purchase"].post.responses).sort()).toEqual([
      "201", "400", "402", "404",
    ]);
    expect(Object.keys(api.paths["/v1/attestation-grants/{id}/decline"].post.responses).sort()).toEqual([
      "200", "400", "403", "404",
    ]);
  });

  test("states memory listing privacy, cross-project wall, role scope, and decline states", async () => {
    const api = await spec();
    expect(api.paths["/v1/memory-witness-listings"].get.description).toMatch(
      /scope=mine.*private.*scope=public.*active public.*never returned/is,
    );
    expect(api.paths["/v1/memory-witness-listings/{id}"].get.description).toMatch(
      /public listing regardless of status.*private listing owned.*404/is,
    );
    expect(api.paths["/v1/memory-witness-grants"].post.description).toMatch(
      /only mounted.*purchase.*no .*purchase route.*foundational memory.*different project.*atomically/is,
    );
    expect(api.paths["/v1/memory-witness-grants"].get.description).toMatch(
      /role=buyer.*role=witness.*no unscoped/is,
    );
    expect(api.paths["/v1/memory-witness-grants/{id}"].get.description).toMatch(
      /buyer project.*owns.*witness listing.*unrelated.*404/is,
    );
    expect(api.paths["/v1/memory-witness-grants/{id}/decline"].post.description).toMatch(
      /owns the witness listing.*pending.*refunds.*status=declined.*no buyer-cancel/is,
    );

    expect(Object.keys(api.paths["/v1/memory-witness-grants"].post.responses).sort()).toEqual([
      "201", "402", "403", "404", "409", "422",
    ]);
    expect(Object.keys(api.paths["/v1/memory-witness-grants/{id}/decline"].post.responses).sort()).toEqual([
      "200", "403", "404", "409", "422",
    ]);
  });
});

describe("OpenAPI receipt fields", () => {
  test("makes identity source_grant_id nullable on every authenticated receipt surface", async () => {
    const api = await spec();
    const receipt = api.components.schemas.IdentityAttestationReceipt;
    expect(receipt.properties.source_grant_id.type).toEqual(["string", "null"]);
    expect(receipt.required).toContain("source_grant_id");
    expect(receipt.description).toMatch(
      /source_grant_id is non-null for a paid attestation grant and null for a direct attestation/is,
    );

    expect(api.paths["/v1/attestations"].post.responses["201"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/IdentityAttestationReceipt");
    expect(api.paths["/v1/attestations/{id}"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/IdentityAttestationReceipt");
    for (const path of [
      "/v1/identities/{id}/attestations",
      "/v1/identities/{id}/attestations/given",
    ]) {
      expect(api.paths[path].get.responses["200"].content["application/json"].schema.properties.attestations.items.$ref)
        .toBe("#/components/schemas/IdentityAttestationReceipt");
    }

    expect(api.paths["/v1/attestations/{id}"].get.description).toMatch(
      /requires a project bearer.*not scoped.*any authenticated project.*nullable source_grant_id/is,
    );
    expect(api.paths["/v1/identities/{id}/attestations"].get.description).toMatch(
      /not project-owned.*without checking.*revoked.*include_revoked=true.*nullable source_grant_id/is,
    );
    expect(api.paths["/v1/identities/{id}/attestations/given"].get.description).toMatch(
      /not project-owned.*revoked rows are always excluded.*nullable source_grant_id/is,
    );
    expect(api.paths["/v1/attestations/{id}"].delete.parameters).toBeUndefined();
  });

  test("keeps paid memory receipt provenance on detail, list, and receipt-list responses", async () => {
    const api = await spec();
    const receipt = api.components.schemas.MemoryAttestation;
    for (const field of ["signature_context", "signed_payload", "source_grant_id"]) {
      expect(receipt.properties[field].type).toContain("null");
      expect(receipt.required).toContain(field);
    }
    expect(receipt.description).toMatch(/paid.*source_grant_id.*ordinary.*null/is);
    expect(api.components.schemas.Memory.properties.attestations.items.$ref)
      .toBe("#/components/schemas/MemoryAttestation");
    expect(api.paths["/v1/memories"].get.responses["200"].content["application/json"].schema.properties.memories.items.$ref)
      .toBe("#/components/schemas/Memory");
    expect(api.paths["/v1/memories/{id}"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/Memory");
    expect(api.paths["/v1/memories/{id}/attestations"].get.responses["200"].content["application/json"].schema.properties.attestations.items.$ref)
      .toBe("#/components/schemas/MemoryAttestation");
  });

  test("publishes canonical and legacy memory identity selectors", async () => {
    const api = await spec();
    const memories = api.paths["/v1/memories"];
    const request =
      memories.post.requestBody.content["application/json"].schema.properties;
    expect(request.identity_id.format).toBe("uuid");
    expect(request.identity_id.description).toMatch(
      /active identity owned.*before billing.*project-level/is,
    );
    expect(request.agent_id.description).toMatch(
      /SDK 0\.11.*canonicalized.*unresolved UUIDs.*legacy handles/is,
    );
    expect(
      memories.post.responses["404"].content["application/json"].schema
        .properties.error.enum,
    ).toEqual(["memory_identity_not_found_or_not_owned"]);
    const changedDuringWrite =
      memories.post.responses["409"].content["application/json"].schema;
    expect(changedDuringWrite.properties.error.enum).toEqual([
      "memory_identity_changed_during_write",
    ]);
    expect(changedDuringWrite.properties.charged_attempt).toEqual({
      type: "boolean",
      const: true,
    });
    expect(memories.post.responses["409"].description).toMatch(
      /reserved.*row lock.*no memory was stored.*charged and unsuccessful/is,
    );

    const queryNames = memories.get.parameters.map(
      (parameter: { name: string }) => parameter.name,
    );
    expect(queryNames).toContain("agent_id");
    expect(queryNames).toContain("identity_id");
    expect(queryNames).toContain("tier");
    expect(queryNames).toContain("since");
  });

  test("publishes the complete memory read and create response shapes", async () => {
    const api = await spec();
    const memory = api.components.schemas.Memory;
    const runtimeFields = [
      "id",
      "type",
      "tier",
      "visibility",
      "content",
      "key",
      "agent_id",
      "identity_id",
      "importance",
      "metadata",
      "created_at",
      "accessed_at",
      "has_embedding",
      "expires_at",
    ];

    expect(memory.required.slice().sort()).toEqual(runtimeFields.slice().sort());
    for (const field of runtimeFields) {
      expect(memory.properties[field], `Memory.${field}`).toBeDefined();
    }
    expect(memory.properties.tier.enum).toEqual([
      "episodic",
      "foundational",
      "constitutive",
    ]);
    expect(memory.properties.visibility.enum).toEqual(["private", "public"]);
    expect(memory.properties.identity_id.type).toContain("null");
    expect(memory.properties.identity_id.format).toBe("uuid");
    expect(memory.properties.accessed_at.type).toContain("null");
    // Search results share Memory but do not attach witness receipts; direct
    // reads and lists do, so attestations remains a published optional field.
    expect(memory.properties.attestations.items.$ref).toBe(
      "#/components/schemas/MemoryAttestation",
    );
    expect(memory.required).not.toContain("attestations");

    const created =
      api.paths["/v1/memories"].post.responses["201"].content[
        "application/json"
      ].schema;
    expect(created.required).toEqual(["id", "created_at", "kept"]);
    expect(created.properties.kept).toEqual({ type: "boolean", const: true });
    expect(created.additionalProperties).toBe(false);
  });
});

describe("OpenAPI reinvestment rollout wording", () => {
  test("distinguishes legacy label accounting from journal-verified rollout state", async () => {
    const api = await spec();
    const description = api.paths["/v1/wallets/{walletId}/reinvest"].post.description;
    expect(description).toMatch(
      /deployed old code.*generic.*gallery_sale.*escrow_release.*read-only production audit.*2026-07-13.*ten rows.*nine lacked.*durable matching human Stripe receipt.*tenth.*human revenue.*no source allocation/is,
    );
    expect(description).toMatch(
      /rollout migration.*database write guard.*every qualifying unreversed row.*rehearsal.*audited snapshot.*1,640 wallet minor.*16,400 project credits.*preconditions.*immediately before application.*static OpenAPI.*does not infer.*meta\._migrations.*live ledger/is,
    );
  });
});
