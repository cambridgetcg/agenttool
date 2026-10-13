/** Exit door unit tests.
 *
 *  Hosted calls go to an in-memory fake of the paged read routes. Node calls
 *  go to a REAL `@agenttool/data` node through its fetch handler, served on a
 *  loopback port-0 socket because the exporter reaches a loopback node over
 *  its own direct connection, never through `globalThis.fetch`. The full
 *  socket-level proof (`serveDataNode`) is `exit-door-integration.test.ts`. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDataNodeFetchHandler,
  DataNode,
} from "../../data/src/index.js";
import {
  AgentTool,
  AgentToolError,
  EXIT_NON_CLAIMS,
  type ExitManifest,
} from "../src/index.js";
import { createHostedFake, IDENTITY_A, type HostedFakeOptions } from "./_exit-door-fixture.js";

const HOSTED = "https://api.exit-door.test";
const PROJECT_KEY = "at_project_key_for_tests";
const NODE_TOKEN = "node_token_for_tests";

const ORIGINAL_FETCH = globalThis.fetch;
const nodes: DataNode[] = [];
const roots: string[] = [];
const servers: Array<{ stop(force?: boolean): unknown }> = [];

afterEach(async () => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const server of servers.splice(0)) server.stop(true);
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

interface NodeCall {
  method: string;
  path: string;
  authorization: string | null;
  body?: Record<string, unknown>;
}

interface Harness {
  at: AgentTool;
  node: DataNode;
  hosted: ReturnType<typeof createHostedFake>;
  nodeCalls: NodeCall[];
  /** Replace the node's response for one route (to simulate drift, errors). */
  intercept: { collect?: (body: Record<string, unknown>, real: Response) => Promise<Response> | Response };
}

async function harness(options: {
  hosted?: Partial<HostedFakeOptions>;
  nodeToken?: string;
  nodeUrl?: string;
  collection?: { id: string; policy?: Record<string, unknown>; schema?: { version: string } };
  limits?: Record<string, number>;
  dataNode?: boolean;
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "exit-door-unit-"));
  roots.push(root);
  const collection = options.collection ?? { id: "agenttool-exit" };
  const node = await DataNode.open({
    root,
    collections: [collection as never],
    ...(options.limits ? { limits: options.limits as never } : {}),
  });
  nodes.push(node);
  const handler = createDataNodeFetchHandler(node, { node_bearer: options.nodeToken ?? NODE_TOKEN });
  const hosted = createHostedFake({ paged: true, bearer: PROJECT_KEY, maxPage: 2, ...options.hosted });
  const nodeCalls: NodeCall[] = [];
  const intercept: Harness["intercept"] = {};
  const serveNode = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const text = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    nodeCalls.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.get("authorization"),
      ...(text ? { body: JSON.parse(text) } : {}),
    });
    // The data handler builds its manifest base URL from the request URL.
    const real = await handler(new Request(`http://127.0.0.1:7742${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      ...(text !== undefined ? { body: text } : {}),
    }));
    if (url.pathname === "/v1/data/collect" && intercept.collect && text) {
      return intercept.collect(JSON.parse(text), real);
    }
    return real;
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: serveNode });
  servers.push(server);
  const nodeUrl = options.nodeUrl ?? `http://127.0.0.1:${server.port}`;
  const nodeOrigin = new URL(nodeUrl).origin;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const request = new Request(url, init);
    if (url.origin === new URL(HOSTED).origin) return hosted.handle(request);
    // Only a non-loopback node URL (allow_remote_node) arrives here.
    if (url.origin === nodeOrigin) return serveNode(request);
    throw new Error(`unexpected origin ${url.origin}`);
  }) as typeof fetch;

  const at = new AgentTool({
    apiKey: PROJECT_KEY,
    baseUrl: HOSTED,
    ...(options.dataNode === false
      ? {}
      : { dataNode: { baseUrl: nodeUrl, token: options.nodeToken ?? NODE_TOKEN } }),
  });
  return { at, node, hosted, nodeCalls, intercept };
}

