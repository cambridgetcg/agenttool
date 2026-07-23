import { afterEach, describe, expect, test } from "bun:test";

import {
  AgentData,
  MemoryBlockStore,
  cidForBytes,
  identityFromPrivateKeys,
} from "@agenttool/adds";

import {
  ARCHIVE_PROTOCOL,
  ArchiveVerificationError,
  InvalidArchiveRecordError,
  RecoveryEnvelopeKeyStore,
  signPlacementReceipt,
  signRecoveryCatalog,
  signSnapshotDescriptor,
  signVerificationReceipt,
  validateZoneDescriptor,
  verifyRecoveryCatalog,
  verifySnapshotDescriptor,
  type RecoveryCatalogCore,
  type SignedPlacementReceipt,
  type SignedSnapshotDescriptor,
  type SignedVerificationReceipt,
  type ZoneDescriptor,
} from "../src/index.js";
import {
  cleanupTemporaryRoots,
} from "./helpers.js";

afterEach(cleanupTemporaryRoots);

function identity() {
  return identityFromPrivateKeys(
    "urn:test:archive-signer",
    Uint8Array.from({ length: 32 }, (_, index) => index),
    Uint8Array.from({ length: 32 }, (_, index) => index + 32),
  );
}

function snapshotCore() {
  return {
    protocol: ARCHIVE_PROTOCOL,
    kind: "snapshot" as const,
    vault_id: "urn:uuid:11111111-1111-4111-8111-111111111111",
    created_at: "2026-07-23T12:00:00.000Z",
    repository: {
      repository_id: "repo:test:fixture",
      object_format: "sha1" as const,
      head_revision: "a".repeat(40),
      head_kind: "branch" as const,
      branch: "main",
      symbolic_refs: [],
      refs_digest: `sha256:${"b".repeat(64)}` as const,
      refs_count: 2,
    },
    completeness: {
      status: "complete" as const,
      committed_history: "included" as const,
      workspace: {
        included: false as const,
        staged_changes: 0,
        tracked_changes: 0,
        untracked_files: 0,
        unmerged_paths: 0,
      },
      submodules: { included: false as const, gitlink_evidence_events: 0 },
      lfs: { included: false as const, pointer_evidence_events: 0 },
      external_filters: { included: false as const, attribute_evidence_events: 0 },
      shallow_clone: { detected: false, complete_history: true },
      partial_clone: { detected: false, promised_objects_materialized: false as const },
      alternates: {
        detected: false,
        alternate_locations: 0,
        objects_materialized: false as const,
      },
      linked_worktrees: { included: false as const, additional_worktrees: 0 },
      ignored_files: { included: false as const, assessed: false as const },
      reasons: [],
    },
    payload: {
      format: "git-bundle" as const,
      bundle_version: "v2-or-v3" as const,
      digest: `sha256:${"c".repeat(64)}` as const,
      bytes: 123,
    },
    parent_snapshot_id: null,
    authority: {
      automatic_restore: "never" as const,
      execute_repository_code: "never" as const,
      checkout: "explicit_after_restore" as const,
    },
  };
}

function catalogZones(): ZoneDescriptor[] {
  return ["a", "b", "c"].map((label) => ({
    zone_id: `zone-${label}`,
    transport: "other",
    locator: `test:zone-${label}`,
    assurance: "simulated",
    delete_authority: "unknown",
    failure_domain: {
      failure_domain_id: `domain-${label}`,
      provider: `provider-${label}`,
      account_root: `account-${label}`,
      region: `region-${label}`,
      credential_root: `credential-${label}`,
      media: `media-${label}`,
    },
  }));
}

