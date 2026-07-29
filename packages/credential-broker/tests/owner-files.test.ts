import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  rm,
  symlink,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireOwnerLifecycleLock,
  inspectOwnerLifecycleLock,
  OwnerFileAlreadyExistsError,
  recoverOwnerLifecycleLock,
  writeOwnerFileAtomic,
  type RecoverOwnerLifecycleLockOptions,
} from "../src/owner-files.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ manifestPath: string; lockPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "agentcred-owner-lock-"));
  roots.push(root);
  await chmod(root, 0o700);
  const manifestPath = join(root, "credential.json");
  return {
    manifestPath,
    lockPath: `${manifestPath}.lifecycle.lock`,
  };
}

async function writeStaleLock(
  lockPath: string,
  overrides: Partial<{
    pid: number;
    nonce: string;
    role: "broker" | "controller";
    at: string;
  }> = {},
): Promise<{ pid: number; nonce: string; role: "broker" | "controller"; at: string }> {
  const record = {
    pid: 2_147_483_647,
    nonce: randomUUID(),
    role: "controller" as const,
    at: "2026-07-29T12:00:00.000Z",
    ...overrides,
  };
  await writeOwnerFileAtomic(lockPath, `${JSON.stringify(record)}\n`, {
    createDirectory: true,
    createOnly: true,
    name: "Test lifecycle lock",
  });
  return record;
}