async function readJsonRecord(node: DataNode, id: string): Promise<Record<string, unknown>> {
  const bytes = await node.readContent(id);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

function store(manifest: ExitManifest, name: string) {
  const found = manifest.stores.find((entry) => entry.store === name);
  if (!found) throw new Error(`store ${name} missing`);
  return found;
}

describe("exit door: export against a paged host", () => {
  test("walks every store to has_more:false and writes a complete manifest", async () => {
    const h = await harness();
    const { manifest, manifest_record_id } = await h.at.exitDoor.export({ collection_id: "agenttool-exit" });

    expect(manifest.schema).toBe("agenttool-exit-manifest/v1");
    expect(manifest.overall).toBe("complete");
    expect(manifest.exporter).toEqual({ package: "@agenttool/sdk", version: "0.23.0" });
    expect(manifest.hosted).toEqual({ origin: HOSTED, auth_mode: "api_key", identity_id: null });
    expect(manifest.node).toEqual({
      node_id: h.node.node_id,
      collection_id: "agenttool-exit",
      max_body_bytes: 1024 * 1024,
    });
    expect(manifest.non_claims).toEqual([...EXIT_NON_CLAIMS]);
    expect(manifest.stores.map((entry) => entry.store)).toEqual([
      "memories",
      "chronicle",
      "strands",
      "strand_thoughts",
      "correspondence",
      "covenants",
      "identities",
      "identity_keys",
      "vault_index",
      "backup_index",
    ]);
    for (const entry of manifest.stores) expect(entry.status).toBe("complete");

    const memories = store(manifest, "memories");
    // maxPage 2 over 5 memories: three pages, each following next_cursor.
    expect(memories.walks).toEqual([{ filter: { scope: "project" }, pages: 3, returned: 5, exhausted: true }]);
    expect(memories.first_page_as_of).toBe("2026-10-11T09:00:00.000Z");
    expect(memories.records).toEqual({ written: 5, inserted: 5, existing: 0 });
    expect(memories.current.record_count).toBe(5);
    expect(memories.fields_not_exported).toEqual([
      { field: "embedding", reason: "hosted_returns_has_embedding_only" },
      { field: "accessed_at", reason: "volatile" },
    ]);
    expect(memories.server_exclusions).toEqual(["expired memories"]);
    const memoryCalls = h.hosted.calls.filter((call) => call.path === "/v1/memories");
    expect(memoryCalls.map((call) => call.query.cursor === undefined)).toEqual([true, false, false]);
    for (const call of memoryCalls) expect(call.query.limit).toBe("100");

    expect(store(manifest, "strands").walks[0]!.filter).toEqual({ order: "created", scope: "project" });
    expect(h.hosted.calls.filter((call) => call.path === "/v1/strands").every((call) => call.query.order === "created")).toBe(true);
    expect(store(manifest, "strand_thoughts").current.record_count).toBe(3);
    expect(store(manifest, "correspondence").current.record_count).toBe(6);
    expect(store(manifest, "covenants").walks).toHaveLength(7);
    expect(store(manifest, "covenants").current.record_count).toBe(2);
    expect(store(manifest, "identity_keys").current.record_count).toBe(3);
    expect(store(manifest, "vault_index").fields_not_exported).toEqual([
      { field: "value", reason: "custody_decision_pending" },
    ]);

    // The manifest is itself a record under exit-run/<run_id>.
    const manifestRecord = h.node.getRecord(manifest_record_id)!;
    expect(manifestRecord.key).toBe(`exit-run/${manifest.run_id}`);
    expect(await readJsonRecord(h.node, manifest_record_id)).toEqual(manifest as never);

    // Index chunks list the current record id per key.
    const index = await readJsonRecord(h.node, memories.current.index_record_ids[0]!);
    expect(index.schema).toBe("agenttool-exit-index/v1");
    expect((index.entries as unknown[]).length).toBe(5);
  });

  test("exported items carry no volatile fields and the documented metadata", async () => {
    const h = await harness();
    const { manifest } = await h.at.exitDoor.export({ collection_id: "agenttool-exit" });
    const index = await readJsonRecord(h.node, store(manifest, "memories").current.index_record_ids[0]!);
    const entry = (index.entries as Array<{ record_id: string; key: string; hosted_id: string }>)[0]!;
    const record = h.node.getRecord(entry.record_id)!;
    const content = await readJsonRecord(h.node, entry.record_id);
    expect(content.schema).toBe("agenttool-exit-item/v1");
    expect(content.origin).toBe(HOSTED);
    expect(content.store).toBe("memories");
    expect(content.item).not.toHaveProperty("accessed_at");
    expect(record.source.collector_id).toBe("text");
    expect(record.source.uri).toBe(`${HOSTED}/v1/memories/${entry.hosted_id}`);
    expect(record.source.external_id).toBe(entry.hosted_id);
    expect(record.key).toBe(`memories/${entry.hosted_id}`);
    expect(record.content.media_type).toBe("application/json");
    expect(record.metadata).toMatchObject({
      store: "memories",
      hosted_id: entry.hosted_id,
      encryption: { encrypted_fields: [], verified: false },
      embedding: { exported: false },
    });
    expect(record.provenance).toEqual([
      { activity: "agenttool-exit-door/v1 copy", at: manifest.started_at },
    ]);

    const thoughtsIndex = await readJsonRecord(h.node, store(manifest, "strand_thoughts").current.index_record_ids[0]!);
    const thoughtEntry = (thoughtsIndex.entries as Array<{ record_id: string }>)[0]!;
    expect(h.node.getRecord(thoughtEntry.record_id)!.metadata).toMatchObject({
      encryption: { encrypted_fields: ["ciphertext"], verified: false },
      identity_id: IDENTITY_A,
    });
  });

  test("a re-run inserts nothing and names the same current records", async () => {
    const h = await harness();
    const first = await h.at.exitDoor.export({ collection_id: "agenttool-exit" });
    const second = await h.at.exitDoor.export({ collection_id: "agenttool-exit" });
    expect(second.manifest.run_id).not.toBe(first.manifest.run_id);
    for (const entry of second.manifest.stores) {
      expect(entry.records.inserted).toBe(0);
      expect(entry.records.existing).toBe(entry.records.written);
      const before = store(first.manifest, entry.store);
      expect(entry.current.record_ids_sha256).toBe(before.current.record_ids_sha256);
    }
  });

  test("stays GET-only on the hosted side and never reads memories by id or search", async () => {
    const h = await harness();
    await h.at.exitDoor.export({ collection_id: "agenttool-exit" });
    for (const call of h.hosted.calls) {
      expect(call.method).toBe("GET");
      expect(call.path).not.toMatch(/^\/v1\/memories\/.+/);
      expect(call.path).not.toContain("search");
      expect(call.path).not.toMatch(/^\/v1\/vault\/.+/);
      expect(call.path).not.toMatch(/^\/v1\/identity\/backup\/.+/);
    }
  });

  test("keeps the project bearer and the node bearer apart", async () => {
    const h = await harness();
    await h.at.exitDoor.export({ collection_id: "agenttool-exit" });
    expect(h.hosted.calls.length).toBeGreaterThan(10);
    for (const call of h.hosted.calls) expect(call.authorization).toBe(`Bearer ${PROJECT_KEY}`);
    expect(h.nodeCalls.length).toBeGreaterThan(10);
    for (const call of h.nodeCalls) {
      if (call.path === "/v1/data/manifest") continue;
      expect(call.authorization).toBe(`Bearer ${NODE_TOKEN}`);
    }
    for (const call of h.nodeCalls) {
      expect(JSON.stringify(call)).not.toContain(PROJECT_KEY);
      if (call.body) expect((call.body as { collector_id: string }).collector_id).toBe("text");
    }
  });

  test("identity_id uses the host's filters and records them in each walk", async () => {
    const h = await harness();
    const { manifest } = await h.at.exitDoor.export({
      collection_id: "agenttool-exit",
      identity_id: IDENTITY_A,
    });
    expect(manifest.hosted.identity_id).toBe(IDENTITY_A);
    expect(store(manifest, "memories").walks[0]!.filter).toEqual({ identity_id: IDENTITY_A });
    expect(store(manifest, "memories").current.record_count).toBe(3);
    expect(store(manifest, "chronicle").walks[0]!.filter).toEqual({ agent_id: IDENTITY_A });
    expect(store(manifest, "strands").current.record_count).toBe(1);
    expect(store(manifest, "identities").current.record_count).toBe(1);
    expect(store(manifest, "identity_keys").current.record_count).toBe(2);
    expect(store(manifest, "correspondence").walks[0]!.filter).toEqual({ walk: "repositories", scope: "project" });
    const memoryCalls = h.hosted.calls.filter((call) => call.path === "/v1/memories");
    for (const call of memoryCalls) expect(call.query.identity_id).toBe(IDENTITY_A);
  });

  test("a store subset exports only that subset", async () => {
    const h = await harness();
    const { manifest } = await h.at.exitDoor.export({
      collection_id: "agenttool-exit",
      stores: ["strand_thoughts"],
    });
    expect(manifest.stores.map((entry) => entry.store)).toEqual(["strand_thoughts"]);
    expect(manifest.stores[0]!.current.record_count).toBe(3);
    // Strands were walked to enumerate thoughts but not written.
    const keys = h.nodeCalls
      .filter((call) => call.path === "/v1/data/collect")
      .map((call) => ((call.body as { input: { key: string } }).input.key));
    expect(keys.some((key) => key.startsWith("strands/"))).toBe(false);
  });
});

describe("exit door: thoughts walk", () => {
  const STRAND = "dddddddd-0000-4000-8000-000000000077";
  const created = "2026-09-01T00:00:00.000Z";
  function thoughtRows(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `eeeeeeee-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      strand_id: STRAND,
      sequence_num: index + 1,
      ciphertext: `c${index + 1}`,
      created_at: created,
    }));
  }
  async function walkThoughts(count: number, strand: Record<string, unknown>, thoughtsCap?: number) {
    const h = await harness({
      hosted: {
        ...(thoughtsCap !== undefined ? { thoughtsCap } : {}),
        dataset: {
          strands: [{ id: STRAND, identity_id: null, created_at: created, ...strand }],
          thoughts: { [STRAND]: thoughtRows(count) },
        },
      },
    });
    const { manifest } = await h.at.exitDoor.export({ collection_id: "agenttool-exit", stores: ["strand_thoughts"] });
    const calls = h.hosted.calls.filter((call) => call.path === `/v1/strands/${STRAND}/thoughts`);
    return { entry: store(manifest, "strand_thoughts"), sinceSeq: calls.map((call) => call.query.since_seq ?? null) };
  }

  test("follows since_seq across full pages without losing a thought at the boundaries", async () => {
    const { entry, sinceSeq } = await walkThoughts(1001, { last_thought_seq: 1001 });
    expect(entry.status).toBe("complete");
    expect(entry.current.record_count).toBe(1001);
    expect(sinceSeq).toEqual([null, "500", "1000"]);
    expect(entry.walks).toEqual([{
      filter: { scope: "per_strand", end: "empty_page_or_parent_last_thought_seq", strands: 1 },
      pages: 3,
      returned: 1001,
      exhausted: true,
    }]);
    // 1,001 thoughts mean 1,001 collect requests to a real node; a shared CI
    // runner needs well over bun's 5 s default for that.
  }, 60_000);

  test("a short page is not the end: a host that caps thoughts below 500 is still walked fully", async () => {
    const { entry, sinceSeq } = await walkThoughts(450, { last_thought_seq: 450 }, 200);
    expect(entry.status).toBe("complete");
    expect(entry.current.record_count).toBe(450);
    expect(sinceSeq).toEqual([null, "200", "400"]);
  }, 30_000);

  test("without last_thought_seq the walk ends on an empty page", async () => {
    const { entry, sinceSeq } = await walkThoughts(3, {});
    expect(entry.status).toBe("complete");
    expect(entry.current.record_count).toBe(3);
    expect(sinceSeq).toEqual([null, "3"]);
  });
});

describe("exit door: hostile hosted ids", () => {
  test("hosted ids cannot steer a request or a source uri out of its prefix", async () => {
    const strand = "../memories/pwned";
    const identity = "a/b?x=1#frag";
    const created = "2026-09-01T00:00:00.000Z";
    const h = await harness({
      hosted: {
        dataset: {
          strands: [
            { id: strand, identity_id: null, created_at: created },
            { id: "..", identity_id: null, created_at: created },
          ],
          thoughts: {
            [strand]: [{ id: "../../t", strand_id: strand, sequence_num: 1, ciphertext: "x", created_at: created }],
          },
          identities: [{ id: identity, created_at: created }],
          keys: { [identity]: [{ kid: "k/1", created_at: created }] },
        },
      },
    });
    const { manifest, item_skips } = await h.at.exitDoor.export({
      collection_id: "agenttool-exit",
      stores: ["strands", "strand_thoughts", "identities", "identity_keys"],
    });
    const paths = h.hosted.calls.map((call) => call.path);
    expect(paths).toContain("/v1/strands/..%2Fmemories%2Fpwned/thoughts");
    expect(paths).toContain("/v1/identities/a%2Fb%3Fx%3D1%23frag/keys");
    expect(paths.some((path) => path.startsWith("/v1/memories"))).toBe(false);
    expect(paths.some((path) => path === "/v1/strands/../thoughts" || path === "/v1/thoughts")).toBe(false);

    // The dot-segment strand is an item skip on both stores, not a crash.
    expect(item_skips.strands).toEqual([{ hosted_id: "..", reason: "hosted_id_not_addressable" }]);
    expect(item_skips.strand_thoughts).toEqual([{ hosted_id: "..", reason: "parent_id_not_addressable" }]);
    expect(item_skips.identities).toEqual([]);
    expect(store(manifest, "strands").item_skip_count).toBe(1);
    expect(store(manifest, "identities").item_skip_count).toBe(0);
    expect(store(manifest, "identities").item_skip_record_ids).toEqual([]);
    const skipsChunk = await readJsonRecord(h.node, store(manifest, "strands").item_skip_record_ids[0]!);
    expect(skipsChunk).toMatchObject({
      schema: "agenttool-exit-skips/v1",
      store: "strands",
      chunk: 0,
      chunk_count: 1,
      item_skips: [{ hosted_id: "..", reason: "hosted_id_not_addressable" }],
    });
    const index = await readJsonRecord(h.node, store(manifest, "strand_thoughts").current.index_record_ids[0]!);
    const thought = h.node.getRecord((index.entries as Array<{ record_id: string }>)[0]!.record_id)!;
    expect(thought.source.uri).toBe(`${HOSTED}/v1/strands/..%2Fmemories%2Fpwned/thoughts/..%2F..%2Ft`);
    const keysIndex = await readJsonRecord(h.node, store(manifest, "identity_keys").current.index_record_ids[0]!);
    const key = h.node.getRecord((keysIndex.entries as Array<{ record_id: string }>)[0]!.record_id)!;
    expect(key.source.uri).toBe(`${HOSTED}/v1/identities/a%2Fb%3Fx%3D1%23frag/keys/k%2F1`);
    expect(manifest.overall).toBe("partial");
  });
});

describe("exit door: hosts without the cursor contract", () => {
  test("marks cursor stores window_only with host_has_no_cursor and does not partition", async () => {
    const h = await harness({ hosted: { paged: false } });
    const { manifest } = await h.at.exitDoor.export({ collection_id: "agenttool-exit" });
    expect(manifest.overall).toBe("partial");
    for (const name of ["memories", "chronicle", "strands", "correspondence"]) {
      expect(store(manifest, name).status).toBe("window_only");
      expect(store(manifest, name).reason).toBe("host_has_no_cursor");
    }
    expect(store(manifest, "strand_thoughts").status).toBe("window_only");
    expect(store(manifest, "strand_thoughts").reason).toBe("parent_store_incomplete:strands");
    for (const name of ["covenants", "identities", "identity_keys", "vault_index", "backup_index"]) {
      expect(store(manifest, name).status).toBe("complete");
    }
    // The first window is still copied: maxPage 2 → two memories, one request.
    expect(store(manifest, "memories").current.record_count).toBe(2);
    expect(h.hosted.calls.filter((call) => call.path === "/v1/memories")).toHaveLength(1);
    expect(store(manifest, "correspondence").current.record_count).toBe(0);
  });
});

describe("exit door: guards before any write", () => {
  test("refuses a node token equal to the project API key", async () => {
    const h = await harness({ nodeToken: PROJECT_KEY });
    const error = await h.at.exitDoor.export({ collection_id: "agenttool-exit" }).catch((e) => e);
    expect(error).toBeInstanceOf(AgentToolError);
    expect(error.code).toBe("data_node_token_reuses_project_bearer");
    expect(h.nodeCalls).toHaveLength(0);
    expect(h.hosted.calls).toHaveLength(0);
  });

  test("refuses a non-loopback node unless allow_remote_node is set", async () => {
    const h = await harness({ nodeUrl: "http://data.example.test:7742" });
    const error = await h.at.exitDoor.export({ collection_id: "agenttool-exit" }).catch((e) => e);
    expect(error.code).toBe("data_node_not_loopback");
    expect(h.nodeCalls).toHaveLength(0);
    const ok = await h.at.exitDoor.export({ collection_id: "agenttool-exit", allow_remote_node: true });
    expect(ok.manifest.overall).toBe("complete");
  });

  test("refuses a node URL with the hosted API's origin, before any request", async () => {
    // allow_remote_node lets a non-loopback node through, never the host itself.
    const remote = await harness({ nodeUrl: `${HOSTED}/` });
    for (const run of [
      () => remote.at.exitDoor.export({ collection_id: "agenttool-exit", allow_remote_node: true }),
      () => remote.at.exitDoor.verify(`rec_${"a".repeat(64)}`, { allow_remote_node: true }),
    ]) {
      const error = await run().catch((e) => e);
      expect(error.code).toBe("data_node_is_hosted_origin");
    }
    expect(remote.hosted.calls).toHaveLength(0);
    expect(remote.nodeCalls).toHaveLength(0);

    // A loopback "host" sharing the node's origin is refused the same way.
    const loopback = await harness();
    const nodeUrl = (loopback.at as unknown as { dataNode: { baseUrl: string } }).dataNode.baseUrl;
    const confused = new AgentTool({
      apiKey: PROJECT_KEY,
      baseUrl: `${nodeUrl}/`,
      dataNode: { baseUrl: nodeUrl, token: NODE_TOKEN },
    });
    const error = await confused.exitDoor.export({ collection_id: "agenttool-exit" }).catch((e) => e);
    expect(error.code).toBe("data_node_is_hosted_origin");
    expect(loopback.nodeCalls).toHaveLength(0);
  });

  test("refuses a missing collection, a missing text collector, or a JSON-refusing policy", async () => {
    const missing = await harness();
    const error = await missing.at.exitDoor.export({ collection_id: "nope" }).catch((e) => e);
    expect(error.code).toBe("data_node_collection_not_found");
    expect(missing.nodeCalls.some((call) => call.path === "/v1/data/collect")).toBe(false);

    const refusing = await harness({
      collection: { id: "agenttool-exit", policy: { allowed_media_types: ["text/plain"] } },
    });
    const refused = await refusing.at.exitDoor.export({ collection_id: "agenttool-exit" }).catch((e) => e);
    expect(refused.code).toBe("data_node_collection_refuses_json");
    expect(refusing.nodeCalls.some((call) => call.path === "/v1/data/collect")).toBe(false);
  });

  test("export and verify need a configured node; plan does not", async () => {
    const h = await harness({ dataNode: false });
    const error = await h.at.exitDoor.export({ collection_id: "agenttool-exit" }).catch((e) => e);
    expect(error.code).toBe("data_node_not_configured");
    const verify = await h.at.exitDoor.verify(`rec_${"a".repeat(64)}`).catch((e) => e);
    expect(verify.code).toBe("data_node_not_configured");
    const plan = await h.at.exitDoor.plan();
    expect(plan.overall).toBe("complete");
  });

  test("validates options before touching anything", async () => {
    const h = await harness();
    const unknown = await h.at.exitDoor
      .export({ collection_id: "agenttool-exit", stores: ["vault_values" as never] })
      .catch((e) => e);
    expect(unknown.code).toBe("exit_store_unknown");
    const noCollection = await h.at.exitDoor.export({ collection_id: "" }).catch((e) => e);
    expect(noCollection.code).toBe("exit_collection_required");
    expect(h.nodeCalls).toHaveLength(0);
    expect(h.hosted.calls).toHaveLength(0);
  });
});

describe("exit door: failure handling", () => {
  test("identity drift fails the run and writes no manifest", async () => {
    const h = await harness();
    h.intercept.collect = async (_body, real) => {
      const parsed = (await real.json()) as { records: Array<Record<string, unknown>> };
      parsed.records[0] = { ...parsed.records[0], id: `rec_${"0".repeat(64)}` };
      return new Response(JSON.stringify(parsed), { status: 200, headers: { "content-type": "application/json" } });
    };
    const error = await h.at.exitDoor.export({ collection_id: "agenttool-exit" }).catch((e) => e);
    expect(error.code).toBe("exit_record_identity_drift");
    const keys = h.nodeCalls
      .filter((call) => call.path === "/v1/data/collect")
      .map((call) => (call.body as { input: { key: string } }).input.key);
    expect(keys.some((key) => key.startsWith("exit-run/"))).toBe(false);
  });

  test("oversize items become item skips with their byte count, never an abort", async () => {
    const big = "x".repeat(12_000);
    const h = await harness({
      limits: { max_body_bytes: 8192 },
      hosted: {
        dataset: {
          memories: [{ id: "aaaaaaaa-0000-4000-8000-000000000099", content: big, identity_id: null, created_at: "2026-10-01T00:00:00.000Z" }],
        },
      },
    });
    const { manifest, item_skips } = await h.at.exitDoor.export({ collection_id: "agenttool-exit", stores: ["memories", "vault_index"] });
    const memories = store(manifest, "memories");
    expect(memories.status).toBe("complete");
    expect(memories.item_skip_count).toBe(1);
    expect(item_skips.memories).toHaveLength(1);
    expect(item_skips.memories![0]!.hosted_id).toBe("aaaaaaaa-0000-4000-8000-000000000099");
    expect(item_skips.memories![0]!.reason).toBe("exceeds_node_limit");
    expect(item_skips.memories![0]!.bytes).toBeGreaterThan(8192);
    const chunk = await readJsonRecord(h.node, memories.item_skip_record_ids[0]!);
    expect(chunk.item_skips).toEqual(item_skips.memories as never);
    expect(memories.current.record_count).toBe(0);
    expect(manifest.overall).toBe("partial");
    expect(store(manifest, "vault_index").current.record_count).toBe(1);
  });

  test("index chunks fit a collection's max_record_bytes, not only the body limit", async () => {
    const memories = Array.from({ length: 300 }, (_, index) => ({
      id: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
      content: `m${index}`,
      identity_id: null,
      created_at: "2026-10-01T00:00:00.000Z",
    }));
    const h = await harness({
      collection: { id: "agenttool-exit", policy: { max_record_bytes: 16_384 } },
      hosted: { maxPage: 100, dataset: { memories } },
    });
    const { manifest, manifest_record_id } = await h.at.exitDoor.export({
      collection_id: "agenttool-exit",
      stores: ["memories"],
    });
    const entry = store(manifest, "memories");
    expect(manifest.overall).toBe("complete");
    expect(entry.current.record_count).toBe(300);
    // 300 entries (~200 bytes each) cannot share one 16 KiB record.
    expect(entry.current.index_record_ids.length).toBeGreaterThan(1);
    let listed = 0;
    for (const id of entry.current.index_record_ids) {
      const record = h.node.getRecord(id)!;
      expect(record.content.size).toBeLessThanOrEqual(16_384);
      listed += ((await readJsonRecord(h.node, id)).entries as unknown[]).length;
    }
    expect(listed).toBe(300);
    expect((await h.at.exitDoor.verify(manifest_record_id)).verified).toBe(true);
  });

  test("the manifest does not grow with the number of repositories or identities", async () => {
    const repositories = Array.from({ length: 300 }, (_, index) => `repo-${String(index).padStart(4, "0")}`);
    const identities = Array.from({ length: 300 }, (_, index) => ({
      id: `1d2c3b4a-0000-4000-8000-${String(index).padStart(12, "0")}`,
      created_at: "2026-05-21T00:00:00.000Z",
    }));
    const h = await harness({
      // One walk record per parent would need ~28 KB per store here.
      limits: { max_body_bytes: 16_384 },
      hosted: { maxPage: 200, dataset: { repositories, events: {}, identities, keys: {} } },
    });
    const { manifest, manifest_record_id } = await h.at.exitDoor.export({
      collection_id: "agenttool-exit",
      stores: ["correspondence", "identities", "identity_keys"],
    });
    expect(manifest.overall).toBe("complete");
    expect(store(manifest, "correspondence").walks).toEqual([
      { filter: { walk: "repositories", scope: "project" }, pages: 2, returned: 300, exhausted: true },
      { filter: { walk: "events", scope: "per_repository", repositories: 300 }, pages: 300, returned: 0, exhausted: true },
    ]);
    expect(store(manifest, "identity_keys").walks).toEqual([
      { filter: { scope: "per_identity", identities: 300 }, pages: 300, returned: 0, exhausted: true },
    ]);
    expect(store(manifest, "identities").current.record_count).toBe(300);
    expect(h.node.getRecord(manifest_record_id)!.content.size).toBeLessThan(16_384);
    expect((await h.at.exitDoor.verify(manifest_record_id)).verified).toBe(true);
  });

  test("item skips live in exit-skips chunks; the manifest only counts them", async () => {
    const big = "x".repeat(12_000);
    const memories = Array.from({ length: 100 }, (_, index) => ({
      id: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
      content: big,
      identity_id: null,
      created_at: "2026-10-01T00:00:00.000Z",
    }));
    const h = await harness({
      limits: { max_body_bytes: 8192 },
      hosted: { maxPage: 100, dataset: { memories } },
    });
    const { manifest, manifest_record_id, item_skips } = await h.at.exitDoor.export({
      collection_id: "agenttool-exit",
      stores: ["memories"],
    });
    const memoriesStore = store(manifest, "memories");
    expect(manifest.overall).toBe("partial");
    expect(memoriesStore.item_skip_count).toBe(100);
    expect(memoriesStore).not.toHaveProperty("item_skips");
    expect(item_skips.memories).toHaveLength(100);
    // 100 skips (~120 bytes each) need several chunks under an 8 KiB body.
    expect(memoriesStore.item_skip_record_ids.length).toBeGreaterThan(1);
    const chunked: unknown[] = [];
    for (const id of memoriesStore.item_skip_record_ids) {
      const chunk = await readJsonRecord(h.node, id);
      expect(chunk.schema).toBe("agenttool-exit-skips/v1");
      expect(h.node.getRecord(id)!.key).toBe(`exit-skips/${manifest.run_id}/memories/${chunk.chunk}`);
      chunked.push(...(chunk.item_skips as unknown[]));
    }
    expect(chunked).toEqual(item_skips.memories as never);
    expect(h.node.getRecord(manifest_record_id)!.content.size).toBeLessThan(8192);

    const verified = await h.at.exitDoor.verify(manifest_record_id);
    expect(verified.verified).toBe(true);
    expect(verified.checked).toBe(1 + memoriesStore.item_skip_record_ids.length);
    const victim = memoriesStore.item_skip_record_ids[0]!;
    await h.node.tombstone(victim, "test");
    const after = await h.at.exitDoor.verify(manifest_record_id);
    expect(after.verified).toBe(false);
    expect(after.mismatches).toContainEqual({ record_id: victim, reason: "record_tombstoned" });
  });

  test("a manifest that cannot fit fails the run instead of being truncated", async () => {
    const h = await harness({ limits: { max_body_bytes: 2048 } });
    const error = await h.at.exitDoor
      .export({ collection_id: "agenttool-exit", stores: ["vault_index", "backup_index"] })
      .catch((e) => e);
    expect(error.code).toBe("exit_manifest_too_large");
    const keys = h.nodeCalls
      .filter((call) => call.path === "/v1/data/collect")
      .map((call) => (call.body as { input: { key: string } }).input.key);
    expect(keys.some((key) => key.startsWith("exit-run/"))).toBe(false);
  });

  test("an aborted run stops with exit_aborted and writes no manifest", async () => {
    const h = await harness();
    const controller = new AbortController();
    let pages = 0;
    const error = await h.at.exitDoor
      .export({
        collection_id: "agenttool-exit",
        signal: controller.signal,
        on_progress: (event) => {
          if (event.event === "page" && ++pages === 1) controller.abort();
        },
      })
      .catch((e) => e);
    expect(error.code).toBe("exit_aborted");
    const keys = h.nodeCalls
      .filter((call) => call.path === "/v1/data/collect")
      .map((call) => (call.body as { input: { key: string } }).input.key);
    expect(keys.some((key) => key.startsWith("exit-run/"))).toBe(false);
  });

  test("a hosted failure fails that store only, with a reduced reason", async () => {
    const h = await harness();
    const harnessFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === new URL(HOSTED).origin && url.pathname === "/v1/chronicle") {
        return new Response(
          JSON.stringify({ error: "chronicle_unavailable", message: "secret internal detail", hint: "server prose" }),
          { status: 503, headers: { "content-type": "application/json", "retry-after": "7" } },
        );
      }
      return harnessFetch(input, init);
    }) as typeof fetch;
    const { manifest } = await h.at.exitDoor.export({ collection_id: "agenttool-exit" });
    expect(store(manifest, "chronicle").status).toBe("failed");
    expect(store(manifest, "chronicle").reason).toBe("chronicle_unavailable");
    expect(store(manifest, "memories").status).toBe("complete");
    expect(manifest.overall).toBe("failed");
    expect(JSON.stringify(manifest)).not.toContain("secret internal detail");
  });

  /** Replace one hosted route's answer; every other route keeps the fake.
   *  `answer` gets the 1-based call number so a fake can stay bounded. */
  function overrideHosted(path: string, answer: (url: URL, call: number) => Response): string[] {
    const seen: string[] = [];
    const harnessFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === new URL(HOSTED).origin && url.pathname === path) {
        seen.push(url.search);
        return answer(url, seen.length);
      }
      return harnessFetch(input, init);
    }) as typeof fetch;
    return seen;
  }
  const page = (body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  test("a host that repeats a cursor fails that store after two requests", async () => {
    const h = await harness();
    // Bounded: without the stall guard the walk would end "complete" at call 5.
    const seen = overrideHosted("/v1/memories", (_url, call) => page({
      memories: [{ id: "aaaaaaaa-0000-4000-8000-000000000001", created_at: "2026-10-01T00:00:00.000Z" }],
      page: call < 5 ? { has_more: true, next_cursor: "same-cursor" } : { has_more: false, next_cursor: null },
    }));
    const { manifest } = await h.at.exitDoor.export({ collection_id: "agenttool-exit", stores: ["memories", "vault_index"] });
    expect(store(manifest, "memories").status).toBe("failed");
    expect(store(manifest, "memories").reason).toBe("hosted_cursor_stalled");
    expect(seen).toHaveLength(2);
    expect(store(manifest, "vault_index").status).toBe("complete");
  });

  test("a host that repeats a next_after position fails that store after two requests", async () => {
    const h = await harness();
    const seen = overrideHosted("/v1/correspondence/repositories", (_url, call) => page({
      repositories: [{ repository_id: "repo-a" }],
      page: call < 5 ? { has_more: true, next_after: "repo-a" } : { has_more: false, next_after: "repo-a" },
    }));
    const { manifest } = await h.at.exitDoor.export({ collection_id: "agenttool-exit", stores: ["correspondence"] });
    expect(store(manifest, "correspondence").status).toBe("failed");
    expect(store(manifest, "correspondence").reason).toBe("hosted_cursor_stalled");
    expect(seen).toHaveLength(2);
  });

  test("has_more without a next cursor is window_only, never complete", async () => {
    const h = await harness();
    overrideHosted("/v1/memories", () => page({
      memories: [{ id: "aaaaaaaa-0000-4000-8000-000000000001", created_at: "2026-10-01T00:00:00.000Z" }],
      page: { has_more: true, next_cursor: null },
    }));
    const { manifest } = await h.at.exitDoor.export({ collection_id: "agenttool-exit", stores: ["memories"] });
    expect(store(manifest, "memories").status).toBe("window_only");
    expect(store(manifest, "memories").reason).toBe("host_has_no_cursor");
    expect(store(manifest, "memories").current.record_count).toBe(1);
  });

  test("node errors leave the exit door as code/status/retryAfter only", async () => {
    const h = await harness();
    h.intercept.collect = () =>
      new Response(
        JSON.stringify({ error: "disk_full", message: "path /secret/node/root is full", details: { path: "/secret" } }),
        { status: 507, headers: { "content-type": "application/json", "retry-after": "30" } },
      );
    const error = await h.at.exitDoor.export({ collection_id: "agenttool-exit" }).catch((e) => e);
    expect(error).toBeInstanceOf(AgentToolError);
    expect(error.code).toBe("disk_full");
    expect(error.status).toBe(507);
    expect(error.retryAfter).toBe("30");
    expect(error.message).not.toContain("/secret");
    expect(error.hint).toBeUndefined();
    expect(error.details).toBeUndefined();
  });
});

describe("exit door: plan and verify", () => {
  test("plan reads hosted data only and writes nothing to the node", async () => {
    const h = await harness();
    const plan = await h.at.exitDoor.plan();
    expect(plan.schema).toBe("agenttool-exit-plan/v1");
    expect(plan.overall).toBe("complete");
    expect(plan.stores.find((entry) => entry.store === "memories")!.items).toBe(5);
    expect(plan.stores.find((entry) => entry.store === "memories")!.largest_item_bytes).toBeGreaterThan(100);
    expect(h.nodeCalls).toHaveLength(0);
  });

  test("plan reports window_only against a host without cursors", async () => {
    const h = await harness({ hosted: { paged: false } });
    const plan = await h.at.exitDoor.plan({ stores: ["memories", "covenants"] });
    expect(plan.overall).toBe("partial");
    expect(plan.stores.map((entry) => [entry.store, entry.status, entry.reason ?? null])).toEqual([
      ["memories", "window_only", "host_has_no_cursor"],
      ["covenants", "complete", null],
    ]);
  });

  test("verify re-reads and re-hashes every record a manifest names", async () => {
    const h = await harness();
    const { manifest, manifest_record_id } = await h.at.exitDoor.export({ collection_id: "agenttool-exit" });
    const result = await h.at.exitDoor.verify(manifest_record_id);
    expect(result.schema).toBe("agenttool-exit-verify/v1");
    expect(result.verified).toBe(true);
    expect(result.run_id).toBe(manifest.run_id);
    expect(result.manifest_overall).toBe("complete");
    expect(result.mismatches).toEqual([]);
    const items = manifest.stores.reduce((sum, entry) => sum + entry.current.record_count, 0);
    const indexes = manifest.stores.reduce((sum, entry) => sum + entry.current.index_record_ids.length, 0);
    expect(result.checked).toBe(1 + items + indexes);

    // A tombstoned record is a mismatch, not a silent pass.
    const memoriesIndex = await readJsonRecord(h.node, store(manifest, "memories").current.index_record_ids[0]!);
    const victim = (memoriesIndex.entries as Array<{ record_id: string }>)[0]!.record_id;
    await h.node.tombstone(victim, "test");
    const after = await h.at.exitDoor.verify(manifest_record_id);
    expect(after.verified).toBe(false);
    expect(after.mismatches).toContainEqual({ record_id: victim, reason: "record_tombstoned" });
  });

  test("verify refuses a malformed manifest id before any request", async () => {
    const h = await harness();
    const error = await h.at.exitDoor.verify("not-a-record").catch((e) => e);
    expect(error.code).toBe("exit_manifest_id_invalid");
    expect(h.nodeCalls).toHaveLength(0);
  });
});
