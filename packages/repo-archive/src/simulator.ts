import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { FileSystemBlockStore } from "@agenttool/adds/fs";
import { generateIdentity } from "@agenttool/adds";

import {
  ARCHIVE_PROTOCOL,
  DEFAULT_ARCHIVE_MAX_BYTES,
  type ArchiveZone,
  type SimulatorResult,
} from "./types.js";
import {
  archiveRepository,
  restoreRepository,
  verifyRecoveryCatalogInZone,
} from "./archive.js";
import {
  InvalidArchiveRecordError,
  UnsafeRestoreTargetError,
} from "./errors.js";

export interface SimulateRepositoryOptions {
  repositoryPath: string;
  repositoryId?: string;
  simulationRoot?: string;
  allowIncomplete?: boolean;
  maxBytes?: number;
  now?: Date | string | number;
}

async function prepareRoot(requested: string | undefined): Promise<{
  root: string;
  temporary: boolean;
}> {
  if (requested === undefined) {
    return {
      root: await mkdtemp(join(await realpath(tmpdir()), "agent-repo-archive-sim-")),
      temporary: true,
    };
  }
  const absolute = resolve(requested);
  const parent = dirname(absolute);
  const canonicalParent = await realpath(parent).catch((cause) => {
    throw new UnsafeRestoreTargetError("Simulation root parent must already exist.", { cause });
  });
  if (canonicalParent !== parent) {
    throw new UnsafeRestoreTargetError("Simulation root ancestors must not traverse symbolic links.");
  }
  try {
    await mkdir(absolute, { mode: 0o700 });
  } catch (cause) {
    throw new UnsafeRestoreTargetError("Simulation root must not already exist.", { cause });
  }
  return { root: absolute, temporary: false };
}

async function createZones(root: string): Promise<ArchiveZone[]> {
  const zonesRoot = join(root, "zones");
  await mkdir(zonesRoot, { mode: 0o700 });
  const labels = ["a", "b", "c"] as const;
  return Promise.all(labels.map(async (label): Promise<ArchiveZone> => {
    const storageRoot = join(zonesRoot, `zone-${label}`);
    await mkdir(storageRoot, { mode: 0o700 });
    return {
      descriptor: {
        zone_id: `zone-${label}`,
        transport: "filesystem",
        locator: `file-zone:zone-${label}`,
        assurance: "simulated",
        delete_authority: "routine_writer",
        failure_domain: {
          failure_domain_id: `simulated-directory-${label}`,
          provider: "same-device-simulator",
          account_root: `same-process-directory-${label}`,
          region: "same-device-region",
          credential_root: `ephemeral-credential-root-${label}`,
          media: "same-physical-media",
        },
      },
      store: new FileSystemBlockStore(storageRoot),
    };
  }));
}

export async function simulateThreeZoneArchive(
  options: SimulateRepositoryOptions,
): Promise<SimulatorResult> {
  if (
    typeof options.repositoryPath !== "string"
    || options.repositoryPath.length === 0
  ) {
    throw new InvalidArchiveRecordError("Simulator repositoryPath is required.");
  }
  const prepared = await prepareRoot(options.simulationRoot);
  let recoveryKey: Uint8Array | undefined;
  try {
    const zones = await createZones(prepared.root);
    const archived = await archiveRepository({
      repositoryPath: options.repositoryPath,
      repositoryId: options.repositoryId,
      zones,
      publisherIdentity: generateIdentity("urn:agenttool:repo-archive:local-simulator"),
      allowIncomplete: options.allowIncomplete,
      requiredVerifiedZones: 3,
      maxBytes: options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES,
      now: options.now,
    });
    recoveryKey = archived.recoveryCapsule.recovery_key;
    const restoresRoot = join(prepared.root, "restores");
    await mkdir(restoresRoot, { mode: 0o700 });
    const zoneResults = [];
    for (const zone of zones) {
      const catalog = await verifyRecoveryCatalogInZone(
        zone,
        archived.recoveryCapsule,
        { maxBytes: options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES },
      );
      const restored = await restoreRepository({
        zone,
        recoveryCapsule: archived.recoveryCapsule,
        targetPath: join(restoresRoot, zone.descriptor.zone_id),
        maxBytes: options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES,
        expectedSnapshotId: archived.snapshot.record_id,
      });
      zoneResults.push({
        zone_id: zone.descriptor.zone_id,
        snapshot_status: "verified" as const,
        catalog_status: catalog.status,
        restored_head: restored.restored_head,
      });
    }
    return {
      protocol: ARCHIVE_PROTOCOL,
      mode: "same-device-three-zone-simulation",
      durability_claim: "none",
      snapshot_id: archived.snapshot.record_id,
      catalog_id: archived.catalog.record_id,
      snapshot_root_cid: archived.snapshotRootCid,
      catalog_root_cid: archived.catalogRootCid,
      capture_status: archived.snapshot.completeness.status,
      zones: zoneResults,
    };
  } finally {
    recoveryKey?.fill(0);
    if (prepared.temporary) {
      await rm(prepared.root, { recursive: true, force: true });
    }
  }
}
