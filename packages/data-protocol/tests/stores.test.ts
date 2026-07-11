import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LimitExceededError,
  MemoryBlockStore,
  MultiBlockStore,
  StoreError,
  cidForBytes,
  type BlockStore,
} from "../src/index.js";
import { FileSystemBlockStore } from "../src/file-store.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("block stores", () => {
  test("multi-store writes all providers and falls back after a provider failure", async () => {
    let failedGets = 0;
    const failed: BlockStore = {
      async get() {
        failedGets += 1;
        throw new Error("provider offline");
      },
      async put() {
        throw new Error("provider offline");
      },
    };
    const memory = new MemoryBlockStore();
    const multi = new MultiBlockStore([failed, memory], { minimumWrites: 1, timeoutMs: 100 });
    const bytes = new TextEncoder().encode("fallback");
    const cid = cidForBytes(bytes);
    const result = await multi.put(cid, bytes);
    expect(result).toEqual({ attempted: 2, stored: 1, failed: 1 });
    expect(await multi.get(cid)).toEqual(bytes);
    expect(failedGets).toBe(1);
  });

  test("reads are ordered local-first and do not disclose a local hit to later stores", async () => {
    const local = new MemoryBlockStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const cid = cidForBytes(bytes);
    await local.put(cid, bytes);
    let remoteGets = 0;
    const remote: BlockStore = {
      async get() {
        remoteGets += 1;
        return null;
      },
      async put() {},
    };
    const multi = new MultiBlockStore([local, remote]);
    expect(await multi.get(cid)).toEqual(bytes);
    expect(remoteGets).toBe(0);
  });

  test("pre-aborted and oversized reads fail without trusting custom providers", async () => {
    const bytes = new Uint8Array(20);
    const cid = cidForBytes(bytes);
    let calls = 0;
    const provider: BlockStore = {
      async get() {
        calls += 1;
        return bytes;
      },
      async put() {},
    };
    const multi = new MultiBlockStore([provider]);
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(multi.get(cid, { signal: controller.signal })).rejects.toThrow("stop");
    expect(calls).toBe(0);
    await expect(multi.get(cid, { maxBytes: 19 })).rejects.toBeInstanceOf(StoreError);
    try {
      await multi.get(cid, { maxBytes: 19 });
    } catch (error) {
      expect((error as StoreError).failures[0]).toBeInstanceOf(LimitExceededError);
    }
  });

  test("hung provider is bounded before ordered fallback", async () => {
    const bytes = new Uint8Array([9]);
    const cid = cidForBytes(bytes);
    const hung: BlockStore = {
      get: () => new Promise(() => undefined),
      put: () => new Promise(() => undefined),
    };
    const memory = new MemoryBlockStore();
    await memory.put(cid, bytes);
    const multi = new MultiBlockStore([hung, memory], { timeoutMs: 15 });
    expect(await multi.get(cid)).toEqual(bytes);
  });

  test("caller abort reasons are preserved for in-flight reads and writes", async () => {
    const hung: BlockStore = {
      get: () => new Promise(() => undefined),
      put: () => new Promise(() => undefined),
    };
    const bytes = new Uint8Array([7]);
    const cid = cidForBytes(bytes);
    const multi = new MultiBlockStore([hung], { timeoutMs: 1_000 });

    const readController = new AbortController();
    const readReason = new Error("cancel read exactly");
    const read = multi.get(cid, { signal: readController.signal });
    readController.abort(readReason);
    try {
      await read;
      throw new Error("read should have aborted");
    } catch (error) {
      expect(error).toBe(readReason);
    }

    const writeController = new AbortController();
    const writeReason = new Error("cancel write exactly");
    const write = multi.put(cid, bytes, { signal: writeController.signal });
    writeController.abort(writeReason);
    try {
      await write;
      throw new Error("write should have aborted");
    } catch (error) {
      expect(error).toBe(writeReason);
    }
  });

  test("filesystem store snapshots mutable caller bytes and enforces bounded reads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttool-adds-"));
    temporaryDirectories.push(directory);
    const store = new FileSystemBlockStore(directory);
    const original = new Uint8Array([4, 5, 6, 7]);
    const expected = original.slice();
    const cid = cidForBytes(original);
    const pending = store.put(cid, original);
    original[0] = 99;
    await pending;
    expect(await store.get(cid)).toEqual(expected);
    await expect(store.get(cid, { maxBytes: 3 })).rejects.toBeInstanceOf(LimitExceededError);
  });
});
