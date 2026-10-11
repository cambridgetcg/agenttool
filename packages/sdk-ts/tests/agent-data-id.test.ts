/** Shared agent-data record-id vectors — the TypeScript SDK's side.
 *
 *  `fixtures/agent-data-record-id-vectors.json` was produced by executing the
 *  real `@agenttool/data` node and is pinned against it again by
 *  `packages/data/tests/record-id-vectors.test.ts`. The Python twin reads the
 *  same file in `packages/sdk-py/tests/test_exit_door.py`. The node is
 *  normative: a red test here means this SDK is wrong until proven otherwise. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalJson,
  sha256Hex,
} from "../src/_agent-data-id.js";
import {
  AgentToolError,
  agentDataRecordId,
  agentDataTextRecordIdentity,
} from "../src/index.js";

interface Vectors {
  canonical_json: Array<{ name: string; value_json: string; canonical: string; sha256: string }>;
  text_records: Array<{
    name: string;
    collection_id: string;
    schema_version: string;
    input: {
      text: string;
      media_type: string;
      source_uri: string;
      external_id?: string;
      key?: string;
      version?: string;
    };
    content_sha256: string;
    content_size: number;
    record_id: string;
  }>;
}

const vectors = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "agent-data-record-id-vectors.json"), "utf8"),
) as Vectors;

describe("agent-data canonical JSON (shared vectors)", () => {
  for (const vector of vectors.canonical_json) {
    test(vector.name, () => {
      const canonical = canonicalJson(JSON.parse(vector.value_json));
      expect(canonical).toBe(vector.canonical);
      expect(sha256Hex(canonical)).toBe(vector.sha256);
    });
  }

  test("refuses values JSON cannot hold instead of coercing them", () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, () => 1, Symbol("x")]) {
      expect(() => canonicalJson(value)).toThrow(AgentToolError);
    }
    expect(() => canonicalJson({ a: undefined })).toThrow(AgentToolError);
    expect(() => canonicalJson([1, undefined])).toThrow(AgentToolError);
    try {
      canonicalJson(Number.NaN);
    } catch (error) {
      expect((error as AgentToolError).code).toBe("invalid_json");
    }
  });
});

describe("agent-data record ids (shared vectors)", () => {
  for (const vector of vectors.text_records) {
    test(vector.name, () => {
      const identity = agentDataTextRecordIdentity({
        collection_id: vector.collection_id,
        schema_version: vector.schema_version,
        text: vector.input.text,
        media_type: vector.input.media_type,
        source_uri: vector.input.source_uri,
        external_id: vector.input.external_id,
        key: vector.input.key,
        version: vector.input.version,
      });
      expect(identity.content.sha256).toBe(vector.content_sha256);
      expect(identity.content.size).toBe(vector.content_size);
      expect(agentDataRecordId(identity)).toBe(vector.record_id);
    });
  }
});
