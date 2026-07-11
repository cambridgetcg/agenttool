import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataNode,
  DataNodeError,
  SQLiteStore,
  type IndexCandidate,
  type JsonObject,
  type RecordEnvelope,
  type RecordIndex,
  type SourceAdapter,
} from "../src/index.js";

const nodes: DataNode[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-data-test-"));
  roots.push(root);
  return root;
}

async function openNode(collections = [{ id: "research" }]): Promise<DataNode> {
  const node = await DataNode.open({ root: await temporaryRoot(), collections });
  nodes.push(node);
  return node;
}

describe("DataNode records and query", () => {
  test("deduplicates deterministic immutable record identities and retains the first envelope", async () => {
    const node = await openNode();
    const first = await node.collect({
      collection_id: "research",
      collector_id: "text",
      input: {
        text: "decentralised solar index",
        observed_at: "2026-01-01T00:00:00Z",
        metadata: { quality: "first" },
      },
    });
    const second = await node.collect({
      collection_id: "research",
      collector_id: "text",
      input: {
        text: "decentralised solar index",
        observed_at: "2026-02-01T00:00:00Z",
        metadata: { quality: "later" },
      },
    });

    expect(first.inserted).toBe(1);
    expect(second).toMatchObject({ inserted: 0, existing: 1 });
    expect(second.records[0]!.id).toBe(first.records[0]!.id);
    expect(second.records[0]!.metadata).toEqual({ quality: "first" });
    expect(second.records[0]!.observed_at).toBe("2026-01-01T00:00:00.000Z");
    expect(Object.isFrozen(second.records[0])).toBe(true);
    expect(new TextDecoder().decode(await node.readContent(first.records[0]!.id))).toBe(
      "decentralised solar index",
    );
    expect(node.changes().changes).toHaveLength(1);
  });

  test("searches local FTS5 content and metadata with collection and where filters", async () => {
    const node = await openNode([{ id: "alpha" }, { id: "beta" }]);
    await node.collect({
      collection_id: "alpha",
      collector_id: "text",
      input: { text: "sunflower protocol", metadata: { topic: "botany", rank: 1 } },
    });
    await node.collect({
      collection_id: "beta",
      collector_id: "text",
      input: { text: "sunflower fabric", metadata: { topic: "systems", rank: 2 } },
    });

    expect(node.query({ text: "sunflower", collections: ["alpha"] }).records).toHaveLength(1);
    const metadataHit = node.query({ text: "systems", where: { metadata: { rank: 2 } } });
    expect(metadataHit.records).toHaveLength(1);
    expect(metadataHit.records[0]!.record.collection_id).toBe("beta");
    expect(node.query({ where: { metadata: { topic: "botany" } } }).records).toHaveLength(1);
    expect(node.query({ collections: [] }).records).toHaveLength(0);
    expect(node.query({ collections: [], text: "sunflower" }).records).toHaveLength(0);
    expect(() => node.query({ consistency: "eventual" as "local" })).toThrow("Only local consistency");
  });

  test("enforces collection schema and byte/media policy while declaring deferred policy hooks", async () => {
    const node = await openNode([{
      id: "strict",
      schema: { version: "article/2", json_schema: { type: "string" } },
      policy: {
        visibility: "private",
        max_record_bytes: 5,
        allowed_media_types: ["text/plain"],
        ttl_seconds: 60,
        allowed_dids: ["did:key:zExample"],
      },
    }]);
    const collection = node.getCollection("strict")!;
    expect(collection.protocol).toBe("agent-data/v1");
    expect(collection.schema.version).toBe("article/2");
    expect(collection.policy).toMatchObject({ visibility: "private", ttl_seconds: 60 });
    await expect(node.collect({
      collection_id: "strict",
      collector_id: "text",
      input: { text: "123456" },
    })).rejects.toMatchObject({ code: "content_too_large", status: 413 });
    await expect(node.collect({
      collection_id: "strict",
      collector_id: "text",
      input: { text: "tiny", media_type: "application/json" },
    })).rejects.toMatchObject({ code: "media_type_not_allowed" });
    expect(node.manifest().capabilities.policy_enforcement).toEqual({
      max_record_bytes: true,
      allowed_media_types: true,
      visibility: false,
      ttl: false,
      allowed_dids: false,
      retention: false,
    });
  });

  test("treats an explicit empty media-type allow-list as deny-all", async () => {
    const node = await openNode([{
      id: "deny-all",
      policy: { allowed_media_types: [] },
    }]);
    expect(node.getCollection("deny-all")!.policy.allowed_media_types).toEqual([]);
    await expect(node.collect({
      collection_id: "deny-all",
      collector_id: "text",
      input: { text: "must not pass" },
    })).rejects.toMatchObject({ code: "media_type_not_allowed" });
  });

  test("carries version lineage, provenance, and an explicitly unverified signature hook", async () => {
    const node = await openNode();
    const first = await node.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "v1", key: "logical-document", version: "1" },
    });
    const second = await node.collect({
      collection_id: "research",
      collector_id: "text",
      input: {
        text: "v2",
        key: "logical-document",
        version: "2",
        supersedes_id: first.records[0]!.id,
        provenance: [{
          activity: "revision",
          at: "2026-07-01T12:00:00Z",
          input_ids: [first.records[0]!.id],
          actor: "did:key:zExample",
        }],
        signature: { algorithm: "ed25519", signer: "did:key:zExample", value: "opaque" },
      },
    });

    expect(second.records[0]).toMatchObject({
      key: "logical-document",
      version: "2",
      supersedes_id: first.records[0]!.id,
      provenance: [{ activity: "revision", at: "2026-07-01T12:00:00.000Z" }],
      signature: { algorithm: "ed25519", value: "opaque" },
    });
    expect(node.manifest().capabilities.signature_verification).toBe(false);
  });

  test("accepts a pluggable SourceAdapter and passes through adapter cursors", async () => {
    const adapter: SourceAdapter = {
      id: "fixture",
      capability: { collector_id: "fixture", description: "Test fixture adapter" },
      async collect(input: JsonObject, _context, cursor) {
        return {
          items: [{
            bytes: new TextEncoder().encode(String(input.value)),
            media_type: "text/plain",
            source: { uri: "urn:test:fixture", external_id: "fixture-1" },
          }],
          cursor: `after:${cursor ?? "start"}`,
        };
      },
    };
    const node = await DataNode.open({
      root: await temporaryRoot(),
      collections: [{ id: "custom" }],
      adapters: [adapter],
    });
    nodes.push(node);
    const result = await node.collect({
      collection_id: "custom",
      collector_id: "fixture",
      input: { value: "custom payload" },
      cursor: "page-1",
    });
    expect(result.cursor).toBe("after:page-1");
    expect(result.records[0]!.source.collector_id).toBe("fixture");
    expect(node.manifest().collectors.some((item) => item.collector_id === "fixture")).toBe(true);
  });

  test("requires RFC 3339 timestamps with a zone and normalizes them to UTC", async () => {
    const node = await openNode();
    const result = await node.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "dated", observed_at: "2026-07-11T10:00:00+01:00" },
    });
    expect(result.records[0]!.observed_at).toBe("2026-07-11T09:00:00.000Z");
    await expect(node.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "bad date", observed_at: "July 11, 2026" },
    })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(node.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "bad calendar", observed_at: "2026-02-30T00:00:00Z" },
    })).rejects.toMatchObject({ code: "invalid_date" });
  });

  test("continues paged FTS lookup past a full page of stale index candidates", async () => {
    const root = await temporaryRoot();
    const sqlite = new SQLiteStore(join(root, "data.sqlite"));
    const index = new StalePagedIndex();
    const node = await DataNode.open({
      root,
      store: sqlite,
      index,
      collections: [{ id: "research" }],
    });
    nodes.push(node);
    const collected = await node.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "eventual real hit", metadata: { wanted: true } },
    });
    index.realId = collected.records[0]!.id;
    const result = node.query({ text: "hit", where: { metadata: { wanted: true } }, limit: 1 });
    expect(result.records[0]!.record.id).toBe(collected.records[0]!.id);
  });
});

