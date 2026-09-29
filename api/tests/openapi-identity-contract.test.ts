import { describe, expect, test } from "bun:test";

import openapiRouter from "../src/routes/openapi";

describe("identity OpenAPI contracts", () => {
  test("publishes fresh same-project BYO enrollment without private-material inputs", async () => {
    const document = await (await openapiRouter.request("/")).json() as { paths: Record<string, Record<string, any>> };
    const operation = document.paths["/v1/identities/enroll"]!.post;
    const schema = operation.requestBody.content["application/json"].schema;
    expect(schema.required).toEqual(["format", "origin", "project_id", "identity_id", "signing_key_id", "display_name", "capabilities", "public_key", "nonce", "timestamp"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.private_key).toBeUndefined(); expect(schema.properties.metadata).toBeUndefined();
    expect(operation.parameters[0]).toMatchObject({ name: "X-Agenttool-Enrollment-Signature", in: "header", required: true });
    expect(operation.description).toContain("authenticated project"); expect(operation.description).toContain("committed atomically");
    expect(operation.requestBody.description).toContain("16384");
    for (const status of ["201", "400", "401", "409", "413", "415", "503"]) expect(operation.responses[status]).toBeDefined();
  });

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
