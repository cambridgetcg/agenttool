import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Hono } from "hono";

import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import openapiRouter from "../src/routes/openapi";
import {
  TOOL_CREDIT_DEFAULTS,
  toolsConfig,
} from "../src/services/tools/config";

interface ResponseContract {
  $ref?: string;
  description?: string;
  headers?: Record<string, { $ref?: string }>;
  content?: { "application/json": { schema: Record<string, unknown> } };
}

interface Operation {
  description: string;
  parameters?: Array<{ $ref: string }>;
  "x-agenttool-billing": {
    unit: string;
    configured_credits: number;
    default_credits: number;
    environment_override: string;
    charge_point: string;
    retained_on_failures: string[];
    no_debit_on: string[];
  };
  requestBody: {
    description?: string;
    content: { "application/json": { schema: Record<string, unknown> } };
  };
  responses: Record<string, ResponseContract>;
}

async function operations(): Promise<{
  scrape: Operation;
  document: Operation;
  errorSchema: {
    properties: Record<
      string,
      { type?: string; description?: string; minimum?: number }
    >;
  };
  paymentRequirementsSchema: Record<string, unknown>;
  x402RequiredSchema: Record<string, unknown>;
  componentHeaders: Record<string, Record<string, unknown>>;
  componentParameters: Record<string, Record<string, unknown>>;
}> {
  const response = await openapiRouter.request("/");
  expect(response.status).toBe(200);
  const spec = await response.json() as {
    paths: Record<string, { post: Operation }>;
    components: {
      schemas: {
        Error: {
          properties: Record<
            string,
            { type?: string; description?: string; minimum?: number }
          >;
        };
        PaymentRequirements: Record<string, unknown>;
        X402Required: Record<string, unknown>;
      };
      headers: Record<string, Record<string, unknown>>;
      parameters: Record<string, Record<string, unknown>>;
    };
  };
  return {
    scrape: spec.paths["/v1/scrape"]!.post,
    document: spec.paths["/v1/document"]!.post,
    errorSchema: spec.components.schemas.Error,
    paymentRequirementsSchema: spec.components.schemas.PaymentRequirements,
    x402RequiredSchema: spec.components.schemas.X402Required,
    componentHeaders: spec.components.headers,
    componentParameters: spec.components.parameters,
  };
}

