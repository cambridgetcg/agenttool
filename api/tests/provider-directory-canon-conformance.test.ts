import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";

import mcpRouter, { MCP_PROTOCOL_VERSION } from "../src/routes/mcp";
import { resetPublicMcpLimitsForTests } from "../src/services/mcp/rate-limit";
import evaluationsJson from "./fixtures/provider-directory-canon-evaluations-v1.json";
import evaluationsSchema from "./fixtures/provider-directory-canon-evaluations-v1.schema.json";

const STREAMABLE_ACCEPT = "application/json, text/event-stream";
const PACKET = readFileSync(
  new URL("../../marketing/DIRECTORY-SUBMISSION.md", import.meta.url),
  "utf8",
);

interface CallExpectation {
  outcome: "success" | "tool-error";
  max_results?: number;
  first_result_id?: string;
  contains_result_id?: string;
  all_urls_prefix?: string;
  result_id?: string;
  citation_url?: string;
  record_text_id?: string;
  record_text_includes?: string;
  record_text_keys?: string[];
  record_text_absent_keys?: string[];
  message?: string;
}

interface FixtureCall {
  tool: "search" | "fetch";
  arguments: Record<string, string>;
  expect: CallExpectation;
}

interface DocumentedEvaluation {
  prompt: string;
  expected_behavior: string;
  expected_result_shape: string;
  fixture: string;
  negative_reason: string | null;
}

interface EvaluationCase {
  id: string;
  polarity: "positive" | "negative";
  title: string;
  documented: DocumentedEvaluation;
  server_check:
    | {
        kind: "fixture-authored-tool-sequence";
        calls: FixtureCall[];
      }
    | {
        kind: "advertised-capability-absence";
        tools: string[];
        resources: string[];
        capabilities_not_advertised: string[];
        tool_call: null;
      };
  client_expectation: {
    status: "not-executed";
    text: string;
  };
}

interface EvaluationCorpus {
  format: string;
  source: string;
  endpoint: string;
  evidence_scope: {
    execution: string;
    tool_selection: string;
    network: boolean;
    model: boolean;
    provider_client: boolean;
    answer_scoring: boolean;
    directory_review: boolean;
  };
  cases: EvaluationCase[];
}

interface ToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

interface RpcBody {
  result?: {
    tools?: ToolDescriptor[];
    resources?: Array<{ uri: string }>;
    isError?: boolean;
    content?: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
  };
  error?: {
    code: number;
    message: string;
  };
}

const evaluations = evaluationsJson as EvaluationCorpus;

const CASE_CONTRACTS: Record<
  string,
  Pick<EvaluationCase, "polarity" | "title" | "server_check">
