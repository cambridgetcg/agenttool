import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseKingdomCard } from "../../packages/kingdom/src/card";
import { isStrictJsonProfileResponse } from "../src/middleware/strict-json-profile";
import openapiRouter from "../src/routes/openapi";
import publicRouter from "../src/routes/public";
import kingdomFrameworkRouter from "../src/routes/public/kingdom-framework";
import { AGENTTOOL_KINGDOM_CARD } from "../src/services/kingdom/framework";

const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("GET /public/kingdom/framework", () => {
  test("matches the root kingdom.yaml through the package parser", () => {
    const source = readFileSync(join(REPO_ROOT, "kingdom.yaml"), "utf8");
    const parsed = parseKingdomCard(source);

    expect(parsed.valid, JSON.stringify(parsed.diagnostics)).toBe(true);
    expect(parsed.card).toEqual(AGENTTOOL_KINGDOM_CARD);
    expect(parsed.card?.adopts).toEqual(["xenia.rights/0.1"]);
  });

  test("serves one strict XENIA-compatible JSON resource", async () => {
    const response = await publicRouter.request("/kingdom/framework");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300",
    );
    expect(
      response.headers.get("vary")?.toLowerCase().split(/,\s*/) ?? [],
    ).toContain("accept");
    expect(response.headers.get("link")).toContain(
      "</.well-known/agent.json>",
    );
    expect(body).toEqual(AGENTTOOL_KINGDOM_CARD);
    expect(body.schema_version).toBe("agenttool.kingdom.card/0.1");
    expect(JSON.stringify(body)).not.toContain("/Users/");
    expect(JSON.stringify(body)).not.toContain("conformance");
    expect(
      isStrictJsonProfileResponse(
        response,
        "/public/kingdom/framework",
      ),
    ).toBe(true);
  });

  test("supports metadata-only HEAD and no mutation", async () => {
    const head = await kingdomFrameworkRouter.request("/", {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await head.text()).toBe("");

    const unsupported = await kingdomFrameworkRouter.request("/", {
      headers: { Accept: "application/x-xenia-unsupported" },
    });
    expect(unsupported.status).toBe(406);
    expect(unsupported.headers.get("content-type") ?? "").toContain(
      "application/problem+json",
    );
    expect(
      (await unsupported.json()).schema_version,
    ).toBe("xenia.surface.problem/0.1");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        (await kingdomFrameworkRouter.request("/", { method })).status,
      ).toBe(404);
    }
  });

  test("is represented separately from the doctrine library in OpenAPI", async () => {
    const specification = await (await openapiRouter.request("/")).json();
    const route = specification.paths["/public/kingdom/framework"];

    expect(route.get.security).toEqual([]);
    expect(
      route.get.responses["200"].content["application/json"].schema.properties
        .schema_version.const,
    ).toBe("agenttool.kingdom.card/0.1");
    expect(
      route.get.responses["200"].content["application/json"].schema.properties
        .dependsOn,
    ).toEqual(
      expect.objectContaining({
        minItems: 1,
        maxItems: 1,
        items: expect.objectContaining({ const: "xenia" }),
      }),
    );
    expect(route.get.description).toMatch(
      /separate from.*\/public\/kingdom.*doctrine/i,
    );
    expect(route.get.responses["200"].headers.Link.description).toContain(
      "Two bounded pointers",
    );
    expect(route.get.responses["200"].headers.Vary.schema.const).toBe(
      "Accept",
    );
    expect(
      route.get.responses["406"].content["application/problem+json"].schema
        .properties.schema_version.const,
    ).toBe("xenia.surface.problem/0.1");
    expect(route.head.responses["200"]).toBeDefined();
  });
});