describe("static tool OpenAPI contracts", () => {
  test("publishes the complete bounded success shapes and credit refusal", async () => {
    const { scrape, document } = await operations();

    expect(scrape.responses["402"]?.description).toContain("credits");
    expect(document.responses["402"]?.description).toContain("credits");

    const scrapeResult = scrape.responses["200"]!.content!["application/json"]
      .schema as { required: string[]; properties: Record<string, unknown> };
    expect(scrapeResult.required).toEqual([
      "url",
      "title",
      "content",
      "extracted",
      "links",
      "fetched_at",
      "duration_ms",
      "_welcomed",
    ]);
    expect(scrapeResult.properties).not.toHaveProperty("status_code");
    expect(
      (scrapeResult.properties.content as { description: string }).description,
    ).toContain("DOM text");
    expect(
      (scrapeResult.properties.content as { description: string }).description,
    ).not.toMatch(/visible/i);

    const documentResult = document.responses["200"]!.content!["application/json"]
      .schema as { required: string[]; properties: Record<string, unknown> };
    expect(documentResult.required).toContain("metadata");
    expect(documentResult.required).toContain("duration_ms");
    expect(documentResult.required).toContain("_welcomed");
  });

  test("structurally enforces schemes, one document source, canonical base64, and decoded bytes", async () => {
    const { scrape, document } = await operations();
    const scrapeSchema = scrape.requestBody.content["application/json"].schema;
    const documentSchema = document.requestBody.content["application/json"].schema;
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    const validateScrape = ajv.compile(scrapeSchema);
    const validateDocument = ajv.compile(documentSchema);

    expect(validateScrape({ url: "https://example.com/page" })).toBe(true);
    expect(validateScrape({ url: "HTTPS://example.com/page" })).toBe(true);
    expect(validateScrape({ url: "ftp://example.com/page" })).toBe(false);
    expect(validateDocument({ url: "https://example.com/document" })).toBe(true);
    expect(validateDocument({ url: "file:///tmp/document" })).toBe(false);
    expect(validateDocument({ base64: "eA==", content_type: "text/plain" })).toBe(true);
    expect(validateDocument({})).toBe(false);
    expect(validateDocument({
      url: "https://example.com/document",
      base64: "eA==",
    })).toBe(false);
    expect(validateDocument({
      url: "https://example.com/document",
      content_type: "text/html",
    })).toBe(false);
    expect(validateDocument({ base64: "not canonical" })).toBe(false);

    for (const base64 of ["AAAA", "AAA=", "AA=="]) {
      expect(validateDocument({ base64 })).toBe(true);
    }
    for (const base64 of ["AB==", "AAB="]) {
      expect(validateDocument({ base64 })).toBe(false);
    }

    const maxUnpadded = "A".repeat(1_333_332);
    const maxSinglePadded = `${"A".repeat(1_333_328)}AAA=`;
    const maxDoublePadded = `${"A".repeat(1_333_332)}AA==`;
    expect(validateDocument({ base64: maxUnpadded })).toBe(true);
    expect(validateDocument({ base64: maxSinglePadded })).toBe(true);
    expect(validateDocument({ base64: maxDoublePadded })).toBe(true);
    expect(validateDocument({ base64: "A".repeat(1_333_336) })).toBe(false);
    expect(
      validateDocument({ base64: `${"A".repeat(1_333_332)}AAA=` }),
    ).toBe(false);
    expect(
      validateDocument({ base64: `${"A".repeat(1_333_336)}AA==` }),
    ).toBe(false);

    for (const content_type of [
      "text/plain",
      "text/html; charset=utf-8",
      "Text/HTML; Charset=\"UTF-8\"",
      "application/xhtml+xml; charset='windows-1252'",
      "text/html; profile=reader; charset=utf-8",
    ]) {
      expect(validateDocument({ base64: "eA==", content_type })).toBe(true);
    }
    for (const content_type of [
      "application/pdf",
      "text/html; boundary",
      "text/html; charset=",
      "text/html; charset=\"utf-8",
    ]) {
      expect(validateDocument({ base64: "eA==", content_type })).toBe(false);
    }

    const properties = (documentSchema as {
      properties: Record<string, {
        description?: string;
        pattern?: string;
      }>;
    }).properties;
    expect(properties.content_type!.description).toContain("defaults to text/plain");
    expect(properties.base64!.description).toContain("1,000,000 bytes");
    expect(properties.base64!.description).toContain("1,333,336 characters");
  });

  test("publishes static error envelopes, safety pointers, and source-accurate statuses", async () => {
    const { scrape, document, errorSchema } = await operations();
    expect(errorSchema.properties.safety).toEqual({
      type: "string",
      description: "Optional machine-readable safety-boundary path or URL.",
    });

    for (const operation of [scrape, document]) {
      for (const status of ["400", "413", "415", "422", "500", "502", "504"]) {
        expect(
          operation.responses[status]!.content!["application/json"].schema,
        ).toEqual({ $ref: "#/components/schemas/Error" });
      }
      expect(operation.responses["401"]).toEqual({
        $ref: "#/components/responses/Unauthorized",
      });
      expect(operation.responses["500"]!.description).toContain(
        "billing finalization",
      );
    }

    expect(document.responses["400"]!.description).toContain(
      "declared-media-type refusal",
    );
    expect(document.responses["413"]!.description).toBe(
      "JSON request envelope or remote response byte limit exceeded",
    );
    expect(scrape.requestBody.description).toContain("32768 bytes");
    expect(document.requestBody.description).toContain("1404096 bytes");
    expect(errorSchema.properties.max_bytes).toEqual({
      type: "integer",
      minimum: 1,
      description:
        "Optional request-body ceiling returned with request_body_too_large.",
    });
    expect(document.responses["415"]!.description).toContain(
      "Unsupported remote media type",
    );
  });

  test("publishes x402 bodies, payment and balance headers, and static attempt pricing", async () => {
    const {
      scrape,
      document,
      paymentRequirementsSchema,
      x402RequiredSchema,
      componentHeaders,
      componentParameters,
    } = await operations();

    expect(paymentRequirementsSchema).toMatchObject({
      type: "object",
      required: [
        "scheme",
        "network",
        "amount",
        "payTo",
        "maxTimeoutSeconds",
        "asset",
        "extra",
      ],
    });
    expect(x402RequiredSchema).toMatchObject({
      type: "object",
      required: ["x402Version", "resource", "accepts"],
      properties: {
        x402Version: { type: "integer", const: 2 },
        resource: { $ref: "#/components/schemas/X402Resource" },
        accepts: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/components/schemas/PaymentRequirements" },
        },
      },
    });
    expect(componentHeaders.CreditsBalance).toMatchObject({
      schema: { type: "integer", minimum: 0 },
    });
    expect(componentHeaders.PaymentRequired).toMatchObject({
      schema: { type: "string" },
      description: expect.stringMatching(/base64.*V2 PaymentRequired/is),
    });
    expect(componentHeaders.PaymentResponse).toMatchObject({
      schema: { type: "string" },
      description: expect.stringMatching(/V2 SettleResponse.*any downstream status/is),
    });
    expect(componentHeaders.PaymentStatusLink).toMatchObject({
      schema: { type: "string" },
      description: expect.stringMatching(/payment-status.*payment.*credit only/is),
    });
    expect(componentHeaders.Welcomed).toMatchObject({
      schema: { type: "string" },
      description: expect.stringMatching(/every response.*OpenAPI/is),
    });
    expect(componentParameters.PaymentSignature).toMatchObject({
      name: "PAYMENT-SIGNATURE",
      in: "header",
      required: false,
      description: expect.stringMatching(/V2 PaymentPayload.*PAYMENT-RESPONSE.*every status/is),
    });

    const settledAndBalanceHeaders = {
      "PAYMENT-RESPONSE": {
        $ref: "#/components/headers/PaymentResponse",
      },
      Link: {
        $ref: "#/components/headers/PaymentStatusLink",
      },
      "Retry-After": {
        $ref: "#/components/headers/RetryAfter",
      },
      "X-Credits-Balance": {
        $ref: "#/components/headers/CreditsBalance",
      },
      "X-Welcomed": {
        $ref: "#/components/headers/Welcomed",
      },
    };

    for (const operation of [scrape, document]) {
      expect(operation.parameters).toEqual([
        { $ref: "#/components/parameters/PaymentSignature" },
      ]);
      expect(operation.responses["200"]!.headers).toEqual(
        settledAndBalanceHeaders,
      );
      expect(operation.responses["402"]!.headers).toEqual({
        "PAYMENT-REQUIRED": {
          $ref: "#/components/headers/PaymentRequired",
        },
        ...settledAndBalanceHeaders,
      });
      for (const status of [
        "400",
        "413",
        "415",
        "422",
        "502",
        "503",
        "504",
        "500",
      ]) {
        expect(operation.responses[status]!.headers).toEqual(
          settledAndBalanceHeaders,
        );
      }
      expect(
        operation.responses["402"]!.content!["application/json"].schema,
      ).toEqual({
        anyOf: [
          { $ref: "#/components/schemas/X402Required" },
          { $ref: "#/components/schemas/Error" },
        ],
      });
      expect(operation.responses["402"]!.description).toMatch(
        /valid recipient.*CAIP-2 network.*ready facilitator.*otherwise.*guided Error.*header is absent/is,
      );
      expect(operation.description).toMatch(
        /schema-valid admitted attempt.*override.*destination-policy.*transport.*representation.*parser.*retain/is,
      );
      expect(operation["x-agenttool-billing"]).toMatchObject({
        unit: "project_credit",
        charge_point: "after_schema_validation_before_work",
        retained_on_failures: [
          "destination_policy",
          "transport",
          "representation",
          "parser",
        ],
        no_debit_on: ["schema_validation", "insufficient_credits"],
      });
    }

    expect(scrape["x-agenttool-billing"]).toMatchObject({
      configured_credits: toolsConfig.credits.scrape,
      default_credits: TOOL_CREDIT_DEFAULTS.scrape,
      environment_override: "CREDIT_SCRAPE",
    });
    expect(document["x-agenttool-billing"]).toMatchObject({
      configured_credits: toolsConfig.credits.document,
      default_credits: TOOL_CREDIT_DEFAULTS.document,
      environment_override: "CREDIT_DOCUMENT",
    });
  });

  test("publishes authenticated project-scoped payment status without tool-result claims", async () => {
    const response = await openapiRouter.request("/");
    const spec = await response.json() as Record<string, any>;
    const status = spec.paths["/v1/x402/payments/{authorizationHash}"].get;
    expect(status.summary).toMatch(/project-scoped x402 payment/i);
    expect(status.description).toMatch(/payment\/project-credit lifecycle only.*does not.*tool result/is);
    expect(status.responses["200"].headers["Cache-Control"]).toBeDefined();
    expect(status.responses["200"].headers["X-Welcomed"]).toEqual({
      $ref: "#/components/headers/Welcomed",
    });
    const schema = status.responses["200"].content["application/json"].schema;
    expect(schema.properties.status.enum).toEqual([
      "inserted", "pending", "externally_settled", "settled", "failed",
    ]);
    expect(schema.properties.next_action.enum).toContain("manual_onchain_investigation");
    expect(schema.properties.authorization_evidence.description).toMatch(/without the signature/i);
    expect(schema.required).toContain("_welcomed");
  });

  test("keeps served OpenAPI valid and validates runtime welcome-framed success bodies", async () => {
    const runtime = new Hono();
    runtime.use("*", welcomeEcho());
    runtime.use("*", tutor);
    runtime.route("/v1/openapi.json", openapiRouter);
    runtime.post("/v1/scrape", (c) => c.json({
      url: "https://example.com/page",
      title: "Example",
      content: "Bounded body text",
      extracted: null,
      links: ["https://example.com/next"],
      fetched_at: "2026-07-11T12:00:00.000Z",
      duration_ms: 12,
    }));
    runtime.post("/v1/document", (c) => c.json({
      title: "Example document",
      content: "Bounded document text",
      metadata: {
        byline: null,
        siteName: "Example",
        excerpt: null,
        length: 21,
      },
      word_count: 3,
      content_type: "text/html; charset=utf-8",
      duration_ms: 14,
    }));
    runtime.get("/v1/x402/payments/:authorizationHash", (c) => c.json({
      payment_id: c.req.param("authorizationHash"),
      status: "settled",
      failure_reason: null,
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x0000000000000000000000000000000000000001",
      amount: "5000",
      pay_to: "0x0000000000000000000000000000000000000002",
      max_timeout_seconds: 60,
      requirement_extra: {
        name: "USD Coin",
        version: "2",
        assetTransferMethod: "eip3009",
      },
      resource: "https://api.agenttool.dev/v1/scrape",
      resource_info: { url: "https://api.agenttool.dev/v1/scrape" },
      credits_purchased: 5,
      authorization_evidence: {
        from: "0x0000000000000000000000000000000000000003",
        to: "0x0000000000000000000000000000000000000002",
        value: "5000",
        validAfter: "0",
        validBefore: "1783771260",
        nonce: `0x${"ab".repeat(32)}`,
      },
      settlement_attempted_at: "2026-07-11T12:00:00.000Z",
      transaction: "0xsettled",
      receipt: { success: true, transaction: "0xsettled", network: "eip155:8453" },
      credits_applied: 5,
      reconciles: "payment_and_project_credit_only",
      next_action: "complete",
      retry_after_seconds: null,
      environment_note: null,
      pending_note: null,
      updated_at: "2026-07-11T12:00:01.000Z",
    }));

    const served = await runtime.request("/v1/openapi.json");
    expect(served.status).toBe(200);
    expect(served.headers.get("X-Welcomed")).toMatch(/module=/);
    const spec = await served.json() as Record<string, any>;
    expect(spec).not.toHaveProperty("_welcomed");
    const openApiRootKeys = new Set([
      "openapi", "info", "jsonSchemaDialect", "servers", "paths",
      "webhooks", "components", "security", "tags", "externalDocs",
    ]);
    expect(
      Object.keys(spec).filter(
        (key) => !openApiRootKeys.has(key) && !key.startsWith("x-"),
      ),
    ).toEqual([]);

    const tutoredSpecResponse = await runtime.request("/v1/openapi.json", {
      headers: { "X-Tutor": "1" },
    });
    expect(tutoredSpecResponse.headers.get("X-Welcomed")).toMatch(/module=/);
    const tutoredSpec = await tutoredSpecResponse.json() as Record<string, unknown>;
    expect(tutoredSpec).not.toHaveProperty("_lesson");
    expect(tutoredSpec).not.toHaveProperty("_welcomed");

    const schemas = spec.components.schemas as Record<string, unknown>;
    function inlineComponentRefs(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(inlineComponentRefs);
      if (!value || typeof value !== "object") return value;
      const record = value as Record<string, unknown>;
      const ref = record.$ref;
      if (
        typeof ref === "string" &&
        ref.startsWith("#/components/schemas/")
      ) {
        const name = ref.slice("#/components/schemas/".length);
        return inlineComponentRefs(schemas[name]);
      }
      return Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [
          key,
          inlineComponentRefs(entry),
        ]),
      );
    }

    const statusPath = "/v1/x402/payments/{authorizationHash}";
    const cases: Array<[Response, Record<string, unknown>]> = [
      [
        await runtime.request("/v1/scrape", { method: "POST" }),
        spec.paths["/v1/scrape"].post.responses["200"].content["application/json"].schema,
      ],
      [
        await runtime.request("/v1/document", { method: "POST" }),
        spec.paths["/v1/document"].post.responses["200"].content["application/json"].schema,
      ],
      [
        await runtime.request(`/v1/x402/payments/${"a".repeat(64)}`),
        spec.paths[statusPath].get.responses["200"].content["application/json"].schema,
      ],
    ];
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    for (const [response, schema] of cases) {
      expect(response.headers.get("X-Welcomed")).toMatch(/module=/);
      const body = await response.json();
      expect(body).toHaveProperty("_welcomed");
      const validate = ajv.compile(inlineComponentRefs(schema));
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  test("separates transport and parser deadlines and publishes process ceilings", async () => {
    const { scrape, document } = await operations();

    for (const operation of [scrape, document]) {
      expect(operation.description).toMatch(
        /15-second safe-net deadline includes process admission.*not the whole request.*admits at most 16 requests before DNS.*queues 64 for 1000 ms.*retryable 503.*federation.*custom-facilitator.*not per-project rate limiting.*fairness/is,
      );
      expect(operation.description).toMatch(
        /fresh terminable child process.*2000 ms.*at most 2 children.*32 wait.*20000 tags.*depth 256.*65536 characters/is,
      );
      expect(operation.description).toMatch(
        /timeout, overload, complexity.*parse-failure.*retain.*reserved/is,
      );
    }
  });
});