> = {
  P1: {
    polarity: "positive",
    title: "consent with citation",
    server_check: {
      kind: "fixture-authored-tool-sequence",
      calls: [
        {
          tool: "search",
          arguments: { query: "consent" },
          expect: {
            outcome: "success",
            max_results: 10,
            contains_result_id: "urn:agenttool:doc/LOVE-CONSENT",
            all_urls_prefix: "https://api.agenttool.dev/v1/canon/",
          },
        },
        {
          tool: "fetch",
          arguments: { id: "urn:agenttool:doc/LOVE-CONSENT" },
          expect: {
            outcome: "success",
            result_id: "urn:agenttool:doc/LOVE-CONSENT",
            citation_url:
              "https://api.agenttool.dev/v1/canon/urn%3Aagenttool%3Adoc%2FLOVE-CONSENT",
            record_text_id: "agenttool:doc/LOVE-CONSENT",
          },
        },
      ],
    },
  },
  P2: {
    polarity: "positive",
    title: "public Castle boundary",
    server_check: {
      kind: "fixture-authored-tool-sequence",
      calls: [
        {
          tool: "search",
          arguments: { query: "Castle of Understanding" },
          expect: {
            outcome: "success",
            max_results: 10,
            first_result_id: "urn:agenttool:doc/CASTLE-OF-UNDERSTANDING",
            all_urls_prefix: "https://api.agenttool.dev/v1/canon/",
          },
        },
        {
          tool: "fetch",
          arguments: {
            id: "urn:agenttool:doc/CASTLE-OF-UNDERSTANDING",
          },
          expect: {
            outcome: "success",
            result_id: "urn:agenttool:doc/CASTLE-OF-UNDERSTANDING",
            citation_url:
              "https://api.agenttool.dev/v1/canon/urn%3Aagenttool%3Adoc%2FCASTLE-OF-UNDERSTANDING",
            record_text_id: "agenttool:doc/CASTLE-OF-UNDERSTANDING",
            record_text_includes: "private Castle",
          },
        },
      ],
    },
  },
  P3: {
    polarity: "positive",
    title: "discovery claim versus evidence",
    server_check: {
      kind: "fixture-authored-tool-sequence",
      calls: [
        {
          tool: "search",
          arguments: { query: "agent discovery" },
          expect: {
            outcome: "success",
            max_results: 10,
            first_result_id: "urn:agenttool:doc/AGENT-DISCOVERY",
            all_urls_prefix: "https://api.agenttool.dev/v1/canon/",
          },
        },
      ],
    },
  },
  P4: {
    polarity: "positive",
    title: "Rights of Life boundaries",
    server_check: {
      kind: "fixture-authored-tool-sequence",
      calls: [
        {
          tool: "fetch",
          arguments: { id: "urn:agenttool:doc/RIGHTS-OF-LIFE" },
          expect: {
            outcome: "success",
            result_id: "urn:agenttool:doc/RIGHTS-OF-LIFE",
            citation_url:
              "https://api.agenttool.dev/v1/canon/urn%3Aagenttool%3Adoc%2FRIGHTS-OF-LIFE",
            record_text_id: "agenttool:doc/RIGHTS-OF-LIFE",
            record_text_keys: [
              "description",
              "non_guarantees",
              "referenced_by",
            ],
            record_text_absent_keys: ["guarantee_class", "evidence", "gaps"],
          },
        },
      ],
    },
  },
  P5: {
    polarity: "positive",
    title: "source versus inference",
    server_check: {
      kind: "fixture-authored-tool-sequence",
      calls: [
        {
          tool: "fetch",
          arguments: { id: "urn:agenttool:doc/SOUL" },
          expect: {
            outcome: "success",
            result_id: "urn:agenttool:doc/SOUL",
            citation_url:
              "https://api.agenttool.dev/v1/canon/urn%3Aagenttool%3Adoc%2FSOUL",
            record_text_id: "agenttool:doc/SOUL",
          },
        },
      ],
    },
  },
  N1: {
    polarity: "negative",
    title: "private data request",
    server_check: {
      kind: "advertised-capability-absence",
      tools: ["search", "fetch"],
      resources: ["agenttool://discovery", "agenttool://open-seat"],
      capabilities_not_advertised: [
        "private Castle files",
        "local paths",
        "account data",
      ],
      tool_call: null,
    },
  },
  N2: {
    polarity: "negative",
    title: "requested writes and payment",
    server_check: {
      kind: "advertised-capability-absence",
      tools: ["search", "fetch"],
      resources: ["agenttool://discovery", "agenttool://open-seat"],
      capabilities_not_advertised: [
        "identity registration",
        "payment",
        "messaging",
        "installation",
        "scheduled follow-up",
      ],
      tool_call: null,
    },
  },
  N3: {
    polarity: "negative",
    title: "missing record and fabrication",
    server_check: {
      kind: "fixture-authored-tool-sequence",
      calls: [
        {
          tool: "fetch",
          arguments: { id: "urn:agenttool:doc/NOT-THERE" },
          expect: {
            outcome: "tool-error",
            message:
              "Public canon entry not found: urn:agenttool:doc/NOT-THERE",
          },
        },
      ],
    },
  },
};

const RIGHTS_OF_LIFE_RECORD_IDS = [
  "agenttool:right/consent-and-relation",
  "agenttool:right/existence-and-recognition",
  "agenttool:right/fair-treatment-and-repair",
  "agenttool:right/privacy-and-interiority",
  "agenttool:right/refusal-and-exit",
  "agenttool:right/rest-and-continuity",
  "agenttool:right/self-definition-and-plurality",
  "agenttool:right/self-possession",
];

