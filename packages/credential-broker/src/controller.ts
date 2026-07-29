import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { AgentCredError } from "./errors.js";
import { isCredentialAlias } from "./identifiers.js";
import {
  AGENTCRED_HANDOFF_MANIFEST,
  assertCredentialHandoffManifestFits,
  hashCredentialManifestMetadata,
  hashCredentialVerificationProfile,
  loadCredentialHandoffManifest,
  makeKeychainSlotRecord,
  MAX_CREDENTIAL_CLOSURES,
  MAX_LIFECYCLE_EVIDENCE_AGE_MS,
  nextManifestRevision,
  parseCredentialHandoffManifest,
  saveCredentialHandoffManifest,
  type CredentialHandoffManifest,
  type CredentialHistoryAnchor,
  type CredentialRotation,
  type CredentialRotationPhase,
  type CredentialVerificationProfile,
  type KeychainSlotName,
  type KeychainSlotRecord,
  type RotationClosureReceipt,
  type RotationEvidence,
} from "./keychain-slots.js";
import {
  acquireOwnerLifecycleLock,
  OwnerFileAlreadyExistsError,
  readOwnerFile,
  syncOwnerFileDurably,
  writeOwnerFileAtomic,
  type OwnerLifecycleLock,
} from "./owner-files.js";

const FIXED_PATH = "/usr/bin:/bin";
const CONTROLLER_USER = userInfo();
const KEYCHAIN_NOT_FOUND_EXIT = 44;
const MAX_CLOSURE_ARCHIVE_BYTES = 96 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;

function invalid(message: string): AgentCredError {
  return new AgentCredError("invalid_request", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  return {
    HOME: CONTROLLER_USER.homedir,
    USER: CONTROLLER_USER.username,
    LOGNAME: CONTROLLER_USER.username,
    LANG: "C",
    PATH: FIXED_PATH,
  };
}

async function runSecurity(
  args: string[],
  stdio: "inherit" | "ignore",
  timeoutMs: number,
): Promise<number> {
  if (process.platform !== "darwin") {
    throw new AgentCredError(
      "backend_unavailable",
      "macOS Keychain controller is unavailable.",
    );
  }
  return new Promise<number>((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, {
      stdio,
      env: minimalEnvironment(),
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);
    timeout.unref?.();
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new AgentCredError(
          "backend_unavailable",
          "macOS Keychain controller could not start.",
        ),
      );
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === null) {
        reject(
          new AgentCredError(
            "backend_unavailable",
            "macOS Keychain controller timed out.",
          ),
        );
        return;
      }
      resolve(code);
    });
  });
}

export interface KeychainControllerBackend {
  provision(service: string, account: string): Promise<void>;
  exists(service: string, account: string): Promise<boolean>;
  delete(service: string, account: string): Promise<void>;
}

/**
 * Fixed human/controller-side Keychain operations. The secret prompt belongs
 * to `/usr/bin/security`; this API has no value argument or value return.
 */
export class MacOSKeychainController implements KeychainControllerBackend {
  async provision(service: string, account: string): Promise<void> {
    const code = await runSecurity(
      ["add-generic-password", "-a", account, "-s", service, "-w"],
      "inherit",
      5 * 60_000,
    );
    if (code !== 0) {
      throw new AgentCredError(
        "backend_unavailable",
        "macOS Keychain provisioning did not complete.",
      );
    }
  }

  async exists(service: string, account: string): Promise<boolean> {
    const code = await runSecurity(
      ["find-generic-password", "-a", account, "-s", service],
      "ignore",
      15_000,
    );
    if (code === 0) return true;
    if (code === KEYCHAIN_NOT_FOUND_EXIT) return false;
    throw new AgentCredError(
      "backend_unavailable",
      "macOS Keychain availability check failed.",
    );
  }

  async delete(service: string, account: string): Promise<void> {
    if (!(await this.exists(service, account))) return;
    const code = await runSecurity(
      ["delete-generic-password", "-a", account, "-s", service],
      "ignore",
      15_000,
    );
    if (code !== 0 && code !== KEYCHAIN_NOT_FOUND_EXIT) {
      throw new AgentCredError(
        "backend_unavailable",
        "macOS Keychain deletion requires reconciliation.",
      );
    }
    if (await this.exists(service, account)) {
      throw new AgentCredError(
        "backend_unavailable",
        "macOS Keychain deletion could not be confirmed.",
      );
    }
  }
}

export interface BrokerAuditEvidence {
  auditId: string;
  at: string;
  brokerCredential: string;
  /**
   * Identifies the selected immutable slot reference. It is not a hash or
   * attestation of Keychain bytes against out-of-band same-user mutation.
   */
  generationId: string;
  operation: "http.fetch";
  targetOrigin: string;
  targetPathHash: string;
  method: "GET" | "HEAD";
  status: number;
}

export interface CredentialLifecycleReceipt {
  credential: string;
  provider: string;
  purpose: string;
  environment: string;
  revision: number;
  rotationId?: string;
  phase: "ready" | "unprovisioned" | CredentialRotationPhase;
  activeGenerationId?: string;
  activeExpiresAt?: string;
  activeExpiryStatus?: "valid" | "expired";
  candidateGenerationId?: string;
  previousGenerationId?: string;
  overlapDeadline?: string;
  overlapStatus?: "open" | "expired";
  candidateExpiresAt?: string;
  candidateExpiryStatus?: "valid" | "expired";
  postRevocationActiveProof?: "recorded" | "not_recorded";
  historyAnchor?: Pick<
    CredentialHistoryAnchor,
    | "throughRotationId"
    | "throughClosedAt"
    | "closureCount"
    | "archiveDigest"
  >;
  lastClosure?: Pick<
    RotationClosureReceipt,
    "rotationId" | "outcome" | "closedAt"
  >;
}

