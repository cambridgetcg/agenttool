import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentData,
  MemoryBlockStore,
  canonicalJsonBytes,
  parseCanonicalJson,
  type Cid,
  type JsonObject,
  type PortableBundle,
  type SignedManifest,
} from "@agenttool/adds";

import {
  ARCHIVE_PROTOCOL,
  DEFAULT_ARCHIVE_CHUNK_SIZE,
  DEFAULT_ARCHIVE_MAX_BYTES,
  DEFAULT_REQUIRED_VERIFIED_ZONES,
  type ArchiveRepositoryOptions,
  type ArchiveZone,
  type ArchivedRepository,
  type RecoveryCapsule,
  type RecoveryKeyEnvelope,
  type RestoreRepositoryOptions,
  type RestoreResult,
  type SignedPlacementReceipt,
  type SignedRecoveryCatalog,
  type SignedSnapshotDescriptor,
  type SignedVerificationReceipt,
} from "./types.js";
import {
  ArchiveVerificationError,
  InvalidArchiveRecordError,
} from "./errors.js";
import { captureGitRepository, restoreGitBundle } from "./git.js";
import { decodeSnapshotPayload, encodeSnapshotPayload } from "./payload.js";
import {
  signPlacementReceipt,
  signRecoveryCatalog,
  signSnapshotDescriptor,
  signVerificationReceipt,
  validateZoneDescriptor,
  verifyRecoveryCatalog,
} from "./records.js";
import {
  equalBytes,
} from "./encoding.js";
import {
  RecoveryEnvelopeKeyStore,
  generateRecoveryKey,
  validateRecoveryKeyEnvelope,
} from "./recovery-keys.js";

export const ARCHIVE_SCHEMA =
  "https://docs.agenttool.dev/specs/agent-repo-archive-0.1.schema.json";
export const SNAPSHOT_PAYLOAD_SCHEMA = `${ARCHIVE_SCHEMA}#snapshot-payload`;
export const RECOVERY_CATALOG_SCHEMA = `${ARCHIVE_SCHEMA}#recovery-catalog`;
export const SNAPSHOT_MEDIA_TYPE =
  "application/vnd.agenttool.repo-archive.snapshot+binary;version=0.1";
export const CATALOG_MEDIA_TYPE =
  "application/vnd.agenttool.repo-archive.catalog+json;version=0.1";

const AUTHORITY = {
  automatic_restore: "never",
  execute_repository_code: "never",
  checkout: "explicit_after_restore",
} as const;

interface Instant {
  text: string;
  epochSeconds: number;
}

function instant(value: Date | string | number | undefined): Instant {
  let milliseconds: number;
  if (value === undefined) {
    milliseconds = Date.now();
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new InvalidArchiveRecordError("Archive numeric time must be non-negative epoch seconds.");
    }
    milliseconds = value * 1_000;
  } else {
    milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  }
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new InvalidArchiveRecordError("Archive time is invalid.");
  }
  const date = new Date(milliseconds);
  return {
    text: date.toISOString(),
    epochSeconds: Math.floor(milliseconds / 1_000),
  };
}

function assertMaximum(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidArchiveRecordError("Archive maxBytes must be a positive safe integer.");
  }
  return value;
}

