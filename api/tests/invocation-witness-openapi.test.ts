import { describe, expect, test } from "bun:test";

import {
  WITNESS_ADAPTER_ID_PATTERN,
  WITNESS_ATTESTATION_ID_PATTERN,
  WITNESS_CAP,
  WITNESS_CHAIN_ID_PATTERN,
  WITNESS_ENTRY_SCHEMA,
  WITNESS_TX_HASH_PATTERN,
} from "../src/services/marketplace/witness";
import openapiRouter from "../src/routes/openapi";
import publicRouter from "../src/routes/public";

describe("invocation witness HTTP contract", () => {
  test("authenticated write route is strict, released-only, and report-honest", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const document = (await response.json()) as any;
    const operation =
      document.paths["/v1/invocations/{id}/witness"].post;

    // No operation override: inherit the document's bearerAuth requirement.
    expect(operation.security).toBeUndefined();
    expect(document.security).toEqual([{ bearerAuth: [] }]);
    expect(operation.description).toMatch(
      /authenticated buyer or seller.*status=released/is,
    );
    expect(operation.description).toMatch(
      /does not query.*verify.*prove ownership\/provenance/is,
    );

    const request =
      operation.requestBody.content["application/json"].schema;
    expect(request.additionalProperties).toBe(false);
    expect(request.required).toEqual([
      "chain_id",
      "tx_hash",
      "attestation_id",
    ]);
    expect(request.properties.chain_id.pattern).toBe(
      WITNESS_CHAIN_ID_PATTERN.source,
    );
    expect(request.properties.tx_hash.pattern).toBe(
      WITNESS_TX_HASH_PATTERN.source,
    );
    expect(request.properties.attestation_id.pattern).toBe(
      WITNESS_ATTESTATION_ID_PATTERN.source,
    );
    expect(request.properties.adapter_id.pattern).toBe(
      WITNESS_ADAPTER_ID_PATTERN.source,
    );

    expect(Object.keys(operation.responses).sort()).toEqual([
      "200",
      "201",
      "400",
      "403",
      "404",
      "409",
      "500",
    ]);
    const created =
      operation.responses["201"].content["application/json"].schema;
    expect(created.additionalProperties).toBe(false);
    expect(created.properties.witness_count.maximum).toBe(WITNESS_CAP);
    expect(created.properties.witness.properties.schema.const).toBe(
      WITNESS_ENTRY_SCHEMA,
    );
    expect(
      created.properties.witness.properties.schema.description,
    ).toMatch(/not a signature.*provenance/i);
  });

  test("public read route exposes comparison fields without claiming chain verification", async () => {
    const response = await openapiRouter.request("/");
    const document = (await response.json()) as any;
    const operation =
      document.paths["/public/invocations/{id}"].get;

    expect(operation.security).toEqual([]);
    expect(operation.description).toMatch(
      /status=released.*settlement timestamp.*do not prove historical writer or cryptographic provenance.*does not query or verify/is,
    );
    expect(operation.description).toMatch(
      /retrieve.*independently.*compare/is,
    );
    expect(operation.description).toMatch(/sealed.*never exposed/is);

    const schema =
      operation.responses["200"].content["application/json"].schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.slice(0, 10)).toEqual([
      "amount",
      "buyer_did",
      "completed_at",
      "completion_sig",
      "created_at",
      "currency",
      "id",
      "listing_id",
      "settled_at",
      "status",
    ]);
    expect(schema.properties._witnesses.minItems).toBe(1);
    expect(schema.properties._witnesses.maxItems).toBe(WITNESS_CAP);
    expect(
      schema.properties._witnesses.items.additionalProperties,
    ).toBe(false);
    expect(
      schema.properties._witnesses.items.properties.schema.const,
    ).toBe(WITNESS_ENTRY_SCHEMA);
    expect(operation.responses["404"].description).toMatch(
      /non-released.*unsettled.*legacy-shaped.*extra-key.*over-cap/i,
    );
  });

  test("public root names the exact authority and verification boundary", async () => {
    const response = await publicRouter.request("/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      endpoints: { witnessed_invocation: string };
    };
    expect(body.endpoints.witnessed_invocation).toMatch(
      /released and settled.*authenticated invocation-party write route/is,
    );
    expect(body.endpoints.witnessed_invocation).toMatch(
      /shape alone is not proof of writer provenance or platform chain verification.*independent chain retrieval and comparison/is,
    );
  });
});