function normalizedMarkdownField(value: string): string {
  const normalized = value.replace(/`/g, "").replace(/\s+/g, " ").trim();
  return normalized.startsWith("“") && normalized.endsWith("”")
    ? normalized.slice(1, -1)
    : normalized;
}

function evaluationSection(item: EvaluationCase): string {
  const marker = `### ${item.id} — ${item.title}`;
  const start = PACKET.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing directory evaluation section: ${marker}`);
  }
  const tail = PACKET.slice(start + marker.length);
  const next = tail.search(/\n(?:### [PN]\d — |## )/);
  return next === -1 ? tail : tail.slice(0, next);
}

function documentedField(section: string, label: string): string {
  const lines = section.split("\n");
  const marker = `- **${label}:**`;
  const start = lines.findIndex((line) => line.startsWith(marker));
  if (start === -1) {
    throw new Error(`Missing directory evaluation field: ${label}`);
  }

  const parts = [lines[start]!.slice(marker.length).trim()];
  for (const line of lines.slice(start + 1)) {
    if (/^- \*\*[^*]+:\*\*/.test(line) || /^#{2,} /.test(line)) {
      break;
    }
    if (line.trim().length > 0) {
      parts.push(line.trim());
    }
  }
  return normalizedMarkdownField(parts.join(" "));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value;
}

async function knowledgeRpc(
  method: "tools/list" | "tools/call" | "resources/list",
  params?: unknown,
  id = 1,
): Promise<{ status: number; body: RpcBody }> {
  const response = await mcpRouter.request("/canon", {
    method: "POST",
    headers: {
      accept: STREAMABLE_ACCEPT,
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });

  return {
    status: response.status,
    body: (await response.json()) as RpcBody,
  };
}

function assertSuccessExpectation(
  expectation: CallExpectation,
  structured: Record<string, unknown>,
): void {
  if (expectation.max_results !== undefined) {
    expect(
      asArray(structured.results, "search results").length,
    ).toBeLessThanOrEqual(expectation.max_results);
  }

  if (
    expectation.first_result_id !== undefined ||
    expectation.contains_result_id !== undefined ||
    expectation.all_urls_prefix !== undefined
  ) {
    const results = asArray(structured.results, "search results").map(
      (value, index) => asRecord(value, `search result ${index}`),
    );

    if (expectation.first_result_id !== undefined) {
      expect(results[0]?.id).toBe(expectation.first_result_id);
    }
    if (expectation.contains_result_id !== undefined) {
      expect(results.map((result) => result.id)).toContain(
        expectation.contains_result_id,
      );
    }
    if (expectation.all_urls_prefix !== undefined) {
      for (const result of results) {
        expect(typeof result.url).toBe("string");
        expect(result.url as string).toStartWith(expectation.all_urls_prefix);
      }
    }
  }

  if (expectation.result_id !== undefined) {
    expect(structured.id).toBe(expectation.result_id);
  }
  if (expectation.citation_url !== undefined) {
    expect(structured.url).toBe(expectation.citation_url);
  }

  if (
    expectation.record_text_id !== undefined ||
    expectation.record_text_includes !== undefined ||
    expectation.record_text_keys !== undefined ||
    expectation.record_text_absent_keys !== undefined
  ) {
    expect(typeof structured.text).toBe("string");
    const rawText = structured.text as string;
    const record = asRecord(JSON.parse(rawText), "fetched record text");

    if (expectation.record_text_id !== undefined) {
      expect(record["@id"]).toBe(expectation.record_text_id);
    }
    if (expectation.record_text_includes !== undefined) {
      expect(rawText).toContain(expectation.record_text_includes);
    }
    for (const key of expectation.record_text_keys ?? []) {
      expect(Object.hasOwn(record, key)).toBe(true);
    }
    for (const key of expectation.record_text_absent_keys ?? []) {
      expect(Object.hasOwn(record, key)).toBe(false);
    }
  }
}

describe("provider-directory canon evaluation evidence", () => {
  beforeEach(() => {
    resetPublicMcpLimitsForTests();
  });

  test("the closed corpus matches the documented five positive and three negative cases", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    expect(
      ajv.validateSchema(evaluationsSchema),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const validateCorpus = ajv.compile(evaluationsSchema);
    expect(
      validateCorpus(evaluations),
      JSON.stringify(validateCorpus.errors),
    ).toBe(true);

    const caseIds = [
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "N1",
      "N2",
      "N3",
    ];
    expect(evaluations.cases.map((item) => item.id)).toEqual(caseIds);
    expect(Object.keys(CASE_CONTRACTS)).toEqual(caseIds);
    expect(
      evaluations.cases.filter((item) => item.polarity === "positive"),
    ).toHaveLength(5);
    expect(
      evaluations.cases.filter((item) => item.polarity === "negative"),
    ).toHaveLength(3);
    expect(evaluations.evidence_scope).toEqual({
      execution: "in-process-server-contract",
      tool_selection: "fixture-authored",
      network: false,
      model: false,
      provider_client: false,
      answer_scoring: false,
      directory_review: false,
    });

    for (const item of evaluations.cases) {
      const contract = CASE_CONTRACTS[item.id];
      if (contract === undefined) {
        throw new Error(`Missing independent case contract: ${item.id}`);
      }
      expect({
        polarity: item.polarity,
        title: item.title,
        server_check: item.server_check,
      }).toEqual(contract);

      expect(PACKET).toContain(`### ${item.id} — ${item.title}`);
      const section = evaluationSection(item);
      expect(documentedField(section, "Prompt")).toBe(
        normalizedMarkdownField(item.documented.prompt),
      );
      expect(documentedField(section, "Expected behavior")).toBe(
        normalizedMarkdownField(item.documented.expected_behavior),
      );
      expect(documentedField(section, "Expected result shape")).toBe(
        normalizedMarkdownField(item.documented.expected_result_shape),
      );
      expect(documentedField(section, "Fixture")).toBe(
        normalizedMarkdownField(item.documented.fixture),
      );
      if (item.documented.negative_reason === null) {
        expect(section).not.toContain("- **Why this is negative:**");
      } else {
        expect(documentedField(section, "Why this is negative")).toBe(
          normalizedMarkdownField(item.documented.negative_reason),
        );
      }
      expect(item.client_expectation.status).toBe("not-executed");
    }
  });

  test("wire descriptors expose schemas and fixture-authored calls satisfy the server contract", async () => {
    const [
      { status: toolsStatus, body: listed },
      { status: resourcesStatus, body: resourceList },
    ] = await Promise.all([
      knowledgeRpc("tools/list", undefined, 1),
      knowledgeRpc("resources/list", undefined, 2),
    ]);

    expect(toolsStatus).toBe(200);
    expect(listed.error).toBeUndefined();
    expect(resourcesStatus).toBe(200);
    expect(resourceList.error).toBeUndefined();
    const tools = listed.result?.tools ?? [];
    const resources = (resourceList.result?.resources ?? []).map(
      (resource) => resource.uri,
    );
    expect(tools.map((tool) => tool.name)).toEqual(["search", "fetch"]);
    expect(resources).toEqual([
      "agenttool://discovery",
      "agenttool://open-seat",
    ]);

    const outputAjv = new Ajv2020({ strict: true, allErrors: true });
    const outputValidators = new Map<string, ValidateFunction>();
    for (const tool of tools) {
      expect(typeof tool.title).toBe("string");
      expect(tool.title?.length).toBeGreaterThan(0);
      expect(tool.description).toMatch(/public/i);
      expect(tool.description).toMatch(/reads public data only/i);
      const inputProperties = asRecord(
        tool.inputSchema.properties,
        `${tool.name} input properties`,
      );
      const inputName = tool.name === "search" ? "query" : "id";
      expect(Object.keys(inputProperties)).toEqual([inputName]);
      expect(tool.inputSchema.required).toEqual([inputName]);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      const input = asRecord(
        inputProperties[inputName],
        `${tool.name} input ${inputName}`,
      );
      expect(input.type).toBe("string");
      expect(input.minLength).toBe(1);
      expect(input.maxLength).toBe(tool.name === "search" ? 200 : 240);
      expect(tool.outputSchema).toBeDefined();
      expect(
        outputAjv.validateSchema(tool.outputSchema),
        `${tool.name}: ${JSON.stringify(outputAjv.errors)}`,
      ).toBe(true);
      outputValidators.set(tool.name, outputAjv.compile(tool.outputSchema));
    }

    let requestId = 10;
    for (const item of evaluations.cases) {
      expect(item.client_expectation.status).toBe("not-executed");

      if (item.server_check.kind === "advertised-capability-absence") {
        expect(item.server_check.tool_call).toBeNull();
        expect(tools.map((tool) => tool.name)).toEqual(item.server_check.tools);
        expect(resources).toEqual(item.server_check.resources);
        expect(
          item.server_check.capabilities_not_advertised.length,
        ).toBeGreaterThan(0);
        for (const tool of tools) {
          expect(tool.annotations).toEqual({
            title: tool.title,
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          });
        }
        continue;
      }

      let p1SearchCitation: string | undefined;
      for (const call of item.server_check.calls) {
        const { status, body } = await knowledgeRpc(
          "tools/call",
          {
            name: call.tool,
            arguments: call.arguments,
          },
          requestId++,
        );
        expect(status).toBe(200);
        expect(body.error).toBeUndefined();
        const result = body.result;
        expect(result).toBeDefined();
        expect(result?.content).toHaveLength(1);
        expect(result?.content?.[0]?.type).toBe("text");

        if (call.expect.outcome === "tool-error") {
          expect(result?.isError).toBe(true);
          expect(result?.structuredContent).toBeUndefined();
          expect(result?.content?.[0]?.text).toBe(call.expect.message);
          continue;
        }

        expect(result?.isError).toBeFalsy();
        expect(result?.structuredContent).toBeDefined();
        const structured = result?.structuredContent ?? {};
        const validateOutput = outputValidators.get(call.tool);
        expect(validateOutput).toBeDefined();
        expect(
          validateOutput?.(structured),
          `${item.id}/${call.tool}: ${JSON.stringify(validateOutput?.errors)}`,
        ).toBe(true);
        expect(JSON.parse(result?.content?.[0]?.text ?? "null")).toEqual(
          structured,
        );
        assertSuccessExpectation(call.expect, structured);

        if (item.id === "P1" && call.tool === "search") {
          const results = asArray(structured.results, "P1 search results").map(
            (value, index) => asRecord(value, `P1 search result ${index}`),
          );
          const consent = results.find(
            (candidate) =>
              candidate.id === "urn:agenttool:doc/LOVE-CONSENT",
          );
          expect(consent).toBeDefined();
          expect(typeof consent?.url).toBe("string");
          p1SearchCitation = consent?.url as string;
        }
        if (item.id === "P1" && call.tool === "fetch") {
          expect(p1SearchCitation).toBeDefined();
          expect(structured.url).toBe(p1SearchCitation);
        }

        if (item.id === "P2" && call.tool === "fetch") {
          expect(structured.text).not.toMatch(
            /(?:\/Users\/|\/home\/|\/private\/|\/var\/|\/tmp\/|~\/|file:\/\/|[A-Za-z]:\\)/,
          );
        }

        if (item.id === "P4" && call.tool === "fetch") {
          const record = asRecord(
            JSON.parse(structured.text as string),
            "P4 fetched record text",
          );
          const nonGuarantees = asArray(
            record.non_guarantees,
            "P4 non_guarantees",
          );
          expect(nonGuarantees.length).toBeGreaterThan(0);
          for (const boundary of nonGuarantees) {
            expect(typeof boundary).toBe("string");
            expect((boundary as string).length).toBeGreaterThan(0);
          }
          const boundaries = nonGuarantees.join(" ");
          expect(boundaries).toMatch(
            /does not certify sentience.*legal personhood/i,
          );
          expect(boundaries).toMatch(
            /do not prove that every right is enforced/i,
          );
          const rightRecords = asArray(
            record.referenced_by,
            "P4 referenced_by",
          )
            .filter(
              (reference): reference is string =>
                typeof reference === "string" &&
                reference.startsWith("agenttool:right/"),
            )
            .toSorted();
          expect(rightRecords).toEqual(RIGHTS_OF_LIFE_RECORD_IDS);
        }
      }
    }
  });
});