describe("change feed and tombstones", () => {
  test("pages with opaque filter-bound cursors and emits immutable tombstone events", async () => {
    const node = await openNode();
    const one = await node.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "one" },
    });
    await node.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "two" },
    });

    const pageOne = node.changes({ collection_id: "research", limit: 1 });
    expect(pageOne.has_more).toBe(true);
    expect(pageOne.changes[0]).toMatchObject({ id: "change_1", type: "record.created" });
    expect(pageOne.cursor).not.toBe("1");
    const pageTwo = node.changes({ collection_id: "research", cursor: pageOne.cursor, limit: 1 });
    expect(pageTwo.changes[0]!.sequence).toBeGreaterThan(pageOne.changes[0]!.sequence);
    expect(() => node.changes({ cursor: pageOne.cursor })).toThrow("different collection filter");

    const tombstone = await node.tombstone(one.records[0]!.id, "superseded");
    expect(tombstone.reason).toBe("superseded");
    expect(node.getRecord(one.records[0]!.id)).toBeNull();
    expect(node.query({ text: "one" }).records).toHaveLength(0);
    await expect(node.resolveRecord(one.records[0]!.id)).rejects.toMatchObject({
      code: "record_tombstoned",
      status: 410,
    });
    const all = node.changes({ collection_id: "research" });
    expect(all.changes.at(-1)).toMatchObject({
      type: "record.tombstoned",
      record_id: one.records[0]!.id,
      tombstone: { reason: "superseded" },
    });
    const again = await node.tombstone(one.records[0]!.id, "ignored later reason");
    expect(again).toEqual(tombstone);
    expect(node.changes({ collection_id: "research" }).changes).toHaveLength(3);
  });
});