function validateZones(
  zones: readonly ArchiveZone[],
  requiredVerifiedZones: number,
): readonly ArchiveZone[] {
  if (!Array.isArray(zones) || zones.length === 0 || zones.length > 32) {
    throw new InvalidArchiveRecordError("Archive requires between one and 32 zones.");
  }
  if (
    !Number.isSafeInteger(requiredVerifiedZones)
    || requiredVerifiedZones < 1
    || requiredVerifiedZones > zones.length
  ) {
    throw new InvalidArchiveRecordError(
      "requiredVerifiedZones must be between one and the number of zones.",
    );
  }
  const ids = new Set<string>();
  const locators = new Set<string>();
  const domains = new Set<string>();
  const providerAccountRoots = new Set<string>();
  const credentialRoots = new Set<string>();
  const stores = new Set<object>();
  const normalized: ArchiveZone[] = [];
  for (const candidate of zones) {
    if (
      candidate?.store === undefined
      || typeof candidate.store.get !== "function"
      || typeof candidate.store.put !== "function"
    ) {
      throw new InvalidArchiveRecordError("Archive zone BlockStore is malformed.");
    }
    const descriptor = validateZoneDescriptor(candidate.descriptor);
    if (
      typeof candidate.store !== "object"
      || candidate.store === null
    ) {
      throw new InvalidArchiveRecordError("Archive zone BlockStore must be an object.");
    }
    if (ids.has(descriptor.zone_id)) {
      throw new InvalidArchiveRecordError(`Duplicate archive zone_id ${descriptor.zone_id}.`);
    }
    if (locators.has(descriptor.locator)) {
      throw new InvalidArchiveRecordError("Two archive zones use the same locator.");
    }
    if (stores.has(candidate.store)) {
      throw new InvalidArchiveRecordError(
        "Two archive zones use the same BlockStore instance.",
      );
    }
    const providerAccountRoot = [
      descriptor.failure_domain.provider,
      descriptor.failure_domain.account_root,
    ].join("\0");
    if (
      providerAccountRoots.has(providerAccountRoot)
      || credentialRoots.has(descriptor.failure_domain.credential_root)
    ) {
      throw new InvalidArchiveRecordError(
        "Two archive zones share a declared provider/account or credential failure root.",
      );
    }
    ids.add(descriptor.zone_id);
    locators.add(descriptor.locator);
    domains.add(descriptor.failure_domain.failure_domain_id);
    providerAccountRoots.add(providerAccountRoot);
    credentialRoots.add(descriptor.failure_domain.credential_root);
    stores.add(candidate.store);
    normalized.push({ descriptor, store: candidate.store });
  }
  if (domains.size < requiredVerifiedZones) {
    throw new InvalidArchiveRecordError(
      "Declared failure domains cannot satisfy requiredVerifiedZones.",
    );
  }
  return normalized;
}

