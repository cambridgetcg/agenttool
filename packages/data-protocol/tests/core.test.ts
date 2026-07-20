import { describe, expect, test } from "bun:test";

import {
  AccessDeniedError,
  AgentData,
  IntegrityError,
  InvalidInputError,
  LimitExceededError,
  MemoryBlockStore,
  MemoryKeyStore,
  canonicalJsonBytes,
  cidForBytes,
  generateIdentity,
  identityFromPrivateKeys,
  validateGrant,
  validateManifest,
  verifyManifestSignature,
  type BlockStore,
  type StoreOperationOptions,
  type UnsignedGrant,
} from "../src/index.js";
import {
  signGrant,
  signManifest,
  signerForIdentity,
  strictEd25519Verify,
  unwrapObjectKeyUnsafe,
  wrapObjectKey,
  x25519KeyId,
} from "../src/crypto.js";
import { base64UrlEncode, randomBytes } from "../src/bytes.js";

const NOW = 1_783_728_000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function client(identity: ReturnType<typeof generateIdentity>, store: BlockStore, keyStore = new MemoryKeyStore()) {
  return new AgentData({ identity, store, keyStore, now: () => NOW });
}

describe("AgentData encrypted object flow", () => {
  test("multi-chunk offline publish, inspect, verify, grant, and recipient roundtrip", async () => {
    const store = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const bob = generateIdentity("did:example:bob");
    const aliceData = client(alice, store);
    const bobData = client(bob, store);
    const plaintext = textEncoder.encode("ADDS keeps locations out of signed manifests 🌞");

    const published = await aliceData.put(plaintext, {
      chunkSize: 7,
      createdAt: NOW,
      mediaType: "text/plain; charset=utf-8",
      schema: "https://example.test/text/v1",
      metadata: { language: "en", private: true },
    });

    expect("key" in published).toBe(false);
    expect(JSON.stringify(published)).not.toContain("signingPrivateKey");
    expect(published.manifest.chunks.length).toBeGreaterThan(1);
    expect(published.manifest).not.toHaveProperty("locations");
    expect(published.manifest).not.toHaveProperty("providers");
    expect(published.replication.minimumAcknowledgements).toBe(1);
    expect(published.replication.storedObjects).toBe(published.manifest.chunks.length + 1);

    const inspected = await bobData.inspect(published.ref);
    expect(inspected.object_id).toStartWith("urn:uuid:");
    const verified = await bobData.verify(published.ref);
    expect(verified.ciphertextBlocksVerified).toBe(inspected.chunks.length);

    const grant = await aliceData.share(published, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      expiresAt: NOW + 3_600,
    });
    expect(grant.audience_x25519_key_id).toBe(x25519KeyId(bob.boxPublicKey));
    const received = await bobData.get(published.ref, { grant, now: NOW });
    expect(received).toEqual(plaintext);
  });

  test("empty plaintext is one authenticated 28-byte block frame", async () => {
    const store = new MemoryBlockStore();
    const aliceData = client(generateIdentity("did:example:alice"), store);
    const published = await aliceData.put(new Uint8Array(0), { createdAt: NOW });
    expect(published.manifest.chunks).toHaveLength(1);
    expect(published.manifest.chunks[0]!.plaintext_size).toBe(0);
    expect(published.manifest.chunks[0]!.ciphertext_size).toBe(16);
    const frame = await store.get(published.manifest.chunks[0]!.cid);
    expect(frame).not.toBeNull();
    expect(frame!.byteLength).toBe(28);
    expect(await aliceData.get(published.ref)).toEqual(new Uint8Array(0));
  });

  test("wrong recipient identity/key and expired grants fail closed", async () => {
    const store = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const bob = generateIdentity("did:example:bob");
    const charlie = generateIdentity("did:example:charlie");
    const aliceData = client(alice, store);
    const published = await aliceData.put("secret", { createdAt: NOW });
    const grant = await aliceData.share(published.ref, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      notBefore: NOW + 10,
      expiresAt: NOW + 20,
    });

    await expect(client(charlie, store).get(published.ref, { grant, now: NOW + 10 })).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(client(bob, store).get(published.ref, { grant, now: NOW + 9 })).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(textDecoder.decode(await client(bob, store).get(published.ref, { grant, now: NOW + 10 }))).toBe("secret");
    expect(textDecoder.decode(await client(bob, store).get(published.ref, { grant, now: NOW + 19 }))).toBe("secret");
    await expect(client(bob, store).get(published.ref, { grant, now: NOW + 20 })).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  test("grant lifetime policy rejects overlong outgoing and incoming grants before retrieval", async () => {
    const store = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const bob = generateIdentity("did:example:bob");
    const standardPublisher = client(alice, store);
    const published = await standardPublisher.put("bounded", { createdAt: NOW });
    await expect(standardPublisher.share(published.ref, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      expiresAt: NOW + 30 * 24 * 60 * 60 + 1,
    })).rejects.toBeInstanceOf(LimitExceededError);

    const permissivePublisher = new AgentData({
      identity: alice,
      store,
      keyStore: new MemoryKeyStore(),
      maxGrantLifetimeSeconds: 60 * 24 * 60 * 60,
      now: () => NOW,
    });
    const permissivePublished = await permissivePublisher.put("bounded incoming", { createdAt: NOW });
    const longGrant = await permissivePublisher.share(permissivePublished.ref, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      expiresAt: NOW + 31 * 24 * 60 * 60,
    });
    let reads = 0;
    const countingStore: BlockStore = {
      get(cid, options) {
        reads += 1;
        return store.get(cid, options);
      },
      put: (cid, bytes, options) => store.put(cid, bytes, options),
    };
    await expect(client(bob, countingStore).get(permissivePublished.ref, {
      grant: longGrant,
      now: NOW,
    })).rejects.toBeInstanceOf(AccessDeniedError);
    expect(reads).toBe(0);
  });

  test("a validly signed recipient regrant is rejected when issuer is not publisher", async () => {
    const store = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const bob = generateIdentity("did:example:bob");
    const charlie = generateIdentity("did:example:charlie");
    const aliceData = client(alice, store);
    const published = await aliceData.put("publisher-only root authority", { createdAt: NOW });
    const toBob = await aliceData.share(published.ref, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      expiresAt: NOW + 100,
    });
    const objectKey = await unwrapObjectKeyUnsafe(toBob, bob.id, bob.boxPrivateKey);
    try {
      const beforeWrap: Omit<UnsignedGrant, "key_wrap"> = {
        adds_version: "0.1",
        kind: "grant",
        grant_id: `urn:uuid:${crypto.randomUUID()}`,
        manifest_cid: published.ref.cid,
        issuer: signerForIdentity(bob),
        audience: charlie.id,
        audience_x25519_public_key: base64UrlEncode(charlie.boxPublicKey),
        audience_x25519_key_id: x25519KeyId(charlie.boxPublicKey),
        rights: ["read"],
        issued_at: NOW,
        expires_at: NOW + 50,
      };
      const keyWrap = await wrapObjectKey(objectKey, beforeWrap, charlie.boxPublicKey);
      const regrant = signGrant({ ...beforeWrap, key_wrap: keyWrap }, bob);
      validateGrant(regrant);
      await expect(client(charlie, store).get(published.ref, { grant: regrant, now: NOW })).rejects.toThrow(
        "issuer is not the manifest publisher",
      );
    } finally {
      objectKey.fill(0);
    }
  });

  test("CID tamper, signature tamper, wrong imported key, and signed AAD mutation are rejected", async () => {
    const honestStore = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const bob = generateIdentity("did:example:bob");
    const aliceKeys = new MemoryKeyStore();
    const aliceData = client(alice, honestStore, aliceKeys);
    const published = await aliceData.put("tamper-evident", { chunkSize: 4, createdAt: NOW });

    const blockCid = published.manifest.chunks[0]!.cid;
    const tamperingStore: BlockStore = {
      put: (cid, bytes, options) => honestStore.put(cid, bytes, options),
      async get(cid, options) {
        const bytes = await honestStore.get(cid, options);
        if (bytes !== null && cid === blockCid) bytes[12] = bytes[12]! ^ 1;
        return bytes;
      },
    };
    await expect(new AgentData({ store: tamperingStore }).verify(published.ref)).rejects.toBeInstanceOf(IntegrityError);

    const grant = await aliceData.share(published.ref, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      expiresAt: NOW + 100,
    });
    const mutatedGrant = structuredClone(grant);
    mutatedGrant.signature.value = `${mutatedGrant.signature.value.startsWith("A") ? "B" : "A"}${mutatedGrant.signature.value.slice(1)}`;
    expect(() => validateGrant(mutatedGrant)).toThrow(IntegrityError);

    const wrongKeyReader = new AgentData({ store: honestStore, keyStore: new MemoryKeyStore() });
    await wrongKeyReader.importKey(published.ref, randomBytes(32));
    await expect(wrongKeyReader.get(published.ref)).rejects.toBeInstanceOf(IntegrityError);

    const objectKey = await unwrapObjectKeyUnsafe(grant, bob.id, bob.boxPrivateKey);
    try {
      const { signature: _signature, ...unsigned } = published.manifest;
      const aadMutated = signManifest({
        ...unsigned,
        encryption: { ...unsigned.encryption, key_id: `${unsigned.encryption.key_id}-changed` },
      }, alice);
      const manifestBytes = canonicalJsonBytes(aadMutated);
      const manifestCid = cidForBytes(manifestBytes);
      await honestStore.put(manifestCid, manifestBytes);
      const reader = new AgentData({ store: honestStore, keyStore: new MemoryKeyStore() });
      await reader.importKey(manifestCid, objectKey);
      await expect(reader.get(manifestCid)).rejects.toBeInstanceOf(IntegrityError);
    } finally {
      objectKey.fill(0);
    }
  });

  test("maxBytes and maxBlocks reject before object writes; ordinary put never exposes a DEK", async () => {
    let puts = 0;
    const backing = new MemoryBlockStore();
    const countingStore: BlockStore = {
      get: (cid, options) => backing.get(cid, options),
      put(cid, bytes, options) {
        puts += 1;
        return backing.put(cid, bytes, options);
      },
    };
    const data = new AgentData({
      identity: generateIdentity("did:example:alice"),
      store: countingStore,
      maxBlocks: 2,
      now: () => NOW,
    });
    await expect(data.put(new Uint8Array(3), { chunkSize: 1 })).rejects.toBeInstanceOf(LimitExceededError);
    expect(puts).toBe(0);
    await expect(data.put(new Blob([new Uint8Array(10)]), { maxBytes: 9 })).rejects.toBeInstanceOf(LimitExceededError);
    expect(puts).toBe(0);
    const metadataLimited = new AgentData({
      identity: generateIdentity("did:example:metadata-limited"),
      store: countingStore,
      maxManifestBytes: 512,
      now: () => NOW,
    });
    await expect(metadataLimited.put(new Uint8Array([1]), {
      metadata: { large: "x".repeat(1_000) },
    })).rejects.toBeInstanceOf(LimitExceededError);
    expect(puts).toBe(0);
    const hintLimited = new AgentData({
      identity: generateIdentity("did:example:hint-limited"),
      store: countingStore,
      maxManifestBytes: 2_500,
      now: () => NOW,
    });
    await expect(hintLimited.put(new Uint8Array([1]), {
      schema: "s".repeat(1_024),
      mediaType: "m".repeat(1_024),
    })).rejects.toBeInstanceOf(LimitExceededError);
    expect(puts).toBe(0);

    const published = await data.put(new Uint8Array([1, 2]), { chunkSize: 1 });
    expect("key" in published).toBe(false);
    await expect(data.get(published.ref, { maxBytes: 1 })).rejects.toBeInstanceOf(LimitExceededError);
  });

  test("signing and box roles reject exact private-key reuse", () => {
    const seed = randomBytes(32);
    expect(() => identityFromPrivateKeys("did:example:bad", seed, seed)).toThrow(InvalidInputError);
  });

  test("unsupported Grant controls and relative extension namespaces fail closed", async () => {
    const store = new MemoryBlockStore();
    const alice = generateIdentity("did:example:alice");
    const bob = generateIdentity("did:example:bob");
    const aliceData = client(alice, store);
    const published = await aliceData.put("profile boundaries", { createdAt: NOW });
    const grant = await aliceData.share(published.ref, {
      audience: bob.id,
      audienceBoxPublicKey: bob.boxPublicKey,
      issuedAt: NOW,
      expiresAt: NOW + 100,
    });

    const broaderRights = structuredClone(grant) as unknown as { rights: string[] };
    broaderRights.rights = ["read", "delegate"];
    expect(() => validateGrant(broaderRights)).toThrow("exactly rights");

    const scoped = structuredClone(grant) as unknown as Record<string, unknown>;
    scoped.scope = { task_id: "task:1" };
    expect(() => validateGrant(scoped)).toThrow("scope is not supported");

    const delegated = structuredClone(grant) as unknown as Record<string, unknown>;
    delegated.parent_grant = published.ref.cid;
    expect(() => validateGrant(delegated)).toThrow("parent_grant is not supported");

    const badExtension = structuredClone(published.manifest) as unknown as Record<string, unknown>;
    badExtension.extensions = { relative: true };
    expect(() => validateManifest(badExtension)).toThrow("absolute URI namespaces");
  });

  test("Ed25519 verification rejects ZIP-215 small-order keys under strict RFC 8032", () => {
    const smallOrderPublicKey = new Uint8Array(32);
    smallOrderPublicKey[0] = 1;
    const smallOrderSignature = new Uint8Array(64);
    smallOrderSignature[0] = 1;
    const publicKey = base64UrlEncode(smallOrderPublicKey);
    const forged = {
      adds_version: "0.1",
      kind: "manifest",
      object_id: "urn:uuid:00000000-0000-4000-8000-000000000000",
      publisher: { id: "did:example:forged", ed25519_public_key: publicKey },
      created_at: NOW,
      plaintext: { size: 0 },
      encryption: {
        algorithm: "AES-256-GCM",
        key_id: "test",
        chunk_size: 1,
        block_aad: "adds-block/v1",
        aad_context: base64UrlEncode(new Uint8Array(32)),
      },
      chunks: [],
      signature: {
        algorithm: "Ed25519",
        public_key: publicKey,
        value: base64UrlEncode(smallOrderSignature),
      },
    } as unknown as Parameters<typeof verifyManifestSignature>[0];
    expect(verifyManifestSignature(forged)).toBe(false);
  });

  test("ADDS Ed25519 rejects small- and mixed-order R points accepted by cofactored verification", () => {
    const publicKey = Uint8Array.from(Buffer.from(
      "a2fa2f4a355ba2e907a53009e9e37caddf7ac7e66a08ba07631f553072b3f24c",
      "hex",
    ));
    const message = textEncoder.encode("test");
    const signatures = [
      "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7fd33d74a93bc0499546b6eac70e94efb3f62779f77be4de831c0e624f5d8b3e07",
      "2947ff378fef06b97cfc2115789afc17794021e6ff1617b902b3c32f63e3436048b3d75478dd580c67e8801e15b492582366b2cd2cd4e086626d46fc1f0f0203",
    ];
    for (const signature of signatures) {
      expect(strictEd25519Verify(Uint8Array.from(Buffer.from(signature, "hex")), message, publicKey)).toBe(false);
    }
  });
});
