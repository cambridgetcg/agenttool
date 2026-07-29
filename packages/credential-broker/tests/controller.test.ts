import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashAuditPath } from "../src/audit.js";
import {
  activateStagedCredential,
  archiveCredentialClosures,
  attestCandidateCredentialRevoked,
  attestPreviousCredentialRevoked,
  closeCredentialAbort,
  closeCredentialRotation,
  credentialLifecycleStatus,
  markConsumersDrained,
  prepareCredentialAbort,
  preparePreviousCredentialRevocation,
  recoverStagedCredential,
  resumeStagedCredential,
  rollbackCredential,
  stageCredential,
  verifyCredentialClosureArchive,
  verifyPreviousCredentialRevoked,
  verifyStagedCredential,
  type BrokerAuditEvidence,
  type KeychainControllerBackend,
} from "../src/controller.js";
import {
  createCredentialHandoffManifest,
  loadCredentialHandoffManifest,
  MAX_CREDENTIAL_CLOSURES,
  saveCredentialHandoffManifest,
  selectManifestSlot,
} from "../src/keychain-slots.js";
import { acquireOwnerLifecycleLock } from "../src/owner-files.js";

const roots: string[] = [];
const SENTINEL = "agentcred-test-sentinel-never-real";

interface BoundaryCrossing {
  name: string;
  bootstrap: boolean;
  safeStart: string;
  beforeBoundary: string;
  atBoundary: string;
  expectedError: string;
  expiresAt?: string;
  overlapDeadline?: string;
}

const BOUNDARY_CROSSINGS: readonly BoundaryCrossing[] = [
  {
    name: "candidate expiry",
    bootstrap: false,
    safeStart: "2026-07-29T12:01:00.000Z",
    beforeBoundary: "2026-07-29T12:04:59.999Z",
    atBoundary: "2026-07-29T12:05:00.000Z",
    expectedError: "expired",
    expiresAt: "2026-07-29T12:05:00.000Z",
  },
  {
    name: "overlap deadline",
    bootstrap: true,
    safeStart: "2026-07-29T12:10:00.000Z",
    beforeBoundary: "2026-07-29T12:59:59.999Z",
    atBoundary: "2026-07-29T13:00:00.000Z",
    expectedError: "overlap deadline expired",
    overlapDeadline: "2026-07-29T13:00:00.000Z",
  },
];