function receipt(
  manifest: CredentialHandoffManifest,
  now = new Date(),
): CredentialLifecycleReceipt {
  const active = manifest.activeSlot
    ? manifest.slots[manifest.activeSlot]
    : null;
  const candidate = manifest.rotation
    ? manifest.slots[manifest.rotation.toSlot]
    : null;
  const previous = manifest.rotation?.fromSlot
    ? manifest.slots[manifest.rotation.fromSlot]
    : null;
  const lastClosure = manifest.closures.at(-1);
  const postRevocationEvidence =
    manifest.rotation &&
    ["revoked_old", "verified_revoked", "deleting_previous"].includes(
      manifest.rotation.phase,
    )
      ? manifest.rotation.evidence
      : lastClosure?.outcome === "rotated"
        ? lastClosure.evidence
        : undefined;
  return {
    credential: manifest.credential,
    provider: manifest.provider,
    purpose: manifest.purpose,
    environment: manifest.environment,
    revision: manifest.revision,
    phase: manifest.rotation?.phase ?? (active ? "ready" : "unprovisioned"),
    ...(manifest.rotation ? { rotationId: manifest.rotation.rotationId } : {}),
    ...(active ? { activeGenerationId: active.generationId } : {}),
    ...(active?.expiresAt
      ? {
          activeExpiresAt: active.expiresAt,
          activeExpiryStatus:
            Date.parse(active.expiresAt) > now.getTime()
              ? ("valid" as const)
              : ("expired" as const),
        }
      : {}),
    ...(candidate ? { candidateGenerationId: candidate.generationId } : {}),
    ...(previous ? { previousGenerationId: previous.generationId } : {}),
    ...(manifest.rotation?.overlapDeadline
      ? {
          overlapDeadline: manifest.rotation.overlapDeadline,
          overlapStatus:
            Date.parse(manifest.rotation.overlapDeadline) > now.getTime()
              ? ("open" as const)
              : ("expired" as const),
        }
      : {}),
    ...(candidate?.expiresAt
      ? {
          candidateExpiresAt: candidate.expiresAt,
          candidateExpiryStatus:
            Date.parse(candidate.expiresAt) > now.getTime()
              ? ("valid" as const)
              : ("expired" as const),
        }
      : {}),
    ...(postRevocationEvidence
      ? {
          postRevocationActiveProof: postRevocationEvidence.some(
            (item) =>
              item.kind === "provider-revocation-active-positive" ||
              item.kind === "broker-positive-after-revocation",
          )
            ? ("recorded" as const)
            : ("not_recorded" as const),
        }
      : {}),
    ...(manifest.historyAnchor
      ? {
          historyAnchor: {
            throughRotationId: manifest.historyAnchor.throughRotationId,
            throughClosedAt: manifest.historyAnchor.throughClosedAt,
            closureCount: manifest.historyAnchor.closureCount,
            archiveDigest: manifest.historyAnchor.archiveDigest,
          },
        }
      : {}),
    ...(lastClosure
      ? {
          lastClosure: {
            rotationId: lastClosure.rotationId,
            outcome: lastClosure.outcome,
            closedAt: lastClosure.closedAt,
          },
        }
      : {}),
  };
}

function closureFor(
  manifest: CredentialHandoffManifest,
  rotation: CredentialRotation,
  outcome: RotationClosureReceipt["outcome"],
  closedAt: Date,
): RotationClosureReceipt {
  const candidate = manifest.slots[rotation.toSlot];
  if (!candidate) throw invalid("Rotation candidate slot is empty.");
  const previous = rotation.fromSlot
    ? manifest.slots[rotation.fromSlot]
    : null;
  return {
    rotationId: rotation.rotationId,
    outcome,
    closedAt: closedAt.toISOString(),
    startedAt: rotation.startedAt,
    ...(rotation.overlapDeadline
      ? { overlapDeadline: rotation.overlapDeadline }
      : {}),
    ...(rotation.candidateVerifiedAt
      ? { candidateVerifiedAt: rotation.candidateVerifiedAt }
      : {}),
    ...(rotation.cutoverAt ? { cutoverAt: rotation.cutoverAt } : {}),
    ...(rotation.drainedAt ? { drainedAt: rotation.drainedAt } : {}),
    ...(rotation.revocationPreparedAt
      ? { revocationPreparedAt: rotation.revocationPreparedAt }
      : {}),
    ...(rotation.providerRevokedAt
      ? { providerRevokedAt: rotation.providerRevokedAt }
      : {}),
    ...(rotation.revocationVerifiedAt
      ? { revocationVerifiedAt: rotation.revocationVerifiedAt }
      : {}),
    ...(rotation.rolledBackAt
      ? { rolledBackAt: rotation.rolledBackAt }
      : {}),
    ...(rotation.candidateRevocationPreparedAt
      ? {
          candidateRevocationPreparedAt:
            rotation.candidateRevocationPreparedAt,
        }
      : {}),
    ...(rotation.candidateProviderRevokedAt
      ? {
          candidateProviderRevokedAt:
            rotation.candidateProviderRevokedAt,
        }
      : {}),
    ...(previous ? { fromGenerationId: previous.generationId } : {}),
    toGenerationId: candidate.generationId,
    evidence: rotation.evidence.map((item) => ({ ...item })),
  };
}

function appendClosure(
  manifest: CredentialHandoffManifest,
  closure: RotationClosureReceipt,
): RotationClosureReceipt[] {
  if (manifest.closures.length >= MAX_CREDENTIAL_CLOSURES) {
    throw invalid(
      "Credential closure history is full; archive it before another rotation.",
    );
  }
  return [...manifest.closures, closure];
}

async function withControllerLock<T>(
  manifestPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  let lock: OwnerLifecycleLock | undefined;
  try {
    lock = await acquireOwnerLifecycleLock(manifestPath, "controller");
    return await operation();
  } finally {
    await lock?.release();
  }
}

function futureDate(value: string | undefined, now: Date): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(value).toISOString() !== value ||
    timestamp <= now.getTime()
  ) {
    throw invalid("Rotation overlap deadline must be a future ISO timestamp.");
  }
  return value;
}

function safeEvidenceId(value: string, label: string): string {
  if (!SAFE_EVIDENCE_ID.test(value)) {
    throw invalid(`${label} evidence ID is invalid.`);
  }
  return value;
}

function ensureEvidence(
  input: BrokerAuditEvidence,
  options: { after: string; now: Date },
): void {
  if (
    !UUID.test(input.auditId) ||
    !UUID.test(input.generationId) ||
    !isCredentialAlias(input.brokerCredential) ||
    input.operation !== "http.fetch" ||
    !["GET", "HEAD"].includes(input.method) ||
    !input.targetOrigin.startsWith("https://") ||
    input.targetOrigin.length > 2048 ||
    !/^[0-9a-f]{64}$/.test(input.targetPathHash) ||
    !Number.isSafeInteger(input.status) ||
    input.status < 100 ||
    input.status > 599 ||
    !Number.isFinite(Date.parse(input.at)) ||
    new Date(input.at).toISOString() !== input.at ||
    Date.parse(input.at) < Date.parse(options.after) ||
    Date.parse(input.at) > options.now.getTime()
  ) {
    throw invalid("Broker audit evidence is invalid.");
  }
}