describe("index durability", () => {
  test("re-collection repairs a record committed before a transient index failure", async () => {
    const root = await temporaryRoot();
    const sqlite = new SQLiteStore(join(root, "data.sqlite"));
    const flaky = new FailOnceIndex(sqlite);
    const node = await DataNode.open({
      root,
      store: sqlite,
      index: flaky,
      collections: [{ id: "research" }],
    });
    nodes.push(node);
    const request = {
      collection_id: "research",
      collector_id: "text",
      input: { text: "repairable index" },
    } as const;

    await expect(node.collect(request)).rejects.toThrow("synthetic index failure");
    expect(node.changes().changes).toHaveLength(1);
    const repaired = await node.collect(request);
    expect(repaired).toMatchObject({ inserted: 0, existing: 1 });
    expect(node.query({ text: "repairable" }).records).toHaveLength(1);
  });

  test("reopening the default SQLite node repairs an interrupted index write", async () => {
    const root = await temporaryRoot();
    const sqlite = new SQLiteStore(join(root, "data.sqlite"));
    const first = await DataNode.open({
      root,
      store: sqlite,
      index: new FailOnceIndex(sqlite),
      collections: [{ id: "research" }],
    });
    await expect(first.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "startup recovery" },
    })).rejects.toThrow("synthetic index failure");
    first.close();

    const reopened = await DataNode.open({ root, collections: [{ id: "research" }] });
    nodes.push(reopened);
    expect(reopened.query({ text: "startup" }).records).toHaveLength(1);
  });
});

class FailOnceIndex implements RecordIndex {
  private shouldFail = true;

  constructor(private readonly delegate: SQLiteStore) {}

  indexRecord(record: RecordEnvelope, document: string): void {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("synthetic index failure");
    }
    this.delegate.indexRecord(record, document);
  }

  removeRecord(recordId: string): void {
    this.delegate.removeRecord(recordId);
  }

  search(text: string, collections: string[] | undefined, limit: number, offset = 0): IndexCandidate[] {
    return this.delegate.search(text, collections, limit, offset);
  }
}

class StalePagedIndex implements RecordIndex {
  realId = "";
  private readonly stale = Array.from({ length: 100 }, (_, index) => `stale-${index}`);

  indexRecord(): void {}
  removeRecord(): void {}

  search(_text: string, _collections: string[] | undefined, limit: number, offset = 0): IndexCandidate[] {
    return [...this.stale, this.realId]
      .slice(offset, offset + limit)
      .filter(Boolean)
      .map((record_id) => ({ record_id }));
  }
}
