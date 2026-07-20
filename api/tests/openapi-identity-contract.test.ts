import { describe, expect, test } from "bun:test";

import openapiRouter from "../src/routes/openapi";

describe("identity OpenAPI contracts", () => {
  test("publishes the signed attestation and local-token boundaries", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const document = await response.json() as {
      paths: Record<string, Record<string, any>>;
    };

    const attestation = document.paths["/v1/attestations"]!.post;
    const attestationSchema =
      attestation.requestBody.content["application/json"].schema;
    expect(attestationSchema.required).toEqual([
      "subject_id",
      "attester_id",
      "claim",
      "signature",
      "kid",
    ]);
    expect(attestationSchema.properties.private_key).toBeUndefined();
    expect(attestationSchema.properties.tier).toBeUndefined();
    expect(attestationSchema.properties.claim_type).toBeUndefined();
    expect(attestationSchema.properties.expires_in_seconds).toBeUndefined();
    expect(attestation.responses["409"]).toBeDefined();

    const issue = document.paths["/v1/identities/{id}/tokens"]!.post;
    expect(issue.deprecated).toBe(true);
    expect(issue.requestBody).toBeUndefined();
    expect(issue.responses["410"]).toBeDefined();

    const verify = document.paths["/v1/tokens/verify"]!.post;
    expect(
      verify.requestBody.content["application/json"].schema.required,
    ).toEqual(["token", "audience_did"]);
    expect(verify.responses["401"]).toBeDefined();
    expect(verify.description).toMatch(/audience identity must belong to the project bearer/i);
  });

  test("names the mounted authenticated discovery allowlist", async () => {
    const document = await (await openapiRouter.request("/")).json() as {
      paths: Record<string, Record<string, any>>;
    };
    const discover = document.paths["/v1/discover"]!.get;
    expect(discover.description).toMatch(/authenticated search/i);
    expect(discover.description).toMatch(/generic metadata and expression are excluded/i);
    expect(discover.parameters.some((parameter: { name: string }) => parameter.name === "creator")).toBe(false);
    expect(discover.responses["400"]).toBeDefined();
  });
});
