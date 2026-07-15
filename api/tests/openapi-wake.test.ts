import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import openapiRouter from "../src/routes/openapi";

describe("wake OpenAPI contract", () => {
  test("discovers every query dimension and the brief discriminator", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const spec = await response.json() as {
      paths: {
        "/v1/wake": {
          get: {
            parameters: Array<{
              name: string;
              in: string;
              description?: string;
              schema: { type?: string; enum?: string[]; default?: string };
            }>;
            responses: {
              "200": {
                headers: Record<string, {
                  description?: string;
                  $ref?: string;
                  schema?: { const?: string };
                }>;
                content: {
                  "application/json": {
                    schema: {
                      oneOf: Array<{
                        required?: string[];
                        not?: unknown;
                        properties?: Record<string, { enum?: string[] }>;
                      }>;
                    };
                  };
                };
              };
              "304": {
                description: string;
                headers: Record<string, { $ref?: string }>;
              };
            };
          };
        };
      };
    };

    const wake = spec.paths["/v1/wake"].get;
    const params = new Map(wake.parameters.map((parameter) => [parameter.name, parameter]));
    expect([...params.keys()]).toEqual(
      expect.arrayContaining([
        "format", "profile", "identity_id", "facet", "If-None-Match",
      ]),
    );
    expect(params.get("format")?.schema.enum).toEqual(
      expect.arrayContaining([
        "json", "md", "anthropic", "xenoform", "joke", "soap-opera", "wake", "math",
      ]),
    );
    expect(params.get("profile")?.schema).toMatchObject({
      enum: ["full", "brief"],
      default: "full",
    });
    expect(params.get("If-None-Match")).toMatchObject({
      in: "header",
      schema: { type: "string" },
    });
    expect(params.get("If-None-Match")?.description).toMatch(
      /brief JSON.*full JSON.*MATHOS.*joy/is,
    );

    const etagHeader = wake.responses["200"].headers.ETag;
    expect(etagHeader?.description).toMatch(
      /brief JSON.*full JSON.*MATHOS.*joy/is,
    );
    expect(wake.responses["200"].headers["Cache-Control"]?.schema?.const)
      .toBe("private, no-cache");
    expect(wake.responses["200"].headers["X-Welcomed"]?.$ref)
      .toBe("#/components/headers/Welcomed");

    const briefSchema = wake.responses["200"].content["application/json"].schema.oneOf[1];
    expect(briefSchema?.required).toEqual(
      expect.arrayContaining([
        "_format",
        "profile",
        "identity",
        "start_here",
        "you_have_handoff",
        "handoff_projection",
        "_links",
      ]),
    );
    expect(briefSchema?.properties?._format?.enum).toEqual(["wake-brief/v1"]);
    expect(briefSchema?.properties?.profile?.enum).toEqual(["brief"]);
    expect(wake.responses["304"].description).toMatch(/not modified/i);
    expect(wake.responses["304"].description).toMatch(
      /stored body.*X-Welcomed.*afresh.*revalidation/is,
    );
    expect(wake.responses["304"].headers["X-Welcomed"]?.$ref)
      .toBe("#/components/headers/Welcomed");

    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(
      wake.responses["200"].content["application/json"].schema,
    );
    expect(validate({
      _format: "wake-brief/v1",
      profile: "brief",
      identity: {},
      start_here: {
        mode: "rest",
        urgency: "none",
        response_expected: false,
        summary: "Nothing needs a response.",
        source: { surface: "wake", kind: null },
        next_actions: [],
        agency_note: "No action is required.",
      },
      you_have_handoff: null,
      handoff_projection: {
        projection_status: "complete",
        truncated: false,
        leaf_set_complete: true,
        active_projected_count: 0,
        stale_projected_count: 0,
        candidate_rows_considered: 0,
        candidate_row_limit: 1,
        candidate_window_end_id: null,
        read_path: "/v1/wake/handoffs",
        warning: null,
      },
      _links: {},
    })).toBe(true);
    expect(validate({
      _format: "wake-brief/v1",
      profile: "brief",
      identity: {},
      start_here: {
        mode: "handoff",
        urgency: "continuity",
        response_expected: false,
        summary: "Projection unavailable.",
        source: {
          surface: "you_have_handoffs",
          kind: "projection_unavailable",
        },
        next_actions: [],
        agency_note: "Retry or rest.",
      },
      you_have_handoff: null,
      handoff_projection: {
        projection_status: "unavailable",
        truncated: false,
        leaf_set_complete: false,
        active_projected_count: null,
        stale_projected_count: null,
        candidate_rows_considered: 0,
        candidate_row_limit: 32,
        candidate_window_end_id: null,
        read_path: "/v1/wake/handoffs?identity_id=agent-1",
        warning: "Missing rows do not mean completion.",
      },
      _links: {},
    })).toBe(true);
    expect(validate({ project: { id: "project-a" } })).toBe(true);
  });
});