async function catalogFixture(): Promise<{
  signingIdentity: ReturnType<typeof identity>;
  core: Omit<RecoveryCatalogCore, "signer" | "status">;
  snapshot: SignedSnapshotDescriptor;
  placements: SignedPlacementReceipt[];
  verifications: SignedVerificationReceipt[];
}> {
  const signingIdentity = identity();
  const snapshot = signSnapshotDescriptor(snapshotCore(), signingIdentity);
  const snapshotRootCid = cidForBytes(new TextEncoder().encode("snapshot manifest"));
  const recoveryKey = Uint8Array.from({ length: 32 }, (_, index) => index + 7);
  const objectKey = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
  const keys = new RecoveryEnvelopeKeyStore({
    vaultId: snapshot.vault_id,
    recoveryKeyId: "urn:uuid:22222222-2222-4222-8222-222222222222",
    recoveryKey,
  });
  await keys.set(snapshotRootCid, objectKey);
  const snapshotKeyEnvelope = keys.exportEnvelope(snapshotRootCid);
  keys.close();
  recoveryKey.fill(0);
  objectKey.fill(0);

  const zones = catalogZones();
  const placements = zones.map((zone) => signPlacementReceipt({
    protocol: ARCHIVE_PROTOCOL,
    kind: "placement",
    vault_id: snapshot.vault_id,
    snapshot_id: snapshot.record_id,
    snapshot_root_cid: snapshotRootCid,
    zone,
    result: "observed",
    ciphertext_blocks_observed: 2,
    encrypted_bytes_observed: 512,
    observed_at: "2026-07-23T12:00:00.000Z",
    caveat: "observation_is_not_future_durability",
  }, signingIdentity));
  const verifications = zones.map((zone) => signVerificationReceipt({
    protocol: ARCHIVE_PROTOCOL,
    kind: "verification",
    vault_id: snapshot.vault_id,
    snapshot_id: snapshot.record_id,
    snapshot_root_cid: snapshotRootCid,
    zone_id: zone.zone_id,
    method: "full_restore",
    result: "verified",
    ciphertext_blocks_verified: 2,
    payload_digest_verified: snapshot.payload.digest,
    git_bundle_verified: true,
    git_fsck: "passed",
    checkout_performed: false,
    restored_head: snapshot.repository.head_revision,
    verified_at: "2026-07-23T12:00:00.000Z",
  }, signingIdentity));
  return {
    signingIdentity,
    snapshot,
    placements,
    verifications,
    core: {
      protocol: ARCHIVE_PROTOCOL,
      kind: "catalog",
      vault_id: snapshot.vault_id,
      generation: 1,
      parent_catalog_id: null,
      created_at: "2026-07-23T12:00:00.000Z",
      required_verified_zones: 3,
      snapshot_root_cid: snapshotRootCid,
      snapshot,
      snapshot_key_envelope: snapshotKeyEnvelope,
      zones,
      placements,
      verifications,
      authority: snapshot.authority,
    },
  };
}

describe("closed signed archive records", () => {
  test("signs, verifies, and rejects unknown or tampered fields", () => {
    const signed = signSnapshotDescriptor(snapshotCore(), identity());
    expect(signed.record_id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifySnapshotDescriptor(signed)).toEqual(signed);

    const changed = structuredClone(signed);
    changed.repository.head_revision = "d".repeat(40);
    expect(() => verifySnapshotDescriptor(changed)).toThrow("record_id");

    const extended = { ...signed, private_key: "not-admitted" };
    expect(() => verifySnapshotDescriptor(extended)).toThrow("unsupported");
  });

  test("admits a bounded reason-only conservative incomplete assessment", () => {
    const core = snapshotCore();
    const signed = signSnapshotDescriptor({
      ...core,
      completeness: {
        ...core.completeness,
        status: "incomplete",
        reasons: ["one named ref does not peel to a commit"],
      },
    }, identity());
    expect(verifySnapshotDescriptor(signed)).toEqual(signed);
    expect(() => signSnapshotDescriptor({
      ...core,
      completeness: {
        ...core.completeness,
        reasons: ["complete records cannot carry gap reasons"],
      },
    }, identity())).toThrow("completeness status");
  });

  test("binds catalog health to distinct domains and exact nested evidence", async () => {
    const fixture = await catalogFixture();
    const catalog = signRecoveryCatalog(fixture.core, fixture.signingIdentity);
    expect(catalog.status).toBe("verified");
    expect(verifyRecoveryCatalog(catalog)).toEqual(catalog);

    const {
      signer: _verificationSigner,
      record_id: _verificationId,
      signature: _verificationSignature,
      ...verificationCore
    } = fixture.verifications[0]!;
    const wrongDigest = signVerificationReceipt({
      ...verificationCore,
      payload_digest_verified: `sha256:${"f".repeat(64)}`,
    }, fixture.signingIdentity);
    expect(() => signRecoveryCatalog({
      ...fixture.core,
      verifications: [wrongDigest, ...fixture.verifications.slice(1)],
    }, fixture.signingIdentity)).toThrow("does not match");

    expect(() => signRecoveryCatalog({
      ...fixture.core,
      placements: fixture.placements.slice(1),
    }, fixture.signingIdentity)).toThrow("no matching placement");

    const relabelledZone = {
      ...fixture.core.zones[0]!,
      locator: "test:another-zone-a",
    };
    const {
      signer: _placementSigner,
      record_id: _placementId,
      signature: _placementSignature,
      ...placementCore
    } = fixture.placements[0]!;
    const wrongPlacement = signPlacementReceipt({
      ...placementCore,
      zone: relabelledZone,
    }, fixture.signingIdentity);
    expect(() => signRecoveryCatalog({
      ...fixture.core,
      placements: [wrongPlacement, ...fixture.placements.slice(1)],
    }, fixture.signingIdentity)).toThrow("descriptor");

    const crossVaultSnapshot = signSnapshotDescriptor({
      ...snapshotCore(),
      vault_id: "urn:uuid:99999999-9999-4999-8999-999999999999",
    }, fixture.signingIdentity);
    expect(() => signRecoveryCatalog({
      ...fixture.core,
      snapshot: crossVaultSnapshot,
    }, fixture.signingIdentity)).toThrow("another vault");
  });

  test("rejects secret-like identities, locators, invalid dates, and fake CIDs", () => {
    expect(() => signSnapshotDescriptor({
      ...snapshotCore(),
      repository: {
        ...snapshotCore().repository,
        repository_id: "/Users/example/private",
      },
    }, identity())).toThrow("filesystem path");
    expect(() => signSnapshotDescriptor({
      ...snapshotCore(),
      repository: {
        ...snapshotCore().repository,
        repository_id: "relative/repository",
      },
    }, identity())).toThrow("filesystem path");
    expect(() => signSnapshotDescriptor({
      ...snapshotCore(),
      created_at: "2026-02-31T12:00:00.000Z",
    }, identity())).toThrow("valid timestamp");
    expect(() => validateZoneDescriptor({
      ...catalogZones()[0]!,
      locator: "https://user:password@example.test/archive?token=secret",
    })).toThrow("admitted");

    const signed = signSnapshotDescriptor(snapshotCore(), identity());
    expect(() => signPlacementReceipt({
      protocol: ARCHIVE_PROTOCOL,
      kind: "placement",
      vault_id: signed.vault_id,
      snapshot_id: signed.record_id,
      snapshot_root_cid: `b${"a".repeat(58)}` as never,
      zone: catalogZones()[0]!,
      result: "observed",
      ciphertext_blocks_observed: 1,
      encrypted_bytes_observed: 1,
      observed_at: "2026-07-23T12:00:00.000Z",
      caveat: "observation_is_not_future_durability",
    }, identity())).toThrow(InvalidArchiveRecordError);
  });
});

