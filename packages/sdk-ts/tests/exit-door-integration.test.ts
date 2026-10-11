/** Exit door against a REAL `@agenttool/data` node over real sockets.
 *
 *  `DataNode.open` on a fresh mkdtemp root, `serveDataNode` on port 0 with a
 *  dedicated node bearer, and a stub hosted API (`_exit-door-fixture.ts`) on
 *  its own port 0 socket. Nothing here contacts a network beyond loopback. */

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DataNode, serveDataNode } from "../../data/src/index.js";
import {
  AgentTool,
  agentDataRecordId,
  type ExitManifest,
} from "../src/index.js";
import { createHostedFake } from "./_exit-door-fixture.js";

const PROJECT_KEY = "at_integration_project_key";
const NODE_TOKEN = "integration_node_bearer";
const COLLECTION = "agenttool-exit";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startNode(): Promise<{ node: DataNode; url: string }> {
  const root = await mkdtemp(join(tmpdir(), "exit-door-integration-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const node = await DataNode.open({ root, collections: [{ id: COLLECTION }] });
  cleanups.push(() => node.close());
  const server = serveDataNode(node, { port: 0, node_bearer: NODE_TOKEN });
  cleanups.push(() => server.stop(true));
  return { node, url: `http://127.0.0.1:${server.port}` };
}

function startHosted(paged: boolean) {
  const fake = createHostedFake({ paged, bearer: PROJECT_KEY, maxPage: 2 });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fake.handle });
  cleanups.push(() => server.stop(true));
  return { fake, url: `http://127.0.0.1:${server.port}` };
}

function client(hostedUrl: string, nodeUrl: string): AgentTool {
  return new AgentTool({
    apiKey: PROJECT_KEY,
    baseUrl: hostedUrl,
    dataNode: { baseUrl: nodeUrl, token: NODE_TOKEN },
  });
}

async function currentRecordIds(node: DataNode, manifest: ExitManifest): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const entry of manifest.stores) {
    for (const indexId of entry.current.index_record_ids) {
      const index = JSON.parse(new TextDecoder().decode(await node.readContent(indexId))) as {
        entries: Array<{ key: string; record_id: string }>;
      };
      for (const item of index.entries) ids.set(item.key, item.record_id);
    }
  }
  return ids;
}

describe("exit door integration (real data node, real sockets)", () => {
  test("copies every store, records match their content hashes, and a re-run inserts 0", async () => {
    const { node, url: nodeUrl } = await startNode();
    const { fake, url: hostedUrl } = startHosted(true);
    const at = client(hostedUrl, nodeUrl);

    const first = await at.exitDoor.export({ collection_id: COLLECTION });
    expect(first.manifest.overall).toBe("complete");

    // The manifest record parses back to exactly what export() returned.
    const manifestBytes = await node.readContent(first.manifest_record_id);
    const parsed = JSON.parse(new TextDecoder().decode(manifestBytes)) as ExitManifest;
    expect(parsed).toEqual(first.manifest);
    expect(parsed.schema).toBe("agenttool-exit-manifest/v1");
    expect(parsed.overall).toBe("complete");
    for (const entry of parsed.stores) expect(entry.status).toBe("complete");

    // Every current record exists, its bytes hash to its envelope, and its id
    // re-derives from the envelope identity the SDK computed before writing.
    const ids = await currentRecordIds(node, first.manifest);
    const expectedCount = first.manifest.stores.reduce((sum, entry) => sum + entry.current.record_count, 0);
    expect(ids.size).toBe(expectedCount);
    expect(expectedCount).toBe(5 + 3 + 2 + 3 + 6 + 2 + 2 + 3 + 1 + 1);
    for (const [key, id] of ids) {
      const record = node.getRecord(id)!;
      expect(record.key).toBe(key);
      const bytes = await node.readContent(id);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(record.content.sha256);
      expect(agentDataRecordId({
        protocol: "agent-data/v1",
        collection_id: record.collection_id,
        source: {
          collector_id: record.source.collector_id,
          uri: record.source.uri,
          ...(record.source.external_id !== undefined ? { external_id: record.source.external_id } : {}),
        },
        content: {
          sha256: record.content.sha256,
          size: record.content.size,
          media_type: record.content.media_type,
        },
        schema_version: record.schema_version,
        ...(record.key !== undefined ? { key: record.key } : {}),
      })).toBe(id);
    }

    // Idempotent re-run: nothing new is inserted and the current set is unchanged.
    const second = await at.exitDoor.export({ collection_id: COLLECTION });
    expect(second.manifest.overall).toBe("complete");
    const written = second.manifest.stores.reduce((sum, entry) => sum + entry.records.written, 0);
    expect(written).toBe(expectedCount);
    for (const entry of second.manifest.stores) {
      expect(entry.records.inserted).toBe(0);
      expect(entry.records.existing).toBe(entry.records.written);
    }
    expect(await currentRecordIds(node, second.manifest)).toEqual(ids);

    // verify() re-reads and re-hashes everything the second manifest names.
    const verified = await at.exitDoor.verify(second.manifest_record_id);
    expect(verified.verified).toBe(true);
    expect(verified.mismatches).toEqual([]);

    // The hosted side saw only GETs carrying the project bearer.
    for (const call of fake.calls) {
      expect(call.method).toBe("GET");
      expect(call.authorization).toBe(`Bearer ${PROJECT_KEY}`);
    }
  });

  test("a hosted redirect fails that store and the project bearer never follows it", async () => {
    const { url: nodeUrl } = await startNode();
    const elsewhere: string[] = [];
    const offOrigin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        elsewhere.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get("authorization")}`);
        return Response.json({ memories: [], page: { has_more: false, next_cursor: null } });
      },
    });
    cleanups.push(() => offOrigin.stop(true));
    const fake = createHostedFake({ paged: true, bearer: PROJECT_KEY, maxPage: 2 });
    const hosted = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/v1/memories") {
          return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${offOrigin.port}/v1/memories` } });
        }
        return fake.handle(request);
      },
    });
    cleanups.push(() => hosted.stop(true));
    const at = client(`http://127.0.0.1:${hosted.port}`, nodeUrl);

    const { manifest } = await at.exitDoor.export({ collection_id: COLLECTION, stores: ["memories", "vault_index"] });
    const byStore = new Map(manifest.stores.map((entry) => [entry.store, entry]));
    expect(byStore.get("memories")!.status).toBe("failed");
    expect(byStore.get("memories")!.reason).toBe("hosted_redirect_refused");
    expect(byStore.get("vault_index")!.status).toBe("complete");
    expect(elsewhere).toEqual([]);
  });

  test("a host without page objects yields window_only, honestly labelled", async () => {
    const { node, url: nodeUrl } = await startNode();
    const { url: hostedUrl } = startHosted(false);
    const at = client(hostedUrl, nodeUrl);

    const { manifest, manifest_record_id } = await at.exitDoor.export({ collection_id: COLLECTION });
    const parsed = JSON.parse(new TextDecoder().decode(await node.readContent(manifest_record_id))) as ExitManifest;
    expect(parsed.overall).toBe("partial");
    const byStore = new Map(parsed.stores.map((entry) => [entry.store, entry]));
    for (const name of ["memories", "chronicle", "strands", "correspondence"] as const) {
      expect(byStore.get(name)!.status).toBe("window_only");
      expect(byStore.get(name)!.reason).toBe("host_has_no_cursor");
    }
    expect(byStore.get("memories")!.walks[0]!.exhausted).toBe(false);
    expect(byStore.get("covenants")!.status).toBe("complete");
    expect(manifest).toEqual(parsed);
  });
});