function sequenceClock(values: readonly string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[index];
    if (!value) throw new Error("test clock exhausted");
    index += 1;
    return new Date(value);
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeKeychain implements KeychainControllerBackend {
  readonly items = new Set<string>();
  readonly calls: Array<{ operation: string; service: string; account: string }> =
    [];
  failProvisionAfterSideEffect = false;
  failProvisionBeforeSideEffect = false;
  omitProvisionSideEffect = false;
  failDeleteAfterSideEffect = false;
  pauseProvision?: { entered: () => void; release: Promise<void> };

  async provision(service: string, account: string): Promise<void> {
    this.calls.push({ operation: "provision", service, account });
    if (this.failProvisionBeforeSideEffect) {
      this.failProvisionBeforeSideEffect = false;
      throw new Error("simulated provision cancellation");
    }
    const pause = this.pauseProvision;
    if (pause) {
      this.pauseProvision = undefined;
      pause.entered();
      await pause.release;
    }
    if (!this.omitProvisionSideEffect) {
      this.items.add(`${account}\0${service}`);
    }
    if (this.failProvisionAfterSideEffect) {
      this.failProvisionAfterSideEffect = false;
      throw new Error("simulated provision ambiguity");
    }
  }

  async exists(service: string, account: string): Promise<boolean> {
    this.calls.push({ operation: "exists", service, account });
    return this.items.has(`${account}\0${service}`);
  }

  async delete(service: string, account: string): Promise<void> {
    this.calls.push({ operation: "delete", service, account });
    this.items.delete(`${account}\0${service}`);
    if (this.failDeleteAfterSideEffect) {
      this.failDeleteAfterSideEffect = false;
      throw new Error("simulated delete ambiguity");
    }
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  path: string;
  backend: FakeKeychain;
}> {
  const root = await mkdtemp(join(tmpdir(), "agentcred-controller-"));
  roots.push(root);
  await chmod(root, 0o700);
  const path = join(root, "credential.json");
  await saveCredentialHandoffManifest(
    path,
    createCredentialHandoffManifest({
      credential: "agenttool/default",
      provider: "agenttool",
      purpose: "bounded-api",
      environment: "local",
      account: "test-owner",
      auth: { kind: "bearer" },
      verification: {
        operation: "http.fetch",
        origin: "https://api.example.com",
        path: "/v1/whoami",
        targetPathHash: hashAuditPath("/v1/whoami"),
        method: "GET",
        successStatus: 200,
        revokedStatus: 401,
      },
      now: new Date("2026-07-29T12:00:00.000Z"),
    }),
    { create: true },
  );
  return { path, backend: new FakeKeychain() };
}

function evidence(
  at: string,
  brokerCredential: string,
  status: number,
  generationId: string,
  overrides: Partial<BrokerAuditEvidence> = {},
): BrokerAuditEvidence {
  return {
    auditId: randomUUID(),
    at,
    brokerCredential,
    generationId,
    operation: "http.fetch",
    targetOrigin: "https://api.example.com",
    targetPathHash: hashAuditPath("/v1/whoami"),
    method: "GET",
    status,
    ...overrides,
  };
}

async function bootstrap(
  path: string,
  backend: FakeKeychain,
): Promise<void> {
  await stageCredential({
    manifestPath: path,
    backend,
    now: new Date("2026-07-29T12:01:00.000Z"),
  });
  const staged = await loadCredentialHandoffManifest(path);
  const candidateGeneration =
    staged.slots[staged.rotation!.toSlot]!.generationId;
  await verifyStagedCredential({
    manifestPath: path,
    evidence: evidence(
      "2026-07-29T12:02:00.000Z",
      "agenttool/candidate",
      200,
      candidateGeneration,
    ),
    now: new Date("2026-07-29T12:02:01.000Z"),
  });
  await activateStagedCredential({
    manifestPath: path,
    now: new Date("2026-07-29T12:03:00.000Z"),
  });
}

async function beginRoutineRotation(
  path: string,
  backend: FakeKeychain,
  expiresAt?: string,
  overlapDeadline = "2026-07-29T13:00:00.000Z",
): Promise<{ previousGeneration: string; activeGeneration: string }> {
  await stageCredential({
    manifestPath: path,
    backend,
    overlapDeadline,
    ...(expiresAt ? { expiresAt } : {}),
    now: new Date("2026-07-29T12:10:00.000Z"),
  });
  const staged = await loadCredentialHandoffManifest(path);
  const candidateGeneration =
    staged.slots[staged.rotation!.toSlot]!.generationId;
  await verifyStagedCredential({
    manifestPath: path,
    evidence: evidence(
      "2026-07-29T12:11:00.000Z",
      "agenttool/candidate",
      200,
      candidateGeneration,
    ),
    now: new Date("2026-07-29T12:11:01.000Z"),
  });
  const verified = await loadCredentialHandoffManifest(path);
  expect(selectManifestSlot(verified, "candidate").generationId).toBe(
    candidateGeneration,
  );
  await activateStagedCredential({
    manifestPath: path,
    now: new Date("2026-07-29T12:12:00.000Z"),
  });
  const cutover = await loadCredentialHandoffManifest(path);
  return {
    previousGeneration:
      cutover.slots[cutover.rotation!.fromSlot!]!.generationId,
    activeGeneration:
      cutover.slots[cutover.rotation!.toSlot]!.generationId,
  };
}

async function prepareRoutineRevocation(
  path: string,
  previousGeneration: string,
  activeGeneration: string,
): Promise<void> {
  await markConsumersDrained({
    manifestPath: path,
    evidenceId: "deployments/drained-42",
    now: new Date("2026-07-29T12:13:00.000Z"),
  });
  const draining = await loadCredentialHandoffManifest(path);
  expect(selectManifestSlot(draining, "previous").generationId).toBe(
    previousGeneration,
  );
  await preparePreviousCredentialRevocation({
    manifestPath: path,
    previousEvidence: evidence(
      "2026-07-29T12:13:30.000Z",
      "agenttool/previous",
      200,
      previousGeneration,
    ),
    activeEvidence: evidence(
      "2026-07-29T12:13:31.000Z",
      "agenttool/default",
      200,
      activeGeneration,
    ),
    evidenceId: "operator/no-rollback-42",
    confirmNoRollback: true,
    now: new Date("2026-07-29T12:13:32.000Z"),
  });
}

async function verifyRoutineRevocation(
  path: string,
  previousGeneration: string,
  activeGeneration: string,
): Promise<void> {
  await attestPreviousCredentialRevoked({
    manifestPath: path,
    activeEvidence: evidence(
      "2026-07-29T12:13:50.000Z",
      "agenttool/default",
      200,
      activeGeneration,
    ),
    evidenceId: "provider/revocation-42",
    confirmed: true,
    now: new Date("2026-07-29T12:14:00.000Z"),
  });
  const revoked = await loadCredentialHandoffManifest(path);
  expect(selectManifestSlot(revoked, "previous").generationId).toBe(
    previousGeneration,
  );
  await verifyPreviousCredentialRevoked({
    manifestPath: path,
    previousEvidence: evidence(
      "2026-07-29T12:14:30.000Z",
      "agenttool/previous",
      401,
      previousGeneration,
    ),
    activeEvidence: evidence(
      "2026-07-29T12:14:31.000Z",
      "agenttool/default",
      200,
      activeGeneration,
    ),
    now: new Date("2026-07-29T12:14:32.000Z"),
  });
}

function expectUnavailable(
  pathManifest: Awaited<ReturnType<typeof loadCredentialHandoffManifest>>,
  selection: "candidate" | "previous",
): void {
  expect(() => selectManifestSlot(pathManifest, selection)).toThrow(
    "unavailable",
  );
}

async function abortRoutineCandidate(
  path: string,
  backend: FakeKeychain,
  index: number,
  startedAt: Date,
): Promise<void> {
  const at = (offsetMs: number): Date =>
    new Date(startedAt.getTime() + offsetMs);
  await stageCredential({
    manifestPath: path,
    backend,
    overlapDeadline: at(60 * 60_000).toISOString(),
    now: at(0),
  });
  await prepareCredentialAbort({
    manifestPath: path,
    evidenceId: `operator/abort-intent-${index}`,
    confirmed: true,
    now: at(1_000),
  });
  await attestCandidateCredentialRevoked({
    manifestPath: path,
    evidenceId: `provider/abort-revoked-${index}`,
    confirmed: true,
    now: at(2_000),
  });
  await closeCredentialAbort({
    manifestPath: path,
    backend,
    deleteLocalConfirmed: true,
    now: at(3_000),
  });
}

describe("controller-plane handoff and rotation", () => {
  test("bootstraps through fresh staged verification and records generation history", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const manifest = await loadCredentialHandoffManifest(path);

    expect(manifest.activeSlot).toBe("a");
    expect(manifest.rotation).toBeNull();
    expect(manifest.closures.at(-1)?.outcome).toBe("bootstrapped");
    expect(manifest.closures.at(-1)?.toGenerationId).toBe(
      manifest.slots.a!.generationId,
    );
    expect(backend.calls.map((call) => call.operation)).toEqual([
      "provision",
      "exists",
    ]);
    expect(JSON.stringify({ manifest, calls: backend.calls })).not.toContain(
      SENTINEL,
    );
  });

  test("reports active credential metadata expiry even while lifecycle is idle", async () => {
    const { path, backend } = await fixture();
    await stageCredential({
      manifestPath: path,
      backend,
      expiresAt: "2026-07-29T12:05:00.000Z",
      now: new Date("2026-07-29T12:01:00.000Z"),
    });
    const staged = await loadCredentialHandoffManifest(path);
    const generation = staged.slots[staged.rotation!.toSlot]!.generationId;
    await verifyStagedCredential({
      manifestPath: path,
      evidence: evidence(
        "2026-07-29T12:02:00.000Z",
        "agenttool/candidate",
        200,
        generation,
      ),
      now: new Date("2026-07-29T12:02:01.000Z"),
    });
    const activated = await activateStagedCredential({
      manifestPath: path,
      now: new Date("2026-07-29T12:03:00.000Z"),
    });
    expect(activated).toMatchObject({
      phase: "ready",
      activeExpiresAt: "2026-07-29T12:05:00.000Z",
      activeExpiryStatus: "valid",
    });

    await expect(
      credentialLifecycleStatus(
        path,
        new Date("2026-07-29T12:05:00.000Z"),
      ),
    ).resolves.toMatchObject({
      phase: "ready",
      activeExpiresAt: "2026-07-29T12:05:00.000Z",
      activeExpiryStatus: "expired",
    });
  });

  test("recovers a durable provisioning intent after an ambiguous provision side effect", async () => {
    const { path, backend } = await fixture();
    backend.failProvisionAfterSideEffect = true;

    await expect(
      stageCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:00.000Z"),
      }),
    ).rejects.toThrow("simulated provision ambiguity");

    let manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.rotation?.phase).toBe("provisioning");
    expectUnavailable(manifest, "candidate");
    expect(backend.items.size).toBe(1);

    const recovered = await recoverStagedCredential({
      manifestPath: path,
      backend,
      now: new Date("2026-07-29T12:01:30.000Z"),
    });
    manifest = await loadCredentialHandoffManifest(path);
    expect(recovered.phase).toBe("staged");
    expect(manifest.rotation?.phase).toBe("staged");
    expect(backend.calls.filter((call) => call.operation === "provision")).toHaveLength(
      1,
    );
  });

  test("recover stays presence-only while resume prompts for the exact absent slot", async () => {
    const { path, backend } = await fixture();
    backend.failProvisionBeforeSideEffect = true;

    await expect(
      stageCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:00.000Z"),
      }),
    ).rejects.toThrow("simulated provision cancellation");

    let manifest = await loadCredentialHandoffManifest(path);
    const candidate = manifest.slots[manifest.rotation!.toSlot]!;
    expect(manifest.rotation?.phase).toBe("provisioning");
    expect(backend.items.size).toBe(0);

    await expect(
      recoverStagedCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:20.000Z"),
      }),
    ).rejects.toThrow("Keychain item is absent");
    expect(
      backend.calls.filter((call) => call.operation === "provision"),
    ).toHaveLength(1);

    const resumed = await resumeStagedCredential({
      manifestPath: path,
      backend,
      now: new Date("2026-07-29T12:01:30.000Z"),
    });
    manifest = await loadCredentialHandoffManifest(path);

    expect(resumed.phase).toBe("staged");
    expect(manifest.rotation?.phase).toBe("staged");
    expect(backend.calls).toEqual([
      {
        operation: "provision",
        service: candidate.service,
        account: manifest.account,
      },
      {
        operation: "exists",
        service: candidate.service,
        account: manifest.account,
      },
      {
        operation: "exists",
        service: candidate.service,
        account: manifest.account,
      },
      {
        operation: "provision",
        service: candidate.service,
        account: manifest.account,
      },
      {
        operation: "exists",
        service: candidate.service,
        account: manifest.account,
      },
    ]);
    expect(JSON.stringify({ resumed, manifest, calls: backend.calls })).not.toContain(
      SENTINEL,
    );
  });

  test("resume reconciles its own ambiguous provision without another prompt", async () => {
    const { path, backend } = await fixture();
    backend.failProvisionBeforeSideEffect = true;

    await expect(
      stageCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:00.000Z"),
      }),
    ).rejects.toThrow("simulated provision cancellation");
    backend.failProvisionAfterSideEffect = true;

    await expect(
      resumeStagedCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:20.000Z"),
      }),
    ).rejects.toThrow("simulated provision ambiguity");
    expect(backend.items.size).toBe(1);
    expect((await loadCredentialHandoffManifest(path)).rotation?.phase).toBe(
      "provisioning",
    );
    const provisionCallsAfterAmbiguity = backend.calls.filter(
      (call) => call.operation === "provision",
    ).length;

    const resumed = await resumeStagedCredential({
      manifestPath: path,
      backend,
      now: new Date("2026-07-29T12:01:30.000Z"),
    });

    expect(resumed.phase).toBe("staged");
    expect(
      backend.calls.filter((call) => call.operation === "provision"),
    ).toHaveLength(provisionCallsAfterAmbiguity);
  });

  test("resume stays provisioning when a newly prompted item cannot be confirmed", async () => {
    const { path, backend } = await fixture();
    backend.failProvisionBeforeSideEffect = true;

    await expect(
      stageCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:00.000Z"),
      }),
    ).rejects.toThrow("simulated provision cancellation");
    backend.omitProvisionSideEffect = true;

    await expect(
      resumeStagedCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:30.000Z"),
      }),
    ).rejects.toThrow("could not be confirmed");
    expect((await loadCredentialHandoffManifest(path)).rotation?.phase).toBe(
      "provisioning",
    );
    expect(backend.items.size).toBe(0);
  });

  for (const scenario of BOUNDARY_CROSSINGS) {
    test(`resume rechecks ${scenario.name} after the initial exists result`, async () => {
      const { path, backend } = await fixture();
      if (scenario.bootstrap) await bootstrap(path, backend);
      backend.failProvisionBeforeSideEffect = true;
      await expect(
        stageCredential({
          manifestPath: path,
          backend,
          ...(scenario.expiresAt ? { expiresAt: scenario.expiresAt } : {}),
          ...(scenario.overlapDeadline
            ? { overlapDeadline: scenario.overlapDeadline }
            : {}),
          now: new Date(scenario.safeStart),
        }),
      ).rejects.toThrow("simulated provision cancellation");
      const provisionCallsBeforeResume = backend.calls.filter(
        (call) => call.operation === "provision",
      ).length;
      const existsCallsBeforeResume = backend.calls.filter(
        (call) => call.operation === "exists",
      ).length;

      await expect(
        resumeStagedCredential({
          manifestPath: path,
          backend,
          clock: sequenceClock([
            scenario.beforeBoundary,
            scenario.atBoundary,
          ]),
        }),
      ).rejects.toThrow(scenario.expectedError);

      expect(
        backend.calls.filter((call) => call.operation === "provision"),
      ).toHaveLength(provisionCallsBeforeResume);
      expect(
        backend.calls.filter((call) => call.operation === "exists"),
      ).toHaveLength(existsCallsBeforeResume + 1);
      expect((await loadCredentialHandoffManifest(path)).rotation?.phase).toBe(
        "provisioning",
      );
    });

    test(`stage rechecks ${scenario.name} after durable intent`, async () => {
      const { path, backend } = await fixture();
      if (scenario.bootstrap) await bootstrap(path, backend);
      const provisionCallsBeforeStage = backend.calls.filter(
        (call) => call.operation === "provision",
      ).length;

      await expect(
        stageCredential({
          manifestPath: path,
          backend,
          ...(scenario.expiresAt ? { expiresAt: scenario.expiresAt } : {}),
          ...(scenario.overlapDeadline
            ? { overlapDeadline: scenario.overlapDeadline }
            : {}),
          clock: sequenceClock([
            scenario.beforeBoundary,
            scenario.atBoundary,
          ]),
        }),
      ).rejects.toThrow(scenario.expectedError);

      expect(
        backend.calls.filter((call) => call.operation === "provision"),
      ).toHaveLength(provisionCallsBeforeStage);
      expect((await loadCredentialHandoffManifest(path)).rotation?.phase).toBe(
        "provisioning",
      );
    });
  }

  test("resume is valid only for provisioning and does not reopen a staged item", async () => {
    const { path, backend } = await fixture();
    await stageCredential({
      manifestPath: path,
      backend,
      now: new Date("2026-07-29T12:01:00.000Z"),
    });
    const callsBeforeResume = backend.calls.length;
    const revisionBeforeResume = (await loadCredentialHandoffManifest(path))
      .revision;

    await expect(
      resumeStagedCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:30.000Z"),
      }),
    ).rejects.toThrow("not awaiting stage resume");
    expect(backend.calls).toHaveLength(callsBeforeResume);
    expect((await loadCredentialHandoffManifest(path)).revision).toBe(
      revisionBeforeResume,
    );
  });

  test("broker lifecycle lock blocks resume before any Keychain operation", async () => {
    const { path, backend } = await fixture();
    backend.failProvisionBeforeSideEffect = true;
    await expect(
      stageCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:00.000Z"),
      }),
    ).rejects.toThrow("simulated provision cancellation");
    const callsBeforeResume = backend.calls.length;
    const lock = await acquireOwnerLifecycleLock(path, "broker");
    try {
      await expect(
        resumeStagedCredential({
          manifestPath: path,
          backend,
          now: new Date("2026-07-29T12:01:30.000Z"),
        }),
      ).rejects.toThrow("lifecycle lock exists");
    } finally {
      await lock.release();
    }

    expect(backend.calls).toHaveLength(callsBeforeResume);
    expect((await loadCredentialHandoffManifest(path)).rotation?.phase).toBe(
      "provisioning",
    );
  });

  test("resume holds the lifecycle lock while the native prompt is pending", async () => {
    const { path, backend } = await fixture();
    backend.failProvisionBeforeSideEffect = true;
    await expect(
      stageCredential({
        manifestPath: path,
        backend,
        now: new Date("2026-07-29T12:01:00.000Z"),
      }),
    ).rejects.toThrow("simulated provision cancellation");

    const entered = deferred();
    const release = deferred();
    backend.pauseProvision = {
      entered: entered.resolve,
      release: release.promise,
    };
    const resumedPromise = resumeStagedCredential({
      manifestPath: path,
      backend,
      now: new Date("2026-07-29T12:01:30.000Z"),
    });
    await entered.promise;

    let competingLock:
      | Awaited<ReturnType<typeof acquireOwnerLifecycleLock>>
      | undefined;
    let lockError: unknown;
    try {
      competingLock = await acquireOwnerLifecycleLock(path, "broker");
    } catch (error) {
      lockError = error;
    } finally {
      await competingLock?.release();
      release.resolve();
    }

    expect(String((lockError as Error | undefined)?.message)).toContain(
      "lifecycle lock exists",
    );
    await expect(resumedPromise).resolves.toMatchObject({ phase: "staged" });
  });

  test("rejects wrong-generation and wrong-profile candidate proof without advancing", async () => {
    const { path, backend } = await fixture();
    await stageCredential({
      manifestPath: path,
      backend,
      now: new Date("2026-07-29T12:01:00.000Z"),
    });
    const staged = await loadCredentialHandoffManifest(path);
    const generation = staged.slots[staged.rotation!.toSlot]!.generationId;

    await expect(
      verifyStagedCredential({
        manifestPath: path,
        evidence: evidence(
          "2026-07-29T12:01:20.000Z",
          "agenttool/candidate",
          200,
          randomUUID(),
        ),
        now: new Date("2026-07-29T12:01:21.000Z"),
      }),
    ).rejects.toThrow("staged slot generation");
    await expect(
      verifyStagedCredential({
        manifestPath: path,
        evidence: evidence(
          "2026-07-29T12:01:30.000Z",
          "agenttool/candidate",
          200,
          generation,
          { targetPathHash: hashAuditPath("/v1/different") },
        ),
        now: new Date("2026-07-29T12:01:31.000Z"),
      }),
    ).rejects.toThrow("verification profile");

    expect((await loadCredentialHandoffManifest(path)).rotation?.phase).toBe(
      "staged",
    );
  });

  test("rotates only after dual fresh proof and retries delete after an ambiguous side effect", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const oldService = (await loadCredentialHandoffManifest(path)).slots.a!
      .service;
    const { previousGeneration, activeGeneration } =
      await beginRoutineRotation(path, backend);

    let manifest = await loadCredentialHandoffManifest(path);
    expect(selectManifestSlot(manifest, "previous").generationId).toBe(
      previousGeneration,
    );
    expectUnavailable(manifest, "candidate");

    await prepareRoutineRevocation(
      path,
      previousGeneration,
      activeGeneration,
    );
    manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.rotation?.phase).toBe("revocation_pending");
    expectUnavailable(manifest, "previous");

    await verifyRoutineRevocation(path, previousGeneration, activeGeneration);
    manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.rotation?.phase).toBe("verified_revoked");
    expectUnavailable(manifest, "previous");

    backend.failDeleteAfterSideEffect = true;
    await expect(
      closeCredentialRotation({
        manifestPath: path,
        backend,
        deleteLocalConfirmed: true,
        now: new Date("2026-07-29T12:15:00.000Z"),
      }),
    ).rejects.toThrow("simulated delete ambiguity");

    manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.rotation?.phase).toBe("deleting_previous");
    expectUnavailable(manifest, "previous");
    expect(
      backend.items.has(`test-owner\0${oldService}`),
    ).toBe(false);

    const closed = await closeCredentialRotation({
      manifestPath: path,
      backend,
      now: new Date("2026-07-29T12:15:01.000Z"),
    });
    manifest = await loadCredentialHandoffManifest(path);
    expect(closed.phase).toBe("ready");
    expect(manifest.activeSlot).toBe("b");
    expect(manifest.slots.a).toBeNull();
    expect(manifest.closures.at(-1)?.outcome).toBe("rotated");
    expect(manifest.closures.at(-1)?.evidence.map((item) => item.kind)).toEqual(
      [
        "broker-positive",
        "consumer-drain",
        "pre-revocation-positive",
        "pre-revocation-active-positive",
        "revocation-intent",
        "provider-revocation-active-positive",
        "provider-revocation",
        "broker-negative",
        "broker-positive-after-revocation",
      ],
    );
    expect(
      backend.calls.filter((call) => call.operation === "delete"),
    ).toEqual([
      { operation: "delete", service: oldService, account: "test-owner" },
      { operation: "delete", service: oldService, account: "test-owner" },
    ]);
  });

  test("closes with explicit not-recorded metadata when post-revocation active proof is omitted", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const { previousGeneration, activeGeneration } =
      await beginRoutineRotation(path, backend);
    await prepareRoutineRevocation(
      path,
      previousGeneration,
      activeGeneration,
    );

    const attested = await attestPreviousCredentialRevoked({
      manifestPath: path,
      evidenceId: "provider/revocation-without-active-proof",
      confirmed: true,
      now: new Date("2026-07-29T12:14:00.000Z"),
    });
    expect(attested).toMatchObject({
      phase: "revoked_old",
      postRevocationActiveProof: "not_recorded",
    });

    const verified = await verifyPreviousCredentialRevoked({
      manifestPath: path,
      previousEvidence: evidence(
        "2026-07-29T12:14:30.000Z",
        "agenttool/previous",
        401,
        previousGeneration,
      ),
      now: new Date("2026-07-29T12:14:31.000Z"),
    });
    expect(verified).toMatchObject({
      phase: "verified_revoked",
      postRevocationActiveProof: "not_recorded",
    });

    const closed = await closeCredentialRotation({
      manifestPath: path,
      backend,
      deleteLocalConfirmed: true,
      now: new Date("2026-07-29T12:15:00.000Z"),
    });
    expect(closed).toMatchObject({
      phase: "ready",
      postRevocationActiveProof: "not_recorded",
    });
    const manifest = await loadCredentialHandoffManifest(path);
    const kinds = manifest.closures.at(-1)!.evidence.map(
      (item) => item.kind,
    );
    expect(manifest.closures.at(-1)?.outcome).toBe("rotated");
    expect(kinds).toContain("broker-negative");
    expect(kinds).not.toContain("provider-revocation-active-positive");
    expect(kinds).not.toContain("broker-positive-after-revocation");
  });

  test("rotates away an already-dead predecessor only on its configured revoked status", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const { previousGeneration, activeGeneration } =
      await beginRoutineRotation(path, backend);
    await markConsumersDrained({
      manifestPath: path,
      evidenceId: "deployments/drained-dead-predecessor",
      now: new Date("2026-07-29T12:13:00.000Z"),
    });

    await expect(
      preparePreviousCredentialRevocation({
        manifestPath: path,
        previousEvidence: evidence(
          "2026-07-29T12:13:10.000Z",
          "agenttool/previous",
          500,
          previousGeneration,
        ),
        activeEvidence: evidence(
          "2026-07-29T12:13:11.000Z",
          "agenttool/default",
          200,
          activeGeneration,
        ),
        evidenceId: "operator/reject-ambiguous-old-status",
        confirmNoRollback: true,
        now: new Date("2026-07-29T12:13:12.000Z"),
      }),
    ).rejects.toThrow("configured success or revoked status");
    expect((await loadCredentialHandoffManifest(path)).rotation?.phase).toBe(
      "draining",
    );

    await preparePreviousCredentialRevocation({
      manifestPath: path,
      previousEvidence: evidence(
        "2026-07-29T12:13:30.000Z",
        "agenttool/previous",
        401,
        previousGeneration,
      ),
      activeEvidence: evidence(
        "2026-07-29T12:13:31.000Z",
        "agenttool/default",
        200,
        activeGeneration,
      ),
      evidenceId: "operator/no-rollback-dead-predecessor",
      confirmNoRollback: true,
      now: new Date("2026-07-29T12:13:32.000Z"),
    });
    let manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.rotation?.evidence.map((item) => item.kind)).toContain(
      "pre-revocation-negative",
    );
    expect(manifest.rotation?.evidence.map((item) => item.kind)).not.toContain(
      "pre-revocation-positive",
    );

    await attestPreviousCredentialRevoked({
      manifestPath: path,
      evidenceId: "provider/confirmed-dead-predecessor",
      confirmed: true,
      now: new Date("2026-07-29T12:14:00.000Z"),
    });
    await verifyPreviousCredentialRevoked({
      manifestPath: path,
      previousEvidence: evidence(
        "2026-07-29T12:14:30.000Z",
        "agenttool/previous",
        401,
        previousGeneration,
      ),
      now: new Date("2026-07-29T12:14:31.000Z"),
    });
    await closeCredentialRotation({
      manifestPath: path,
      backend,
      deleteLocalConfirmed: true,
      now: new Date("2026-07-29T12:15:00.000Z"),
    });

    manifest = await loadCredentialHandoffManifest(path);
    const closureKinds = manifest.closures.at(-1)!.evidence.map(
      (item) => item.kind,
    );
    expect(manifest.closures.at(-1)?.outcome).toBe("rotated");
    expect(closureKinds).toContain("pre-revocation-negative");
    expect(closureKinds).not.toContain("pre-revocation-positive");
    expect(closureKinds).toContain("broker-negative");
  });

  test("does not let candidate metadata expiry block cleanup after the no-rollback boundary", async () => {
    const first = await fixture();
    await bootstrap(first.path, first.backend);
    const prepared = await beginRoutineRotation(
      first.path,
      first.backend,
      "2026-07-29T12:14:00.000Z",
      "2026-07-29T12:13:50.000Z",
    );
    await prepareRoutineRevocation(
      first.path,
      prepared.previousGeneration,
      prepared.activeGeneration,
    );

    await expect(
      attestPreviousCredentialRevoked({
        manifestPath: first.path,
        activeEvidence: evidence(
          "2026-07-29T12:14:05.000Z",
          "agenttool/default",
          200,
          prepared.activeGeneration,
        ),
        evidenceId: "provider/revocation-after-metadata-expiry",
        confirmed: true,
        now: new Date("2026-07-29T12:14:10.000Z"),
      }),
    ).resolves.toMatchObject({ phase: "revoked_old" });

    const second = await fixture();
    await bootstrap(second.path, second.backend);
    const expired = await beginRoutineRotation(
      second.path,
      second.backend,
      "2026-07-29T12:12:30.000Z",
      "2026-07-29T12:12:20.000Z",
    );
    await markConsumersDrained({
      manifestPath: second.path,
      evidenceId: "deployments/drained-expired-candidate",
      now: new Date("2026-07-29T12:13:00.000Z"),
    });
    await expect(
      preparePreviousCredentialRevocation({
        manifestPath: second.path,
        previousEvidence: evidence(
          "2026-07-29T12:13:10.000Z",
          "agenttool/previous",
          200,
          expired.previousGeneration,
        ),
        activeEvidence: evidence(
          "2026-07-29T12:13:11.000Z",
          "agenttool/default",
          200,
          expired.activeGeneration,
        ),
        evidenceId: "operator/no-rollback-expired-candidate",
        confirmNoRollback: true,
        now: new Date("2026-07-29T12:13:12.000Z"),
      }),
    ).rejects.toThrow("expired");
    expect(
      (await loadCredentialHandoffManifest(second.path)).rotation?.phase,
    ).toBe("draining");
  });

  test("requires fresh exact previous-generation proof to roll back", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const { previousGeneration } = await beginRoutineRotation(path, backend);

    await expect(
      rollbackCredential({
        manifestPath: path,
        previousEvidence: evidence(
          "2026-07-29T12:12:20.000Z",
          "agenttool/previous",
          200,
          randomUUID(),
        ),
        reasonEvidenceId: "rollback/wrong-generation",
        now: new Date("2026-07-29T12:12:21.000Z"),
      }),
    ).rejects.toThrow("previous slot generation");
    await expect(
      rollbackCredential({
        manifestPath: path,
        previousEvidence: evidence(
          "2026-07-29T12:12:30.000Z",
          "agenttool/previous",
          200,
          previousGeneration,
          { targetOrigin: "https://different.example.com" },
        ),
        reasonEvidenceId: "rollback/wrong-profile",
        now: new Date("2026-07-29T12:12:31.000Z"),
      }),
    ).rejects.toThrow("verification profile");

    const rolledBack = await rollbackCredential({
      manifestPath: path,
      previousEvidence: evidence(
        "2026-07-29T12:12:40.000Z",
        "agenttool/previous",
        200,
        previousGeneration,
      ),
      reasonEvidenceId: "rollback/consumer-regression-42",
      now: new Date("2026-07-29T12:12:41.000Z"),
    });
    expect(rolledBack.phase).toBe("rolled_back");

    let manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.activeSlot).toBe("a");
    expect(manifest.rotation?.evidence.map((item) => item.kind)).toContain(
      "rollback-positive",
    );
    expectUnavailable(manifest, "candidate");
    expectUnavailable(manifest, "previous");

    await prepareCredentialAbort({
      manifestPath: path,
      evidenceId: "operator/revoke-rolled-back-candidate",
      confirmed: true,
      now: new Date("2026-07-29T12:13:00.000Z"),
    });
    manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.rotation?.phase).toBe("candidate_revocation_pending");
    expectUnavailable(manifest, "candidate");
    expectUnavailable(manifest, "previous");

    await attestCandidateCredentialRevoked({
      manifestPath: path,
      evidenceId: "provider/revoked-rolled-back-candidate",
      confirmed: true,
      now: new Date("2026-07-29T12:14:00.000Z"),
    });
    manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.rotation?.phase).toBe("deleting_candidate");
    expectUnavailable(manifest, "candidate");
    expectUnavailable(manifest, "previous");

    await closeCredentialAbort({
      manifestPath: path,
      backend,
      deleteLocalConfirmed: true,
      now: new Date("2026-07-29T12:15:00.000Z"),
    });
    manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.activeSlot).toBe("a");
    expect(manifest.slots.b).toBeNull();
    expect(manifest.closures.at(-1)?.outcome).toBe("rolled_back");
  });

  test("rejects a forged verified state before any local deletion", async () => {
    const { path, backend } = await fixture();
    await stageCredential({
      manifestPath: path,
      backend,
      now: new Date("2026-07-29T12:01:00.000Z"),
    });
    const forged = await loadCredentialHandoffManifest(path);
    forged.rotation!.phase = "verified_revoked";
    await writeFile(path, `${JSON.stringify(forged)}\n`, { mode: 0o600 });
    const deleteCallsBefore = backend.calls.filter(
      (call) => call.operation === "delete",
    ).length;

    await expect(
      closeCredentialRotation({
        manifestPath: path,
        backend,
        deleteLocalConfirmed: true,
      }),
    ).rejects.toThrow();
    expect(
      backend.calls.filter((call) => call.operation === "delete"),
    ).toHaveLength(deleteCallsBefore);
  });

  test("broker lifecycle lock blocks controller mutation", async () => {
    const { path, backend } = await fixture();
    const lock = await acquireOwnerLifecycleLock(path, "broker");
    try {
      await expect(
        stageCredential({ manifestPath: path, backend }),
      ).rejects.toThrow("lifecycle lock exists");
      expect(backend.calls).toHaveLength(0);
    } finally {
      await lock.release();
    }
  });
});