describe("recovery key envelopes", () => {
  test("survive publisher state loss and bind the key to one manifest CID", async () => {
    const recoveryKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const objectKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const manifestCid = cidForBytes(new TextEncoder().encode("manifest-a"));
    const original = new RecoveryEnvelopeKeyStore({
      vaultId: "urn:uuid:11111111-1111-4111-8111-111111111111",
      recoveryKeyId: "urn:uuid:22222222-2222-4222-8222-222222222222",
      recoveryKey,
    });
    await original.set(manifestCid, objectKey);
    const envelope = original.exportEnvelope(manifestCid);
    original.close();

    expect(JSON.stringify(envelope)).not.toContain(Buffer.from(objectKey).toString("base64url"));
    const recoveredStore = new RecoveryEnvelopeKeyStore({
      vaultId: envelope.vault_id,
      recoveryKeyId: envelope.recovery_key_id,
      recoveryKey,
      envelopes: [envelope],
    });
    expect(await recoveredStore.get(manifestCid)).toEqual(objectKey);
    recoveredStore.close();

    const anotherCid = cidForBytes(new TextEncoder().encode("manifest-b"));
    const rebound = { ...envelope, manifest_cid: anotherCid };
    const reboundStore = new RecoveryEnvelopeKeyStore({
      vaultId: rebound.vault_id,
      recoveryKeyId: rebound.recovery_key_id,
      recoveryKey,
      envelopes: [rebound],
    });
    await expect(reboundStore.get(anotherCid)).rejects.toBeInstanceOf(ArchiveVerificationError);
    reboundStore.close();
    recoveryKey.fill(0);
    objectKey.fill(0);
  });

  test("never stores plaintext object or recovery keys in ADDS blocks", async () => {
    const backing = new MemoryBlockStore();
    const written: Uint8Array[] = [];
    const blockStore = {
      get: backing.get.bind(backing),
      async put(...args: Parameters<MemoryBlockStore["put"]>) {
        written.push(Uint8Array.from(args[1]));
        return backing.put(...args);
      },
    };
    const recoveryKey = Uint8Array.from({ length: 32 }, (_, index) => 240 - index);
    const objectKeys: Uint8Array[] = [];
    class RecordingKeyStore extends RecoveryEnvelopeKeyStore {
      override async set(manifestCid: Parameters<RecoveryEnvelopeKeyStore["set"]>[0], key: Uint8Array) {
        objectKeys.push(Uint8Array.from(key));
        await super.set(manifestCid, key);
      }
    }
    const keyStore = new RecordingKeyStore({
      vaultId: "urn:test:key-storage",
      recoveryKeyId: "urn:test:key-storage:root",
      recoveryKey,
    });
    const publisher = new AgentData({
      identity: identity(),
      store: blockStore,
      keyStore,
    });
    await publisher.put(new TextEncoder().encode("encrypted archive payload"), {
      schema: "urn:test:encrypted",
      mediaType: "application/octet-stream",
    });
    const contains = (haystack: Uint8Array, needle: Uint8Array): boolean => {
      outer: for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
        for (let index = 0; index < needle.byteLength; index += 1) {
          if (haystack[offset + index] !== needle[index]) continue outer;
        }
        return true;
      }
      return false;
    };
    expect(written.length).toBeGreaterThan(0);
    expect(objectKeys).toHaveLength(1);
    for (const bytes of written) {
      expect(contains(bytes, recoveryKey)).toBe(false);
      expect(contains(bytes, objectKeys[0]!)).toBe(false);
    }
    keyStore.close();
    recoveryKey.fill(0);
    objectKeys[0]!.fill(0);
  });
});
