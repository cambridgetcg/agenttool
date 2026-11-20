import { describe, expect, test } from "bun:test";
import {
  AgentData,
  InvalidInputError,
  LimitExceededError,
  MemoryBlockStore,
  MultiBlockStore,
  StoreError,
  cidForBytes,
  generateIdentity,
  type BlockStore,
  type Cid,
  type StoreOperationOptions,
} from "../src/index.js";

function patternBytes(size: number, seed = 17): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    out[i] = (i * 31 + seed) & 0xff;
  }
  return out;
}

async function collectStream(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function delayedStore(
  backing: BlockStore,
  delayMs: number,
  hooks: {
    onStart?: (cid: Cid) => void;
    onAbort?: (cid: Cid) => void;
    onDone?: (cid: Cid) => void;
  } = {},
): BlockStore {
  return {
    async get(cid: Cid, options?: StoreOperationOptions): Promise<Uint8Array | null> {
      hooks.onStart?.(cid);
      if (options?.signal?.aborted) {
        hooks.onAbort?.(cid);
        throw options.signal.reason ?? new Error("aborted");
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          options?.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          hooks.onAbort?.(cid);
          reject(options?.signal?.reason ?? new Error("aborted"));
        };
        options?.signal?.addEventListener("abort", onAbort, { once: true });
      });
      const result = await backing.get(cid, options);
      hooks.onDone?.(cid);
      return result;
    },
    put(cid, bytes, options) {
      return backing.put(cid, bytes, options);
    },
  };
}

describe("MultiBlockStore parallel and hedged reads", () => {
  test("validates readStrategy, hedgeDelayMs, and maxConcurrentReads", () => {
    const store = new MemoryBlockStore();
    expect(() => new MultiBlockStore([store], { readStrategy: "bogus" as "parallel" })).toThrow(InvalidInputError);
    expect(() => new MultiBlockStore([store], { hedgeDelayMs: 0 })).toThrow(InvalidInputError);
    expect(() => new MultiBlockStore([store], { maxConcurrentReads: 0 })).toThrow(InvalidInputError);
    expect(() => new MultiBlockStore([store], { maxConcurrentReads: 33 })).toThrow(InvalidInputError);
  });

  test("hedged read skips secondary when primary responds before hedgeDelayMs (request budget)", async () => {
    const bytes = new TextEncoder().encode("fast-local-hit");
    const cid = cidForBytes(bytes);
    const primary = new MemoryBlockStore();
    const secondary = new MemoryBlockStore();
    await primary.put(cid, bytes);
    await secondary.put(cid, bytes);

    let secondaryCalls = 0;
    const trackedSecondary: BlockStore = {
      get(id, opts) {
        secondaryCalls += 1;
        return secondary.get(id, opts);
      },
      put: (id, b, opts) => secondary.put(id, b, opts),
    };

    const multi = new MultiBlockStore([primary, trackedSecondary], {
      readStrategy: "hedged",
      hedgeDelayMs: 80,
      maxConcurrentReads: 2,
    });
    const out = await multi.get(cid);
    expect(out).toEqual(bytes);
    expect(secondaryCalls).toBe(0);
  });

  test("hedged read fires secondary after hedgeDelayMs, returns fast winner, and aborts slow primary", async () => {
    const bytes = new TextEncoder().encode("hedged-winner-bytes");
    const cid = cidForBytes(bytes);
    const primaryBacking = new MemoryBlockStore();
    const secondaryBacking = new MemoryBlockStore();
    await primaryBacking.put(cid, bytes);
    await secondaryBacking.put(cid, bytes);

    let primaryAborted = false;
    const slowPrimary = delayedStore(primaryBacking, 500, {
      onAbort: () => {
        primaryAborted = true;
      },
    });
    const fastSecondary = delayedStore(secondaryBacking, 5);

    const multi = new MultiBlockStore([slowPrimary, fastSecondary], {
      readStrategy: "hedged",
      hedgeDelayMs: 20,
      maxConcurrentReads: 2,
      timeoutMs: 2_000,
    });
    const start = performance.now();
    const out = await multi.get(cid);
    const elapsed = performance.now() - start;

    expect(out).toEqual(bytes);
    expect(elapsed).toBeLessThan(250);
    expect(primaryAborted).toBe(true);
  });

  test("hedged read fails over immediately on corrupt primary without waiting for hedgeDelayMs", async () => {
    const good = new TextEncoder().encode("valid-block");
    const cid = cidForBytes(good);
    const corrupt = new TextEncoder().encode("tampered!!!");
    const corruptPrimary: BlockStore = {
      async get() {
        return corrupt;
      },
      async put() {},
    };
    const healthySecondary = new MemoryBlockStore();
    await healthySecondary.put(cid, good);

    const multi = new MultiBlockStore([corruptPrimary, healthySecondary], {
      readStrategy: "hedged",
      hedgeDelayMs: 2_000,
      maxConcurrentReads: 2,
    });
    const start = performance.now();
    const out = await multi.get(cid);
    const elapsed = performance.now() - start;

    expect(out).toEqual(good);
    expect(elapsed).toBeLessThan(200);
  });

  test("parallel read respects maxConcurrentReads cap across many mirrors", async () => {
    const good = new TextEncoder().encode("mirror-5-hit");
    const cid = cidForBytes(good);
    let inFlight = 0;
    let peakInFlight = 0;

    const makeMiss = (delay: number): BlockStore => ({
      async get(_id, opts) {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        try {
          await new Promise((r) => setTimeout(r, delay));
          if (opts?.signal?.aborted) throw opts.signal.reason;
          return null;
        } finally {
          inFlight -= 1;
        }
      },
      async put() {},
    });

    const hit = new MemoryBlockStore();
    await hit.put(cid, good);

    const multi = new MultiBlockStore(
      [makeMiss(15), makeMiss(15), makeMiss(15), makeMiss(15), hit],
      { readStrategy: "parallel", maxConcurrentReads: 2 },
    );
    const out = await multi.get(cid);
    expect(out).toEqual(good);
    expect(peakInFlight).toBeLessThanOrEqual(2);
  });

  test("parallel read throws StoreError when all providers corrupt or fail, and returns null when all miss", async () => {
    const good = new TextEncoder().encode("missing-or-corrupt");
    const cid = cidForBytes(good);
    const emptyA = new MemoryBlockStore();
    const emptyB = new MemoryBlockStore();
    const missStore = new MultiBlockStore([emptyA, emptyB], { readStrategy: "parallel" });
    expect(await missStore.get(cid)).toBeNull();

    const corruptA: BlockStore = { async get() { return new Uint8Array([1, 2, 3]); }, async put() {} };
    const failB: BlockStore = { async get() { throw new Error("boom"); }, async put() {} };
    const errStore = new MultiBlockStore([corruptA, failB], { readStrategy: "parallel" });
    await expect(errStore.get(cid)).rejects.toThrow(StoreError);
  });

  test("parallel read preserves caller abort reason", async () => {
    const cid = cidForBytes(new TextEncoder().encode("abort-me"));
    const backing = new MemoryBlockStore();
    const slowA = delayedStore(backing, 500);
    const slowB = delayedStore(backing, 500);
    const multi = new MultiBlockStore([slowA, slowB], { readStrategy: "parallel" });
    const controller = new AbortController();
    const reason = new Error("caller-cancelled");
    setTimeout(() => controller.abort(reason), 15);
    await expect(multi.get(cid, { signal: controller.signal })).rejects.toBe(reason);
  });
});