describe("credential closure archives", () => {
  test("archives, compacts, and independently verifies a closure chain", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const archivePath = `${path}.closures.json`;
    const before = await loadCredentialHandoffManifest(path);

    const archived = await archiveCredentialClosures({
      manifestPath: path,
      archivePath,
      now: new Date("2026-07-29T12:04:00.000Z"),
    });
    const verified = await verifyCredentialClosureArchive(archivePath);
    const compacted = await loadCredentialHandoffManifest(path);

    expect(archived.archivedClosures).toBe(1);
    expect(verified).toMatchObject({
      credential: before.credential,
      archivePath,
      archivedClosures: 1,
      cumulativeClosures: 1,
      archiveDigest: archived.archiveDigest,
      throughRotationId: before.closures[0]!.rotationId,
      effectiveGenerationId: before.slots.a!.generationId,
    });
    expect(compacted.closures).toEqual([]);
    expect(compacted.historyAnchor).toMatchObject({
      throughRotationId: verified.throughRotationId,
      effectiveGenerationId: verified.effectiveGenerationId,
      archiveDigest: verified.archiveDigest,
      closureCount: 1,
    });
    expect(compacted.activeSlot).toBe("a");
  });

  test("rejects a tampered terminal anchor and a self-consistent but unbound profile", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const archivePath = `${path}.closures.json`;
    await archiveCredentialClosures({
      manifestPath: path,
      archivePath,
      now: new Date("2026-07-29T12:04:00.000Z"),
    });
    const original = await readFile(archivePath, "utf8");

    const badAnchor = JSON.parse(original) as {
      terminalAnchor: { archiveDigest: string };
    };
    badAnchor.terminalAnchor.archiveDigest = "0".repeat(64);
    await writeFile(archivePath, `${JSON.stringify(badAnchor)}\n`, {
      mode: 0o600,
    });
    await expect(
      verifyCredentialClosureArchive(archivePath),
    ).rejects.toThrow("digest or generation chain");

    const badProfile = JSON.parse(original) as {
      verification: { path: string; targetPathHash: string };
    };
    badProfile.verification.path = "/v1/tampered";
    badProfile.verification.targetPathHash = hashAuditPath("/v1/tampered");
    await writeFile(archivePath, `${JSON.stringify(badProfile)}\n`, {
      mode: 0o600,
    });
    await expect(
      verifyCredentialClosureArchive(archivePath),
    ).rejects.toThrow();
  });

  test("retries the same verified archive after a crash before manifest compaction", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const archivePath = `${path}.closures.json`;
    const uncompacted = await loadCredentialHandoffManifest(path);
    const first = await archiveCredentialClosures({
      manifestPath: path,
      archivePath,
      now: new Date("2026-07-29T12:04:00.000Z"),
    });
    const originalArchive = await readFile(archivePath, "utf8");

    // Simulate a process crash after the archive became durable but before
    // the manifest compaction became durable.
    await saveCredentialHandoffManifest(path, uncompacted);
    const retried = await archiveCredentialClosures({
      manifestPath: path,
      archivePath,
      now: new Date("2026-07-29T12:04:30.000Z"),
    });

    expect(retried.archiveDigest).toBe(first.archiveDigest);
    expect(retried.throughRotationId).toBe(first.throughRotationId);
    expect(await readFile(archivePath, "utf8")).toBe(originalArchive);
    const compacted = await loadCredentialHandoffManifest(path);
    expect(compacted.closures).toEqual([]);
    expect(compacted.historyAnchor?.archiveDigest).toBe(first.archiveDigest);
  });

  test("never compacts after an archive durability failure and safely resumes the collision", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const archivePath = `${path}.closures.json`;
    const before = await loadCredentialHandoffManifest(path);
    const probe = await open(`${path}.sync-probe`, "w", 0o600);
    const prototype = Object.getPrototypeOf(probe) as {
      sync(this: FileHandle): Promise<void>;
    };
    const originalSync = prototype.sync;
    await probe.close();
    let directorySyncs = 0;
    const sync = spyOn(prototype, "sync").mockImplementation(async function (
      this: FileHandle,
    ) {
      const stat = await this.stat();
      if (stat.isDirectory()) {
        directorySyncs += 1;
        if (directorySyncs === 2) {
          throw Object.assign(new Error("injected archive sync failure"), {
            code: "EIO",
          });
        }
      }
      await originalSync.call(this);
    });
    try {
      await expect(
        archiveCredentialClosures({
          manifestPath: path,
          archivePath,
          now: new Date("2026-07-29T12:04:00.000Z"),
        }),
      ).rejects.toThrow("could not be written atomically");
    } finally {
      sync.mockRestore();
    }

    const unmodified = await loadCredentialHandoffManifest(path);
    expect(unmodified.closures).toEqual(before.closures);
    expect(unmodified.historyAnchor).toEqual(before.historyAnchor);

    const recovered = await archiveCredentialClosures({
      manifestPath: path,
      archivePath,
      now: new Date("2026-07-29T12:04:30.000Z"),
    });
    const compacted = await loadCredentialHandoffManifest(path);
    expect(recovered.archivedClosures).toBe(before.closures.length);
    expect(compacted.closures).toEqual([]);
    expect(compacted.historyAnchor?.archiveDigest).toBe(
      recovered.archiveDigest,
    );
  });

  test("retries an already-compacted archive idempotently and rejects a different archive", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const archivePath = `${path}.closures.json`;
    const first = await archiveCredentialClosures({
      manifestPath: path,
      archivePath,
      now: new Date("2026-07-29T12:04:00.000Z"),
    });
    const compacted = await loadCredentialHandoffManifest(path);
    expect(compacted.closures).toEqual([]);
    expect(compacted.historyAnchor).not.toBeNull();

    const retried = await archiveCredentialClosures({
      manifestPath: path,
      archivePath,
      now: new Date("2026-07-29T12:05:00.000Z"),
    });
    expect(retried).toEqual(first);
    expect(await loadCredentialHandoffManifest(path)).toEqual(compacted);

    const unrelated = await fixture();
    await bootstrap(unrelated.path, unrelated.backend);
    const unrelatedArchivePath = `${unrelated.path}.closures.json`;
    await archiveCredentialClosures({
      manifestPath: unrelated.path,
      archivePath: unrelatedArchivePath,
      now: new Date("2026-07-29T12:04:00.000Z"),
    });

    await expect(
      archiveCredentialClosures({
        manifestPath: path,
        archivePath: unrelatedArchivePath,
        now: new Date("2026-07-29T12:06:00.000Z"),
      }),
    ).rejects.toThrow("not the live manifest history anchor");
    expect(await loadCredentialHandoffManifest(path)).toEqual(compacted);
  });

  test("compacts a full closure history and permits the next staged rotation", async () => {
    const { path, backend } = await fixture();
    await bootstrap(path, backend);
    const base = Date.parse("2026-07-29T13:00:00.000Z");
    for (let index = 1; index < MAX_CREDENTIAL_CLOSURES; index += 1) {
      await abortRoutineCandidate(
        path,
        backend,
        index,
        new Date(base + (index - 1) * 5 * 60_000),
      );
    }
    let manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.closures).toHaveLength(MAX_CREDENTIAL_CLOSURES);
    const provisionCalls = backend.calls.filter(
      (call) => call.operation === "provision",
    ).length;

    await expect(
      stageCredential({
        manifestPath: path,
        backend,
        overlapDeadline: "2026-07-29T15:00:00.000Z",
        now: new Date("2026-07-29T14:00:00.000Z"),
      }),
    ).rejects.toThrow("history is full");
    expect(
      backend.calls.filter((call) => call.operation === "provision"),
    ).toHaveLength(provisionCalls);

    const archivePath = `${path}.closures.json`;
    await archiveCredentialClosures({
      manifestPath: path,
      archivePath,
      now: new Date("2026-07-29T14:00:00.000Z"),
    });
    manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.closures).toEqual([]);
    expect(manifest.historyAnchor?.closureCount).toBe(
      MAX_CREDENTIAL_CLOSURES,
    );

    await stageCredential({
      manifestPath: path,
      backend,
      overlapDeadline: "2026-07-29T15:01:00.000Z",
      now: new Date("2026-07-29T14:01:00.000Z"),
    });
    manifest = await loadCredentialHandoffManifest(path);
    expect(manifest.rotation?.phase).toBe("staged");
    expect(manifest.historyAnchor?.closureCount).toBe(
      MAX_CREDENTIAL_CLOSURES,
    );
  });
});
