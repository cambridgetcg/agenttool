/** agent-data/v1 SDK façade tests — all HTTP mocked, no network. */

import { afterEach, describe, expect, test } from "bun:test";
import { AgentTool, AgentToolError, DataClient } from "../src/index.js";

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