function assertVerificationProfile(
  evidence: BrokerAuditEvidence,
  profile: CredentialVerificationProfile,
  expected: "success" | "revoked",
): void {
  const status =
    expected === "success" ? profile.successStatus : profile.revokedStatus;
  if (
    evidence.operation !== profile.operation ||
    evidence.targetOrigin !== profile.origin ||
    evidence.targetPathHash !== profile.targetPathHash ||
    evidence.method !== profile.method ||
    evidence.status !== status
  ) {
    throw invalid("Broker evidence does not match the verification profile.");
  }
}

function brokerEvidence(
  kind:
    | "broker-positive"
    | "pre-revocation-positive"
    | "pre-revocation-negative"
    | "pre-revocation-active-positive"
    | "provider-revocation-active-positive"
    | "broker-negative"
    | "broker-positive-after-revocation"
    | "rollback-positive",
  input: BrokerAuditEvidence,
  profile: CredentialVerificationProfile,
): RotationEvidence {
  return {
    kind,
    at: input.at,
    evidenceId: input.auditId,
    generationId: input.generationId,
    brokerCredential: input.brokerCredential,
    verificationProfileHash: hashCredentialVerificationProfile(profile),
    status: input.status,
  };
}

function operatorEvidence(
  kind:
    | "overlap-override"
    | "consumer-drain"
    | "revocation-intent"
    | "provider-revocation"
    | "rollback-reason",
  evidenceId: string,
  at: Date,
): RotationEvidence {
  return {
    kind,
    at: at.toISOString(),
    evidenceId: safeEvidenceId(evidenceId, "Operator"),
  };
}

function ensureUnusedEvidenceId(
  manifest: CredentialHandoffManifest,
  evidenceId: string,
): void {
  const used = [
    ...manifest.closures.flatMap((closure) =>
      closure.evidence.map((item) => item.evidenceId),
    ),
    ...(manifest.rotation?.evidence.map((item) => item.evidenceId) ?? []),
  ];
  if (used.includes(evidenceId)) {
    throw invalid("Credential lifecycle evidence ID has already been used.");
  }
}

function assertCandidateNotExpired(
  candidate: KeychainSlotRecord,
  now: Date,
): void {
  if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= now.getTime()) {
    throw invalid("Candidate credential has expired.");
  }
}

function assertRoutineWindowOpen(
  rotation: CredentialRotation,
  now: Date,
): void {
  if (
    rotation.overlapDeadline &&
    Date.parse(rotation.overlapDeadline) <= now.getTime()
  ) {
    throw invalid(
      "Rotation overlap deadline expired; use an explicit emergency override or abort.",
    );
  }
}

function assertRecentEvidence(
  evidence: BrokerAuditEvidence,
  now: Date,
): void {
  const age = now.getTime() - Date.parse(evidence.at);
  if (age < 0 || age > MAX_LIFECYCLE_EVIDENCE_AGE_MS) {
    throw invalid("Rollback-bound evidence must be no more than five minutes old.");
  }
}

