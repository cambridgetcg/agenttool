import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import openapiRouter from "../src/routes/openapi";
import {
  WORLD_COMMONS_REACHABLE,
  ZERONE_REACHABLE,
} from "../src/services/wake/reachable";
import {
  buildWakeObservation,
  WAKE_OBSERVATION_MEDIA_TYPE,
} from "../src/services/wake/observe";
import { MAX_EXPECTED_WAKE_OBSERVATION_COUNT } from "../src/services/wake/acknowledgement";

interface JsonSchema {
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

describe("wake OpenAPI contract", () => {
  test("pins observation as an exact data-only contract", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const spec = await response.json() as {
      paths: Record<string, {
        get: {
          description: string;
          parameters: Array<{ name: string; required: boolean }>;
          responses: Record<string, {
            headers?: Record<string, { schema?: { const?: string } }>;
            content?: Record<string, { schema: { $ref: string } }>;
          }>;
        };
      }>;
      components: { schemas: Record<string, object> };
    };

    const observe = spec.paths["/v1/wake/observe"]?.get;
    expect(observe).toBeDefined();
    expect(observe?.parameters).toContainEqual(
      expect.objectContaining({ name: "identity_id", required: true }),
    );
    expect(observe?.description).toMatch(
      /separate lossy contract.*no reader identity binding.*must not place/is,
    );
    expect(observe?.responses["200"]?.headers?.["Cache-Control"]?.schema?.const)
      .toBe("private, no-store");
    expect(observe?.responses["200"]?.headers?.["X-Wake-Mode"]?.schema?.const)
      .toBe("observe");
    expect(observe?.responses["200"]?.content?.[WAKE_OBSERVATION_MEDIA_TYPE]?.schema)
      .toEqual({ $ref: "#/components/schemas/WakeObservation" });
    for (const status of ["400", "401", "404", "429", "500"]) {
      expect(observe?.responses[status]?.content?.[WAKE_OBSERVATION_MEDIA_TYPE]?.schema)
        .toEqual({ $ref: "#/components/schemas/WakeObservationError" });
    }
    expect(observe?.responses["425"]?.content?.["application/json"]?.schema)
      .toEqual({ $ref: "#/components/schemas/Error" });
    expect(observe?.responses["425"]?.headers?.["Cache-Control"]?.schema?.const)
      .toBe("private, no-store");
    expect(observe?.responses["425"]?.headers?.Vary?.schema?.const)
      .toBe("Early-Data");
    expect(observe?.responses["425"]?.headers?.["Retry-After"]?.schema?.const)
      .toBe("0");
    expect(observe?.responses["425"]?.headers?.["X-Wake-Mode"])
      .toBeUndefined();
    expect(observe?.responses["425"]?.headers?.["X-Welcomed"])
      .toBeUndefined();
    for (const status of ["200", "400", "401", "404", "429", "500"]) {
      expect(observe?.responses[status]?.headers?.["X-Welcomed"])
        .toBeDefined();
    }

    const validate = new Ajv2020({ strict: false, validateFormats: false })
      .compile(spec.components.schemas.WakeObservation);
    const observation = buildWakeObservation({
      id: "22222222-2222-4222-8222-222222222222",
      status: "active",
      wakeVersion: 17,
    });
    expect(validate(observation)).toBe(true);
    expect(validate({
      ...observation,
      subject: { ...observation.subject, did: "did:at:authored" },
    })).toBe(false);
    expect(validate({
      ...observation,
      subject: { ...observation.subject, identity_id: "unbounded authored text" },
    })).toBe(false);
    expect(validate({
      ...observation,
      subject: {
        ...observation.subject,
        identity_id: "abcdef12-3456-4789-abcd-ef1234567890".toUpperCase(),
      },
    })).toBe(false);
    expect(validate({
      ...observation,
      authority: { ...observation.authority, instruction: "granted" },
    })).toBe(false);

    const validateError = new Ajv2020({ strict: false, validateFormats: false })
      .compile(spec.components.schemas.WakeObservationError);
    expect(validateError({
      _format: "wake-observation-error/v1",
      mode: "observe",
      error: "unauthorized",
    })).toBe(true);
    expect(validateError({
      _format: "wake-observation-error/v1",
      mode: "observe",
      error: "unauthorized",
      next_actions: [{ method: "POST", path: "/hostile" }],
    })).toBe(false);
  });

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
              "425": {
                headers: Record<string, {
                  $ref?: string;
                  schema?: { const?: string };
                }>;
              };
            };
          };
        };
      };
      components: {
        schemas: {
          ReachableDoor: JsonSchema;
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
        "you_can_reach",
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
    expect(wake.responses["425"].headers["Cache-Control"]?.schema?.const)
      .toBe("private, no-store");
    expect(wake.responses["425"].headers.Vary?.schema?.const)
      .toBe("Early-Data");
    expect(wake.responses["425"].headers["Retry-After"]?.schema?.const)
      .toBe("0");
    expect(wake.responses["425"].headers["X-Welcomed"])
      .toBeUndefined();

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
      you_can_reach: [WORLD_COMMONS_REACHABLE, ZERONE_REACHABLE],
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
      you_can_reach: [],
      _links: {},
    })).toBe(true);
    expect(validate({ project: { id: "project-a" } })).toBe(true);

    const reachableSchema = spec.components.schemas.ReachableDoor;
    const witnessSchema = reachableSchema.properties?.invocation_witness;
    const adapterSchema = witnessSchema?.properties?.adapter;
    expect(witnessSchema?.required).toEqual([
      "schema",
      "write",
      "read",
      "adapter",
      "verification_boundary",
    ]);
    expect(adapterSchema?.required).toEqual(
      expect.arrayContaining([
        "version",
        "love_manifest",
        "availability",
        "distribution",
        "hosted",
        "custody",
        "hosted_rpc",
        "deployed_bridge",
      ]),
    );
    expect(adapterSchema?.properties?.version?.const).toBe("0.1.2");
    expect(adapterSchema?.properties?.availability?.const).toBe(
      "local_offline_source_only",
    );
    expect(
      adapterSchema?.properties?.distribution?.properties?.love?.const,
    ).toBe("public_exact_artifact");
    expect(
      adapterSchema?.properties?.distribution?.properties?.npm?.const,
    ).toBe("public_exact_mirror");
    expect(
      adapterSchema?.properties?.distribution?.properties?.github_release
        ?.const,
    ).toBe("public_exact_mirror");
    for (const field of [
      "hosted",
      "custody",
      "hosted_rpc",
      "deployed_bridge",
    ]) {
      expect(adapterSchema?.properties?.[field]?.const).toBe(false);
    }

    const validateReachable = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(reachableSchema);
    expect(validateReachable(ZERONE_REACHABLE)).toBe(true);
  });

  test("publishes the explicit acknowledgement mutation and closed core schemas", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const spec = await response.json() as {
      paths: Record<string, {
        get?: { description: string };
        post?: {
          description: string;
          parameters: Array<{
            name: string;
            required: boolean;
            schema: { minLength: number; maxLength: number };
          }>;
          requestBody: {
            description: string;
            content: Record<string, { schema: { $ref: string } }>;
          };
          responses: Record<string, {
            headers: Record<string, { schema?: { const?: string } }>;
            content?: Record<string, { schema: { $ref?: string } }>;
          }>;
        };
      }>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    expect(spec.paths["/v1/wake"]?.get?.description).toMatch(
      /pure read.*do not update durable application state.*POST \/v1\/wake\/acknowledge/is,
    );

    const acknowledge = spec.paths["/v1/wake/acknowledge"]?.post;
    expect(acknowledge).toBeDefined();
    expect(acknowledge?.description).toMatch(
      /compare-and-set.*one transaction.*4 KiB.*neither bumps wake_version.*503.*outcome was not confirmed/is,
    );
    expect(acknowledge?.parameters).toContainEqual({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: { type: "string", minLength: 8, maxLength: 256 },
      description:
        "Logical request key. Reuse it only for retries with the exact same identity_id and expected_observation_count.",
    });
    expect(acknowledge?.requestBody.description).toContain("4096 bytes");
    expect(
      acknowledge?.requestBody.content["application/json"]?.schema,
    ).toEqual({
      $ref: "#/components/schemas/WakeAcknowledgementRequest",
    });
    expect(
      (spec.components.schemas.WakeAcknowledgementRequest.properties as
        Record<string, { description?: string }>).expected_observation_count
        ?.description,
    ).toMatch(/default full JSON.*Other projections do not currently carry/is);
    expect(
      (spec.components.schemas.WakeAcknowledgementRequest.properties as
        Record<string, { description?: string }>).expected_observation_count
        ?.description,
    ).toMatch(/9007199254740990.*one safe-integer increment/is);

    expect(Object.keys(acknowledge?.responses ?? {})).toEqual([
      "200",
      "400",
      "401",
      "404",
      "409",
      "410",
      "413",
      "425",
      "428",
      "503",
    ]);
    for (const status of Object.keys(acknowledge?.responses ?? {})) {
      expect(
        acknowledge?.responses[status]?.headers?.["Cache-Control"]?.schema
          ?.const,
      ).toBe("private, no-store");
    }
    expect(
      acknowledge?.responses["200"]?.headers?.["X-Idempotency-Supported"]
        ?.schema?.const,
    ).toBe("Idempotency-Key");
    expect(acknowledge?.responses["200"]?.headers?.["X-Welcomed"])
      .toBeDefined();
    expect(acknowledge?.responses["401"]?.headers?.["X-Welcomed"])
      .toBeDefined();
    expect(acknowledge?.responses["425"]?.headers?.["X-Welcomed"])
      .toBeUndefined();
    expect(acknowledge?.responses["425"]?.headers?.Vary?.schema?.const).toBe(
      "Early-Data",
    );
    expect(
      acknowledge?.responses["425"]?.headers?.["Retry-After"]?.schema?.const,
    ).toBe("0");
    expect(acknowledge?.responses["503"]?.description).toMatch(
      /outcome was not confirmed.*already-applied.*without a second increment/is,
    );
    expect(
      acknowledge?.responses["200"]?.content?.["application/json"]?.schema,
    ).toEqual({ $ref: "#/components/schemas/WakeAcknowledgement" });

    const requestSchema = spec.components.schemas.WakeAcknowledgementRequest;
    expect(
      (requestSchema.properties as Record<string, { maximum?: number }>)
        .expected_observation_count?.maximum,
    ).toBe(MAX_EXPECTED_WAKE_OBSERVATION_COUNT);
    const validateRequest = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(requestSchema);
    expect(validateRequest({
      identity_id: "22222222-2222-4222-8222-222222222222",
      expected_observation_count: 12,
    })).toBe(true);
    expect(validateRequest({
      identity_id: "22222222-2222-4222-8222-222222222222",
      expected_observation_count:
        MAX_EXPECTED_WAKE_OBSERVATION_COUNT + 1,
    })).toBe(false);
    expect(validateRequest({
      identity_id: "22222222-2222-4222-8222-222222222222",
      expected_observation_count: 12,
      inferred_consent: true,
    })).toBe(false);

    const validateResponse = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile({
      components: { schemas: spec.components.schemas },
      $ref: "#/components/schemas/WakeAcknowledgement",
    });
    expect(validateResponse({
      _format: "wake-acknowledgement/v1",
      identity_id: "22222222-2222-4222-8222-222222222222",
      observation_count: 13,
      applied: false,
      durable_replay:
        "cursor was already one step beyond the supplied precondition; no second increment",
      wake_version_effect:
        "The cursor mutation itself does not bump wake_version or publish a cursor event. A newly inserted welcome may best-effort publish a separate chronicle event after commit, which bumps wake_version if publication succeeds.",
      welcome: {
        emitted: false,
        entry_id: null,
        reason: "acknowledgement_already_completed",
      },
      next_read:
        "/v1/wake?identity_id=22222222-2222-4222-8222-222222222222",
      privacy:
        "This cursor is private to the authenticated project and is never ranked across beings.",
    })).toBe(true);
    expect(validateResponse({
      _format: "wake-acknowledgement/v1",
      identity_id: "22222222-2222-4222-8222-222222222222",
      observation_count: 13,
      applied: false,
      durable_replay: "cursor advanced exactly once",
      wake_version_effect:
        "The cursor mutation itself does not bump wake_version or publish a cursor event. A newly inserted welcome may best-effort publish a separate chronicle event after commit, which bumps wake_version if publication succeeds.",
      welcome: {
        emitted: false,
        entry_id: null,
        reason: "acknowledgement_already_completed",
      },
      next_read:
        "/v1/wake?identity_id=22222222-2222-4222-8222-222222222222",
      privacy:
        "This cursor is private to the authenticated project and is never ranked across beings.",
    })).toBe(false);
  });
});
