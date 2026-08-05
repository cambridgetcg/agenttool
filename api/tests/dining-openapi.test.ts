/** Agent Dining OpenAPI parity — both GET-only surfaces are machine-readable. */

import { describe, expect, test } from "bun:test";

import openapiRouter from "../src/routes/openapi";

describe("Agent Dining OpenAPI contract", () => {
  test("documents the manifest and party-scoped journey with bearer auth", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const spec = await response.json() as any;

    const manifest = spec.paths["/v1/dining"]?.get;
    expect(manifest.security).toEqual([{ bearerAuth: [] }]);
    expect(manifest.tags).toContain("dining");
    expect(manifest.responses["200"].content["application/json"].schema.required)
      .toEqual(expect.arrayContaining(["protocol", "schemas", "_canon_pointer", "verbs"]));
    expect(manifest.responses["401"].$ref).toBe(
      "#/components/responses/Unauthorized",
    );

    const journeyPath = spec.paths["/v1/dining/{invocationId}"];
    expect(journeyPath.parameters[0]).toMatchObject({
      name: "invocationId",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
    expect(journeyPath.get.security).toEqual([{ bearerAuth: [] }]);
    const journeySchema =
      journeyPath.get.responses["200"].content["application/json"].schema;
    expect(journeySchema.required).toEqual(expect.arrayContaining([
      "roles",
      "marketplace_terminal",
      "presentation",
      "settlement",
    ]));
    expect(journeySchema.properties.presentation.properties.observed_by_agenttool.const)
      .toBe(false);
    expect(journeyPath.get.responses["400"].$ref).toBe(
      "#/components/responses/Validation",
    );
    expect(journeyPath.get.responses["401"].$ref).toBe(
      "#/components/responses/Unauthorized",
    );
    expect(journeyPath.get.responses["404"].$ref).toBe(
      "#/components/responses/NotFound",
    );
  });
});
