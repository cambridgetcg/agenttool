import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataNode,
  HttpSourceAdapter,
  type CollectorContext,
  type JsonObject,
} from "../src/index.js";

const nodes: DataNode[] = [];
const roots: string[] = [];
const servers: Array<Bun.Server<unknown>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-data-collector-test-"));
  roots.push(root);
  return root;
}

async function nodeWith(adapters = [] as HttpSourceAdapter[]): Promise<DataNode> {
  const node = await DataNode.open({
    root: await temporaryRoot(),
    collections: [{ id: "sources" }],
    adapters,
  });
  nodes.push(node);
  return node;
}

function context(max = 1024): CollectorContext {
  return {
    max_record_bytes: max,
    collection: {
      protocol: "agent-data/v1",
      id: "sources",
      schema: { version: "1" },
      policy: { visibility: "private" },
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("file and text collectors", () => {
  test("collects one regular file with inferred media type and source provenance", async () => {
    const root = await temporaryRoot();
    const path = join(root, "sample.json");
    await writeFile(path, '{"hello":"sun"}');
    const node = await nodeWith();
    const result = await node.collect({
      collection_id: "sources",
      collector_id: "file",
      input: { path, metadata: { owner: "local" } },
    });

    expect(result.records[0]).toMatchObject({
      source: { collector_id: "file", external_id: path },
      content: { media_type: "application/json" },
      metadata: { owner: "local", file_name: "sample.json" },
    });
    expect(result.records[0]!.source.uri).toStartWith("file:");
    expect((await node.resolveRecord(result.records[0]!.id)).content).toEqual({
      encoding: "utf8",
      data: '{"hello":"sun"}',
    });
  });
});

describe("bounded HTTP collector", () => {
  test("blocks loopback and private IP literals by default before fetch", async () => {
    let called = false;
    const adapter = new HttpSourceAdapter({
      fetch: async () => {
        called = true;
        return new Response("should not happen");
      },
    });
    await expect(adapter.collect({ url: "http://127.0.0.1/private" }, context()))
      .rejects.toMatchObject({ code: "http_private_network_blocked" });
    await expect(adapter.collect({ url: "http://10.2.3.4/private" }, context()))
      .rejects.toMatchObject({ code: "http_private_network_blocked" });
    await expect(adapter.collect({ url: "http://[::ffff:7f00:1]/private" }, context()))
      .rejects.toMatchObject({ code: "http_private_network_blocked" });
    expect(called).toBe(false);
  });

  test("blocks private IPv4 hidden in IPv6 transition forms and reserved TEST-NET", async () => {
    let called = false;
    const adapter = new HttpSourceAdapter({
      fetch: async () => {
        called = true;
        return new Response("should not happen");
      },
    });
    for (const url of [
      "http://[64:ff9b::7f00:1]/nat64-loopback",
      "http://[2002:7f00:1::]/6to4-loopback",
      "http://[2002:c0a8:101::]/6to4-private",
      "http://[::7f00:1]/ipv4-compatible",
      "http://[fec0::1]/site-local",
      "http://198.51.100.7/test-net",
    ]) {
      await expect(adapter.collect({ url }, context()))
        .rejects.toMatchObject({ code: "http_private_network_blocked" });
    }
    expect(called).toBe(false);
  });

  test("rejects non-boolean private-network options", () => {
    let thrown: unknown;
    try {
      new HttpSourceAdapter({ allow_private_network: "false" as unknown as boolean });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: "invalid_option",
      message: "allow_private_network must be a boolean",
    });
  });

  test("re-checks redirect destinations and blocks a public-to-private redirect", async () => {
    let calls = 0;
    const adapter = new HttpSourceAdapter({
      fetch: async () => {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/internal" },
        });
      },
    });
    await expect(adapter.collect({ url: "http://93.184.216.34/start" }, context()))
      .rejects.toMatchObject({ code: "http_private_network_blocked" });
    expect(calls).toBe(1);
  });

  test("drops every caller header before following a cross-origin redirect", async () => {
    const seenHeaders: Headers[] = [];
    const adapter = new HttpSourceAdapter({
      fetch: async (_url, init) => {
        seenHeaders.push(new Headers(init?.headers));
        if (seenHeaders.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "http://93.184.216.35/final" },
          });
        }
        return new Response("public response", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      },
    });

    await adapter.collect({
      url: "http://93.184.216.34/start",
      headers: {
        authorization: "Bearer source-credential",
        "x-source-key": "source-credential",
      },
    }, context());

    expect(seenHeaders).toHaveLength(2);
    expect(seenHeaders[0]!.has("authorization")).toBe(true);
    expect(seenHeaders[0]!.has("x-source-key")).toBe(true);
    expect([...seenHeaders[1]!.keys()]).toEqual([]);
  });

  test("supports explicit private-network opt-in and bounded redirects", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/start") return Response.redirect(new URL("/final", request.url), 302);
        return new Response("loopback payload", {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            etag: '"v1"',
          },
        });
      },
    });
    servers.push(server);
    const node = await nodeWith([new HttpSourceAdapter({ allow_private_network: true })]);
    const result = await node.collect({
      collection_id: "sources",
      collector_id: "http",
      input: { url: new URL("/start", server.url).href },
    });

    expect(result.records[0]).toMatchObject({
      content: { media_type: "text/plain", size: 16 },
      source: { collector_id: "http" },
      metadata: { http_status: 200, etag: '"v1"' },
    });
    expect(result.records[0]!.source.uri).toEndWith("/final");
    expect(new TextDecoder().decode(await node.readContent(result.records[0]!.id))).toBe("loopback payload");
  });

  test("enforces streamed byte, redirect, timeout, and scheme limits", async () => {
    const large = new HttpSourceAdapter({
      max_bytes: 4,
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("123"));
          controller.enqueue(new TextEncoder().encode("456"));
          controller.close();
        },
      })),
    });
    await expect(large.collect({ url: "https://93.184.216.34/data" }, context(100)))
      .rejects.toMatchObject({ code: "content_too_large" });

    const redirect = new HttpSourceAdapter({
      max_redirects: 0,
      fetch: async () => new Response(null, { status: 302, headers: { location: "/again" } }),
    });
    await expect(redirect.collect({ url: "https://93.184.216.34/start" }, context()))
      .rejects.toMatchObject({ code: "http_redirect_limit" });

    const timeout = new HttpSourceAdapter({
      timeout_ms: 20,
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    await expect(timeout.collect({ url: "https://93.184.216.34/slow" }, context()))
      .rejects.toMatchObject({ code: "http_timeout" });

    await expect(large.collect({ url: "file:///etc/passwd" }, context()))
      .rejects.toMatchObject({ code: "invalid_url_scheme" });
  });
});
