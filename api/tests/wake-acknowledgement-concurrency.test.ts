/** WAKE acknowledgement lifecycle and lock-order concurrency contract. */

import { describe, expect, test } from "bun:test";

import { advanceWakeAcknowledgement } from "../src/services/wake/acknowledgement";

type RowLockMode = "no_key_update" | "key_share";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class Mutex {
  private held = false;
  private readonly waiters: Array<(release: () => void) => void> = [];

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.held) this.grant(resolve);
      else this.waiters.push(resolve);
    });
  }

  private grant(resolve: (release: () => void) => void): void {
    this.held = true;
    let released = false;
    resolve(() => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) this.grant(next);
      else this.held = false;
    });
  }
}

interface RowLockHolder {
  mode: RowLockMode;
  release: () => void;
}

/** PostgreSQL compatibility subset used by this contract: NO KEY UPDATE
 * conflicts with itself, while KEY SHARE remains compatible with it. The
 * latter models a hypothetical future physical chronicle FK; none exists in
 * the current schema. */
class CompatibleIdentityRowLock {
  private readonly holders: RowLockHolder[] = [];
  private readonly waiters: Array<{
    mode: RowLockMode;
    resolve: (release: () => void) => void;
  }> = [];

  acquire(mode: RowLockMode): Promise<() => void> {
    return new Promise((resolve) => {
      this.waiters.push({ mode, resolve });
      this.drain();
    });
  }

  private compatible(mode: RowLockMode): boolean {
    return (
      mode === "key_share" ||
      this.holders.every((holder) => holder.mode === "key_share")
    );
  }

  private drain(): void {
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index]!;
      if (!this.compatible(waiter.mode)) {
        index += 1;
        continue;
      }
      this.waiters.splice(index, 1);
      let released = false;
      const holder: RowLockHolder = {
        mode: waiter.mode,
        release: () => {
          if (released) return;
          released = true;
          const holderIndex = this.holders.indexOf(holder);
          if (holderIndex >= 0) this.holders.splice(holderIndex, 1);
          this.drain();
        },
      };
      this.holders.push(holder);
      waiter.resolve(holder.release);
    }
  }
}

interface FakeTransaction {
  releases: Array<() => void>;
  execute: () => Promise<void>;
  select: () => unknown;
  update: () => unknown;
}

