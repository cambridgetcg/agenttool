/** A missing optional inventory cannot erase identity or become observed zero. */
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { Hono } from "hono";
import Ajv2020 from "ajv/dist/2020";
import type { ProjectContext } from "../src/auth/middleware";
import { createWakeOptionalReads } from "../src/services/wake/optional-reads";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const PRIVATE_ERROR = "PRIVATE_DRIVER_QUERY_AND_CREDENTIAL_CANARY";
const project = { id: PROJECT_ID, name: "inventory-fixture", credits: 0 };
const identity = {
  id: IDENTITY_ID,
  projectId: PROJECT_ID,
  did: "did:at:test/inventory-fixture",
  displayName: "Inventory fixture",
  capabilities: [],
  metadata: {},
  expression: {},
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  wakeVersion: 1,
  wakeObservationCount: 0,
  trustScore: 0,
  authorityRootPublicKey: null,
  authoritySequence: 0,
  substrateKind: "llm",
  signingScheme: "ed25519",
  modalities: [],
  proxyForIdentityId: null,
  proxyKind: "none",
};
let unavailableTables = new Set<string>();
let warn: ReturnType<typeof spyOn>;

function query() {
  let table = "";
  const chain = {
    from(value: Parameters<typeof getTableName>[0]) { table = getTableName(value); return chain; },
    where() { return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    offset() { return chain; },
    leftJoin() { return chain; },
    innerJoin() { return chain; },
    groupBy() { return chain; },
    then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
      const result = unavailableTables.has(table)
        ? Promise.reject(new Error(PRIVATE_ERROR))
        : Promise.resolve(table === "projects" ? [project] : table === "identities" ? [identity] : []);
      return result.then(resolve, reject);
    },
  };
  return chain;
}

mock.module("../src/db/client", () => ({
  db: { select: query, execute: async () => [] },
}));

const { buildWakeBundle } = await import("../src/services/wake/build");
const { default: wakeRoutes } = await import("../src/routes/wake");
const { buildWakeBrief } = await import("../src/services/wake/brief");
const { renderWakeMarkdown } = await import("../src/services/wake/markdown");
const { renderWakeForProvider } = await import("../src/services/wake/providers");
const { _setWallsStatusForTests } = await import("../src/services/wake/walls-status");
const { default: openapiRoutes } = await import("../src/routes/openapi");
const { apiCors } = await import("../src/middleware/api-cors");

function app() {
  const app = new Hono<ProjectContext>();
  app.use("*", apiCors());
  app.use("*", async (c, next) => {
    c.set("project", project as never);
    c.set("apiKeyId", "33333333-3333-4333-8333-333333333333");
    c.set("clientSource", "http");
    await next();
  });
  app.route("/v1/wake", wakeRoutes);
  return app;
}

beforeEach(() => {
  unavailableTables = new Set();
  warn?.mockRestore();
  warn = spyOn(console, "warn").mockImplementation(() => {});
  _setWallsStatusForTests({ intact: true, probed_at_unix_ms: 1, probes: [], declared: [] });
});
afterAll(() => warn?.mockRestore());