describe("AgentData bounded streaming putStream and getStream", () => {
  test("wire parity: putStream <-> get and put <-> getStream across empty, boundary, and multi-chunk objects with Grant", async () => {
    const blocks = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const bob = generateIdentity("did:example:bob");
    const publisher = new AgentData({ identity: alice, store: blocks });
    const reader = new AgentData({ identity: bob, store: blocks });

    for (const size of [0, 1, 1024, 1024 * 5 + 37]) {
      const payload = patternBytes(size, size % 97);
      // AsyncIterable input split into uneven parts
      async function* unevenParts(): AsyncGenerator<Uint8Array> {
        for (let off = 0; off < payload.byteLength; off += 313) {
          yield payload.slice(off, Math.min(off + 313, payload.byteLength));
        }
      }

      const published = await publisher.putStream(unevenParts(), {
        plaintextSize: payload.byteLength,
        chunkSize: 1024,
        concurrency: 4,
        mediaType: "application/octet-stream",
      });

      // Verify existing verify() & get() read putStream output identically
      const verified = await publisher.verify(published.ref);
      expect(verified.ciphertextBlocksVerified).toBe(size === 0 ? 1 : Math.ceil(size / 1024));
      expect(await publisher.get(published.ref)).toEqual(payload);

      // Verify Grant + getStream() reads identically with concurrent prefetch
      const grant = await publisher.share(published.ref, {
        audience: bob.id,
        audienceBoxPublicKey: bob.boxPublicKey,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
      const streamed = await collectStream(
        reader.getStream(published.ref, { grant, concurrency: 4 }),
      );
      expect(streamed).toEqual(payload);
    }

    // Reverse parity: object written with legacy put() streams identically via getStream()
    const legacyPayload = patternBytes(4096 + 99, 42);
    const legacyPublished = await publisher.put(legacyPayload, { chunkSize: 1024 });
    expect(await collectStream(publisher.getStream(legacyPublished.ref, { concurrency: 3 }))).toEqual(legacyPayload);
  });

  test("putStream auto-derives UTF-8 byte size for strings and Blob, and requires plaintextSize for iterables", async () => {
    const blocks = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const publisher = new AgentData({ identity: alice, store: blocks });

    const text = "香港廣東話 café 🚀 streaming test";
    const pubText = await publisher.putStream(text, { chunkSize: 8, concurrency: 2 });
    expect(new TextDecoder().decode(await collectStream(publisher.getStream(pubText.ref)))).toBe(text);

    const blob = new Blob([patternBytes(2500, 11)]);
    const pubBlob = await publisher.putStream(blob, { chunkSize: 512, concurrency: 2 });
    expect(await publisher.get(pubBlob.ref)).toEqual(patternBytes(2500, 11));

    async function* iter() {
      yield new Uint8Array([1, 2, 3]);
    }
    await expect(publisher.putStream(iter())).rejects.toThrow(InvalidInputError);
  });

  test("putStream fails closed on plaintextSize mismatch (short or long) without writing Manifest", async () => {
    const alice = generateIdentity("did:example:alice");

    for (const [declared, actual] of [[2048, 1024], [1024, 2048]] as const) {
      const blocks = new MemoryBlockStore();
      let putCount = 0;
      const counted: BlockStore = {
        get: (c, o) => blocks.get(c, o),
        put(c, b, o) {
          putCount += 1;
          return blocks.put(c, b, o);
        },
      };
      const publisher = new AgentData({ identity: alice, store: counted });
      async function* parts() {
        yield patternBytes(actual, 5);
      }
      await expect(
        publisher.putStream(parts(), { plaintextSize: declared, chunkSize: 512 }),
      ).rejects.toThrow(InvalidInputError);
      // Manifest is never written if size disagrees (and on short/long mismatch, at most chunks written).
      expect(putCount).toBeLessThan(Math.ceil(Math.max(declared, actual) / 512) + 1);
    }
  });

  test("putStream bounds in-flight block writes to concurrency and streams past 64 MiB default when maxBytes is raised", async () => {
    const alice = generateIdentity("did:example:alice");
    const blocks = new MemoryBlockStore();
    let activePuts = 0;
    let peakPuts = 0;
    const tracked: BlockStore = {
      get: (c, o) => blocks.get(c, o),
      async put(c, b, o) {
        activePuts += 1;
        peakPuts = Math.max(peakPuts, activePuts);
        try {
          await new Promise((r) => setTimeout(r, 5));
          return await blocks.put(c, b, o);
        } finally {
          activePuts -= 1;
        }
      },
    };
    const publisher = new AgentData({ identity: alice, store: tracked, maxBytes: 128 * 1024 * 1024 });

    // Respects maxBytes before streaming begins
    async function* hugeFake() {
      yield new Uint8Array(1);
    }
    await expect(
      publisher.putStream(hugeFake(), { plaintextSize: 200 * 1024 * 1024 }),
    ).rejects.toThrow(LimitExceededError);

    // 12 chunks with concurrency 3 -> peak concurrent puts never exceeds 3
    const total = 12 * 1024;
    async function* twelveChunks() {
      for (let i = 0; i < 12; i += 1) {
        yield patternBytes(1024, i);
      }
    }
    const result = await publisher.putStream(twelveChunks(), {
      plaintextSize: total,
      chunkSize: 1024,
      concurrency: 3,
    });
    expect(result.manifest.chunks.length).toBe(12);
    expect(peakPuts).toBeLessThanOrEqual(3);
  });

  test("getStream early break stops reading remaining chunks and aborts in-flight prefetches", async () => {
    const blocks = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const publisher = new AgentData({ identity: alice, store: blocks });
    const payload = patternBytes(10 * 512, 9);
    const published = await publisher.putStream(payload, { chunkSize: 512, concurrency: 2 });

    let getsStarted = 0;
    let abortsSeen = 0;
    const slowStore = delayedStore(blocks, 40, {
      onStart: () => { getsStarted += 1; },
      onAbort: () => { abortsSeen += 1; },
    });
    const reader = new AgentData({
      identity: alice,
      store: slowStore,
      keyStore: undefined,
    });
    const grant = await publisher.share(published.ref, {
      audience: alice.id,
      audienceBoxPublicKey: alice.boxPublicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const received: Uint8Array[] = [];
    for await (const chunk of reader.getStream(published.ref, { grant, concurrency: 2 })) {
      received.push(chunk);
      if (received.length === 2) break;
    }

    expect(received.length).toBe(2);
    expect(received[0]).toEqual(payload.subarray(0, 512));
    expect(received[1]).toEqual(payload.subarray(512, 1024));
    // 1 manifest + 2 yielded + at most 2 prefetched << 11 total blocks
    expect(getsStarted).toBeLessThanOrEqual(5);
    expect(abortsSeen).toBeGreaterThanOrEqual(1);
  });

  test("AgentData passes readStrategy/hedgeDelayMs/maxConcurrentReads through to MultiBlockStore", async () => {
    const alice = generateIdentity("did:example:alice");
    const primary = new MemoryBlockStore();
    const secondary = new MemoryBlockStore();
    const writer = new AgentData({ identity: alice, stores: [primary, secondary], minimumWrites: 2 });
    const payload = patternBytes(2048, 77);
    const published = await writer.putStream(payload, { chunkSize: 512 });

    let primaryAborted = 0;
    const slowPrimary = delayedStore(primary, 400, {
      onAbort: () => { primaryAborted += 1; },
    });
    const fastReader = new AgentData({
      identity: alice,
      stores: [slowPrimary, secondary],
      readStrategy: "hedged",
      hedgeDelayMs: 15,
      maxConcurrentReads: 2,
    });
    const grant = await writer.share(published.ref, {
      audience: alice.id,
      audienceBoxPublicKey: alice.boxPublicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const start = performance.now();
    const out = await collectStream(fastReader.getStream(published.ref, { grant, concurrency: 2 }));
    const elapsed = performance.now() - start;

    expect(out).toEqual(payload);
    expect(elapsed).toBeLessThan(350);
    expect(primaryAborted).toBeGreaterThanOrEqual(1);
  });

  test("putStream aborts remaining writes and writes no Manifest when a concurrent block put fails", async () => {
    const alice = generateIdentity("did:example:alice");
    const backing = new MemoryBlockStore();
    let puts = 0;
    const flaky: BlockStore = {
      get: (c, o) => backing.get(c, o),
      async put(c, b, o) {
        puts += 1;
        if (puts === 2) throw new Error("disk-full");
        return backing.put(c, b, o);
      },
    };
    const publisher = new AgentData({ identity: alice, store: flaky });
    async function* sixChunks() {
      for (let i = 0; i < 6; i += 1) {
        yield patternBytes(512, i);
      }
    }
    await expect(
      publisher.putStream(sixChunks(), { plaintextSize: 6 * 512, chunkSize: 512, concurrency: 3 }),
    ).rejects.toThrow("disk-full");
    // No manifest block was published after the chunk failure.
    expect(puts).toBeLessThan(7);
  });

  test("getStream rejects tampered chunk mid-stream and aborts remaining prefetches", async () => {
    const alice = generateIdentity("did:example:alice");
    const backing = new MemoryBlockStore();
    const publisher = new AgentData({ identity: alice, store: backing });
    const payload = patternBytes(6 * 512, 33);
    const published = await publisher.putStream(payload, { chunkSize: 512, concurrency: 2 });
    const tamperedCid = published.manifest.chunks[2]!.cid;

    const sabotaged: BlockStore = {
      async get(cid, opts) {
        const bytes = await backing.get(cid, opts);
        if (bytes === null) return null;
        if (cid === tamperedCid) {
          const bad = bytes.slice();
          bad[bad.byteLength - 1] = bad[bad.byteLength - 1]! ^ 0xff;
          return bad;
        }
        return bytes;
      },
      put: (c, b, o) => backing.put(c, b, o),
    };
    const reader = new AgentData({ identity: alice, store: sabotaged });
    const grant = await publisher.share(published.ref, {
      audience: alice.id,
      audienceBoxPublicKey: alice.boxPublicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const received: Uint8Array[] = [];
    await expect((async () => {
      for await (const chunk of reader.getStream(published.ref, { grant, concurrency: 3 })) {
        received.push(chunk);
      }
    })()).rejects.toThrow();
    expect(received.length).toBe(2);
  });

  test("getStream preserves caller abort reason mid-stream", async () => {
    const alice = generateIdentity("did:example:alice");
    const backing = new MemoryBlockStore();
    const publisher = new AgentData({ identity: alice, store: backing });
    const payload = patternBytes(5 * 512, 19);
    const published = await publisher.putStream(payload, { chunkSize: 512 });

    const slow = delayedStore(backing, 60);
    const reader = new AgentData({ identity: alice, store: slow });
    const grant = await publisher.share(published.ref, {
      audience: alice.id,
      audienceBoxPublicKey: alice.boxPublicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const controller = new AbortController();
    const reason = new Error("stop-streaming-now");
    setTimeout(() => controller.abort(reason), 90);
    await expect(
      collectStream(reader.getStream(published.ref, { grant, concurrency: 2, signal: controller.signal })),
    ).rejects.toBe(reason);
  });
});