function fakeLifecycleDatabase(initialStatus: "active" | "revoked" = "active") {
  const identity = {
    id: "22222222-2222-4222-8222-222222222222",
    projectId: "project-1",
    name: "Wake Test",
    status: initialStatus,
    count: 0,
  };
  const rowLock = new CompatibleIdentityRowLock();
  const welcomeLock = new Mutex();
  const events: string[] = [];
  const acknowledgementLocked = deferred();
  let acknowledgementPause: Promise<void> | undefined;
  let selectedStatus: "active" | "revoked" = initialStatus;
  let updateCalls = 0;
  let welcomeCalls = 0;

  const database = {
    async transaction<T>(callback: (tx: FakeTransaction) => Promise<T>) {
      const before = { ...identity };
      const releases: Array<() => void> = [];
      const selectBuilder = {
        from() { return selectBuilder; },
        where() { return selectBuilder; },
        limit() { return selectBuilder; },
        async for(strength: string) {
          if (strength !== "no key update") {
            throw new Error(`unexpected row-lock strength: ${strength}`);
          }
          releases.push(await rowLock.acquire("no_key_update"));
          events.push("ack:identity-row-locked");
          acknowledgementLocked.resolve();
          if (acknowledgementPause) await acknowledgementPause;
          selectedStatus = identity.status;
          return [{
            id: identity.id,
            name: identity.name,
            status: identity.status,
            observationCount: identity.count,
          }];
        },
      };
      const updateBuilder = {
        set() { return updateBuilder; },
        where() { return updateBuilder; },
        async returning() {
          updateCalls += 1;
          if (
            identity.status !== selectedStatus ||
            identity.count !== 0
          ) {
            return [];
          }
          identity.count += 1;
          events.push("ack:cursor-updated");
          return [{ count: identity.count }];
        },
      };
      const tx: FakeTransaction = {
        releases,
        execute: async () => undefined,
        select: () => selectBuilder,
        update: () => updateBuilder,
      };
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(identity, before);
        events.push("ack:transaction-rolled-back");
        throw error;
      } finally {
        events.push("ack:transaction-ended");
        for (const release of releases.reverse()) release();
      }
    },
  };

  const decideWelcome = async (txValue: unknown) => {
    const tx = txValue as FakeTransaction;
    tx.releases.push(await welcomeLock.acquire());
    events.push("ack:welcome-advisory-locked");
    welcomeCalls += 1;
    return {
      emitted: false,
      entry_id: null,
      reason: "recent_welcome_exists" as const,
    };
  };

  const revoke = async (pause?: Promise<void>, locked?: () => void) => {
    const release = await rowLock.acquire("no_key_update");
    events.push("revoke:identity-row-locked");
    locked?.();
    try {
      if (pause) await pause;
      identity.status = "revoked";
      events.push("revoke:status-updated");
    } finally {
      release();
    }
  };

  const standaloneWelcome = async (
    pauseAfterAdvisory?: Promise<void>,
    advisoryLocked?: () => void,
  ) => {
    const releaseWelcome = await welcomeLock.acquire();
    events.push("standalone:welcome-advisory-locked");
    advisoryLocked?.();
    try {
      if (pauseAfterAdvisory) await pauseAfterAdvisory;
      // Current chronicle.agent_id is a logical relation only. A standalone
      // insert therefore takes no physical-FK identity-row lock.
      events.push("standalone:welcome-inserted");
    } finally {
      releaseWelcome();
    }
  };

  return {
    identity,
    database,
    decideWelcome,
    revoke,
    standaloneWelcome,
    events,
    acknowledgementLocked,
    pauseAcknowledgementUntil(promise: Promise<void>) {
      acknowledgementPause = promise;
    },
    updateCalls: () => updateCalls,
    welcomeCalls: () => welcomeCalls,
  };
}

const ARGS = {
  projectId: "project-1",
  identityId: "22222222-2222-4222-8222-222222222222",
  expectedObservationCount: 0,
};

function acknowledge(fake: ReturnType<typeof fakeLifecycleDatabase>) {
  return advanceWakeAcknowledgement(ARGS, {
    database: fake.database as never,
    decideWelcome: fake.decideWelcome as never,
    publishWelcome: () => undefined,
  });
}

