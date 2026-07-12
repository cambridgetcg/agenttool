/** agent-data/v1 SDK façade tests — all HTTP mocked, no network. */

import { afterEach, describe, expect, test } from "bun:test";
import {
  AGENT_DATA_SYNC_PROTOCOL,
  AgentTool,
  AgentToolError,
  DataClient,
  DataSyncClient,
} from "../src/index.js";

interface CapturedCall {
  url: string;
  method: string;
  headers: Headers;
  body?: unknown;
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_DATA_URL = process.env.AGENT_DATA_NODE_URL;
const ORIGINAL_DATA_TOKEN = process.env.AGENT_DATA_NODE_TOKEN;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  restoreEnv("AGENT_DATA_NODE_URL", ORIGINAL_DATA_URL);
  restoreEnv("AGENT_DATA_NODE_TOKEN", ORIGINAL_DATA_TOKEN);
});

function installFetchStub(): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let body: unknown;
    if (init?.body !== undefined) body = JSON.parse(String(init.body));
    const call: CapturedCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(body !== undefined ? { body } : {}),
    };
    calls.push(call);
    return new Response(
      JSON.stringify({
        ok: true,
        protocol: "agent-data/v1",
        request_url: call.url,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return calls;
}

describe("AgentTool.data security boundary", () => {
  test("supports a standalone data client without an AgentTool API key", async () => {
    const calls = installFetchStub();
    const data = new DataClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "standalone-node-token",
    });

    await data.manifest();

    expect(calls[0]!.headers.get("authorization")).toBe(
      "Bearer standalone-node-token",
    );
  });

  test("uses only the separately configured data-node bearer", async () => {
    const calls = installFetchStub();
    const at = new AgentTool({
      apiKey: "agenttool-project-secret",
      dataNode: {
        baseUrl: "http://127.0.0.1:8787/",
        token: "data-node-secret",
      },
    });

    await at.data.manifest();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:8787/v1/data/manifest");
    expect(calls[0]!.headers.get("authorization")).toBe(
      "Bearer data-node-secret",
    );
    expect([...calls[0]!.headers.values()].join(" ")).not.toContain(
      "agenttool-project-secret",
    );
  });

  test("does not send any authorization header when the node has no token", async () => {
    delete process.env.AGENT_DATA_NODE_TOKEN;
    const calls = installFetchStub();
    const at = new AgentTool({
      apiKey: "agenttool-project-secret",
      dataNode: { baseUrl: "http://127.0.0.1:8787" },
    });

    await at.data.collections();

    expect(calls[0]!.headers.has("authorization")).toBe(false);
    expect([...calls[0]!.headers.values()].join(" ")).not.toContain(
      "agenttool-project-secret",
    );
  });

  test("reads dedicated URL and token environment fallbacks", async () => {
    process.env.AGENT_DATA_NODE_URL = "http://localhost:9988/";
    process.env.AGENT_DATA_NODE_TOKEN = "env-data-token";
    const calls = installFetchStub();
    const at = new AgentTool({ apiKey: "agenttool-project-secret" });

    await at.data.manifest();

    expect(calls[0]!.url).toBe("http://localhost:9988/v1/data/manifest");
    expect(calls[0]!.headers.get("authorization")).toBe(
      "Bearer env-data-token",
    );
  });

  test("does not pair an explicit node URL with the ambient node token", async () => {
    process.env.AGENT_DATA_NODE_URL = "http://trusted-node.test";
    process.env.AGENT_DATA_NODE_TOKEN = "trusted-node-token";
    const calls = installFetchStub();
    const at = new AgentTool({
      apiKey: "agenttool-project-secret",
      dataNode: { baseUrl: "http://different-node.test" },
    });

    await at.data.manifest();

    expect(calls[0]!.url).toBe(
      "http://different-node.test/v1/data/manifest",
    );
    expect(calls[0]!.headers.has("authorization")).toBe(false);
  });

  test("guides callers when no data node is configured", () => {
    delete process.env.AGENT_DATA_NODE_URL;
    delete process.env.AGENT_DATA_NODE_TOKEN;
    const at = new AgentTool({ apiKey: "agenttool-project-secret" });

    try {
      void at.data;
      throw new Error("expected at.data to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as AgentToolError).code).toBe("data_node_not_configured");
      expect((error as AgentToolError).hint).toContain("AGENT_DATA_NODE_URL");
    }
  });
});

describe("AgentTool.data wire contract", () => {
  test("maps all seven methods to the agent-data/v1 routes", async () => {
    const calls = installFetchStub();
    const at = new AgentTool({
      apiKey: "agenttool-project-secret",
      dataNode: { baseUrl: "http://data-node.test", token: "node-token" },
    });

    await at.data.manifest();
    await at.data.collections();
    await at.data.collect({
      collection_id: "research",
      collector_id: "rss",
      input: { url: "https://example.test/feed.xml" },
      cursor: "collect-cursor",
    });
    await at.data.query({
      collections: ["research"],
      text: "solar",
      where: { language: "en" },
      limit: 5,
      consistency: "local",
    });
    await at.data.get("record/one");
    await at.data.changes({
      collection_id: "research notes",
      cursor: "change/cursor",
      limit: 25,
    });
    await at.data.tombstone("record/one", { reason: "source retracted" });

    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "http://data-node.test/v1/data/manifest"],
      ["GET", "http://data-node.test/v1/data/collections"],
      ["POST", "http://data-node.test/v1/data/collect"],
      ["POST", "http://data-node.test/v1/data/query"],
      ["GET", "http://data-node.test/v1/data/records/record%2Fone"],
      [
        "GET",
        "http://data-node.test/v1/data/changes?collection_id=research+notes&cursor=change%2Fcursor&limit=25",
      ],
      [
        "POST",
        "http://data-node.test/v1/data/records/record%2Fone/tombstone",
      ],
    ]);
    expect(calls[2]!.body).toEqual({
      collection_id: "research",
      collector_id: "rss",
      input: { url: "https://example.test/feed.xml" },
      cursor: "collect-cursor",
    });
    expect(calls[3]!.body).toEqual({
      collections: ["research"],
      text: "solar",
      where: { language: "en" },
      limit: 5,
      consistency: "local",
    });
    expect(calls[6]!.body).toEqual({ reason: "source retracted" });

    for (const call of calls) {
      expect(call.headers.get("authorization")).toBe("Bearer node-token");
      expect([...call.headers.values()].join(" ")).not.toContain(
        "agenttool-project-secret",
      );
    }
  });
});

