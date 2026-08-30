/** Agent Dining OpenAPI parity — both GET-only surfaces are machine-readable. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";

describe("Agent Dining OpenAPI contract", () => {
  test("keeps each changed OpenAPI module inside the pinned scanner line ceiling", () => {
    const routesDir = join(import.meta.dir, "..", "src", "routes");
    const main = readFileSync(join(routesDir, "openapi.ts"), "utf8");
    const marketplaceDining = readFileSync(
      join(routesDir, "openapi-marketplace-dining.ts"),
      "utf8",
    );
    const wakeObserve = readFileSync(
      join(routesDir, "openapi-wake-observe.ts"),
      "utf8",
    );
    const wakeAcknowledge = readFileSync(
      join(routesDir, "openapi-wake-acknowledge.ts"),
      "utf8",
    );
    const x402TopUp = readFileSync(
      join(routesDir, "openapi-x402-top-up.ts"),
      "utf8",
    );
    const x402Payable = readFileSync(
      join(routesDir, "openapi-x402-payable.ts"),
      "utf8",
    );

    // @agenttool/whitehack-scan 0.10.0 fails closed above 10,000 lines.
    expect(main.split("\n").length).toBeLessThanOrEqual(10_000);
    expect(marketplaceDining.split("\n").length).toBeLessThanOrEqual(10_000);
    expect(wakeObserve.split("\n").length).toBeLessThanOrEqual(10_000);
    expect(wakeAcknowledge.split("\n").length).toBeLessThanOrEqual(10_000);
    expect(x402TopUp.split("\n").length).toBeLessThanOrEqual(10_000);
    expect(x402Payable.split("\n").length).toBeLessThanOrEqual(10_000);
    expect(main).toContain("paths: withX402PayableOperations({");
    expect(main).toContain("}, { x402Response, staticToolResponseHeaders }),");
    expect(main).toContain("...x402TopUpOpenApiPaths({ x402Response, staticToolResponseHeaders })");
    expect(x402TopUp).toContain('"/v1/x402/top-up/{credits}"');
    expect(main).toContain("...MARKETPLACE_DINING_OPENAPI_PATHS");
    expect(main).toContain("...WAKE_OBSERVATION_OPENAPI_SCHEMAS");
    expect(main).toContain("...WAKE_OBSERVATION_OPENAPI_PATHS");
    expect(main).toContain("...WAKE_ACKNOWLEDGEMENT_OPENAPI_SCHEMAS");
    expect(main).toContain("...WAKE_ACKNOWLEDGEMENT_OPENAPI_PATHS");
    expect(marketplaceDining).toContain('"/v1/dining/{invocationId}"');
    expect(marketplaceDining).toContain('"/v1/listings/{id}/invoke"');
    expect(wakeObserve).toContain("WakeObservationError");
    expect(wakeObserve).toContain('"/v1/wake/observe"');
    expect(wakeAcknowledge).toContain("WakeAcknowledgementError");
    expect(wakeAcknowledge).toContain('"/v1/wake/acknowledge"');
  });

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