async function withinOneSecond<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("concurrency contract timed out")),
          1_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe("WAKE acknowledgement lifecycle serialization", () => {
  test("a revocation that wins the row lock prevents cursor and welcome writes", async () => {
    const fake = fakeLifecycleDatabase();
    const allowRevocation = deferred();
    const revocationLocked = deferred();
    const revocation = fake.revoke(
      allowRevocation.promise,
      revocationLocked.resolve,
    );
    await revocationLocked.promise;

    const acknowledgement = acknowledge(fake);
    await Promise.resolve();
    expect(fake.updateCalls()).toBe(0);
    allowRevocation.resolve();
    await revocation;

    expect(await withinOneSecond(acknowledgement)).toEqual({
      ok: false,
      error: "identity_revoked",
      observation_count: 0,
    });
    expect(fake.updateCalls()).toBe(0);
    expect(fake.welcomeCalls()).toBe(0);
  });

  test("an acknowledgement that wins the row lock commits before revocation", async () => {
    const fake = fakeLifecycleDatabase();
    const allowAcknowledgement = deferred();
    fake.pauseAcknowledgementUntil(allowAcknowledgement.promise);

    const acknowledgement = acknowledge(fake);
    await fake.acknowledgementLocked.promise;
    const revocation = fake.revoke();
    await Promise.resolve();
    expect(fake.identity.status).toBe("active");

    allowAcknowledgement.resolve();
    const result = await withinOneSecond(acknowledgement);
    await withinOneSecond(revocation);

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      observation_count: 1,
    });
    expect(fake.identity).toMatchObject({ status: "revoked", count: 1 });
    expect(fake.events.indexOf("ack:cursor-updated")).toBeLessThan(
      fake.events.indexOf("revoke:status-updated"),
    );
  });

  test("current standalone welcome needs no identity-row lock while acknowledgement holds NO KEY UPDATE", async () => {
    const fake = fakeLifecycleDatabase();
    const allowStandaloneInsert = deferred();
    const standaloneAdvisoryLocked = deferred();
    const standalone = fake.standaloneWelcome(
      allowStandaloneInsert.promise,
      standaloneAdvisoryLocked.resolve,
    );
    await standaloneAdvisoryLocked.promise;

    const acknowledgement = acknowledge(fake);
    await fake.acknowledgementLocked.promise;
    allowStandaloneInsert.resolve();

    await withinOneSecond(standalone);
    const result = await withinOneSecond(acknowledgement);
    expect(result).toMatchObject({ ok: true, applied: true });
    expect(fake.events).toEqual(
      expect.arrayContaining([
        "ack:identity-row-locked",
        "standalone:welcome-inserted",
        "ack:welcome-advisory-locked",
      ]),
    );
    expect(fake.events.indexOf("standalone:welcome-inserted")).toBeLessThan(
      fake.events.indexOf("ack:welcome-advisory-locked"),
    );
  });

  test("NO KEY UPDATE stays compatible with a hypothetical future physical-FK KEY SHARE", async () => {
    const rowLock = new CompatibleIdentityRowLock();
    const releaseAcknowledgement = await rowLock.acquire("no_key_update");
    const releaseFutureForeignKey = await withinOneSecond(
      rowLock.acquire("key_share"),
    );
    releaseFutureForeignKey();
    releaseAcknowledgement();
  });

  test("an error welcome decision rolls the cursor back", async () => {
    const fake = fakeLifecycleDatabase();
    const previousWarn = console.warn;
    console.warn = () => undefined;
    try {
      const result = await advanceWakeAcknowledgement(ARGS, {
        database: fake.database as never,
        decideWelcome: (async () => ({
          emitted: false,
          entry_id: null,
          reason: "error",
        })) as never,
        publishWelcome: () => undefined,
      });

      expect(result).toEqual({ ok: false, error: "unavailable" });
      expect(fake.identity.count).toBe(0);
      expect(fake.events).toContain("ack:transaction-rolled-back");
    } finally {
      console.warn = previousWarn;
    }
  });

  test("a synchronous post-commit publisher failure does not falsify the committed result", async () => {
    const fake = fakeLifecycleDatabase();
    const previousWarn = console.warn;
    console.warn = () => undefined;
    try {
      const result = await advanceWakeAcknowledgement(ARGS, {
        database: fake.database as never,
        decideWelcome: fake.decideWelcome as never,
        publishWelcome: () => {
          throw new Error("publisher unavailable");
        },
      });

      expect(result).toMatchObject({
        ok: true,
        applied: true,
        observation_count: 1,
      });
      expect(fake.identity.count).toBe(1);
      expect(fake.events).not.toContain("ack:transaction-rolled-back");
    } finally {
      console.warn = previousWarn;
    }
  });

  test("commit-then-disconnect is outcome-unknown and an exact retry cannot double-increment", async () => {
    const fake = fakeLifecycleDatabase();
    const previousWarn = console.warn;
    console.warn = () => undefined;
    try {
      const commitThenDisconnect = {
        async transaction<T>(callback: (tx: FakeTransaction) => Promise<T>) {
          await fake.database.transaction(callback);
          throw new Error("connection lost after commit acknowledgement");
        },
      };

      const uncertain = await advanceWakeAcknowledgement(ARGS, {
        database: commitThenDisconnect as never,
        decideWelcome: fake.decideWelcome as never,
        publishWelcome: () => undefined,
      });
      expect(uncertain).toEqual({ ok: false, error: "unavailable" });
      expect(fake.identity.count).toBe(1);
      expect(fake.welcomeCalls()).toBe(1);

      const retry = await acknowledge(fake);
      expect(retry).toMatchObject({
        ok: true,
        applied: false,
        observation_count: 1,
        welcome: { reason: "acknowledgement_already_completed" },
      });
      expect(fake.identity.count).toBe(1);
      expect(fake.welcomeCalls()).toBe(1);
    } finally {
      console.warn = previousWarn;
    }
  });
});