describe("owner lifecycle lock recovery", () => {
  test("distinguishes create collisions from post-create durability failures", async () => {
    const { lockPath } = await fixture();
    await writeOwnerFileAtomic(lockPath, "first\n", {
      createOnly: true,
      name: "Test owner file",
    });

    try {
      await writeOwnerFileAtomic(lockPath, "second\n", {
        createOnly: true,
        name: "Test owner file",
      });
      throw new Error("expected create collision");
    } catch (error) {
      expect(error).toBeInstanceOf(OwnerFileAlreadyExistsError);
    }

    const durabilityPath = `${lockPath}.durability`;
    const probe = await open(`${lockPath}.probe-durability`, "w", 0o600);
    const prototype = Object.getPrototypeOf(probe) as {
      stat(this: FileHandle): ReturnType<FileHandle["stat"]>;
      sync(this: FileHandle): Promise<void>;
    };
    const originalSync = prototype.sync;
    await probe.close();
    let injected = false;
    const sync = spyOn(prototype, "sync").mockImplementation(async function (
      this: FileHandle,
    ) {
      const stat = await this.stat();
      if (!injected && stat.isDirectory()) {
        injected = true;
        throw Object.assign(new Error("injected directory sync failure"), {
          code: "EIO",
        });
      }
      await originalSync.call(this);
    });
    try {
      let failure: unknown;
      try {
        await writeOwnerFileAtomic(durabilityPath, "durable?\n", {
          createOnly: true,
          name: "Test owner file",
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeTruthy();
      expect(failure).not.toBeInstanceOf(OwnerFileAlreadyExistsError);
      expect((await lstat(durabilityPath)).isFile()).toBe(true);
    } finally {
      sync.mockRestore();
    }
  });

  test("inspection returns metadata while recovery requires explicit confirmation and the exact nonce", async () => {
    const { manifestPath } = await fixture();
    const lock = await acquireOwnerLifecycleLock(manifestPath, "broker");
    try {
      const inspected = await inspectOwnerLifecycleLock(manifestPath);
      expect(inspected.path).toBe(lock.path);
      expect(inspected.pid).toBe(process.pid);
      expect(inspected.role).toBe("broker");

      await expect(
        recoverOwnerLifecycleLock(manifestPath, {
          confirmStaleLock: false,
          expectedNonce: inspected.nonce,
        } as unknown as RecoverOwnerLifecycleLockOptions),
      ).rejects.toThrow("explicit stale-lock confirmation");

      await expect(
        recoverOwnerLifecycleLock(manifestPath, {
          confirmStaleLock: true,
          expectedNonce: randomUUID(),
        }),
      ).rejects.toThrow("nonce does not match");

      await expect(
        recoverOwnerLifecycleLock(manifestPath, {
          confirmStaleLock: true,
          expectedNonce: inspected.nonce,
        }),
      ).rejects.toThrow("still live");
    } finally {
      await lock.release();
    }
  });

  test("never auto-reclaims a stale record and removes it only through explicit recovery", async () => {
    const { manifestPath, lockPath } = await fixture();
    const stale = await writeStaleLock(lockPath);

    await expect(
      acquireOwnerLifecycleLock(manifestPath, "controller"),
    ).rejects.toThrow("recover a stale lock manually");

    const recovered = await recoverOwnerLifecycleLock(manifestPath, {
      confirmStaleLock: true,
      expectedNonce: stale.nonce,
    });
    expect(recovered).toMatchObject(stale);
    await expect(lstat(lockPath)).rejects.toThrow();

    const next = await acquireOwnerLifecycleLock(manifestPath, "controller");
    await next.release();
  });

  test("removes only its own partial lock when acquisition sync fails", async () => {
    const { manifestPath, lockPath } = await fixture();
    const probe = await open(`${lockPath}.probe`, "w", 0o600);
    const prototype = Object.getPrototypeOf(probe) as {
      sync(this: FileHandle): Promise<void>;
    };
    const originalSync = prototype.sync;
    await probe.close();
    let failNext = true;
    const sync = spyOn(prototype, "sync").mockImplementation(async function (
      this: FileHandle,
    ) {
      if (failNext) {
        failNext = false;
        throw Object.assign(new Error("injected sync failure"), { code: "EIO" });
      }
      await originalSync.call(this);
    });
    try {
      await expect(
        acquireOwnerLifecycleLock(manifestPath, "controller"),
      ).rejects.toThrow("could not be acquired");
      await expect(lstat(lockPath)).rejects.toThrow();
    } finally {
      sync.mockRestore();
    }
  });

  test("refuses recovery when process absence cannot be proved", async () => {
    const { manifestPath, lockPath } = await fixture();
    const stale = await writeStaleLock(lockPath);
    const kill = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });
    try {
      await expect(
        recoverOwnerLifecycleLock(manifestPath, {
          confirmStaleLock: true,
          expectedNonce: stale.nonce,
        }),
      ).rejects.toThrow("process absence was not proved");
      expect((await lstat(lockPath)).isFile()).toBe(true);
    } finally {
      kill.mockRestore();
    }
  });

  test("rejects non-canonical timestamps and extra lock fields", async () => {
    const { manifestPath, lockPath } = await fixture();
    const base = {
      pid: 2_147_483_647,
      nonce: randomUUID(),
      role: "controller",
      at: "2026-07-29 12:00:00Z",
    };
    await writeOwnerFileAtomic(lockPath, `${JSON.stringify(base)}\n`, {
      createOnly: true,
      name: "Test lifecycle lock",
    });
    await expect(inspectOwnerLifecycleLock(manifestPath)).rejects.toThrow(
      "invalid",
    );

    await writeOwnerFileAtomic(
      lockPath,
      `${JSON.stringify({
        ...base,
        at: "2026-07-29T12:00:00.000Z",
        unexpected: true,
      })}\n`,
      { name: "Test lifecycle lock" },
    );
    await expect(inspectOwnerLifecycleLock(manifestPath)).rejects.toThrow(
      "invalid",
    );
  });

  test("refuses a group-readable lock and never follows a lock symlink", async () => {
    const { manifestPath, lockPath } = await fixture();
    await writeStaleLock(lockPath);
    await chmod(lockPath, 0o640);
    await expect(inspectOwnerLifecycleLock(manifestPath)).rejects.toThrow(
      "mode 0600",
    );

    await rm(lockPath);
    const targetPath = `${lockPath}.target`;
    await writeStaleLock(targetPath);
    await symlink(targetPath, lockPath);
    await expect(inspectOwnerLifecycleLock(manifestPath)).rejects.toThrow(
      "opened safely",
    );
  });

  test("refuses an inspected nonce after the lock file is replaced", async () => {
    const { manifestPath, lockPath } = await fixture();
    const first = await writeStaleLock(lockPath);
    const replacement = { ...first, nonce: randomUUID() };
    await writeOwnerFileAtomic(lockPath, `${JSON.stringify(replacement)}\n`, {
      name: "Test lifecycle lock",
    });

    await expect(
      recoverOwnerLifecycleLock(manifestPath, {
        confirmStaleLock: true,
        expectedNonce: first.nonce,
      }),
    ).rejects.toThrow("nonce does not match");
    expect((await inspectOwnerLifecycleLock(manifestPath)).nonce).toBe(
      replacement.nonce,
    );
  });
});
