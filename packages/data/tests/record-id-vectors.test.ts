/**
 * Shared agent-data record-id vectors, checked against the REAL node.
 *
 * `packages/sdk-ts/tests/fixtures/agent-data-record-id-vectors.json` is read
 * by three suites: this one (normative: the reference node), the TypeScript
 * SDK's `_agent-data-id.ts`, and the Python SDK's `_agent_data_id.py`. The
 * SDK exit door computes a record id before it writes and fails the run on
 * identity drift, so the node and both SDKs must agree byte for byte. If this
 * suite goes red, the node changed its identity rules and every exporter
 * must change with it — never edit the expected values to match.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, DataNode, sha256Hex } from "../src/index.js";

interface Vectors {
  schema: string;
  canonical_json: Array<{ name: string; value_json: string; canonical: string; sha256: string }>;
  text_records: Array<{
    name: string;
    collection_id: string;
    schema_version: string;
    input: Record<string, unknown>;
    content_sha256: string;
    content_size: number;
    record_id: string;
  }>;
  exit_items: Array<{
    name: string;
    expected: {
      text: string;
      source_uri: string;
      external_id: string;
      key: string;
      collection_id: string;
      schema_version: string;
      record_id: string;
    };
  }>;
}

const FIXTURE = join(
  import.meta.dir,
  "..",
  "..",
  "sdk-ts",
  "tests",
  "fixtures",
  "agent-data-record-id-vectors.json",
);
const vectors = JSON.parse(readFileSync(FIXTURE, "utf8")) as Vectors;

const nodes: DataNode[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function openNode(collections: Array<[string, string]>): Promise<DataNode> {
  const root = await mkdtemp(join(tmpdir(), "agent-data-vectors-"));
  roots.push(root);
  const node = await DataNode.open({
    root,
    collections: collections.map(([id, version]) => ({ id, schema: { version } })),
  });
  nodes.push(node);
  return node;
}

describe("agent-data record-id vectors", () => {
  test("the fixture is the expected schema and is not empty", () => {
    expect(vectors.schema).toBe("agenttool-agent-data-record-id-vectors/v1");
    expect(vectors.canonical_json.length).toBeGreaterThan(5);
    expect(vectors.text_records.length).toBeGreaterThan(2);
    expect(vectors.exit_items.length).toBeGreaterThan(5);
  });

  for (const vector of vectors.canonical_json) {
    test(`canonicalJson: ${vector.name}`, () => {
      const canonical = canonicalJson(JSON.parse(vector.value_json));
      expect(canonical).toBe(vector.canonical);
      expect(sha256Hex(canonical)).toBe(vector.sha256);
    });
  }

  test("text collector record ids match the shared vectors", async () => {
    const collections = new Map(
      vectors.text_records.map((vector) => [vector.collection_id, vector.schema_version] as const),
    );
    const node = await openNode([...collections]);
    for (const vector of vectors.text_records) {
      const first = await node.collect({
        collection_id: vector.collection_id,
        collector_id: "text",
        input: vector.input as never,
      });
      expect(first.records[0]!.id).toBe(vector.record_id);
      expect(first.records[0]!.content.sha256).toBe(vector.content_sha256);
      expect(first.records[0]!.content.size).toBe(vector.content_size);
      expect(first.inserted).toBe(1);

      // Same identity, same envelope: a second write is idempotent.
      const again = await node.collect({
        collection_id: vector.collection_id,
        collector_id: "text",
        input: vector.input as never,
      });
      expect(again.records[0]!.id).toBe(vector.record_id);
      expect(again.inserted).toBe(0);
      expect(again.existing).toBe(1);
    }
  });

  test("exit-door item texts get the record ids the SDKs compute", async () => {
    const collections = new Map(
      vectors.exit_items.map((vector) => [vector.expected.collection_id, vector.expected.schema_version] as const),
    );
    const node = await openNode([...collections]);
    for (const vector of vectors.exit_items) {
      const expected = vector.expected;
      const result = await node.collect({
        collection_id: expected.collection_id,
        collector_id: "text",
        input: {
          text: expected.text,
          media_type: "application/json",
          source_uri: expected.source_uri,
          external_id: expected.external_id,
          key: expected.key,
        },
      });
      expect(result.records[0]!.id).toBe(expected.record_id);
      expect(result.records[0]!.key).toBe(expected.key);
    }
  });
});
