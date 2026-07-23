/** Discoverability locks for the hosted collaboration relay surface. */

import { expect, test } from "bun:test";

import openapi from "../src/routes/openapi";

type OpenApiOperation = {
  security?: Array<Record<string, unknown>>;
  description?: string;
  parameters?: Array<{ $ref?: string }>;
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: { $ref?: string };
      };
    };
  };
  responses?: Record<string, {
    description?: string;
    content?: {
      "application/json"?: {
        schema?: { $ref?: string };
      };
    };
  }>;
};

type OpenApiDocument = {
  components: {
    securitySchemes: Record<string, { bearerFormat?: string; description?: string }>;
    schemas: Record<string, {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      required?: string[];
    }>;
  };
  tags: Array<{ name: string; description?: string }>;
  paths: Record<
    string,
    {
      get?: OpenApiOperation;
      post?: OpenApiOperation;
    }
  >;
};

test("OpenAPI exposes both collab authority boundaries and every mounted route", async () => {
  const response = await openapi.request("/");
  expect(response.status).toBe(200);
  const document = await response.json() as OpenApiDocument;

  expect(document.components.securitySchemes.bearerAuth?.bearerFormat).toBe(
    "at_*",
  );
  expect(
    document.components.securitySchemes.collabDeviceAuth?.bearerFormat,
  ).toBe("atc_*");
  expect(
    document.components.securitySchemes.collabDeviceAuth?.description,
  ).toContain("grants no GitHub");
  expect(document.tags.some((tag) => tag.name === "collab")).toBe(true);

  const enrollment = document.paths["/v1/collab/enrolments"]?.post;
  expect(enrollment?.security).toEqual([{ bearerAuth: [] }]);
  expect(enrollment?.parameters).toContainEqual({
    $ref: "#/components/parameters/CollabIdempotencyKey",
  });
  expect(
    document.components.schemas.CollabEnrolmentRequest?.required,
  ).toContain("expected_device_version");
  expect(
    document.components.schemas.CollabEnrolmentRequest?.required,
  ).toContain("idempotency_key");
  expect(
    document.components.schemas.CollabEnrolmentResult?.properties,
  ).toHaveProperty("receipt");

  const repositoryPaths = [
    "/v1/collab/repositories/{repository_id}/events",
    "/v1/collab/repositories/{repository_id}/operations",
    "/v1/collab/repositories/{repository_id}/operations/claim",
    "/v1/collab/repositories/{repository_id}/operations/{action_id}/renew",
    "/v1/collab/repositories/{repository_id}/operations/{action_id}/begin",
    "/v1/collab/repositories/{repository_id}/operations/{action_id}/complete",
    "/v1/collab/repositories/{repository_id}/operations/{action_id}/release",
    "/v1/collab/repositories/{repository_id}/operations/{action_id}/recover",
    "/v1/collab/repositories/{repository_id}/observations",
  ];
  for (const path of repositoryPaths) {
    const item = document.paths[path];
    expect(item, path).toBeDefined();
    for (const operation of [item?.get, item?.post]) {
      if (!operation) continue;
      expect(operation.security, path).toEqual([{ collabDeviceAuth: [] }]);
    }
  }
  expect(
    document.paths[
      "/v1/collab/repositories/{repository_id}/operations/claim"
    ]?.post?.description,
  ).toContain("does not execute GitHub");

  const mutationBindings = [
    ["claim", "CollabOperationClaimRequest", "lease_seconds"],
    ["{action_id}/renew", "CollabOperationRenewRequest", "lease_id"],
    ["{action_id}/begin", "CollabOperationBeginRequest", "expected_version"],
    ["{action_id}/complete", "CollabOperationCompleteRequest", "outcome"],
    ["{action_id}/release", "CollabOperationReleaseRequest", "lease_id"],
    ["{action_id}/recover", "CollabOperationRecoverRequest", "disposition"],
  ] as const;
  for (const [suffix, component, requiredField] of mutationBindings) {
    const operation = document.paths[
      `/v1/collab/repositories/{repository_id}/operations/${suffix}`
    ]?.post;
    expect(
      operation?.requestBody?.content?.["application/json"]?.schema?.$ref,
      suffix,
    ).toBe(`#/components/schemas/${component}`);
    expect(document.components.schemas[component]?.additionalProperties)
      .toBe(false);
    expect(document.components.schemas[component]?.required).toContain(
      requiredField,
    );
    expect(
      operation?.responses?.["200"]?.content?.["application/json"]?.schema
        ?.$ref,
    ).toBe("#/components/schemas/CollabOperationResult");
  }

  expect(
    document.paths[
      "/v1/collab/repositories/{repository_id}/operations"
    ]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
  ).toBe("#/components/schemas/CollabOperationPage");
  expect(
    document.paths[
      "/v1/collab/repositories/{repository_id}/events"
    ]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
  ).toBe("#/components/schemas/CollabEventPage");
  const observations = document.paths[
    "/v1/collab/repositories/{repository_id}/observations"
  ];
  expect(
    observations?.get?.responses?.["200"]?.content?.["application/json"]
      ?.schema?.$ref,
  ).toBe("#/components/schemas/CollabProviderObservationPage");
  expect(
    observations?.post?.responses?.["200"]?.content?.["application/json"]
      ?.schema?.$ref,
  ).toBe("#/components/schemas/CollabProviderObservationResult");
  expect(observations?.post?.responses?.["403"]?.description).toContain(
    "policy",
  );
});