describe("AgentTool.data.sync wire and authority contract", () => {
  test("pulls and reads status only through the configured local data node", async () => {
    const calls: CapturedCall[] = [];
    const status = {
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "peer one",
      collection_id: "research/notes",
      cursor_present: true,
      last_applied_at: "2026-07-12T12:00:00.000Z",
      records_inserted: 3,
      records_existing: 1,
      tombstones_applied: 2,
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body === undefined
        ? undefined
        : JSON.parse(String(init.body));
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        ...(body !== undefined ? { body } : {}),
      });
      const payload = String(input).includes("/pull")
        ? {
            protocol: AGENT_DATA_SYNC_PROTOCOL,
            peer_id: "peer one",
            origin_node_id: "origin-node",
            collection_id: "research/notes",
            pages_applied: 2,
            changes_applied: 6,
            records_inserted: 3,
            records_existing: 1,
            tombstones_applied: 2,
            has_more: false,
            status: { ...status, cursor: "nested-must-not-escape" },
            // A defensive compatibility check: even a drifted local node must
            // not make its opaque raw checkpoint public through this façade.
            cursor: "must-not-escape",
          }
        : { ...status, cursor: "must-not-escape" };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const at = new AgentTool({
      apiKey: "agenttool-project-secret",
      dataNode: { baseUrl: "http://local-data.test", token: "local-node-token" },
    });

    expect(at.data.sync).toBeInstanceOf(DataSyncClient);
    const pulled = await at.data.sync.pull({
      peer_id: "peer one",
      collection_id: "research/notes",
      limit: 25,
      max_pages: 2,
      max_plaintext_bytes: 1_048_576,
      // Unknown runtime properties are intentionally not forwarded, even
      // when an untyped caller bypasses the compile-time request shape.
      cursor: "caller-cursor-must-not-be-sent",
      peer_bearer: "peer-token-must-not-be-sent",
    } as Parameters<DataSyncClient["pull"]>[0] & {
      cursor: string;
      peer_bearer: string;
    });
    const checkpoint = await at.data.sync.status({
      peer_id: "peer one",
      collection_id: "research/notes",
    });

    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", "http://local-data.test/v1/data/sync/pull"],
      [
        "GET",
        "http://local-data.test/v1/data/sync/status?peer_id=peer+one&collection_id=research%2Fnotes",
      ],
    ]);
    expect(calls[0]!.body).toEqual({
      protocol: "agent-data-sync/v1",
      peer_id: "peer one",
      collection_id: "research/notes",
      limit: 25,
      max_pages: 2,
      max_plaintext_bytes: 1_048_576,
    });
    for (const call of calls) {
      expect(call.headers.get("authorization")).toBe("Bearer local-node-token");
      expect([...call.headers.values()].join(" ")).not.toContain(
        "agenttool-project-secret",
      );
      expect(call.url).not.toContain("peer-token");
    }
    expect(calls[0]!.body).not.toHaveProperty("cursor");
    expect(calls[0]!.body).not.toHaveProperty("token");
    expect(calls[0]!.body).not.toHaveProperty("peer_bearer");
    expect(pulled).not.toHaveProperty("cursor");
    expect(checkpoint).not.toHaveProperty("cursor");
    expect(pulled.status).not.toHaveProperty("cursor");
    expect(pulled.status).toEqual(status);
    expect(checkpoint).toEqual(status);
  });

  test("preserves only stable error metadata and never echoes response details", async () => {
    const calls: CapturedCall[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return new Response(JSON.stringify({
        error: "sync_in_progress",
        message: "A pull is already running at internal-cursor-value.",
        details: {
          retryable: true,
          cursor: "internal-cursor-value",
          peer_bearer: "peer-secret-value",
        },
      }), {
        status: 409,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "2",
        },
      });
    }) as typeof fetch;
    const data = new DataClient({
      baseUrl: "http://local-data.test",
      token: "local-node-token",
    });

    try {
      await data.sync.pull({ peer_id: "peer-a", collection_id: "research" });
      throw new Error("expected sync pull to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as AgentToolError).code).toBe("sync_in_progress");
      expect((error as AgentToolError).status).toBe(409);
      expect((error as AgentToolError).message).toBe(
        "Agent data sync request failed.",
      );
      expect((error as AgentToolError).hint).toBeUndefined();
      expect((error as AgentToolError).details).toBeUndefined();
      expect((error as AgentToolError).retryAfter).toBe("2");
      expect(String(error)).not.toContain("local-node-token");
      expect(String(error)).not.toContain("internal-cursor-value");
      expect(String(error)).not.toContain("peer-secret-value");
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      protocol: "agent-data-sync/v1",
      peer_id: "peer-a",
      collection_id: "research",
    });
  });

  test("maps local transport failures without echoing transport diagnostics", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect failed near peer-secret-value");
    }) as typeof fetch;
    const data = new DataClient({ baseUrl: "http://local-data.test" });

    try {
      await data.sync.status({ peer_id: "peer-a", collection_id: "research" });
      throw new Error("expected sync status to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as AgentToolError).code).toBe("data_node_unreachable");
      expect((error as AgentToolError).message).toBe(
        "Agent data sync request failed.",
      );
      expect((error as AgentToolError).hint).toBeUndefined();
      expect(String(error)).not.toContain("peer-secret-value");
    }
  });
});