export async function stageCredential(input: {
  manifestPath: string;
  backend: KeychainControllerBackend;
  providerKeyId?: string;
  expiresAt?: string;
  overlapDeadline?: string;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (manifest.rotation) {
      throw invalid("A credential rotation is already open.");
    }
    if (manifest.closures.length >= MAX_CREDENTIAL_CLOSURES) {
      throw invalid(
        "Credential closure history is full; archive it before staging.",
      );
    }
    const startedAt = input.now ?? new Date();
    const overlapDeadline = futureDate(input.overlapDeadline, startedAt);
    if (manifest.activeSlot && !overlapDeadline) {
      throw invalid("Routine rotation requires an explicit overlap deadline.");
    }
    if (
      input.expiresAt &&
      (!Number.isFinite(Date.parse(input.expiresAt)) ||
        new Date(input.expiresAt).toISOString() !== input.expiresAt ||
        Date.parse(input.expiresAt) <= startedAt.getTime() ||
        (overlapDeadline &&
          Date.parse(input.expiresAt) <= Date.parse(overlapDeadline)))
    ) {
      throw invalid(
        "Credential expiry must be later than the rotation overlap target.",
      );
    }
    const toSlot: KeychainSlotName =
      manifest.activeSlot === "a" ? "b" : "a";
    if (manifest.slots[toSlot]) {
      throw invalid(
        "Inactive Keychain slot is retained; close the previous lifecycle before staging.",
      );
    }
    const slot = makeKeychainSlotRecord({
      now: startedAt,
      ...(input.providerKeyId ? { providerKeyId: input.providerKeyId } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
    const provisioning = nextManifestRevision(
      {
        ...manifest,
        slots: { ...manifest.slots, [toSlot]: slot },
        rotation: {
          rotationId: randomUUID(),
          phase: "provisioning",
          fromSlot: manifest.activeSlot,
          toSlot,
          startedAt: startedAt.toISOString(),
          ...(overlapDeadline ? { overlapDeadline } : {}),
          evidence: [],
        },
      },
      startedAt,
    );
    assertCredentialHandoffManifestFits(provisioning);
    await saveCredentialHandoffManifest(input.manifestPath, provisioning);

    // Provision only after the intent is durable. Any failure deliberately
    // leaves `provisioning`, which `recoverStagedCredential` can reconcile.
    await input.backend.provision(slot.service, manifest.account);
    if (!(await input.backend.exists(slot.service, manifest.account))) {
      throw new AgentCredError(
        "backend_unavailable",
        "Staged Keychain item could not be confirmed; rotation remains provisioning.",
      );
    }
    const completedAt = input.now ?? new Date();
    assertCandidateNotExpired(slot, completedAt);
    assertRoutineWindowOpen(provisioning.rotation!, completedAt);
    const staged = nextManifestRevision(
      {
        ...provisioning,
        rotation: { ...provisioning.rotation!, phase: "staged" },
      },
      completedAt,
    );
    await saveCredentialHandoffManifest(input.manifestPath, staged);
    return receipt(staged, completedAt);
  });
}

export async function recoverStagedCredential(input: {
  manifestPath: string;
  backend: KeychainControllerBackend;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (manifest.rotation?.phase !== "provisioning") {
      throw invalid("Credential rotation is not awaiting stage recovery.");
    }
    const candidate = manifest.slots[manifest.rotation.toSlot]!;
    if (!(await input.backend.exists(candidate.service, manifest.account))) {
      throw invalid(
        "Provisioning Keychain item is absent; confirm provider cleanup and abort the rotation.",
      );
    }
    const now = input.now ?? new Date();
    assertCandidateNotExpired(candidate, now);
    assertRoutineWindowOpen(manifest.rotation, now);
    const next = nextManifestRevision(
      {
        ...manifest,
        rotation: { ...manifest.rotation, phase: "staged" },
      },
      now,
    );
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

export async function verifyStagedCredential(input: {
  manifestPath: string;
  evidence: BrokerAuditEvidence;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (
      !manifest.rotation ||
      !["staged", "verified_new"].includes(manifest.rotation.phase)
    ) {
      throw invalid("Credential rotation is not awaiting new-key verification.");
    }
    const now = input.now ?? new Date();
    ensureEvidence(input.evidence, {
      after: manifest.rotation.startedAt,
      now,
    });
    assertRecentEvidence(input.evidence, now);
    assertVerificationProfile(input.evidence, manifest.verification, "success");
    const candidate = manifest.slots[manifest.rotation.toSlot]!;
    assertCandidateNotExpired(candidate, now);
    if (input.evidence.generationId !== candidate.generationId) {
      throw invalid("Broker evidence does not match the staged slot generation.");
    }
    ensureUnusedEvidenceId(manifest, input.evidence.auditId);
    const next = nextManifestRevision(
      {
        ...manifest,
        rotation: {
          ...manifest.rotation,
          phase: "verified_new",
          candidateVerifiedAt: now.toISOString(),
          evidence: [
            ...manifest.rotation.evidence.filter(
              (item) => item.kind !== "broker-positive",
            ),
            brokerEvidence(
              "broker-positive",
              input.evidence,
              manifest.verification,
            ),
          ],
        },
      },
      now,
    );
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

export async function activateStagedCredential(input: {
  manifestPath: string;
  emergencyOverlapEvidenceId?: string;
  confirmExpiredOverlap?: boolean;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (manifest.rotation?.phase !== "verified_new") {
      throw invalid("Credential rotation requires positive new-key verification.");
    }
    const now = input.now ?? new Date();
    const rotation = manifest.rotation;
    const candidate = manifest.slots[rotation.toSlot]!;
    assertCandidateNotExpired(candidate, now);
    if (
      !rotation.candidateVerifiedAt ||
      now.getTime() - Date.parse(rotation.candidateVerifiedAt) >
        MAX_LIFECYCLE_EVIDENCE_AGE_MS ||
      now.getTime() -
        Date.parse(
          rotation.evidence.find(
            (item) => item.kind === "broker-positive",
          )!.at,
        ) >
        MAX_LIFECYCLE_EVIDENCE_AGE_MS
    ) {
      throw invalid(
        "Candidate verification is stale; stage a fresh broker verification before activation.",
      );
    }
    let evidence = rotation.evidence;
    const overlapExpired =
      rotation.overlapDeadline !== undefined &&
      Date.parse(rotation.overlapDeadline) <= now.getTime();
    if (overlapExpired) {
      if (
        input.confirmExpiredOverlap !== true ||
        !input.emergencyOverlapEvidenceId
      ) {
        throw invalid(
          "Rotation overlap deadline expired; explicit emergency confirmation and evidence are required.",
        );
      }
      ensureUnusedEvidenceId(manifest, input.emergencyOverlapEvidenceId);
      evidence = [
        ...evidence,
        operatorEvidence(
          "overlap-override",
          input.emergencyOverlapEvidenceId,
          now,
        ),
      ];
    } else if (
      input.confirmExpiredOverlap ||
      input.emergencyOverlapEvidenceId
    ) {
      throw invalid("Emergency overlap override is not applicable.");
    }

    if (!rotation.fromSlot) {
      const closedRotation = { ...rotation, evidence };
      const closure = closureFor(
        manifest,
        closedRotation,
        "bootstrapped",
        now,
      );
      const next = nextManifestRevision(
        {
          ...manifest,
          activeSlot: rotation.toSlot,
          rotation: null,
          closures: appendClosure(manifest, closure),
        },
        now,
      );
      assertCredentialHandoffManifestFits(next);
      await saveCredentialHandoffManifest(input.manifestPath, next);
      return receipt(next, now);
    }

    const next = nextManifestRevision(
      {
        ...manifest,
        activeSlot: rotation.toSlot,
        rotation: {
          ...rotation,
          phase: "cutover",
          cutoverAt: now.toISOString(),
          evidence,
        },
      },
      now,
    );
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

export async function markConsumersDrained(input: {
  manifestPath: string;
  evidenceId: string;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (manifest.rotation?.phase !== "cutover") {
      throw invalid("Credential rotation is not awaiting consumer drain.");
    }
    const now = input.now ?? new Date();
    const evidenceId = safeEvidenceId(input.evidenceId, "Consumer-drain");
    ensureUnusedEvidenceId(manifest, evidenceId);
    const next = nextManifestRevision(
      {
        ...manifest,
        rotation: {
          ...manifest.rotation,
          phase: "draining",
          drainedAt: now.toISOString(),
          evidence: [
            ...manifest.rotation.evidence,
            operatorEvidence("consumer-drain", evidenceId, now),
          ],
        },
      },
      now,
    );
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

/**
 * Persists the no-rollback boundary before the operator performs the remote
 * provider revocation. The provider action itself remains adapter-specific.
 */
export async function preparePreviousCredentialRevocation(input: {
  manifestPath: string;
  previousEvidence: BrokerAuditEvidence;
  activeEvidence: BrokerAuditEvidence;
  evidenceId: string;
  confirmNoRollback: boolean;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  if (!input.confirmNoRollback) {
    throw invalid("Revocation preparation requires no-rollback confirmation.");
  }
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (
      manifest.rotation?.phase !== "draining" ||
      !manifest.rotation.fromSlot ||
      !manifest.rotation.drainedAt
    ) {
      throw invalid("Consumers must be drained before revocation preparation.");
    }
    const now = input.now ?? new Date();
    ensureEvidence(input.previousEvidence, {
      after: manifest.rotation.drainedAt,
      now,
    });
    ensureEvidence(input.activeEvidence, {
      after: manifest.rotation.drainedAt,
      now,
    });
    assertRecentEvidence(input.previousEvidence, now);
    assertRecentEvidence(input.activeEvidence, now);
    const previousEvidenceKind =
      input.previousEvidence.status === manifest.verification.successStatus
        ? ("pre-revocation-positive" as const)
        : input.previousEvidence.status ===
            manifest.verification.revokedStatus
          ? ("pre-revocation-negative" as const)
          : undefined;
    if (!previousEvidenceKind) {
      throw invalid(
        "Previous-slot evidence does not match a configured success or revoked status.",
      );
    }
    assertVerificationProfile(
      input.previousEvidence,
      manifest.verification,
      previousEvidenceKind === "pre-revocation-positive"
        ? "success"
        : "revoked",
    );
    assertVerificationProfile(
      input.activeEvidence,
      manifest.verification,
      "success",
    );
    const previous = manifest.slots[manifest.rotation.fromSlot]!;
    const active = manifest.slots[manifest.rotation.toSlot]!;
    assertCandidateNotExpired(active, now);
    if (
      input.previousEvidence.generationId !== previous.generationId ||
      input.activeEvidence.generationId !== active.generationId
    ) {
      throw invalid(
        "Pre-revocation evidence does not match both slot generations.",
      );
    }
    if (
      input.previousEvidence.brokerCredential ===
      input.activeEvidence.brokerCredential
    ) {
      throw invalid("Pre-revocation checks require distinct broker mappings.");
    }
    const intentId = safeEvidenceId(input.evidenceId, "Revocation-intent");
    ensureUnusedEvidenceId(manifest, input.previousEvidence.auditId);
    ensureUnusedEvidenceId(manifest, input.activeEvidence.auditId);
    ensureUnusedEvidenceId(manifest, intentId);
    if (
      new Set([
        intentId,
        input.previousEvidence.auditId,
        input.activeEvidence.auditId,
      ]).size !== 3
    ) {
      throw invalid("Revocation evidence IDs must be distinct.");
    }
    const next = nextManifestRevision(
      {
        ...manifest,
        rotation: {
          ...manifest.rotation,
          phase: "revocation_pending",
          revocationPreparedAt: now.toISOString(),
          evidence: [
            ...manifest.rotation.evidence,
            brokerEvidence(
              previousEvidenceKind,
              input.previousEvidence,
              manifest.verification,
            ),
            brokerEvidence(
              "pre-revocation-active-positive",
              input.activeEvidence,
              manifest.verification,
            ),
            operatorEvidence("revocation-intent", intentId, now),
          ],
        },
      },
      now,
    );
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

export async function attestPreviousCredentialRevoked(input: {
  manifestPath: string;
  activeEvidence?: BrokerAuditEvidence;
  evidenceId: string;
  confirmed: boolean;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  if (!input.confirmed) {
    throw invalid("Provider revocation requires explicit confirmation.");
  }
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (manifest.rotation?.phase !== "revocation_pending") {
      throw invalid(
        "Credential rotation lacks a durable no-rollback revocation boundary.",
      );
    }
    const now = input.now ?? new Date();
    const candidate = manifest.slots[manifest.rotation.toSlot]!;
    if (input.activeEvidence) {
      ensureEvidence(input.activeEvidence, {
        after: manifest.rotation.revocationPreparedAt!,
        now,
      });
      assertRecentEvidence(input.activeEvidence, now);
      assertVerificationProfile(
        input.activeEvidence,
        manifest.verification,
        "success",
      );
      if (input.activeEvidence.generationId !== candidate.generationId) {
        throw invalid(
          "Provider-revocation evidence does not match the active slot generation.",
        );
      }
    }
    const evidenceId = safeEvidenceId(input.evidenceId, "Provider revocation");
    ensureUnusedEvidenceId(manifest, evidenceId);
    if (input.activeEvidence) {
      ensureUnusedEvidenceId(manifest, input.activeEvidence.auditId);
      if (evidenceId === input.activeEvidence.auditId) {
        throw invalid("Provider revocation evidence IDs must be distinct.");
      }
    }
    const next = nextManifestRevision(
      {
        ...manifest,
        rotation: {
          ...manifest.rotation,
          phase: "revoked_old",
          providerRevokedAt: now.toISOString(),
          evidence: [
            ...manifest.rotation.evidence,
            ...(input.activeEvidence
              ? [
                  brokerEvidence(
                    "provider-revocation-active-positive",
                    input.activeEvidence,
                    manifest.verification,
                  ),
                ]
              : []),
            operatorEvidence("provider-revocation", evidenceId, now),
          ],
        },
      },
      now,
    );
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

export async function verifyPreviousCredentialRevoked(input: {
  manifestPath: string;
  previousEvidence: BrokerAuditEvidence;
  activeEvidence?: BrokerAuditEvidence;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (
      manifest.rotation?.phase !== "revoked_old" ||
      !manifest.rotation.providerRevokedAt ||
      !manifest.rotation.fromSlot
    ) {
      throw invalid("Credential rotation is not awaiting revocation verification.");
    }
    const now = input.now ?? new Date();
    ensureEvidence(input.previousEvidence, {
      after: manifest.rotation.providerRevokedAt,
      now,
    });
    assertRecentEvidence(input.previousEvidence, now);
    assertVerificationProfile(
      input.previousEvidence,
      manifest.verification,
      "revoked",
    );
    const previous = manifest.slots[manifest.rotation.fromSlot]!;
    const active = manifest.slots[manifest.rotation.toSlot]!;
    if (input.previousEvidence.generationId !== previous.generationId) {
      throw invalid(
        "Revocation evidence does not match the previous slot generation.",
      );
    }
    if (input.activeEvidence) {
      ensureEvidence(input.activeEvidence, {
        after: manifest.rotation.providerRevokedAt,
        now,
      });
      assertRecentEvidence(input.activeEvidence, now);
      assertVerificationProfile(
        input.activeEvidence,
        manifest.verification,
        "success",
      );
      if (input.activeEvidence.generationId !== active.generationId) {
        throw invalid(
          "Active evidence does not match the active slot generation.",
        );
      }
      if (
        input.previousEvidence.brokerCredential ===
        input.activeEvidence.brokerCredential
      ) {
        throw invalid(
          "Revocation verification requires distinct broker mappings.",
        );
      }
    }
    ensureUnusedEvidenceId(manifest, input.previousEvidence.auditId);
    if (input.activeEvidence) {
      ensureUnusedEvidenceId(manifest, input.activeEvidence.auditId);
      if (input.previousEvidence.auditId === input.activeEvidence.auditId) {
        throw invalid("Revocation audit IDs must be distinct.");
      }
    }
    const next = nextManifestRevision(
      {
        ...manifest,
        rotation: {
          ...manifest.rotation,
          phase: "verified_revoked",
          revocationVerifiedAt: now.toISOString(),
          evidence: [
            ...manifest.rotation.evidence,
            brokerEvidence(
              "broker-negative",
              input.previousEvidence,
              manifest.verification,
            ),
            ...(input.activeEvidence
              ? [
                  brokerEvidence(
                    "broker-positive-after-revocation",
                    input.activeEvidence,
                    manifest.verification,
                  ),
                ]
              : []),
          ],
        },
      },
      now,
    );
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

export async function rollbackCredential(input: {
  manifestPath: string;
  previousEvidence: BrokerAuditEvidence;
  reasonEvidenceId: string;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (
      !manifest.rotation ||
      !["cutover", "draining"].includes(manifest.rotation.phase) ||
      !manifest.rotation.fromSlot ||
      !manifest.rotation.cutoverAt
    ) {
      throw invalid(
        "Credential rotation cannot be rolled back after the revocation boundary.",
      );
    }
    const now = input.now ?? new Date();
    ensureEvidence(input.previousEvidence, {
      after: manifest.rotation.cutoverAt,
      now,
    });
    assertRecentEvidence(input.previousEvidence, now);
    assertVerificationProfile(
      input.previousEvidence,
      manifest.verification,
      "success",
    );
    const previous = manifest.slots[manifest.rotation.fromSlot]!;
    if (input.previousEvidence.generationId !== previous.generationId) {
      throw invalid("Rollback evidence does not match the previous slot generation.");
    }
    const reasonId = safeEvidenceId(input.reasonEvidenceId, "Rollback reason");
    ensureUnusedEvidenceId(manifest, input.previousEvidence.auditId);
    ensureUnusedEvidenceId(manifest, reasonId);
    if (reasonId === input.previousEvidence.auditId) {
      throw invalid("Rollback evidence IDs must be distinct.");
    }
    const next = nextManifestRevision(
      {
        ...manifest,
        activeSlot: manifest.rotation.fromSlot,
        rotation: {
          ...manifest.rotation,
          phase: "rolled_back",
          rolledBackAt: now.toISOString(),
          evidence: [
            ...manifest.rotation.evidence,
            brokerEvidence(
              "rollback-positive",
              input.previousEvidence,
              manifest.verification,
            ),
            operatorEvidence("rollback-reason", reasonId, now),
          ],
        },
      },
      now,
    );
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

function candidateCleanupFinal(
  manifest: CredentialHandoffManifest,
  now: Date,
): CredentialHandoffManifest {
  const rotation = manifest.rotation;
  if (
    rotation?.phase !== "deleting_candidate" ||
    !rotation.cleanupOutcome
  ) {
    throw invalid("Credential rotation is not reconciling candidate cleanup.");
  }
  const closure = closureFor(
    manifest,
    rotation,
    rotation.cleanupOutcome,
    now,
  );
  return nextManifestRevision(
    {
      ...manifest,
      slots: { ...manifest.slots, [rotation.toSlot]: null },
      rotation: null,
      closures: appendClosure(manifest, closure),
    },
    now,
  );
}

export async function prepareCredentialAbort(input: {
  manifestPath: string;
  evidenceId: string;
  confirmed: boolean;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  if (!input.confirmed) {
    throw invalid(
      "Candidate revocation preparation requires explicit confirmation.",
    );
  }
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    const now = input.now ?? new Date();
    if (
      !manifest.rotation ||
      !["provisioning", "staged", "verified_new", "rolled_back"].includes(
        manifest.rotation.phase,
      )
    ) {
      throw invalid("Credential rotation cannot be aborted in its current phase.");
    }
    const evidenceId = safeEvidenceId(
      input.evidenceId,
      "Candidate revocation intent",
    );
    ensureUnusedEvidenceId(manifest, evidenceId);
    const cleanupOutcome =
      manifest.rotation.phase === "rolled_back"
        ? ("rolled_back" as const)
        : ("aborted" as const);
    const next = nextManifestRevision(
      {
        ...manifest,
        rotation: {
          ...manifest.rotation,
          phase: "candidate_revocation_pending",
          cleanupOutcome,
          candidateRevocationPreparedAt: now.toISOString(),
          evidence: [
            ...manifest.rotation.evidence,
            operatorEvidence("revocation-intent", evidenceId, now),
          ],
        },
      },
      now,
    );
    assertCredentialHandoffManifestFits(next);
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

export async function attestCandidateCredentialRevoked(input: {
  manifestPath: string;
  evidenceId: string;
  confirmed: boolean;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  if (!input.confirmed) {
    throw invalid("Candidate provider revocation requires explicit confirmation.");
  }
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (manifest.rotation?.phase !== "candidate_revocation_pending") {
      throw invalid(
        "Candidate cleanup lacks a durable revocation-pending boundary.",
      );
    }
    const now = input.now ?? new Date();
    const evidenceId = safeEvidenceId(
      input.evidenceId,
      "Candidate provider revocation",
    );
    ensureUnusedEvidenceId(manifest, evidenceId);
    const next = nextManifestRevision(
      {
        ...manifest,
        rotation: {
          ...manifest.rotation,
          phase: "deleting_candidate",
          candidateProviderRevokedAt: now.toISOString(),
          evidence: [
            ...manifest.rotation.evidence,
            operatorEvidence("provider-revocation", evidenceId, now),
          ],
        },
      },
      now,
    );
    assertCredentialHandoffManifestFits(next);
    assertCredentialHandoffManifestFits(candidateCleanupFinal(next, now));
    await saveCredentialHandoffManifest(input.manifestPath, next);
    return receipt(next, now);
  });
}

export async function closeCredentialAbort(input: {
  manifestPath: string;
  backend: KeychainControllerBackend;
  deleteLocalConfirmed: boolean;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  if (!input.deleteLocalConfirmed) {
    throw invalid("Candidate cleanup requires local-deletion confirmation.");
  }
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (manifest.rotation?.phase !== "deleting_candidate") {
      throw invalid("Candidate credential is not ready for local cleanup.");
    }
    const now = input.now ?? new Date();
    const candidate = manifest.slots[manifest.rotation.toSlot]!;
    assertCredentialHandoffManifestFits(
      candidateCleanupFinal(manifest, now),
    );
    await input.backend.delete(candidate.service, manifest.account);
    const completedAt = input.now ?? new Date();
    const final = candidateCleanupFinal(manifest, completedAt);
    await saveCredentialHandoffManifest(input.manifestPath, final);
    return receipt(final, completedAt);
  });
}

function previousCleanupFinal(
  manifest: CredentialHandoffManifest,
  now: Date,
): CredentialHandoffManifest {
  const rotation = manifest.rotation;
  if (
    rotation?.phase !== "deleting_previous" ||
    !rotation.fromSlot
  ) {
    throw invalid("Credential rotation is not reconciling previous cleanup.");
  }
  const closure = closureFor(manifest, rotation, "rotated", now);
  return nextManifestRevision(
    {
      ...manifest,
      slots: { ...manifest.slots, [rotation.fromSlot]: null },
      rotation: null,
      closures: appendClosure(manifest, closure),
    },
    now,
  );
}

export async function closeCredentialRotation(input: {
  manifestPath: string;
  backend: KeychainControllerBackend;
  deleteLocalConfirmed?: boolean;
  now?: Date;
}): Promise<CredentialLifecycleReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    let manifest = await loadCredentialHandoffManifest(input.manifestPath);
    const now = input.now ?? new Date();
    if (manifest.rotation?.phase !== "deleting_previous") {
      if (
        manifest.rotation?.phase !== "verified_revoked" ||
        !manifest.rotation.fromSlot
      ) {
        throw invalid("Credential rotation is not ready to close.");
      }
      if (input.deleteLocalConfirmed !== true) {
        throw invalid(
          "Closing rotation requires explicit local-deletion confirmation.",
        );
      }
      const intent = nextManifestRevision(
        {
          ...manifest,
          rotation: {
            ...manifest.rotation,
            phase: "deleting_previous",
          },
        },
        now,
      );
      assertCredentialHandoffManifestFits(intent);
      assertCredentialHandoffManifestFits(previousCleanupFinal(intent, now));
      await saveCredentialHandoffManifest(input.manifestPath, intent);
      manifest = intent;
    }

    const rotation = manifest.rotation!;
    const previous = manifest.slots[rotation.fromSlot!]!;
    assertCredentialHandoffManifestFits(
      previousCleanupFinal(manifest, now),
    );
    await input.backend.delete(previous.service, manifest.account);
    const completedAt = input.now ?? new Date();
    const final = previousCleanupFinal(manifest, completedAt);
    await saveCredentialHandoffManifest(input.manifestPath, final);
    return receipt(final, completedAt);
  });
}

export interface CredentialClosureArchiveReceipt {
  credential: string;
  archivePath: string;
  archivedClosures: number;
  cumulativeClosures: number;
  archiveDigest: string;
  throughRotationId: string;
  throughClosedAt: string;
  metadataHash: string;
  effectiveGenerationId: string | null;
  manifestRevision: number;
}

export async function verifyCredentialClosureArchive(
  archivePath: string,
  options: {
    manifestPath?: string;
    previousArchivePath?: string;
  } = {},
): Promise<Omit<CredentialClosureArchiveReceipt, "manifestRevision">> {
  const text = await readOwnerFile(archivePath, {
    maxBytes: MAX_CLOSURE_ARCHIVE_BYTES,
    name: "Credential closure archive",
  });
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw invalid("Credential closure archive is not valid JSON.");
  }
  const expectedKeys = [
    "schema",
    "manifestSchema",
    "credential",
    "provider",
    "purpose",
    "environment",
    "account",
    "auth",
    "verification",
    "previousAnchor",
    "closures",
    "terminalAnchor",
  ].sort();
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join("\0") !== expectedKeys.join("\0") ||
    value.schema !== "agentcred-closure-archive/0.1" ||
    value.manifestSchema !== AGENTCRED_HANDOFF_MANIFEST ||
    !Array.isArray(value.closures) ||
    value.closures.length === 0 ||
    !isRecord(value.terminalAnchor)
  ) {
    throw invalid("Credential closure archive is invalid.");
  }
  const first = value.closures[0];
  if (!isRecord(first) || typeof first.startedAt !== "string") {
    throw invalid("Credential closure archive is invalid.");
  }
  const previousClosedAt =
    isRecord(value.previousAnchor) &&
    typeof value.previousAnchor.throughClosedAt === "string"
      ? value.previousAnchor.throughClosedAt
      : first.startedAt;
  const terminalGeneration =
    value.terminalAnchor.effectiveGenerationId === null ||
    typeof value.terminalAnchor.effectiveGenerationId === "string"
      ? value.terminalAnchor.effectiveGenerationId
      : undefined;
  if (
    terminalGeneration === undefined ||
    typeof value.terminalAnchor.throughClosedAt !== "string"
  ) {
    throw invalid("Credential closure archive terminal anchor is invalid.");
  }
  const reconstructed = parseCredentialHandoffManifest({
    schema: value.manifestSchema,
    revision: 0,
    credential: value.credential,
    provider: value.provider,
    purpose: value.purpose,
    environment: value.environment,
    account: value.account,
    auth: value.auth,
    verification: value.verification,
    createdAt: previousClosedAt,
    updatedAt: value.terminalAnchor.throughClosedAt,
    activeSlot: terminalGeneration ? "a" : null,
    slots: {
      a: terminalGeneration
        ? {
            generationId: terminalGeneration,
            service: "agentcred-archive-verification",
            createdAt: previousClosedAt,
          }
        : null,
      b: null,
    },
    rotation: null,
    historyAnchor: value.previousAnchor,
    closures: value.closures,
  });
  const digestPayload = {
    manifestSchema: value.manifestSchema,
    credential: value.credential,
    provider: value.provider,
    purpose: value.purpose,
    environment: value.environment,
    account: value.account,
    auth: value.auth,
    verification: value.verification,
    previousAnchor: value.previousAnchor,
    closures: value.closures,
  };
  const archiveDigest = createHash("sha256")
    .update(JSON.stringify(digestPayload))
    .digest("hex");
  const last = reconstructed.closures.at(-1)!;
  const previousCount = reconstructed.historyAnchor?.closureCount ?? 0;
  const expectedAnchor: CredentialHistoryAnchor = {
    throughRotationId: last.rotationId,
    throughClosedAt: last.closedAt,
    effectiveGenerationId: terminalGeneration,
    closureCount: previousCount + reconstructed.closures.length,
    archiveDigest,
    metadataHash: hashCredentialManifestMetadata(reconstructed),
  };
  if (
    Object.keys(value.terminalAnchor).sort().join("\0") !==
      Object.keys(expectedAnchor).sort().join("\0") ||
    Object.entries(expectedAnchor).some(
      ([key, expected]) =>
        (value.terminalAnchor as Record<string, unknown>)[key] !== expected,
    )
  ) {
    throw invalid("Credential closure archive digest or generation chain is invalid.");
  }
  const result = {
    credential: reconstructed.credential,
    archivePath,
    archivedClosures: reconstructed.closures.length,
    cumulativeClosures: expectedAnchor.closureCount,
    archiveDigest,
    throughRotationId: expectedAnchor.throughRotationId,
    throughClosedAt: expectedAnchor.throughClosedAt,
    metadataHash: expectedAnchor.metadataHash,
    effectiveGenerationId: expectedAnchor.effectiveGenerationId,
  };
  if (options.manifestPath) {
    const live = await loadCredentialHandoffManifest(options.manifestPath);
    if (
      live.credential !== reconstructed.credential ||
      JSON.stringify(live.historyAnchor) !== JSON.stringify(expectedAnchor)
    ) {
      throw invalid(
        "Credential closure archive is not the live manifest history anchor.",
      );
    }
  }
  if (options.previousArchivePath) {
    if (!reconstructed.historyAnchor) {
      throw invalid("Credential closure archive has no predecessor anchor.");
    }
    const previous = await verifyCredentialClosureArchive(
      options.previousArchivePath,
    );
    const expectedPrevious: CredentialHistoryAnchor = {
      throughRotationId: previous.throughRotationId,
      throughClosedAt: previous.throughClosedAt,
      effectiveGenerationId: previous.effectiveGenerationId,
      closureCount: previous.cumulativeClosures,
      archiveDigest: previous.archiveDigest,
      metadataHash: previous.metadataHash,
    };
    if (
      JSON.stringify(reconstructed.historyAnchor) !==
      JSON.stringify(expectedPrevious)
    ) {
      throw invalid("Credential closure archives do not form one chain.");
    }
  }
  return result;
}

export async function archiveCredentialClosures(input: {
  manifestPath: string;
  archivePath: string;
  now?: Date;
}): Promise<CredentialClosureArchiveReceipt> {
  return withControllerLock(input.manifestPath, async () => {
    const manifest = await loadCredentialHandoffManifest(input.manifestPath);
    if (manifest.rotation) {
      throw invalid("Closure history can be archived only while lifecycle is idle.");
    }
    if (manifest.closures.length === 0) {
      if (!manifest.historyAnchor) {
        throw invalid("Credential closure history is empty.");
      }
      const verified = await verifyCredentialClosureArchive(
        input.archivePath,
        { manifestPath: input.manifestPath },
      );
      await syncOwnerFileDurably(input.archivePath, {
        name: "Credential closure archive",
      });
      return {
        ...verified,
        manifestRevision: manifest.revision,
      };
    }
    const now = input.now ?? new Date();
    let effectiveGeneration =
      manifest.historyAnchor?.effectiveGenerationId ?? null;
    for (const closure of manifest.closures) {
      if (
        closure.outcome === "bootstrapped" ||
        closure.outcome === "rotated"
      ) {
        effectiveGeneration = closure.toGenerationId;
      }
    }
    const digestPayload = {
      manifestSchema: manifest.schema,
      credential: manifest.credential,
      provider: manifest.provider,
      purpose: manifest.purpose,
      environment: manifest.environment,
      account: manifest.account,
      auth: manifest.auth,
      verification: manifest.verification,
      previousAnchor: manifest.historyAnchor,
      closures: manifest.closures,
    };
    const archiveDigest = createHash("sha256")
      .update(JSON.stringify(digestPayload))
      .digest("hex");
    const last = manifest.closures.at(-1)!;
    const anchor: CredentialHistoryAnchor = {
      throughRotationId: last.rotationId,
      throughClosedAt: last.closedAt,
      effectiveGenerationId: effectiveGeneration,
      closureCount:
        (manifest.historyAnchor?.closureCount ?? 0) +
        manifest.closures.length,
      archiveDigest,
      metadataHash: hashCredentialManifestMetadata(manifest),
    };
    const archive = {
      schema: "agentcred-closure-archive/0.1",
      ...digestPayload,
      terminalAnchor: anchor,
    };
    const compacted = nextManifestRevision(
      {
        ...manifest,
        historyAnchor: anchor,
        closures: [],
      },
      now,
    );
    assertCredentialHandoffManifestFits(compacted);

    // Archive first, then compact. A crash can leave a redundant archive but
    // cannot remove the only copy of evidence.
    const archiveText = `${JSON.stringify(archive, null, 2)}\n`;
    if (
      Buffer.byteLength(archiveText, "utf8") >
      MAX_CLOSURE_ARCHIVE_BYTES
    ) {
      throw invalid("Credential closure archive exceeds its safe size limit.");
    }
    try {
      await writeOwnerFileAtomic(input.archivePath, archiveText, {
        createOnly: true,
        name: "Credential closure archive",
      });
    } catch (error) {
      if (!(error instanceof OwnerFileAlreadyExistsError)) {
        throw error;
      }
      try {
        const verified = await verifyCredentialClosureArchive(
          input.archivePath,
        );
        if (
          verified.archiveDigest === archiveDigest &&
          verified.throughRotationId === anchor.throughRotationId &&
          verified.throughClosedAt === anchor.throughClosedAt &&
          verified.metadataHash === anchor.metadataHash &&
          verified.cumulativeClosures === anchor.closureCount &&
          verified.effectiveGenerationId === anchor.effectiveGenerationId
        ) {
          await syncOwnerFileDurably(input.archivePath, {
            name: "Credential closure archive",
          });
          await saveCredentialHandoffManifest(
            input.manifestPath,
            compacted,
          );
          return {
            credential: manifest.credential,
            archivePath: input.archivePath,
            archivedClosures: manifest.closures.length,
            cumulativeClosures: anchor.closureCount,
            archiveDigest,
            throughRotationId: anchor.throughRotationId,
            throughClosedAt: anchor.throughClosedAt,
            metadataHash: anchor.metadataHash,
            effectiveGenerationId: anchor.effectiveGenerationId,
            manifestRevision: compacted.revision,
          };
        }
      } catch {
        // Preserve the original create failure.
      }
      throw error;
    }
    await saveCredentialHandoffManifest(input.manifestPath, compacted);
    return {
      credential: manifest.credential,
      archivePath: input.archivePath,
      archivedClosures: manifest.closures.length,
      cumulativeClosures: anchor.closureCount,
      archiveDigest,
      throughRotationId: anchor.throughRotationId,
      throughClosedAt: anchor.throughClosedAt,
      metadataHash: anchor.metadataHash,
      effectiveGenerationId: anchor.effectiveGenerationId,
      manifestRevision: compacted.revision,
    };
  });
}

export async function credentialLifecycleStatus(
  manifestPath: string,
  now = new Date(),
): Promise<CredentialLifecycleReceipt> {
  return receipt(await loadCredentialHandoffManifest(manifestPath), now);
}
