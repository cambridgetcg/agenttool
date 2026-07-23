import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { generateIdentity } from "@agenttool/adds";

import {
  ArchiveVerificationError,
  UnsafeRestoreTargetError,
  archiveRepository,
  restoreRepository,
  simulateThreeZoneArchive,
} from "../src/index.js";
import {
  cleanupTemporaryRoots,
  createArchiveZones,
  createFixtureRepository,
  temporaryRoot,
} from "./helpers.js";

afterEach(cleanupTemporaryRoots);

async function storedBytesContain(root: string, needle: Uint8Array): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (await storedBytesContain(path, needle)) return true;
    } else if (entry.isFile()) {
      const bytes = new Uint8Array(await readFile(path));
      outer: for (let offset = 0; offset <= bytes.byteLength - needle.byteLength; offset += 1) {
        for (let index = 0; index < needle.byteLength; index += 1) {
          if (bytes[offset + index] !== needle[index]) continue outer;
        }
        return true;
      }
    }
  }
  return false;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

describe("three-zone archive simulator", () => {
  test("independently imports, decrypts, verifies, and restores every zone", async () => {
    const fixture = await createFixtureRepository();
    const parent = await temporaryRoot("agent-repo-archive-simulator-parent-");
    const result = await simulateThreeZoneArchive({
      repositoryPath: fixture.root,
      simulationRoot: join(parent, "simulation"),
      now: "2026-07-23T12:00:00.000Z",
    });
    expect(result.durability_claim).toBe("none");
    expect(result.capture_status).toBe("complete");
    expect(result.zones).toHaveLength(3);
    expect(result.zones.map((zone) => zone.restored_head)).toEqual([
      fixture.head,
      fixture.head,
      fixture.head,
    ]);
    expect(result.zones.every((zone) => zone.snapshot_status === "verified")).toBe(true);
    expect(result.zones.every((zone) => zone.catalog_status === "verified")).toBe(true);
  });

  test("recovers from one zone after publisher state loss and isolates corruption", async () => {
    const parent = await temporaryRoot("agent-repo-archive-e2e-");
    const sentinel = join(parent, "hook-ran");
    const fixture = await createFixtureRepository({ hookSentinel: sentinel });
    const zones = await createArchiveZones(parent);
    const publisher = generateIdentity("urn:test:archive-publisher");
    const archived = await archiveRepository({
      repositoryPath: fixture.root,
      repositoryId: "repo:test:independent-recovery",
      zones,
      publisherIdentity: publisher,
      now: "2026-07-23T12:00:00.000Z",
      requiredVerifiedZones: 3,
      chunkSize: 4_096,
    });
    expect(archived.outcome.policy_satisfied).toBe(true);
    expect(archived.outcome.recovery_verified_zone_ids).toEqual([
      "zone-a",
      "zone-b",
      "zone-c",
    ]);
    expect(() => JSON.stringify(archived.recoveryCapsule)).toThrow(
      "cannot be serialized",
    );
    expect(Object.keys(archived.recoveryCapsule)).not.toContain("recovery_key");

    publisher.signingPrivateKey.fill(0);
    publisher.boxPrivateKey.fill(0);
    expect(await storedBytesContain(
      zones[0]!.storageRoot,
      new TextEncoder().encode("recoverable source marker"),
    )).toBe(false);
    expect(await storedBytesContain(
      zones[0]!.storageRoot,
      new TextEncoder().encode(fixture.root),
    )).toBe(false);

    const restoreParent = await temporaryRoot("agent-repo-archive-independent-restore-");
    const restored = await restoreRepository({
      zone: zones[1]!,
      recoveryCapsule: archived.recoveryCapsule,
      targetPath: join(restoreParent, "from-b"),
      expectedSnapshotId: archived.snapshot.record_id,
    });
    expect(restored.restored_head).toBe(fixture.head);
    await expect(lstat(join(restored.target_path, "README.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(sentinel)).rejects.toMatchObject({ code: "ENOENT" });

    const blockCid = archived.snapshotManifest.chunks[0]!.cid;
    const corruptPath = join(
      zones[0]!.storageRoot,
      blockCid.slice(1, 3),
      blockCid,
    );
    const corruptBytes = new Uint8Array(await readFile(corruptPath));
    corruptBytes[corruptBytes.byteLength - 1] ^= 1;
    await writeFile(corruptPath, corruptBytes);
    const corruptTarget = join(restoreParent, "from-corrupt-a");
    await expect(restoreRepository({
      zone: zones[0]!,
      recoveryCapsule: archived.recoveryCapsule,
      targetPath: corruptTarget,
    })).rejects.toThrow();
    await expect(lstat(corruptTarget)).rejects.toMatchObject({ code: "ENOENT" });

    const healthy = await restoreRepository({
      zone: zones[2]!,
      recoveryCapsule: archived.recoveryCapsule,
      targetPath: join(restoreParent, "from-c"),
    });
    expect(healthy.restored_head).toBe(fixture.head);

    const wrongKey = {
      ...archived.recoveryCapsule,
      recovery_key: new Uint8Array(32),
    };
    const wrongKeyTarget = join(restoreParent, "wrong-key");
    await expect(restoreRepository({
      zone: zones[1]!,
      recoveryCapsule: wrongKey,
      targetPath: wrongKeyTarget,
    })).rejects.toBeInstanceOf(ArchiveVerificationError);
    await expect(lstat(wrongKeyTarget)).rejects.toMatchObject({ code: "ENOENT" });

    archived.recoveryCapsule.recovery_key.fill(0);
  });

  test("returns a recoverable degraded archive when one policy zone is unavailable", async () => {
    const parent = await temporaryRoot("agent-repo-archive-degraded-");
    const fixture = await createFixtureRepository();
    const zones = await createArchiveZones(parent);
    zones[2] = {
      ...zones[2]!,
      store: {
        async get() {
          throw new Error("simulated zone outage");
        },
        async put() {
          throw new Error("simulated zone outage");
        },
      },
    };
    const archived = await archiveRepository({
      repositoryPath: fixture.root,
      zones,
      publisherIdentity: generateIdentity("urn:test:degraded"),
      now: "2026-07-23T12:00:00.000Z",
      requiredVerifiedZones: 3,
    });
    expect(archived.catalog.status).toBe("degraded");
    expect(archived.outcome).toEqual({
      policy_satisfied: false,
      recovery_verified_zone_ids: ["zone-a", "zone-b"],
      snapshot_failed_zone_ids: ["zone-c"],
      catalog_failed_zone_ids: ["zone-c"],
    });
    const restoreParent = await temporaryRoot("agent-repo-archive-degraded-restore-");
    expect((await restoreRepository({
      zone: zones[0]!,
      recoveryCapsule: archived.recoveryCapsule,
      targetPath: join(restoreParent, "restored"),
    })).restored_head).toBe(fixture.head);
    archived.recoveryCapsule.recovery_key.fill(0);
  });

  test("rejects existing and symlink-ancestor restore targets before mutation", async () => {
    const parent = await temporaryRoot("agent-repo-archive-target-safety-");
    const fixture = await createFixtureRepository();
    const zones = await createArchiveZones(parent);
    const archived = await archiveRepository({
      repositoryPath: fixture.root,
      zones,
      publisherIdentity: generateIdentity("urn:test:target-safety"),
      now: "2026-07-23T12:00:00.000Z",
    });
    const existing = join(parent, "existing");
    await mkdir(existing);
    await expect(restoreRepository({
      zone: zones[1]!,
      recoveryCapsule: archived.recoveryCapsule,
      targetPath: existing,
    })).rejects.toBeInstanceOf(UnsafeRestoreTargetError);

    const realDirectory = join(parent, "real-parent");
    const linkDirectory = join(parent, "linked-parent");
    await mkdir(realDirectory);
    await symlink(realDirectory, linkDirectory);
    await expect(restoreRepository({
      zone: zones[1]!,
      recoveryCapsule: archived.recoveryCapsule,
      targetPath: join(linkDirectory, "outside"),
    })).rejects.toBeInstanceOf(UnsafeRestoreTargetError);
    await expect(lstat(join(realDirectory, "outside"))).rejects.toMatchObject({ code: "ENOENT" });
    archived.recoveryCapsule.recovery_key.fill(0);
  });

  test("does not install through a parent replaced during private verification", async () => {
    const parent = await temporaryRoot("agent-repo-archive-parent-race-");
    const fixture = await createFixtureRepository();
    const zones = await createArchiveZones(parent);
    const archived = await archiveRepository({
      repositoryPath: fixture.root,
      zones,
      publisherIdentity: generateIdentity("urn:test:parent-race"),
      now: "2026-07-23T12:00:00.000Z",
    });
    const requestedParent = join(parent, "requested-parent");
    const originalParent = join(parent, "original-parent");
    const redirectedParent = join(parent, "redirected-parent");
    const wrapperDirectory = join(parent, "git-wrapper");
    const wrapperPath = join(wrapperDirectory, "git");
    const parentSwitched = join(parent, "parent-switched");
    await mkdir(requestedParent);
    await mkdir(redirectedParent);
    await mkdir(wrapperDirectory);
    const realGit = Bun.which("git");
    if (realGit === null) throw new Error("git is required for the restore race test");
    await writeFile(
      wrapperPath,
      [
        "#!/bin/sh",
        "set -eu",
        "for argument in \"$@\"; do",
        `  if [ "$argument" = "init" ] && [ ! -e ${shellQuote(parentSwitched)} ]; then`,
        `    : > ${shellQuote(parentSwitched)}`,
        `    mv ${shellQuote(requestedParent)} ${shellQuote(originalParent)}`,
        `    ln -s ${shellQuote(redirectedParent)} ${shellQuote(requestedParent)}`,
        "  fi",
        "done",
        `exec ${shellQuote(realGit)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    await chmod(wrapperPath, 0o700);

    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${wrapperDirectory}:${previousPath ?? ""}`;
      const pendingRestore = restoreRepository({
        zone: zones[1]!,
        recoveryCapsule: archived.recoveryCapsule,
        targetPath: join(requestedParent, "restored"),
      });
      await expect(pendingRestore).rejects.toBeInstanceOf(
        UnsafeRestoreTargetError,
      );
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
    await expect(lstat(join(originalParent, "restored"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(redirectedParent, "restored"))).rejects.toMatchObject({ code: "ENOENT" });
    archived.recoveryCapsule.recovery_key.fill(0);
  });
});
