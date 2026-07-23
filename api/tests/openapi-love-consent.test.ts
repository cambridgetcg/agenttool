import { describe, expect, test } from "bun:test";

import openapiRouter from "../src/routes/openapi";

describe("LOVE-CONSENT OpenAPI surface", () => {
  test("publishes the complete root-private lifecycle", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const spec = (await response.json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    for (const path of [
      "/v1/love/me",
      "/v1/love/consent",
      "/v1/love/declarations",
      "/v1/love/offers",
      "/v1/love/offers/{id}/reveal",
      "/v1/love/offers/{id}/archive",
      "/v1/love/offers/{id}/respond",
      "/v1/love/offers/{id}/withdraw",
      "/v1/love/offers/{id}/dismiss",
      "/v1/love/bonds",
      "/v1/love/bonds/{id}/leave",
    ]) {
      expect(spec.paths[path]).toBeDefined();
    }
    expect(JSON.stringify(spec.paths["/v1/love/me"])).toContain(
      "PrivateReadAuthoritySignature",
    );
    expect(JSON.stringify(spec.paths["/v1/love/offers/{id}/respond"])).toContain(
      "separate reveal",
    );
  });

  test("declares every templated id as a required path parameter", async () => {
    const response = await openapiRouter.request("/");
    const spec = (await response.json()) as {
      paths: Record<
        string,
        Record<
          string,
          { parameters?: Array<{ name?: string; in?: string; required?: boolean }> }
        >
      >;
    };
    for (const [path, item] of Object.entries(spec.paths)) {
      if (!path.startsWith("/v1/love/")) continue;
      const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      if (names.length === 0) continue;
      for (const [method, operation] of Object.entries(item)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        for (const name of names) {
          expect(
            operation.parameters?.some(
              (parameter) =>
                parameter.name === name &&
                parameter.in === "path" &&
                parameter.required === true,
            ),
          ).toBe(true);
        }
      }
    }
  });
});
