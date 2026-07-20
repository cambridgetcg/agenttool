import { describe, expect, test } from "bun:test";

import { memoryWitnessGrantsRouter } from "../src/routes/memory-witness-marketplace";
import openapi from "../src/routes/openapi";

const grantId = "11111111-1111-4111-8111-111111111111";
const keyId = "22222222-2222-4222-8222-222222222222";

async function post(path: string, body: unknown) {
  return memoryWitnessGrantsRouter.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("memory-witness signing route validation", () => {
  test("signing-payload requires an explicit key", async () => {
    const response = await post(`/${grantId}/signing-payload`, {});
    expect(response.status).toBe(422);
  });

  test("issue requires the signed authorization expiry", async () => {
    const response = await post(`/${grantId}/issue`, {
      signing_key_id: keyId,
      signature_b64: Buffer.alloc(64).toString("base64"),
    });
    expect(response.status).toBe(422);
  });

  test("issue rejects non-canonical signature base64 before DB access", async () => {
    const response = await post(`/${grantId}/issue`, {
      signing_key_id: keyId,
      signature_b64: "not-base64",
      authorization_expires_at: "2026-07-13T12:05:00.000Z",
    });
    expect(response.status).toBe(422);
  });

  test("OpenAPI publishes the challenge and paid issue contract", async () => {
    const response = await openapi.request("/");
    const document = (await response.json()) as {
      paths: Record<string, { post?: { description?: string } }>;
    };
    const challenge =
      document.paths["/v1/memory-witness-grants/{id}/signing-payload"];
    const issue = document.paths["/v1/memory-witness-grants/{id}/issue"];
    expect(challenge?.post?.description).toContain("memory-witness-issue/v1");
    expect(issue?.post?.description).toContain(
      "ordinary memory-attestation/v1 signatures are rejected",
    );
  });
});
