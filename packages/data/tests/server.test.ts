import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataNode,
  createDataNodeFetchHandler,
  serveDataNode,
} from "../src/index.js";

const TOKEN = "test-node-token";
const nodes: DataNode[] = [];
const roots: string[] = [];
const servers: Array<Bun.Server<unknown>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function openNode(): Promise<DataNode> {
  const root = await mkdtemp(join(tmpdir(), "agent-data-server-test-"));
  roots.push(root);
  const node = await DataNode.open({ root, collections: [{ id: "default" }] });
  nodes.push(node);
  return node;
}

function jsonRequest(path: string, body: unknown, token?: string): Request {
  return new Request(`http://127.0.0.1:7742${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string, token?: string): Request {
  return new Request(`http://127.0.0.1:7742${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe("agent-data HTTP surface", () => {
  test("keeps discovery public while withholding every data route without a configured token", async () => {
    const node = await openNode();
    const fetch = createDataNodeFetchHandler(node);

    const wellKnown = await fetch(getRequest("/.well-known/agent-data"));
    expect(wellKnown.status).toBe(200);
    expect(await wellKnown.json()).toMatchObject({
      protocol: "agent-data/v1",
      capabilities: { peer_sync: false, http_data_auth: "dedicated_node_bearer" },
    });

    for (const request of [
      getRequest("/v1/data/collections"),
      jsonRequest("/v1/data/query", {}),
      getRequest("/v1/data/changes"),
      jsonRequest("/v1/data/collect", {
        collection_id: "default",
        collector_id: "text",
        input: { text: "secret corpus" },
      }),
    ]) {
      const response = await fetch(request);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "data_auth_not_configured",
        message: "HTTP data access is disabled until a dedicated node bearer is configured",
      });
    }
    expect(node.query().records).toHaveLength(0);
  });

  test("requires the dedicated bearer and serves all specified snake_case route shapes", async () => {
    const node = await openNode();
    const fetch = createDataNodeFetchHandler(node, { node_bearer: TOKEN });

    const unauthorized = await fetch(getRequest("/v1/data/collections", "wrong"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain("Bearer");
    expect(await unauthorized.json()).toEqual({
      error: "unauthorized",
      message: "A valid node bearer is required",
    });

    const collections = await fetch(getRequest("/v1/data/collections", TOKEN));
    expect(await collections.json()).toMatchObject({
      collections: [{ protocol: "agent-data/v1", id: "default" }],
    });

    const collectedResponse = await fetch(jsonRequest("/v1/data/collect", {
      collection_id: "default",
      collector_id: "text",
      input: { text: "fast local corpus", metadata: { subject: "framework" } },
    }, TOKEN));
    expect(collectedResponse.status).toBe(200);
    const collected = await collectedResponse.json() as {
      records: Array<{ id: string }>;
      inserted: number;
      existing: number;
    };
    expect(collected).toMatchObject({ inserted: 1, existing: 0 });
    const recordId = collected.records[0]!.id;

    const query = await fetch(jsonRequest("/v1/data/query", {
      collections: ["default"],
      text: "local",
      where: { metadata: { subject: "framework" } },
      consistency: "local",
    }, TOKEN));
    expect(await query.json()).toMatchObject({
      consistency: "local",
      records: [{ record: { id: recordId } }],
    });

    const record = await fetch(getRequest(`/v1/data/records/${recordId}`, TOKEN));
    expect(await record.json()).toMatchObject({
      record: { id: recordId },
      content: { encoding: "utf8", data: "fast local corpus" },
    });

    const changes = await fetch(getRequest("/v1/data/changes?collection_id=default&limit=1", TOKEN));
    expect(await changes.json()).toMatchObject({
      changes: [{ type: "record.created", record_id: recordId }],
      has_more: false,
    });

    const tombstoned = await fetch(jsonRequest(
      `/v1/data/records/${recordId}/tombstone`,
      { reason: "test removal" },
      TOKEN,
    ));
    expect(await tombstoned.json()).toMatchObject({
      record_id: recordId,
      tombstoned: true,
      tombstone: { record_id: recordId, reason: "test removal" },
    });
    const gone = await fetch(getRequest(`/v1/data/records/${recordId}`, TOKEN));
    expect(gone.status).toBe(410);
    expect(await gone.json()).toMatchObject({ error: "record_tombstoned" });
  });

  test("enforces JSON and request-body bounds with flat SDK-compatible errors", async () => {
    const node = await openNode();
    const fetch = createDataNodeFetchHandler(node, { node_bearer: TOKEN, max_body_bytes: 24 });
    const tooLarge = await fetch(jsonRequest("/v1/data/query", { text: "x".repeat(100) }, TOKEN));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({
      error: "request_too_large",
      message: "Request body exceeds the 24-byte limit",
    });

    const wrongType = await fetch(new Request("http://127.0.0.1:7742/v1/data/query", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" },
      body: "{}",
    }));
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toMatchObject({ error: "unsupported_media_type" });

    const notFound = await fetch(getRequest("/nothing"));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: "not_found", message: "Endpoint was not found" });
  });

  test("binds to loopback by default and refuses unauthenticated non-loopback exposure", async () => {
    const node = await openNode();
    const server = serveDataNode(node, { port: 0 });
    servers.push(server);
    expect(server.url.hostname).toBe("127.0.0.1");

    expect(() => serveDataNode(node, { hostname: "0.0.0.0", port: 0 })).toThrow(
      "non-loopback bind requires",
    );
    const authenticated = serveDataNode(node, {
      hostname: "0.0.0.0",
      port: 0,
      node_bearer: TOKEN,
    });
    servers.push(authenticated);
  });
});