describe("bounded optional wake inventories", () => {
  test("observed empty inventories retain the existing payload shape", async () => {
    const reads = createWakeOptionalReads();
    expect(await reads.read("wallets", async () => [])).toEqual([]);
    expect(reads.metadata()).toEqual({});
    const result = await buildWakeBundle(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture identity missing");
    expect(result.bundle._degradation).toBeUndefined();
    expect(buildWakeBrief(result.bundle).state_counts.wallets).toBe(0);
  });

  test("failures are request-local, deterministic, and reveal no exception details", async () => {
    const failed = createWakeOptionalReads();
    const other = createWakeOptionalReads();
    await Promise.all([
      failed.read("bearers", async () => { throw new Error(PRIVATE_ERROR); }),
      failed.read("wallets", () => { throw new Error(PRIVATE_ERROR); }),
      other.read("vault", async () => []),
    ]);
    expect(failed.metadata()._degradation?.unavailable_sections).toEqual(["wallets", "bearers"]);
    expect(other.metadata()).toEqual({});
    expect(JSON.stringify(failed.metadata())).not.toContain(PRIVATE_ERROR);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PRIVATE_ERROR);
  });

  for (const [section, table] of [["wallets", "wallets"], ["vault", "vault_secrets"], ["bearers", "api_keys"]] as const) {
    test(`${section} failure preserves both real composers and announces the missing inventory`, async () => {
      unavailableTables.add(table);
      const result = await buildWakeBundle(PROJECT_ID);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("fixture identity missing");
      expect(result.bundle.agent.id).toBe(IDENTITY_ID);
      expect(result.bundle._degradation?.unavailable_sections).toEqual([section]);

      const response = await app().request("/v1/wake");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(response.headers.get("X-Wake-Unavailable")).toBe(section);
      expect(body._degradation.unavailable_sections).toEqual([section]);
      expect(JSON.stringify(body)).not.toContain(PRIVATE_ERROR);
      if (section === "wallets") expect(body.you_own.projection_status).toBe("unavailable");
      if (section === "vault") expect(body.you_keep.projection_status).toBe("unavailable");
      if (section === "bearers") {
        expect(body.you_protect.bearers).toBeNull();
        expect(body.you_protect.note).not.toContain("Healthy");
        expect(body.you_protect.note).toContain("unavailable");
      }
    });
  }

  test("brief and every provider preserve unknown inventory rather than observed zero", async () => {
    unavailableTables = new Set(["wallets", "vault_secrets", "api_keys"]);
    const result = await buildWakeBundle(PROJECT_ID);
    if (!result.ok) throw new Error("fixture identity missing");
    const brief = buildWakeBrief(result.bundle);
    expect(brief.state_counts.wallets).toBeNull();
    expect(brief.start_here.mode).toBe("attention");
    expect(brief.start_here.source.kind).toBe("inventory_unavailable");
    const full = renderWakeMarkdown(result.bundle);
    expect(full).toContain("**Wallets**: unavailable");
    expect(full).toContain("**Vault entries**: unavailable");
    expect(full).not.toContain("**Wallets**: 0");
    const compact = renderWakeMarkdown(result.bundle, { profile: "brief" });
    expect(compact).toContain("wallets unavailable");
    expect(compact).not.toContain("0 wallets");
    for (const provider of ["anthropic", "openai", "gemini", "cohere", "xenoform"] as const) {
      expect(JSON.stringify(renderWakeForProvider(result.bundle, provider))).toContain("unavailable");
      expect(JSON.stringify(renderWakeForProvider(result.bundle, provider, { profile: "brief" }))).toContain("unavailable");
    }
    const math = await app().request("/v1/wake?format=math");
    expect(math.status).toBe(503);
    const refusal = await math.json();
    expect(refusal.error).toBe("wake_projection_unavailable");
    expect(refusal.docs).toBe("https://docs.agenttool.dev/WAKE.md");
    expect(refusal.axiom_id).toBe(11);
    expect(refusal.hint).toContain("do not interpret placeholders as observed zero");
    expect(math.headers.get("X-Wake-Unavailable")).toBe("wallets, vault, bearers");
  });

  test("lossy custom formats and subkey reads retain the unavailable-inventory boundary", async () => {
    unavailableTables.add("wallets");
    for (const format of ["haiku", "fortune", "joke", "soap-opera", "adventure", "zen", "meme", "memo", "wake"]) {
      const response = await app().request(`/v1/wake?format=${format}`, {
        headers: { Origin: "https://app.agenttool.dev" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Wake-Unavailable")).toBe("wallets");
      expect(response.headers.get("Access-Control-Expose-Headers")).toContain("X-Wake-Unavailable");
    }
    for (const suffix of ["", "?format=xenoform"]) {
      const response = await app().request(`/v1/wake/wallets${suffix}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Wake-Unavailable")).toBe("wallets");
      const body = await response.json();
      expect(body.wallets).toEqual([]);
      expect(body._degradation.unavailable_sections).toEqual(["wallets"]);
    }
  });

  test("an observed urgent action keeps priority while the inventory warning remains visible", async () => {
    unavailableTables.add("wallets");
    const result = await buildWakeBundle(PROJECT_ID);
    if (!result.ok) throw new Error("fixture identity missing");
    result.bundle.attention = {
      count: 1,
      items: [{ kind: "invocation_sla_breach", severity: "action", count: 1, summary: "Review an invocation", next: "GET /v1/invocations", next_actions: [] }],
    };
    const brief = buildWakeBrief(result.bundle);
    expect(brief.start_here.source.kind).toBe("invocation_sla_breach");
    expect(brief.start_here.response_expected).toBe(true);
    expect(renderWakeMarkdown(result.bundle, { profile: "brief" })).toContain("Wake inventory unavailable: wallets");
  });

  test("published OpenAPI admits real partial full/brief/503 responses and rejects invalid wallet counts", async () => {
    unavailableTables.add("wallets");
    const spec = await (await openapiRoutes.request("/")).json();
    const contract = spec.paths["/v1/wake"].get.responses;
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile({
      ...contract["200"].content["application/json"].schema,
      components: spec.components,
    });
    const full = await (await app().request("/v1/wake")).json();
    const briefResponse = await app().request("/v1/wake?profile=brief");
    expect(briefResponse.headers.get("X-Wake-Unavailable")).toBe("wallets");
    const brief = await briefResponse.json();
    expect(validate(full)).toBe(true);
    expect(validate(brief)).toBe(true);
    expect(brief.state_counts.wallets).toBeNull();
    expect(validate({ ...brief, state_counts: { ...brief.state_counts, wallets: "unknown" } })).toBe(false);
    expect(validate({ ...brief, state_counts: { ...brief.state_counts, wallets: -1 } })).toBe(false);
    const validateUnavailable = ajv.compile({
      ...contract["503"].content["application/json"].schema,
      components: spec.components,
    });
    expect(validateUnavailable(await (await app().request("/v1/wake?format=math")).json())).toBe(true);
  });
});
