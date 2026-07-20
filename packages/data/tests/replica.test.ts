import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataNode,
  type RecordEnvelope,
  type StoredCollection,
  type Tombstone,
} from "../src/index.js";

const nodes: DataNode[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function openNode(
  nodeId: string,
  collections: Parameters<typeof DataNode.open>[0]["collections"] = [],
): Promise<DataNode> {
  const root = await mkdtemp(join(tmpdir(), "agent-data-replica-test-"));
  roots.push(root);
  const node = await DataNode.open({ root, node_id: nodeId, collections });
  nodes.push(node);
  return node;
}

function remoteBlobRef(record: RecordEnvelope): RecordEnvelope {
  const remote = structuredClone(record);
  remote.content.blob_ref = `peer-private:${record.content.sha256}`;
  return remote;
}

describe("replica imports", () => {
  test("preserves a remote immutable envelope, replaces blob_ref, and settles reverse cycles", async () => {
    const source = await openNode("node_source", [{
      id: "research",
      name: "Research",
      schema: { version: "article/2", json_schema: { type: "string" } },
      policy: {
        visibility: "private",
        allowed_media_types: ["text/plain"],
        max_record_bytes: 1024,
      },
    }]);
    const target = await openNode("node_target");
    const collection = source.getCollection("research")!;

    expect(target.importCollection(collection)).toBe("inserted");
    expect(target.importCollection(structuredClone(collection))).toBe("existing");
    expect(target.getCollection("research")).toEqual(collection);

    const collected = await source.collect({
      collection_id: "research",
      collector_id: "text",
      input: {
        text: "replicated sunlight",
        source_uri: "urn:test:sunlight",
        external_id: "sunlight-1",
        key: "sunlight",
        version: "2",
        observed_at: "2026-07-12T10:20:30+01:00",
        metadata: { topic: "solar", nested: { trusted: false } },
        provenance: [{
          activity: "collected",
          at: "2026-07-12T09:20:30Z",
          actor: "collector:text",
          input_ids: [],
        }],
        signature: {
          algorithm: "Ed25519",
          signer: "did:example:source",
          value: "carried-not-verified",
        },
      },
    });
    const sourceRecord = collected.records[0]!;
    const bytes = await source.readContent(sourceRecord);
    const remoteRecord = remoteBlobRef(sourceRecord);

    expect(await target.importReplica(source.node_id, remoteRecord, bytes)).toBe("inserted");
    expect(await target.importReplica(source.node_id, structuredClone(remoteRecord), bytes)).toBe("existing");

    const stored = target.getRecord(sourceRecord.id)!;
    expect(stored.content.blob_ref).not.toBe(remoteRecord.content.blob_ref);
    expect({ ...stored, content: { ...stored.content, blob_ref: remoteRecord.content.blob_ref } })
      .toEqual(remoteRecord);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(new TextDecoder().decode(await target.readContent(stored))).toBe("replicated sunlight");
    expect(target.query({ text: "sunlight" }).records[0]!.record.id).toBe(stored.id);
    expect(target.changes().changes).toHaveLength(1);

    // A record returning through the target carries another node-local blob_ref,
    // but every immutable envelope field still matches the original.
    expect(await source.importReplica(target.node_id, stored, bytes)).toBe("existing");
    expect(source.changes().changes).toHaveLength(1);

    const conflicting = structuredClone(remoteRecord);
    conflicting.metadata = { topic: "different immutable first envelope" };
    await expect(target.importReplica(source.node_id, conflicting, bytes)).rejects.toMatchObject({
      code: "replica_record_conflict",
      status: 409,
    });
    expect(target.changes().changes).toHaveLength(1);
  });

  test("rejects malformed origins, unbound collections, tampered identity/content, and skipped predecessors", async () => {
    const source = await openNode("node_source", [{ id: "chain", schema: { version: "1" } }]);
    const target = await openNode("node_target");
    const first = (await source.collect({
      collection_id: "chain",
      collector_id: "text",
      input: { text: "first", key: "item", version: "1" },
    })).records[0]!;
    const second = (await source.collect({
      collection_id: "chain",
      collector_id: "text",
      input: {
        text: "second",
        key: "item",
        version: "2",
        supersedes_id: first.id,
      },
    })).records[0]!;
    const firstBytes = await source.readContent(first);
    const secondBytes = await source.readContent(second);

    await expect(target.importReplica(source.node_id, first, firstBytes)).rejects.toMatchObject({
      code: "replica_collection_not_found",
    });
    target.importCollection(source.getCollection("chain")!);

    await expect(target.importReplica("bad\norigin", first, firstBytes)).rejects.toMatchObject({
      code: "invalid_replica_origin",
    });
    await expect(target.importReplica(source.node_id, second, secondBytes)).rejects.toMatchObject({
      code: "superseded_record_not_found",
    });

    const wrongSize = remoteBlobRef(first);
    await expect(target.importReplica(source.node_id, wrongSize, firstBytes.subarray(1))).rejects.toMatchObject({
      code: "replica_content_size_mismatch",
    });
    const wrongHashBytes = new Uint8Array(firstBytes);
    wrongHashBytes[0] = wrongHashBytes[0]! ^ 1;
    await expect(target.importReplica(source.node_id, wrongSize, wrongHashBytes)).rejects.toMatchObject({
      code: "replica_content_hash_mismatch",
    });

    const wrongIdentity = structuredClone(first);
    wrongIdentity.source.uri = "urn:test:tampered-source";
    await expect(target.importReplica(source.node_id, wrongIdentity, firstBytes)).rejects.toMatchObject({
      code: "replica_record_id_mismatch",
    });
    const wrongSchema = structuredClone(first);
    wrongSchema.schema_version = "2";
    await expect(target.importReplica(source.node_id, wrongSchema, firstBytes)).rejects.toMatchObject({
      code: "replica_schema_mismatch",
    });

    expect(await target.importReplica(source.node_id, first, firstBytes)).toBe("inserted");
    expect(await target.importReplica(source.node_id, second, secondBytes)).toBe("inserted");
    expect(target.getRecord(second.id)!.supersedes_id).toBe(first.id);
  });

  test("imports exact tombstones idempotently and rejects conflicting immutable removal facts", async () => {
    const source = await openNode("node_source", [{ id: "research" }]);
    const target = await openNode("node_target");
    target.importCollection(source.getCollection("research")!);
    const record = (await source.collect({
      collection_id: "research",
      collector_id: "text",
      input: { text: "withdraw me" },
    })).records[0]!;
    const bytes = await source.readContent(record);
    await target.importReplica(source.node_id, record, bytes);
    await source.tombstone(record.id, "source withdrew this version");
    const remoteTombstone = source.getTombstone(record.id)!;

    expect(await target.importTombstone(source.node_id, remoteTombstone)).toBe("inserted");
    expect(await target.importTombstone(source.node_id, structuredClone(remoteTombstone))).toBe("existing");
    expect(target.getTombstone(record.id)).toEqual(remoteTombstone);
    expect(target.getRecord(record.id)).toBeNull();
    expect(target.query({ text: "withdraw" }).records).toHaveLength(0);
    expect(target.changes().changes.at(-1)).toMatchObject({
      type: "record.tombstoned",
      occurred_at: remoteTombstone.tombstoned_at,
      tombstone: remoteTombstone,
    });

    expect(await source.importTombstone(target.node_id, target.getTombstone(record.id)!)).toBe("existing");
    expect(source.changes().changes).toHaveLength(2);

    const conflict = structuredClone(remoteTombstone);
    conflict.reason = "a different immutable reason";
    await expect(target.importTombstone(source.node_id, conflict)).rejects.toMatchObject({
      code: "replica_tombstone_conflict",
      status: 409,
    });
    const missing: Tombstone = {
      record_id: `rec_${"f".repeat(64)}`,
      collection_id: "research",
      tombstoned_at: "2026-07-12T00:00:00Z",
    };
    await expect(target.importTombstone(source.node_id, missing)).rejects.toMatchObject({
      code: "record_not_found",
    });
  });

  test("rejects a conflicting imported collection definition without changing the first", async () => {
    const source = await openNode("node_source", [{ id: "stable", schema: { version: "1" } }]);
    const target = await openNode("node_target");
    const collection = source.getCollection("stable")!;
    expect(target.importCollection(collection)).toBe("inserted");

    const conflict = structuredClone(collection) as StoredCollection;
    conflict.schema.version = "2";
    expect(() => target.importCollection(conflict)).toThrow("different definition");
    expect(target.getCollection("stable")!.schema.version).toBe("1");
  });
});
