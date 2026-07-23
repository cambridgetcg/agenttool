import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ADDS_BUNDLE_PROTOCOL,
  AgentData,
  IntegrityError,
  LimitExceededError,
  MemoryBlockStore,
  canonicalJsonBytes,
  cidForBytes,
  generateIdentity,
  type BlockStore,
  type PortableBundle,
  type StoreOperationOptions,
} from "../src/index.js";
import { FileSystemBlockStore } from "../src/file-store.js";

const NOW = 1_783_728_000;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function cloneBundle(bundle: PortableBundle): PortableBundle {
  return {
    protocol: bundle.protocol,
    root: { ...bundle.root },
    blocks: bundle.blocks.map((block) => ({ cid: block.cid, bytes: block.bytes.slice() })),
  };
}

class CountingStore implements BlockStore {
  readonly backing = new MemoryBlockStore();
  puts = 0;

  get(cid: string, options?: StoreOperationOptions): Promise<Uint8Array | null> {
    return this.backing.get(cid, options);
  }

  put(cid: string, bytes: Uint8Array, options?: StoreOperationOptions) {
    this.puts += 1;
    return this.backing.put(cid, bytes, options);
  }
}

describe("ADDS portable bundles", () => {
  test("exports and imports a keyless ordered bundle for an authorised offline reader", async () => {
    const publisherStore = new MemoryBlockStore();
    const receiverStore = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const bob = generateIdentity("did:example:bob");
    const publisher = new AgentData({ identity: alice, store: publisherStore, now: () => NOW });
    const plaintext = new TextEncoder().encode("transport-neutral encrypted object bundle");
    const published = await publisher.put(plaintext, { chunkSize: 7, createdAt: NOW });
    const grant = await publisher.share(published.ref, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      expiresAt: NOW + 3_600,
    });

    const bundle = await new AgentData({ store: publisherStore }).exportBundle(published.ref);
    expect(bundle.protocol).toBe(ADDS_BUNDLE_PROTOCOL);
    expect(bundle.root).toEqual(published.ref);
    expect(bundle.blocks[0]!.cid).toBe(published.ref.cid);
    expect(bundle.blocks.slice(1).map((block) => block.cid)).toEqual(
      published.manifest.chunks.map((chunk) => chunk.cid),
    );
    expect(JSON.stringify(bundle)).not.toContain("key_wrap");
    expect(JSON.stringify(bundle)).not.toContain("signingPrivateKey");

    const receiver = new AgentData({ identity: bob, store: receiverStore, now: () => NOW });
    const imported = await receiver.importBundle(bundle);
    expect(imported).toMatchObject({
      cid: published.ref.cid,
      ref: published.ref,
      ciphertextBlocksVerified: published.manifest.chunks.length,
      replication: {
        storedObjects: published.manifest.chunks.length + 1,
        minimumAcknowledgements: 1,
      },
    });
    expect(imported.bundleBytes).toBe(bundle.blocks.reduce((sum, block) => sum + block.bytes.byteLength, 0));
    expect(await receiver.verify(published.ref)).toMatchObject({
      cid: published.ref.cid,
      ciphertextBlocksVerified: published.manifest.chunks.length,
    });
    expect(await receiver.get(published.ref, { grant, now: NOW })).toEqual(plaintext);
  });

  test("rejects incomplete, reordered, CID-tampered, and signature-tampered bundles before writes", async () => {
    const publisherStore = new MemoryBlockStore();
    const publisher = new AgentData({
      identity: generateIdentity("did:example:publisher"),
      store: publisherStore,
      now: () => NOW,
    });
    const published = await publisher.put("strict portable bundle validation", {
      chunkSize: 5,
      createdAt: NOW,
      mediaType: "text/plain",
    });
    const honest = await publisher.exportBundle(published.ref);

    const cases: PortableBundle[] = [];
    const incomplete = cloneBundle(honest);
    incomplete.blocks.pop();
    cases.push(incomplete);

    const reordered = cloneBundle(honest);
    [reordered.blocks[1], reordered.blocks[2]] = [reordered.blocks[2]!, reordered.blocks[1]!];
    cases.push(reordered);

    const corruptCiphertext = cloneBundle(honest);
    corruptCiphertext.blocks[1]!.bytes[12] = corruptCiphertext.blocks[1]!.bytes[12]! ^ 1;
    cases.push(corruptCiphertext);

    const duplicate = cloneBundle(honest);
    duplicate.blocks[2] = {
      cid: duplicate.blocks[1]!.cid,
      bytes: duplicate.blocks[1]!.bytes.slice(),
    };
    cases.push(duplicate);

    for (const bundle of cases) {
      const target = new CountingStore();
      await expect(new AgentData({ store: target }).importBundle(bundle)).rejects.toBeInstanceOf(IntegrityError);
      expect(target.puts).toBe(0);
    }

    const signedManifestTamper = cloneBundle(honest);
    const manifest = structuredClone(published.manifest);
    manifest.media_type = "application/octet-stream";
    const manifestBytes = canonicalJsonBytes(manifest);
    const manifestCid = cidForBytes(manifestBytes);
    signedManifestTamper.root.cid = manifestCid;
    signedManifestTamper.blocks[0] = { cid: manifestCid, bytes: manifestBytes };
    const target = new CountingStore();
    await expect(new AgentData({ store: target }).importBundle(signedManifestTamper)).rejects.toBeInstanceOf(
      IntegrityError,
    );
    expect(target.puts).toBe(0);
  });

  test("enforces aggregate byte, plaintext, block, shape, and abort limits before writes", async () => {
    const publisherStore = new MemoryBlockStore();
    const publisher = new AgentData({
      identity: generateIdentity("did:example:limits"),
      store: publisherStore,
      now: () => NOW,
    });
    const published = await publisher.put(new Uint8Array(24), { chunkSize: 8, createdAt: NOW });
    const bundle = await publisher.exportBundle(published.ref);
    const bundleBytes = bundle.blocks.reduce((sum, block) => sum + block.bytes.byteLength, 0);

    await expect(publisher.exportBundle(published.ref, { maxBundleBytes: bundleBytes - 1 })).rejects.toBeInstanceOf(
      LimitExceededError,
    );

    for (const options of [
      { maxBundleBytes: bundleBytes - 1 },
      { maxBytes: 23 },
    ]) {
      const target = new CountingStore();
      await expect(new AgentData({ store: target }).importBundle(bundle, options)).rejects.toBeInstanceOf(
        LimitExceededError,
      );
      expect(target.puts).toBe(0);
    }

    const blockLimited = new CountingStore();
    await expect(new AgentData({ store: blockLimited, maxBlocks: 2 }).importBundle(bundle)).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    expect(blockLimited.puts).toBe(0);

    const extraField = cloneBundle(bundle) as PortableBundle & { grant: string };
    extraField.grant = "must-not-be-accepted";
    const strictTarget = new CountingStore();
    await expect(new AgentData({ store: strictTarget }).importBundle(extraField)).rejects.toThrow(
      "unsupported field grant",
    );
    expect(strictTarget.puts).toBe(0);

    const abortedTarget = new CountingStore();
    const controller = new AbortController();
    const reason = new Error("stop portable import");
    controller.abort(reason);
    try {
      await new AgentData({ store: abortedTarget }).importBundle(bundle, { signal: controller.signal });
      throw new Error("import should have aborted");
    } catch (error) {
      expect(error).toBe(reason);
    }
    expect(abortedTarget.puts).toBe(0);
  });

  test("keeps a failed import retryable by writing the root last", async () => {
    const publisherStore = new MemoryBlockStore();
    const publisher = new AgentData({
      identity: generateIdentity("did:example:partial"),
      store: publisherStore,
      now: () => NOW,
    });
    const published = await publisher.put("resume after a partial portable import", {
      chunkSize: 6,
      createdAt: NOW,
    });
    const bundle = await publisher.exportBundle(published.ref);
    const backing = new MemoryBlockStore();
    const failCid = bundle.blocks[2]!.cid;
    let failOnce = true;
    const flaky: BlockStore = {
      get: (cid, options) => backing.get(cid, options),
      async put(cid, bytes, options) {
        if (cid === failCid && failOnce) {
          failOnce = false;
          throw new Error("synthetic partial import failure");
        }
        return backing.put(cid, bytes, options);
      },
    };
    const receiver = new AgentData({ store: flaky });

    await expect(receiver.importBundle(bundle)).rejects.toThrow("synthetic partial import failure");
    expect(await backing.get(bundle.blocks[1]!.cid)).not.toBeNull();
    expect(await backing.get(bundle.root.cid)).toBeNull();

    await expect(receiver.importBundle(bundle)).resolves.toMatchObject({ cid: bundle.root.cid });
    expect(await backing.get(bundle.root.cid)).not.toBeNull();
    await expect(receiver.verify(bundle.root)).resolves.toMatchObject({ cid: bundle.root.cid });
  });

  test("survives a filesystem-store reopen and remains decryptable with the separate direct Grant", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttool-adds-bundle-"));
    temporaryDirectories.push(directory);
    const publisherStore = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice-restart");
    const bob = generateIdentity("did:example:bob-restart");
    const publisher = new AgentData({ identity: alice, store: publisherStore, now: () => NOW });
    const published = await publisher.put("restart-safe content-addressed copy", {
      chunkSize: 8,
      createdAt: NOW,
    });
    const grant = await publisher.share(published.ref, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      expiresAt: NOW + 3_600,
    });
    const bundle = await publisher.exportBundle(published.ref);

    await new AgentData({ store: new FileSystemBlockStore(directory) }).importBundle(bundle);
    const reopened = new AgentData({
      identity: bob,
      store: new FileSystemBlockStore(directory),
      now: () => NOW,
    });
    expect(new TextDecoder().decode(await reopened.get(published.ref, { grant, now: NOW }))).toBe(
      "restart-safe content-addressed copy",
    );
  });
});
