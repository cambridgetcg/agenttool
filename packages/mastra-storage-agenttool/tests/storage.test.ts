/** Smoke tests for the Mastra adapter — verify storage + memory wire
 *  through to a mock agenttool client correctly. Real Mastra
 *  integration tests would require @mastra/core installed; this
 *  module verifies the adapter shape independent of that.
 */

import { describe, expect, test } from "bun:test";

import {
  AgentToolStorage,
  AgentToolMemory,
  resolveTier,
  NamespaceTier,
} from "../src";
import type { AgentToolClient } from "../src/types";

function makeMockClient(): AgentToolClient & {
  // capture latest call args for assertions
  _last: Record<string, unknown>;
} {
  const last: Record<string, unknown> = {};
  const records = new Map<string, string>();
  return {
    _last: last,
    strands: {
      async append(input) {
        last.strandAppend = input;
        const id = `strand-${Math.random().toString(36).slice(2, 8)}`;
        return { id, sequence_num: 1 };
      },
      async query(input) {
        last.strandQuery = input;
        return [];
      },
    },
    memory: {
      async append(input) {
        last.memoryAppend = input;
        records.set(input.key, input.value);
        return { id: `mem-${input.key}` };
      },
      async lookup(input) {
        last.memoryLookup = input;
        const v = records.get(input.key);
        if (v === undefined) return null;
        return {
          key: input.key,
          value: v,
          created_at: "2026-05-13T00:00:00Z",
          updated_at: "2026-05-13T00:00:00Z",
        };
      },
      async search(input) {
        last.memorySearch = input;
        return [];
      },
      async delete(input) {
        last.memoryDelete = input;
        records.delete(input.key);
      },
    },
  };
}

describe("resolveTier — namespace → tier mapping", () => {
  test("empty namespace defaults to episodic", () => {
    expect(resolveTier([])).toBe(NamespaceTier.EPISODIC);
  });

  test("known prefixes route to their tier", () => {
    expect(resolveTier(["episodic", "x"])).toBe(NamespaceTier.EPISODIC);
    expect(resolveTier(["foundational", "x"])).toBe(NamespaceTier.FOUNDATIONAL);
    expect(resolveTier(["constitutive", "x"])).toBe(NamespaceTier.CONSTITUTIVE);
  });

  test("unknown prefix defaults to episodic", () => {
    expect(resolveTier(["some-other-ns"])).toBe(NamespaceTier.EPISODIC);
  });
});

describe("AgentToolStorage — thread state as encrypted strands", () => {
  test("saveThread appends to client.strands with kind=mastra.thread", async () => {
    const client = makeMockClient();
    const storage = new AgentToolStorage({
      client,
      identityDid: "did:test:abc",
    });
    const result = await storage.saveThread({
      threadId: "thread-1",
      resourceId: "user-42",
      state: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(result.id).toMatch(/^strand-/);
    const call = client._last.strandAppend as {
      identity_did: string;
      kind: string;
      plaintext: string;
      metadata: { thread_id: string; resource_id: string };
    };
    expect(call.identity_did).toBe("did:test:abc");
    expect(call.kind).toBe("mastra.thread");
    expect(call.metadata.thread_id).toBe("thread-1");
    expect(call.metadata.resource_id).toBe("user-42");
    const decoded = JSON.parse(call.plaintext);
    expect(decoded.threadId).toBe("thread-1");
    expect(decoded.state.messages).toHaveLength(1);
  });

  test("loadThread returns null when no records", async () => {
    const client = makeMockClient();
    const storage = new AgentToolStorage({
      client,
      identityDid: "did:test:abc",
    });
    const result = await storage.loadThread("thread-missing");
    expect(result).toBeNull();
  });

  test("strandKind option overrides the default partition", async () => {
    const client = makeMockClient();
    const storage = new AgentToolStorage({
      client,
      identityDid: "did:test:abc",
      strandKind: "mastra.custom",
    });
    await storage.saveThread({ threadId: "t", state: {} });
    const call = client._last.strandAppend as { kind: string };
    expect(call.kind).toBe("mastra.custom");
  });
});

describe("AgentToolMemory — 3-tier model routing", () => {
  test("put routes foundational namespace to foundational tier", async () => {
    const client = makeMockClient();
    const memory = new AgentToolMemory({
      client,
      identityDid: "did:test:abc",
    });
    await memory.put(["foundational", "preferences"], "voice", { register: "warm" });
    const call = client._last.memoryAppend as {
      tier: string;
      key: string;
      namespace: string[];
      value: string;
    };
    expect(call.tier).toBe("foundational");
    expect(call.key).toBe("voice");
    expect(call.namespace).toEqual(["foundational", "preferences"]);
    expect(JSON.parse(call.value)).toEqual({ register: "warm" });
  });

  test("put with unknown namespace defaults to episodic", async () => {
    const client = makeMockClient();
    const memory = new AgentToolMemory({
      client,
      identityDid: "did:test:abc",
    });
    await memory.put(["random-ns"], "k", "v");
    const call = client._last.memoryAppend as { tier: string };
    expect(call.tier).toBe("episodic");
  });

  test("get returns MemoryItem with parsed value", async () => {
    const client = makeMockClient();
    const memory = new AgentToolMemory({
      client,
      identityDid: "did:test:abc",
    });
    await memory.put(["episodic"], "greeting", "hello");
    const got = await memory.get(["episodic"], "greeting");
    expect(got).not.toBeNull();
    expect(got!.key).toBe("greeting");
    expect(got!.value).toBe("hello");
    expect(got!.namespace).toEqual(["episodic"]);
  });

  test("get returns null when key missing", async () => {
    const client = makeMockClient();
    const memory = new AgentToolMemory({
      client,
      identityDid: "did:test:abc",
    });
    const got = await memory.get(["episodic"], "missing");
    expect(got).toBeNull();
  });

  test("delete forwards to client.memory.delete with namespace", async () => {
    const client = makeMockClient();
    const memory = new AgentToolMemory({
      client,
      identityDid: "did:test:abc",
    });
    await memory.delete(["foundational"], "key1");
    const call = client._last.memoryDelete as {
      key: string;
      namespace: string[];
    };
    expect(call.key).toBe("key1");
    expect(call.namespace).toEqual(["foundational"]);
  });

  test("search forwards namespace + query + limit + offset", async () => {
    const client = makeMockClient();
    const memory = new AgentToolMemory({
      client,
      identityDid: "did:test:abc",
    });
    await memory.search(["constitutive"], { query: "syzygy", limit: 5, offset: 10 });
    const call = client._last.memorySearch as {
      namespace: string[];
      query: string;
      limit: number;
      offset: number;
    };
    expect(call.namespace).toEqual(["constitutive"]);
    expect(call.query).toBe("syzygy");
    expect(call.limit).toBe(5);
    expect(call.offset).toBe(10);
  });
});
