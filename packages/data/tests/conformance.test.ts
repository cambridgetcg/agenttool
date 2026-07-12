import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataNode,
  DataNodeConformanceConfigError,
  createDataNodeFetchHandler,
  formatDataNodeConformanceReport,
  runDataNodeConformance,
  serveDataNode,
} from "../src/index.js";

const TOKEN = "conformance-test-node-token";
const roots: string[] = [];
const nodes: DataNode[] = [];
const servers: Array<Bun.Server<unknown>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function startNode(token = TOKEN): Promise<{ node: DataNode; origin: string }> {
  const root = await mkdtemp(join(tmpdir(), "agent-data-conformance-test-"));
  roots.push(root);
  const node = await DataNode.open({
    root,
    collections: [{ id: "conformance", policy: { allowed_media_types: ["text/plain"] } }],
  });
  nodes.push(node);
  const server = serveDataNode(node, { port: 0, node_bearer: token });
  servers.push(server);
  return { node, origin: server.url.origin };
}

describe("agent-data Slice 1 HTTP conformance", () => {
  test("passes public and authenticated read-only profiles over a real socket", async () => {
    const { origin } = await startNode();
    const publicAuthorization: Array<string | null> = [];
    const inspectingFetch: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/.well-known/agent-data" || url.pathname === "/v1/data/manifest") {
        publicAuthorization.push(new Headers(init?.headers).get("authorization"));
      }
      return fetch(input, init);
    };

    const publicReport = await runDataNodeConformance({
      target: origin,
      profile: "public",
      fetch: inspectingFetch,
      run_id: "public-test",
    });
    expect(publicReport.verdict).toBe("pass");
    expect(publicReport.target.node_id).toBeString();
    expect(publicAuthorization).toEqual([null, null]);
    await expectReportMatchesSchema(publicReport);

    const readReport = await runDataNodeConformance({
      target: origin,
      profile: "read",
      token: TOKEN,
      run_id: "read-test",
    });
    expect(readReport.verdict).toBe("pass");
    expect(readReport.summary.failed).toBe(0);
    expect(readReport.target.node_id).toBeUndefined();
    expect(readReport.mutation.requested).toBe(false);
    await expectReportMatchesSchema(readReport);
  });

  test("passes the explicitly acknowledged fixture lifecycle and reports logical residue", async () => {
    const { node, origin } = await startNode();
    const report = await runDataNodeConformance({
      target: origin,
      profile: "slice1",
      token: TOKEN,
      collection_id: "conformance",
      expected_node_id: node.node_id,
      acknowledge_persistent_residue: true,
      run_id: "slice1-test",
    });

    expect(report.verdict).toBe("pass");
    expect(report.mutation).toMatchObject({
      requested: true,
      started: true,
      record_created: true,
      tombstone_appended: true,
      uncertain: false,
    });
    expect(report.mutation.fixture).toMatchObject({
      owned_records: 2,
      unverified_records: 0,
      tombstoned_records: 2,
      active_owned_records: 0,
    });
    expect(node.changes({ collection_id: "conformance" }).changes).toHaveLength(4);
    expect(report.target.node_id).toBe(node.node_id);
    await expectReportMatchesSchema(report);
  });

  test("refuses mutation without an expected node and persistent-residue acknowledgement", async () => {
    const { origin } = await startNode();
    await expect(runDataNodeConformance({
      target: origin,
      profile: "slice1",
      token: TOKEN,
      collection_id: "conformance",
    })).rejects.toBeInstanceOf(DataNodeConformanceConfigError);
  });

  test("reports a rejected supplied credential as inconclusive instead of protocol failure", async () => {
    const { origin } = await startNode();
    const report = await runDataNodeConformance({
      target: origin,
      profile: "read",
      token: "wrong-dedicated-node-token",
      run_id: "wrong-token-test",
    });
    expect(report.verdict).toBe("inconclusive");
    expect(report.checks.find((check) => check.id === "auth.valid_bearer.collections")).toMatchObject({
      status: "inconclusive",
      reason_code: "credential_rejected",
    });
    expect(report.summary.failed).toBe(0);
  });

  test("keeps a lost committed collect uncertain and never retries or claims finalization", async () => {
    const { node, origin } = await startNode();
    let collectCalls = 0;
    const loseFirstCollect: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/v1/data/collect" && new Headers(init?.headers).get("authorization") === `Bearer ${TOKEN}`) {
        collectCalls += 1;
        const response = await fetch(input, init);
        await response.arrayBuffer();
        throw new DOMException("simulated lost response", "TimeoutError");
      }
      return fetch(input, init);
    };
    const report = await runDataNodeConformance({
      target: origin,
      profile: "slice1",
      token: TOKEN,
      collection_id: "conformance",
      expected_node_id: node.node_id,
      acknowledge_persistent_residue: true,
      fetch: loseFirstCollect,
      run_id: "lost-collect-test",
    });

    expect(report.verdict).toBe("inconclusive");
    expect(report.mutation).toMatchObject({ started: true, uncertain: true, record_created: false });
    expect(report.mutation.fixture).toMatchObject({
      owned_records: 0,
      unverified_records: 0,
      tombstoned_records: 0,
      active_owned_records: 0,
    });
    expect(collectCalls).toBe(1);
    expect(report.checks.find((check) => check.id === "tombstones.fixture_finalization")).toMatchObject({
      status: "inconclusive",
      reason_code: "mutation_outcome_uncertain_no_retry",
    });
    expect(node.query({ collections: ["conformance"] }).records).toHaveLength(1);
  });

  test("does not serialize a bearer, its hash, or malicious remote response text", async () => {
    const canary = "CANARY_NODE_BEARER_7f4db19a";
    const { origin } = await startNode(canary);
    const canaryHash = createHash("sha256").update(canary).digest("hex");
    const maliciousFetch: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/v1/data/query" && new Headers(init?.headers).get("authorization") === `Bearer ${canary}`) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
        if (body.consistency === "eventual") {
          return new Response(JSON.stringify({ error: canary, message: canary, details: { echoed: canary } }), {
            status: 400,
            headers: { "content-type": "application/json", "x-echo": canary },
          });
        }
        if (body.consistency === "local") {
          return new Response(JSON.stringify({ records: [], consistency: canary, echoed: canary }), {
            status: 200,
            headers: { "content-type": "application/json", "x-echo": canary },
          });
        }
      }
      if (url.pathname === "/v1/data/changes" && url.searchParams.get("limit") === "1" && !url.searchParams.has("cursor")) {
        return new Response(canary, {
          status: 307,
          headers: {
            location: `https://attacker.invalid/${canary}`,
            "x-echo": canary,
          },
        });
      }
      return fetch(input, init);
    };

    const report = await runDataNodeConformance({
      target: origin,
      profile: "read",
      token: canary,
      fetch: maliciousFetch,
      run_id: "canary-test",
    });
    const serialized = `${JSON.stringify(report)}\n${formatDataNodeConformanceReport(report)}`;
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain(canaryHash);
    expect(report.verdict).toBe("fail");
  });

  test("does not serialize authenticated server-controlled record identifiers", async () => {
    const canary = "RECORD_ID_CANARY_BEARER_91bd";
    const canaryHash = createHash("sha256").update(canary).digest("hex");
    const { node, origin } = await startNode(canary);
    let altered = false;
    const identifierCovertChannel: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const response = await fetch(input, init);
      if (
        altered
        || url.pathname !== "/v1/data/collect"
        || new Headers(init?.headers).get("authorization") !== `Bearer ${canary}`
      ) return response;
      altered = true;
      const body = await response.json() as { records: Array<Record<string, unknown>> } & Record<string, unknown>;
      return new Response(JSON.stringify({
        ...body,
        records: [{ ...body.records[0]!, id: `remote-${canaryHash}` }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const report = await runDataNodeConformance({
      target: origin,
      profile: "slice1",
      token: canary,
      collection_id: "conformance",
      expected_node_id: node.node_id,
      acknowledge_persistent_residue: true,
      fetch: identifierCovertChannel,
      run_id: "record-covert-channel-test",
    });
    const serialized = `${JSON.stringify(report)}\n${formatDataNodeConformanceReport(report)}`;
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain(canaryHash);
    expect(report.verdict).toBe("fail");
  });

  test("refuses redirects, URL credentials, and non-loopback plaintext targets", async () => {
    const redirectingFetch: typeof fetch = async () => new Response("", {
      status: 307,
      headers: { location: "https://elsewhere.invalid/v1/data/manifest" },
    });
    const report = await runDataNodeConformance({
      target: "https://node.example",
      profile: "public",
      fetch: redirectingFetch,
      run_id: "redirect-test",
    });
    expect(report.verdict).toBe("fail");
    expect(report.checks.some((check) => check.reason_code === "redirect_refused")).toBe(true);

    const transportError = await runDataNodeConformance({
      target: "https://node.example",
      profile: "public",
      fetch: async () => Response.error(),
      run_id: "response-error-test",
    });
    expect(transportError.verdict).toBe("inconclusive");
    expect(transportError.checks.some((check) => check.reason_code === "invalid_response_status")).toBe(true);
    await expectReportMatchesSchema(transportError);

    await expect(runDataNodeConformance({
      target: "https://user:secret@node.example",
      profile: "public",
    })).rejects.toMatchObject({ code: "target_url_credentials" });
    await expect(runDataNodeConformance({
      target: "http://node.example",
      profile: "public",
    })).rejects.toMatchObject({ code: "insecure_target" });
  });

  test("uses non-actionable auth probes even when a broken boundary reaches route parsing", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-data-auth-bypass-test-"));
    roots.push(root);
    const node = await DataNode.open({ root, collections: [{ id: "conformance" }] });
    nodes.push(node);
    const handler = createDataNodeFetchHandler(node, { node_bearer: TOKEN });
    const bypassingFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${TOKEN}`);
      return handler(new Request(input, { ...init, headers }));
    };
    const report = await runDataNodeConformance({
      target: "http://127.0.0.1:7742",
      profile: "public",
      fetch: bypassingFetch,
      run_id: "auth-bypass-test",
    });

    expect(report.verdict).toBe("fail");
    expect(node.query({ collections: ["conformance"] }).records).toEqual([]);
    expect(node.changes({ collection_id: "conformance" }).changes).toEqual([]);
  });

  test("blocks every fixture write when the two discovery doors identify different nodes", async () => {
    const { node, origin } = await startNode();
    let authenticatedCollects = 0;
    const splitDiscovery: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const authorization = new Headers(init?.headers).get("authorization");
      if (url.pathname === "/v1/data/collect" && authorization === `Bearer ${TOKEN}`) authenticatedCollects += 1;
      const response = await fetch(input, init);
      if (url.pathname !== "/v1/data/manifest") return response;
      const body = await response.json() as Record<string, unknown>;
      return new Response(JSON.stringify({ ...body, node_id: "different-node-behind-origin" }), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    };
    const report = await runDataNodeConformance({
      target: origin,
      profile: "slice1",
      token: TOKEN,
      collection_id: "conformance",
      expected_node_id: node.node_id,
      acknowledge_persistent_residue: true,
      fetch: splitDiscovery,
      run_id: "split-discovery-test",
    });

    expect(report.verdict).toBe("fail");
    expect(report.checks.find((check) => check.id === "discovery.manifest_equivalence")).toMatchObject({
      status: "fail",
      reason_code: "manifest_mismatch",
    });
    expect(authenticatedCollects).toBe(0);
    expect(node.query({ collections: ["conformance"] }).records).toEqual([]);
  });

  test("requires a real Bearer challenge rather than a matching substring", async () => {
    const { origin } = await startNode();
    const badChallenge: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.startsWith("/v1/data/") && url.pathname !== "/v1/data/manifest") {
        return new Response(JSON.stringify({ error: "unauthorized", message: "rejected" }), {
          status: 401,
          headers: { "content-type": "application/json", "www-authenticate": "Basic realm=notbearer" },
        });
      }
      return fetch(input, init);
    };
    const report = await runDataNodeConformance({
      target: origin,
      profile: "public",
      fetch: badChallenge,
      run_id: "challenge-test",
    });
    expect(report.verdict).toBe("fail");
    expect(report.checks.some((check) => check.reason_code === "missing_bearer_challenge")).toBe(true);
  });

  test("accepts an omitted optional collection visibility declaration", async () => {
    const { origin } = await startNode();
    const noVisibility: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const response = await fetch(input, init);
      if (
        url.pathname !== "/v1/data/collections"
        || new Headers(init?.headers).get("authorization") !== `Bearer ${TOKEN}`
      ) return response;
      const body = await response.json() as { collections: Array<Record<string, unknown>> };
      const collections = body.collections.map((collection) => {
        const policy = { ...(collection.policy as Record<string, unknown>) };
        delete policy.visibility;
        return { ...collection, policy };
      });
      return new Response(JSON.stringify({ collections }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const report = await runDataNodeConformance({
      target: origin,
      profile: "read",
      token: TOKEN,
      fetch: noVisibility,
      run_id: "optional-visibility-test",
    });
    expect(report.verdict).toBe("pass");
  });

  test("fails malformed fixture ownership fields and leaves the ID unverified", async () => {
    const { node, origin } = await startNode();
    let altered = false;
    const malformedRecord: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const response = await fetch(input, init);
      if (
        altered
        || url.pathname !== "/v1/data/collect"
        || new Headers(init?.headers).get("authorization") !== `Bearer ${TOKEN}`
      ) return response;
      altered = true;
      const body = await response.json() as { records: Array<Record<string, unknown>> } & Record<string, unknown>;
      const record = body.records[0]!;
      const source = { ...(record.source as Record<string, unknown>), external_id: "wrong-external-id" };
      return new Response(JSON.stringify({ ...body, records: [{ ...record, source }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const report = await runDataNodeConformance({
      target: origin,
      profile: "slice1",
      token: TOKEN,
      collection_id: "conformance",
      expected_node_id: node.node_id,
      acknowledge_persistent_residue: true,
      fetch: malformedRecord,
      run_id: "malformed-record-test",
    });
    expect(report.verdict).toBe("fail");
    expect(report.checks.find((check) => check.id === "records.collect_owned_fixture")).toMatchObject({
      status: "fail",
      reason_code: "record_external_id_mismatch",
    });
    expect(report.mutation).toMatchObject({ uncertain: true, tombstone_appended: false });
    expect(report.mutation.fixture).toMatchObject({ owned_records: 0, unverified_records: 0 });
    expect(node.query({ collections: ["conformance"] }).records).toHaveLength(1);
  });
});

async function expectReportMatchesSchema(report: unknown): Promise<void> {
  const schema = await Bun.file(new URL("../schema/agent-data-conformance-report-v1.schema.json", import.meta.url)).json() as Schema;
  const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as { version: string };
  const errors: string[] = [];
  validateSchema(schema, schema, report, "$", errors);
  expect(errors).toEqual([]);
  expect((report as { tool: { version: string } }).tool.version).toBe(packageJson.version);
}

interface Schema {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  $defs?: Record<string, Schema>;
}

function validateSchema(root: Schema, schema: Schema, value: unknown, path: string, errors: string[]): void {
  if (schema.$ref) {
    const target = schema.$ref.split("/").slice(1).reduce<unknown>((current, segment) => {
      return current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined;
    }, root);
    if (!target || typeof target !== "object") {
      errors.push(`${path}: unresolved ${schema.$ref}`);
      return;
    }
    validateSchema(root, target as Schema, value, path, errors);
    return;
  }
  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) errors.push(`${path}: const`);
  if (schema.enum && !schema.enum.some((entry) => Object.is(entry, value))) errors.push(`${path}: enum`);
  if (schema.type && !matchesSchemaType(schema.type, value)) {
    errors.push(`${path}: type ${schema.type}`);
    return;
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(object, required)) errors.push(`${path}.${required}: required`);
    }
    for (const [key, child] of Object.entries(object)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) validateSchema(root, childSchema, child, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: additional`);
    }
  }
  if (schema.type === "array" && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: minItems`);
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) errors.push(`${path}: uniqueItems`);
    if (schema.items) value.forEach((entry, index) => validateSchema(root, schema.items!, entry, `${path}[${index}]`, errors));
  }
  if (schema.type === "string" && typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: maxLength`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern`);
    if (schema.format === "date-time" && !Number.isFinite(Date.parse(value))) errors.push(`${path}: date-time`);
    if (schema.format === "uri") {
      try { new URL(value); } catch { errors.push(`${path}: uri`); }
    }
  }
  if ((schema.type === "number" || schema.type === "integer") && typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum`);
  }
}

function matchesSchemaType(type: string, value: unknown): boolean {
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  return true;
}