function recoveryCapsule(
  fields: Omit<RecoveryCapsule, "recovery_key" | "toJSON">,
  recoveryKey: Uint8Array,
): RecoveryCapsule {
  const capsule = {
    ...fields,
    toJSON(): never {
      throw new InvalidArchiveRecordError(
        "Recovery capsules contain secret key material and cannot be serialized as JSON.",
      );
    },
  } as RecoveryCapsule;
  Object.defineProperty(capsule, "recovery_key", {
    value: Uint8Array.from(recoveryKey),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return capsule;
}

function manifestMetadataMatches(
  manifest: SignedManifest,
  schema: string,
  mediaType: string,
  kind: string,
): boolean {
  return (
    manifest.schema === schema
    && manifest.media_type === mediaType
    && manifest.metadata?.protocol === ARCHIVE_PROTOCOL
    && manifest.metadata?.kind === kind
  );
}

async function importPortableIntoZone(
  zone: ArchiveZone,
  portable: PortableBundle,
  maxBytes: number,
): Promise<void> {
  const receiver = new AgentData({
    store: zone.store,
    maxBytes,
  });
  await receiver.importBundle(portable, { maxBytes });
}

async function retrieveSnapshot(
  zone: ArchiveZone,
  rootCid: Cid,
  envelopeValue: RecoveryKeyEnvelope,
  recoveryKey: Uint8Array,
  maxBytes: number,
): Promise<{
  manifest: SignedManifest;
  descriptor: SignedSnapshotDescriptor;
  bundle: Uint8Array;
  ciphertextBlocks: number;
  encryptedBytes: number;
}> {
  const envelope = validateRecoveryKeyEnvelope(envelopeValue);
  if (envelope.manifest_cid !== rootCid) {
    throw new ArchiveVerificationError("Snapshot recovery envelope is bound to another root.");
  }
  const keys = new RecoveryEnvelopeKeyStore({
    vaultId: envelope.vault_id,
    recoveryKeyId: envelope.recovery_key_id,
    recoveryKey,
    envelopes: [envelope],
  });
  try {
    const reader = new AgentData({
      store: zone.store,
      keyStore: keys,
      maxBytes,
    });
    const verified = await reader.verify(rootCid, { maxBytes });
    if (!manifestMetadataMatches(
      verified.manifest,
      SNAPSHOT_PAYLOAD_SCHEMA,
      SNAPSHOT_MEDIA_TYPE,
      "snapshot",
    )) {
      throw new ArchiveVerificationError("Snapshot ADDS Manifest has the wrong archive profile.");
    }
    const plaintext = await reader.get(rootCid, { maxBytes });
    try {
      const decoded = decodeSnapshotPayload(plaintext, { maxBundleBytes: maxBytes });
      return {
        manifest: verified.manifest,
        descriptor: decoded.descriptor,
        bundle: decoded.bundle,
        ciphertextBlocks: verified.ciphertextBlocksVerified,
        encryptedBytes: verified.encryptedBytes,
      };
    } finally {
      plaintext.fill(0);
    }
  } finally {
    keys.close();
  }
}

async function verifySnapshotZone(
  zone: ArchiveZone,
  rootCid: Cid,
  envelope: RecoveryKeyEnvelope,
  recoveryKey: Uint8Array,
  expectedSnapshotId: `sha256:${string}`,
  maxBytes: number,
): Promise<{
  descriptor: SignedSnapshotDescriptor;
  ciphertextBlocks: number;
  encryptedBytes: number;
  restoredHead: string;
}> {
  const retrieved = await retrieveSnapshot(
    zone,
    rootCid,
    envelope,
    recoveryKey,
    maxBytes,
  );
  if (retrieved.descriptor.record_id !== expectedSnapshotId) {
    throw new ArchiveVerificationError("Zone returned a different SnapshotDescriptor.");
  }
  const drillRoot = await mkdtemp(
    join(await realpath(tmpdir()), "agent-repo-archive-drill-"),
  );
  try {
    const restored = await restoreGitBundle(
      retrieved.bundle,
      retrieved.descriptor,
      join(drillRoot, "repository"),
    );
    return {
      descriptor: retrieved.descriptor,
      ciphertextBlocks: retrieved.ciphertextBlocks,
      encryptedBytes: retrieved.encryptedBytes,
      restoredHead: restored.restoredHead,
    };
  } finally {
    retrieved.bundle.fill(0);
    await rm(drillRoot, { recursive: true, force: true });
  }
}

async function retrieveCatalog(
  zone: ArchiveZone,
  capsule: RecoveryCapsule,
  maxBytes: number,
): Promise<SignedRecoveryCatalog> {
  if (
    capsule.protocol !== ARCHIVE_PROTOCOL
    || capsule.kind !== "recovery_capsule"
    || !(capsule.recovery_key instanceof Uint8Array)
    || capsule.recovery_key.byteLength !== 32
    || capsule.catalog_key_envelope.manifest_cid !== capsule.catalog_root_cid
    || capsule.catalog_key_envelope.vault_id !== capsule.vault_id
    || capsule.catalog_key_envelope.recovery_key_id !== capsule.recovery_key_id
  ) {
    throw new InvalidArchiveRecordError("Recovery capsule is malformed or internally inconsistent.");
  }
  const keys = new RecoveryEnvelopeKeyStore({
    vaultId: capsule.vault_id,
    recoveryKeyId: capsule.recovery_key_id,
    recoveryKey: capsule.recovery_key,
    envelopes: [capsule.catalog_key_envelope],
  });
  try {
    const reader = new AgentData({
      store: zone.store,
      keyStore: keys,
      maxBytes,
    });
    const manifest = await reader.inspect(capsule.catalog_root_cid, { maxBytes });
    if (!manifestMetadataMatches(
      manifest,
      RECOVERY_CATALOG_SCHEMA,
      CATALOG_MEDIA_TYPE,
      "catalog",
    )) {
      throw new ArchiveVerificationError("Catalog ADDS Manifest has the wrong archive profile.");
    }
    const plaintext = await reader.get(capsule.catalog_root_cid, { maxBytes });
    try {
      const catalog = verifyRecoveryCatalog(parseCanonicalJson(plaintext));
      if (
        catalog.vault_id !== capsule.vault_id
        || catalog.snapshot_key_envelope.recovery_key_id !== capsule.recovery_key_id
      ) {
        throw new ArchiveVerificationError("Recovery catalog belongs to another vault or key route.");
      }
      return catalog;
    } finally {
      plaintext.fill(0);
    }
  } finally {
    keys.close();
  }
}

export async function archiveRepository(
  options: ArchiveRepositoryOptions,
): Promise<ArchivedRepository> {
  const now = instant(options.now);
  const maxBytes = assertMaximum(options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES);
  const chunkSize = options.chunkSize ?? DEFAULT_ARCHIVE_CHUNK_SIZE;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new InvalidArchiveRecordError("Archive chunkSize must be a positive safe integer.");
  }
  const required = options.requiredVerifiedZones ?? DEFAULT_REQUIRED_VERIFIED_ZONES;
  const zones = validateZones(options.zones, required);
  const vaultId = options.vaultId ?? `urn:uuid:${globalThis.crypto.randomUUID()}`;
  const recoveryKeyId = options.recoveryKeyId ?? `urn:uuid:${globalThis.crypto.randomUUID()}`;
  const recoveryKey = options.recoveryKey === undefined
    ? generateRecoveryKey()
    : Uint8Array.from(options.recoveryKey);
  if (recoveryKey.byteLength !== 32) {
    throw new InvalidArchiveRecordError("Archive recoveryKey must be 32 bytes.");
  }

  const stagingStore = new MemoryBlockStore();
  const stagingKeys = new RecoveryEnvelopeKeyStore({
    vaultId,
    recoveryKeyId,
    recoveryKey,
  });
  try {
    const capture = await captureGitRepository({
      repositoryPath: options.repositoryPath,
      repositoryId: options.repositoryId,
      allowIncomplete: options.allowIncomplete,
      maxBytes,
    });
    const snapshot = signSnapshotDescriptor({
      protocol: ARCHIVE_PROTOCOL,
      kind: "snapshot",
      vault_id: vaultId,
      created_at: now.text,
      repository: capture.repository,
      completeness: capture.completeness,
      payload: capture.payload,
      parent_snapshot_id: options.parentSnapshotId ?? null,
      authority: AUTHORITY,
    }, options.publisherIdentity);
    const snapshotPayload = (() => {
      try {
        return encodeSnapshotPayload(snapshot, capture.bundle);
      } finally {
        capture.bundle.fill(0);
      }
    })();

    const publisher = new AgentData({
      identity: options.publisherIdentity,
      store: stagingStore,
      keyStore: stagingKeys,
      maxBytes,
      now: () => now.epochSeconds,
    });
    const publishedSnapshot = await (async () => {
      try {
        return await publisher.put(snapshotPayload, {
          maxBytes,
          chunkSize,
          createdAt: now.epochSeconds,
          schema: SNAPSHOT_PAYLOAD_SCHEMA,
          mediaType: SNAPSHOT_MEDIA_TYPE,
          metadata: {
            protocol: ARCHIVE_PROTOCOL,
            kind: "snapshot",
          },
        });
      } finally {
        snapshotPayload.fill(0);
      }
    })();
    const snapshotEnvelope = stagingKeys.exportEnvelope(publishedSnapshot.ref.cid);
    const portableSnapshot = await publisher.exportBundle(publishedSnapshot.ref, { maxBytes });

    const placements: SignedPlacementReceipt[] = [];
    const verifications: SignedVerificationReceipt[] = [];
    const failures: string[] = [];
    for (const zone of zones) {
      try {
        await importPortableIntoZone(zone, portableSnapshot, maxBytes);
        const zoneReader = new AgentData({ store: zone.store, maxBytes });
        const ciphertext = await zoneReader.verify(publishedSnapshot.ref, { maxBytes });
        placements.push(signPlacementReceipt({
          protocol: ARCHIVE_PROTOCOL,
          kind: "placement",
          vault_id: vaultId,
          snapshot_id: snapshot.record_id,
          snapshot_root_cid: publishedSnapshot.ref.cid,
          zone: zone.descriptor,
          result: "observed",
          ciphertext_blocks_observed: ciphertext.ciphertextBlocksVerified,
          encrypted_bytes_observed: ciphertext.encryptedBytes,
          observed_at: now.text,
          caveat: "observation_is_not_future_durability",
        }, options.publisherIdentity));

        const verification = await verifySnapshotZone(
          zone,
          publishedSnapshot.ref.cid,
          snapshotEnvelope,
          recoveryKey,
          snapshot.record_id,
          maxBytes,
        );
        verifications.push(signVerificationReceipt({
          protocol: ARCHIVE_PROTOCOL,
          kind: "verification",
          vault_id: vaultId,
          snapshot_id: snapshot.record_id,
          snapshot_root_cid: publishedSnapshot.ref.cid,
          zone_id: zone.descriptor.zone_id,
          method: "full_restore",
          result: "verified",
          ciphertext_blocks_verified: verification.ciphertextBlocks,
          payload_digest_verified: snapshot.payload.digest,
          git_bundle_verified: true,
          git_fsck: "passed",
          checkout_performed: false,
          restored_head: verification.restoredHead,
          verified_at: now.text,
        }, options.publisherIdentity));
      } catch {
        failures.push(zone.descriptor.zone_id);
      }
    }
    const catalog = signRecoveryCatalog({
      protocol: ARCHIVE_PROTOCOL,
      kind: "catalog",
      vault_id: vaultId,
      generation: 1,
      parent_catalog_id: null,
      created_at: now.text,
      required_verified_zones: required,
      snapshot_root_cid: publishedSnapshot.ref.cid,
      snapshot,
      snapshot_key_envelope: snapshotEnvelope,
      zones: zones.map((zone) => zone.descriptor),
      placements,
      verifications,
      authority: AUTHORITY,
    }, options.publisherIdentity);
    const catalogBytes = canonicalJsonBytes(catalog as unknown as JsonObject);
    const publishedCatalog = await (async () => {
      try {
        return await publisher.put(catalogBytes, {
          maxBytes,
          chunkSize,
          createdAt: now.epochSeconds,
          schema: RECOVERY_CATALOG_SCHEMA,
          mediaType: CATALOG_MEDIA_TYPE,
          metadata: {
            protocol: ARCHIVE_PROTOCOL,
            kind: "catalog",
          },
        });
      } finally {
        catalogBytes.fill(0);
      }
    })();
    const catalogEnvelope = stagingKeys.exportEnvelope(publishedCatalog.ref.cid);
    const portableCatalog = await publisher.exportBundle(publishedCatalog.ref, { maxBytes });
    const provisionalCapsule = recoveryCapsule({
      protocol: ARCHIVE_PROTOCOL,
      kind: "recovery_capsule",
      vault_id: vaultId,
      catalog_root_cid: publishedCatalog.ref.cid,
      catalog_key_envelope: catalogEnvelope,
      recovery_key_id: recoveryKeyId,
      created_at: now.text,
    }, recoveryKey);

    const catalogFailures: string[] = [];
    for (const zone of zones) {
      try {
        await importPortableIntoZone(zone, portableCatalog, maxBytes);
        const recovered = await retrieveCatalog(zone, provisionalCapsule, maxBytes);
        if (recovered.record_id !== catalog.record_id) {
          throw new ArchiveVerificationError("Zone returned another RecoveryCatalog.");
        }
      } catch {
        catalogFailures.push(zone.descriptor.zone_id);
      }
    }
    if (catalogFailures.length === zones.length) {
      provisionalCapsule.recovery_key.fill(0);
      throw new ArchiveVerificationError(
        "RecoveryCatalog did not round-trip through any declared zone.",
      );
    }
    const catalogAvailable = new Set(
      zones
        .map((zone) => zone.descriptor.zone_id)
        .filter((zoneId) => !catalogFailures.includes(zoneId)),
    );
    const recoveryVerifiedZoneIds = verifications
      .map((receipt) => receipt.zone_id)
      .filter((zoneId) => catalogAvailable.has(zoneId));
    const recoveryVerifiedDomains = new Set(
      recoveryVerifiedZoneIds.map((zoneId) => zones.find(
        (zone) => zone.descriptor.zone_id === zoneId,
      )!.descriptor.failure_domain.failure_domain_id),
    );

    return {
      snapshot,
      snapshotRootCid: publishedSnapshot.ref.cid,
      snapshotManifest: publishedSnapshot.manifest,
      placements,
      verifications,
      catalog,
      catalogRootCid: publishedCatalog.ref.cid,
      catalogManifest: publishedCatalog.manifest,
      recoveryCapsule: provisionalCapsule,
      outcome: {
        policy_satisfied: (
          catalog.status === "verified"
          && recoveryVerifiedDomains.size >= required
        ),
        recovery_verified_zone_ids: recoveryVerifiedZoneIds,
        snapshot_failed_zone_ids: failures,
        catalog_failed_zone_ids: catalogFailures,
      },
    };
  } finally {
    stagingKeys.close();
    recoveryKey.fill(0);
  }
}

export async function restoreRepository(
  options: RestoreRepositoryOptions,
): Promise<RestoreResult> {
  const maxBytes = assertMaximum(options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES);
  const zone = validateZones([options.zone], 1)[0]!;
  const catalog = await retrieveCatalog(zone, options.recoveryCapsule, maxBytes);
  if (
    options.expectedSnapshotId !== undefined
    && catalog.snapshot.record_id !== options.expectedSnapshotId
  ) {
    throw new ArchiveVerificationError("RecoveryCatalog does not name the expected snapshot.");
  }
  const declaredZone = catalog.zones.find(
    (declared) => declared.zone_id === zone.descriptor.zone_id,
  );
  if (
    declaredZone === undefined
    || !equalBytes(
      canonicalJsonBytes(declaredZone as unknown as JsonObject),
      canonicalJsonBytes(zone.descriptor as unknown as JsonObject),
    )
  ) {
    throw new ArchiveVerificationError("Restore zone does not match its signed catalog descriptor.");
  }
  const snapshot = await retrieveSnapshot(
    zone,
    catalog.snapshot_root_cid,
    catalog.snapshot_key_envelope,
    options.recoveryCapsule.recovery_key,
    maxBytes,
  );
  try {
    if (snapshot.descriptor.record_id !== catalog.snapshot.record_id) {
      throw new ArchiveVerificationError("Snapshot payload does not match RecoveryCatalog.");
    }
    const restored = await restoreGitBundle(
      snapshot.bundle,
      snapshot.descriptor,
      options.targetPath,
    );
    return {
      zone_id: zone.descriptor.zone_id,
      snapshot_id: snapshot.descriptor.record_id,
      catalog_id: catalog.record_id,
      target_path: restored.targetPath,
      restored_head: restored.restoredHead,
      checkout_performed: false,
      git_bundle_verified: true,
      git_fsck: "passed",
    };
  } finally {
    snapshot.bundle.fill(0);
  }
}

export async function verifyRecoveryCatalogInZone(
  zone: ArchiveZone,
  recoveryCapsule: RecoveryCapsule,
  options: { maxBytes?: number } = {},
): Promise<SignedRecoveryCatalog> {
  const validatedZone = validateZones([zone], 1)[0]!;
  return retrieveCatalog(
    validatedZone,
    recoveryCapsule,
    assertMaximum(options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES),
  );
}
