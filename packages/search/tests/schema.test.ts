import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import telescopeSchema from "@agenttool/telescope/report.schema.json" with {
  type: "json",
};
import { SearchEngine } from "../src/engine.js";
import { SearchSession } from "../src/session.js";
import type {
  SearchProvider,
  ProviderCandidate,
} from "../src/types.js";
import { telescopeReport } from "./helpers.js";

const responseSchema = JSON.parse(
  await readFile(
    join(import.meta.dir, "../schema/agenttool-search-v0.1.schema.json"),
    "utf8",
  ),
);
const inspectionSchema = JSON.parse(
  await readFile(
    join(
      import.meta.dir,
      "../schema/agenttool-search-inspection-v0.1.schema.json",
    ),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateResponse = ajv.compile(responseSchema);
const validateInspection = ajv.compile(inspectionSchema);

function provider(
  id: string,
  candidates: readonly ProviderCandidate[],
): SearchProvider {
  return {
    id,
    kinds: ["agent"],
    boundary: {
      mode: "fixture",
      credentials: "omitted",
      query_disclosed: true,
      connected_address_pinning: false,
      statement: "Fixture provider with no connected-address pinning.",
    },
    async search() {
      return {
        results: candidates,
        observation: {
          request_url: `https://${id}.example/search?q=%5Bredacted%5D`,
          final_url: `https://${id}.example/search?q=%5Bredacted%5D`,
          status: 200,
          media_type: "application/json",
          bytes: 2,
          sha256: "a".repeat(64),
          boundary_codes: ["fixture"],
        },
      };
    },
  };
}

function candidate(
  providerNumber: number,
): ProviderCandidate {
  return {
    kind: "agent",
    title: `Fixture agent ${providerNumber}`,
    summary: "Untrusted remote summary.",
    target_url: "https://agent.example.com/path?token=private",
    capabilities: Array.from(
      { length: 32 },
      (_value, index) => `p${providerNumber}-capability-${index}`,
    ),
    claims: Array.from({ length: 32 }, (_value, index) => ({
      key: `p${providerNumber}.claim.${index}`,
      value: `claim ${index}`,
      basis: "publisher_assertion" as const,
    })),
  };
}

describe("static search schemas", () => {
  test("embeds the exact Telescope report contract", () => {
    expect(inspectionSchema.properties.report).toEqual(telescopeSchema);
  });

  test("validate canonical merged engine and inspection output", async () => {
    let id = 0;
    const engine = new SearchEngine(
      [
        provider("alpha", [candidate(1)]),
        provider("beta", [candidate(2)]),
      ],
      {
        sessionId: "schema-session",
        randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        now: () => new Date("2026-07-26T12:00:00.000Z"),
      },
    );
    const response = await engine.search({ query: "fixture", limit: 1 });

    expect(response.results[0]?.capabilities).toHaveLength(32);
    expect(response.results[0]?.claims).toHaveLength(32);
    expect(validateResponse(response)).toBe(true);
    expect(validateResponse.errors).toBeNull();
    const providerClaim = structuredClone(response);
    providerClaim.results[0]!.claims[0]!.basis = "provider_assertion";
    expect(validateResponse(providerClaim)).toBe(true);

    const session = new SearchSession(
      engine,
      { async open() {} },
      {
        inspect: async (origin) => telescopeReport(origin),
        now: () => new Date("2026-07-26T12:01:00.000Z"),
      },
    );
    const resultId = response.results[0]?.result_id;
    if (!resultId) throw new Error("missing fixture result");
    const inspection = await session.inspect({
      session_id: response.session_id,
      result_id: resultId,
    });

    expect(validateInspection(inspection)).toBe(true);
    expect(validateInspection.errors).toBeNull();
  });

  test("rejects authority drift and public raw targets", async () => {
    const engine = new SearchEngine(
      [provider("alpha", [candidate(1)])],
      {
        sessionId: "schema-session",
        randomUUID: () => crypto.randomUUID(),
        now: () => new Date("2026-07-26T12:00:00.000Z"),
      },
    );
    const response = await engine.search({ query: "fixture", limit: 1 });
    const drifted = structuredClone(response) as unknown as Record<
      string,
      unknown
    >;
    drifted.authority = "provider";
    expect(validateResponse(drifted)).toBe(false);

    const exposed = structuredClone(response);
    Object.assign(exposed.results[0]!, {
      target_url: "https://agent.example/path?token=private",
    });
    expect(validateResponse(exposed)).toBe(false);
  });

  test("requires one correctly paired inspect, plan, and open follow-up", async () => {
    const engine = new SearchEngine(
      [provider("alpha", [candidate(1)])],
      {
        sessionId: "schema-session",
        randomUUID: () => crypto.randomUUID(),
        now: () => new Date("2026-07-26T12:00:00.000Z"),
      },
    );
    const response = await engine.search({ query: "fixture", limit: 1 });

    const mismatched = structuredClone(response) as unknown as {
      results: Array<{
        followups: Array<{ operation: string }>;
      }>;
    };
    mismatched.results[0]!.followups[0]!.operation = "browser_open_result";
    expect(validateResponse(mismatched)).toBe(false);

    const duplicated = structuredClone(response) as unknown as {
      results: Array<{
        followups: Array<Record<string, unknown>>;
      }>;
    };
    const inspect = structuredClone(duplicated.results[0]!.followups[0]!);
    duplicated.results[0]!.followups = [
      structuredClone(inspect),
      structuredClone(inspect),
      inspect,
    ];
    expect(validateResponse(duplicated)).toBe(false);
  });
});
