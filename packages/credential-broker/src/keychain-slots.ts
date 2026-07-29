import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { AgentCredError } from "./errors.js";
import { validateCredentialAuth } from "./http.js";
import { isCredentialAlias } from "./identifiers.js";
import { normalizePathPrefix } from "./policy.js";
import {
  readOwnerFile,
  writeOwnerFileAtomic,
} from "./owner-files.js";
import type { CredentialAuth } from "./types.js";
import type { MacOSKeychainReference } from "./backends.js";

export const AGENTCRED_HANDOFF_MANIFEST = "agentcred-handoff/0.1" as const;
export const MAX_CREDENTIAL_CLOSURES = 8;
export const MAX_LIFECYCLE_EVIDENCE_AGE_MS = 5 * 60_000;

export type KeychainSlotName = "a" | "b";
export type KeychainSlotSelection = "active" | "candidate" | "previous";
export type CredentialRotationPhase =
  | "provisioning"
  | "staged"
  | "verified_new"
  | "cutover"
  | "draining"
  | "revocation_pending"
  | "revoked_old"
  | "verified_revoked"
  | "rolled_back"
  | "candidate_revocation_pending"
  | "deleting_previous"
  | "deleting_candidate";

export interface ManagedMacOSKeychainReference {
  backend: "managed-macos-keychain";
  manifestPath: string;
  selection: KeychainSlotSelection;
  auth: ManagedCredentialAuth;
}

export type ManagedCredentialAuth =
  | { kind: "bearer"; headerName?: never; prefix?: never }
  | { kind: "header"; headerName: string; prefix?: never };

export interface KeychainSlotRecord {
  generationId: string;
  service: string;
  createdAt: string;
  providerKeyId?: string;
  expiresAt?: string;
}

export interface RotationEvidence {
  kind:
    | "broker-positive"
    | "overlap-override"
    | "consumer-drain"
    | "pre-revocation-positive"
    | "pre-revocation-negative"
    | "pre-revocation-active-positive"
    | "revocation-intent"
    | "provider-revocation"
    | "provider-revocation-active-positive"
    | "broker-negative"
    | "broker-positive-after-revocation"
    | "rollback-positive"
    | "rollback-reason";
  at: string;
  evidenceId: string;
  generationId?: string;
  brokerCredential?: string;
  verificationProfileHash?: string;
  status?: number;
}

export interface CredentialVerificationProfile {
  operation: "http.fetch";
  origin: string;
  path: string;
  targetPathHash: string;
  method: "GET" | "HEAD";
  successStatus: number;
  revokedStatus: number;
}

export interface CredentialRotation {
  rotationId: string;
  phase: CredentialRotationPhase;
  fromSlot: KeychainSlotName | null;
  toSlot: KeychainSlotName;
  startedAt: string;
  overlapDeadline?: string;
  candidateVerifiedAt?: string;
  cutoverAt?: string;
  drainedAt?: string;
  revocationPreparedAt?: string;
  providerRevokedAt?: string;
  revocationVerifiedAt?: string;
  rolledBackAt?: string;
  candidateRevocationPreparedAt?: string;
  candidateProviderRevokedAt?: string;
  cleanupOutcome?: "aborted" | "rolled_back";
  evidence: RotationEvidence[];
}

export interface RotationClosureReceipt {
  rotationId: string;
  outcome: "bootstrapped" | "rotated" | "aborted" | "rolled_back";
  closedAt: string;
  startedAt: string;
  overlapDeadline?: string;
  candidateVerifiedAt?: string;
  cutoverAt?: string;
  drainedAt?: string;
  revocationPreparedAt?: string;
  providerRevokedAt?: string;
  revocationVerifiedAt?: string;
  rolledBackAt?: string;
  candidateRevocationPreparedAt?: string;
  candidateProviderRevokedAt?: string;
  fromGenerationId?: string;
  toGenerationId: string;
  evidence: RotationEvidence[];
}

export interface CredentialHistoryAnchor {
  throughRotationId: string;
  throughClosedAt: string;
  effectiveGenerationId: string | null;
  closureCount: number;
  archiveDigest: string;
  metadataHash: string;
}

export interface CredentialHandoffManifest {
  schema: typeof AGENTCRED_HANDOFF_MANIFEST;
  revision: number;
  credential: string;
  provider: string;
  purpose: string;
  environment: string;
  account: string;
  auth: ManagedCredentialAuth;
  verification: CredentialVerificationProfile;
  createdAt: string;
  updatedAt: string;
  activeSlot: KeychainSlotName | null;
  slots: Record<KeychainSlotName, KeychainSlotRecord | null>;
  rotation: CredentialRotation | null;
  historyAnchor: CredentialHistoryAnchor | null;
  closures: RotationClosureReceipt[];
}

const MAX_MANIFEST_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalid(message: string): AgentCredError {
  return new AgentCredError("invalid_request", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const allow = new Set(allowed);
  if (Object.keys(value).some((key) => !allow.has(key))) {
    throw invalid(`${name} contains an unknown field.`);
  }
}

function safeId(value: unknown, name: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw invalid(`${name} is invalid.`);
  }
  return value;
}

function isoDate(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw invalid(`${name} is invalid.`);
  }
  return value;
}

function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw invalid(`${name} is invalid.`);
  }
  return value;
}

function evidenceId(value: unknown): string {
  const parsed = safeId(value, "Rotation evidence ID");
  if (parsed.length > 128) {
    throw invalid("Rotation evidence ID is invalid.");
  }
  return parsed;
}

export function hashCredentialVerificationProfile(
  profile: CredentialVerificationProfile,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        profile.operation,
        profile.origin,
        profile.path,
        profile.targetPathHash,
        profile.method,
        profile.successStatus,
        profile.revokedStatus,
      ]),
    )
    .digest("hex");
}

export function hashCredentialManifestMetadata(
  manifest: Pick<
    CredentialHandoffManifest,
    | "credential"
    | "provider"
    | "purpose"
    | "environment"
    | "account"
    | "auth"
    | "verification"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        manifest.credential,
        manifest.provider,
        manifest.purpose,
        manifest.environment,
        manifest.account,
        manifest.auth,
        manifest.verification,
      ]),
    )
    .digest("hex");
}

function parseAuth(value: unknown): ManagedCredentialAuth {
  if (!isRecord(value)) throw invalid("Credential auth metadata is invalid.");
  onlyKeys(value, ["kind", "headerName"], "Credential auth metadata");
  if (
    typeof value.kind !== "string" ||
    !["bearer", "header"].includes(value.kind) ||
    (value.headerName !== undefined && typeof value.headerName !== "string")
  ) {
    throw invalid("Credential auth metadata is invalid.");
  }
  const auth: CredentialAuth = {
    kind: value.kind as CredentialAuth["kind"],
    ...(typeof value.headerName === "string" ? { headerName: value.headerName } : {}),
  };
  validateCredentialAuth(auth);
  return auth as ManagedCredentialAuth;
}

function parseSlot(value: unknown, name: string): KeychainSlotRecord | null {
  if (value === null) return null;
  if (!isRecord(value)) throw invalid(`${name} is invalid.`);
  onlyKeys(
    value,
    ["generationId", "service", "createdAt", "providerKeyId", "expiresAt"],
    name,
  );
  const slot: KeychainSlotRecord = {
    generationId: uuid(value.generationId, `${name} generation`),
    service: safeId(value.service, `${name} service`),
    createdAt: isoDate(value.createdAt, `${name} creation time`),
    ...(value.providerKeyId === undefined
      ? {}
      : { providerKeyId: safeId(value.providerKeyId, `${name} provider key ID`) }),
    ...(value.expiresAt === undefined
      ? {}
      : { expiresAt: isoDate(value.expiresAt, `${name} expiry`) }),
  };
  if (
    slot.expiresAt &&
    Date.parse(slot.expiresAt) <= Date.parse(slot.createdAt)
  ) {
    throw invalid(`${name} expiry must follow creation.`);
  }
  return slot;
}

function parseEvidence(value: unknown): RotationEvidence {
  if (!isRecord(value)) throw invalid("Rotation evidence is invalid.");
  onlyKeys(
    value,
    [
      "kind",
      "at",
      "evidenceId",
      "generationId",
      "brokerCredential",
      "verificationProfileHash",
      "status",
    ],
    "Rotation evidence",
  );
  const kinds: RotationEvidence["kind"][] = [
    "broker-positive",
    "overlap-override",
    "consumer-drain",
    "pre-revocation-positive",
    "pre-revocation-negative",
    "pre-revocation-active-positive",
    "revocation-intent",
    "provider-revocation",
    "provider-revocation-active-positive",
    "broker-negative",
    "broker-positive-after-revocation",
    "rollback-positive",
    "rollback-reason",
  ];
  if (typeof value.kind !== "string" || !kinds.includes(value.kind as RotationEvidence["kind"])) {
    throw invalid("Rotation evidence kind is invalid.");
  }
  if (
    value.status !== undefined &&
    (typeof value.status !== "number" ||
      !Number.isSafeInteger(value.status) ||
      value.status < 100 ||
      value.status > 599)
  ) {
    throw invalid("Rotation evidence status is invalid.");
  }
  const brokerKinds: RotationEvidence["kind"][] = [
    "broker-positive",
    "pre-revocation-positive",
    "pre-revocation-negative",
    "pre-revocation-active-positive",
    "provider-revocation-active-positive",
    "broker-negative",
    "broker-positive-after-revocation",
    "rollback-positive",
  ];
  const isBrokerEvidence = brokerKinds.includes(
    value.kind as RotationEvidence["kind"],
  );
  if (
    isBrokerEvidence &&
    (typeof value.generationId !== "string" ||
      !isCredentialAlias(value.brokerCredential) ||
      typeof value.verificationProfileHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.verificationProfileHash) ||
      typeof value.status !== "number")
  ) {
    throw invalid("Broker evidence requires an exact verification profile.");
  }
  if (
    !isBrokerEvidence &&
    (value.generationId !== undefined ||
      value.brokerCredential !== undefined ||
      value.verificationProfileHash !== undefined ||
      value.status !== undefined)
  ) {
    throw invalid("Operator evidence cannot contain broker result fields.");
  }
  return {
    kind: value.kind as RotationEvidence["kind"],
    at: isoDate(value.at, "Rotation evidence time"),
    evidenceId: evidenceId(value.evidenceId),
    ...(value.generationId === undefined
      ? {}
      : {
          generationId: uuid(
            value.generationId,
            "Rotation evidence generation",
          ),
        }),
    ...(typeof value.brokerCredential === "string"
      ? {
          brokerCredential: isCredentialAlias(value.brokerCredential)
            ? value.brokerCredential
            : (() => {
                throw invalid(
                  "Rotation evidence broker credential is invalid.",
                );
              })(),
        }
      : {}),
    ...(typeof value.verificationProfileHash === "string"
      ? { verificationProfileHash: value.verificationProfileHash }
      : {}),
    ...(typeof value.status === "number" ? { status: value.status } : {}),
  };
}

function parseVerificationProfile(value: unknown): CredentialVerificationProfile {
  if (!isRecord(value)) throw invalid("Credential verification profile is invalid.");
  onlyKeys(
    value,
    [
      "operation",
      "origin",
      "path",
      "targetPathHash",
      "method",
      "successStatus",
      "revokedStatus",
    ],
    "Credential verification profile",
  );
  if (
    typeof value.origin !== "string" ||
    value.origin.length > 2048 ||
    !value.origin.startsWith("https://") ||
    (() => {
      try {
        return new URL(value.origin as string).origin !== value.origin;
      } catch {
        return true;
      }
    })() ||
    typeof value.path !== "string" ||
    !value.path.startsWith("/") ||
    value.path.length > 2048 ||
    /[?#\0\r\n]/.test(value.path) ||
    typeof value.targetPathHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.targetPathHash) ||
    createHash("sha256").update(value.path as string).digest("hex") !==
      value.targetPathHash ||
    typeof value.successStatus !== "number" ||
    !Number.isSafeInteger(value.successStatus) ||
    value.successStatus < 200 ||
    value.successStatus >= 300 ||
    typeof value.revokedStatus !== "number" ||
    !Number.isSafeInteger(value.revokedStatus) ||
    value.revokedStatus < 400 ||
    value.revokedStatus >= 500
  ) {
    throw invalid("Credential verification profile is invalid.");
  }
  try {
    normalizePathPrefix(value.path as string);
  } catch {
    throw invalid("Credential verification path is not canonical.");
  }
  if (
    value.operation !== "http.fetch" ||
    !["GET", "HEAD"].includes(value.method as string)
  ) {
    throw invalid("HTTP credential verification profile is invalid.");
  }
  return {
    operation: "http.fetch",
    origin: value.origin,
    path: value.path,
    targetPathHash: value.targetPathHash,
    method: value.method as "GET" | "HEAD",
    successStatus: value.successStatus,
    revokedStatus: value.revokedStatus,
  };
}

function parseRotation(value: unknown): CredentialRotation | null {
  if (value === null) return null;
  if (!isRecord(value)) throw invalid("Credential rotation is invalid.");
  onlyKeys(
    value,
    [
      "rotationId",
      "phase",
      "fromSlot",
      "toSlot",
      "startedAt",
      "overlapDeadline",
      "candidateVerifiedAt",
      "cutoverAt",
      "drainedAt",
      "revocationPreparedAt",
      "providerRevokedAt",
      "revocationVerifiedAt",
      "rolledBackAt",
      "candidateRevocationPreparedAt",
      "candidateProviderRevokedAt",
      "cleanupOutcome",
      "evidence",
    ],
    "Credential rotation",
  );
  const phases: CredentialRotationPhase[] = [
    "provisioning",
    "staged",
    "verified_new",
    "cutover",
    "draining",
    "revocation_pending",
    "revoked_old",
    "verified_revoked",
    "rolled_back",
    "candidate_revocation_pending",
    "deleting_previous",
    "deleting_candidate",
  ];
  if (
    typeof value.phase !== "string" ||
    !phases.includes(value.phase as CredentialRotationPhase) ||
    ![null, "a", "b"].includes(value.fromSlot as string | null) ||
    !["a", "b"].includes(value.toSlot as string) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > 10 ||
    (value.cleanupOutcome !== undefined &&
      !["aborted", "rolled_back"].includes(value.cleanupOutcome as string))
  ) {
    throw invalid("Credential rotation is invalid.");
  }
  const rotation: CredentialRotation = {
    rotationId: uuid(value.rotationId, "Rotation ID"),
    phase: value.phase as CredentialRotationPhase,
    fromSlot: value.fromSlot as KeychainSlotName | null,
    toSlot: value.toSlot as KeychainSlotName,
    startedAt: isoDate(value.startedAt, "Rotation start time"),
    ...(value.overlapDeadline === undefined
      ? {}
      : { overlapDeadline: isoDate(value.overlapDeadline, "Rotation overlap deadline") }),
    ...(value.candidateVerifiedAt === undefined
      ? {}
      : {
          candidateVerifiedAt: isoDate(
            value.candidateVerifiedAt,
            "Candidate verification time",
          ),
        }),
    ...(value.cutoverAt === undefined
      ? {}
      : { cutoverAt: isoDate(value.cutoverAt, "Rotation cutover time") }),
    ...(value.drainedAt === undefined
      ? {}
      : { drainedAt: isoDate(value.drainedAt, "Rotation drain time") }),
    ...(value.revocationPreparedAt === undefined
      ? {}
      : {
          revocationPreparedAt: isoDate(
            value.revocationPreparedAt,
            "Rotation revocation preparation time",
          ),
        }),
    ...(value.providerRevokedAt === undefined
      ? {}
      : {
          providerRevokedAt: isoDate(
            value.providerRevokedAt,
            "Provider revocation time",
          ),
        }),
    ...(value.revocationVerifiedAt === undefined
      ? {}
      : {
          revocationVerifiedAt: isoDate(
            value.revocationVerifiedAt,
            "Revocation verification time",
          ),
        }),
    ...(value.rolledBackAt === undefined
      ? {}
      : { rolledBackAt: isoDate(value.rolledBackAt, "Rotation rollback time") }),
    ...(value.candidateRevocationPreparedAt === undefined
      ? {}
      : {
          candidateRevocationPreparedAt: isoDate(
            value.candidateRevocationPreparedAt,
            "Candidate revocation preparation time",
          ),
        }),
    ...(value.candidateProviderRevokedAt === undefined
      ? {}
      : {
          candidateProviderRevokedAt: isoDate(
            value.candidateProviderRevokedAt,
            "Candidate provider revocation time",
          ),
        }),
    ...(value.cleanupOutcome === undefined
      ? {}
      : {
          cleanupOutcome: value.cleanupOutcome as
            | "aborted"
            | "rolled_back",
        }),
    evidence: value.evidence.map(parseEvidence),
  };
  if (rotation.fromSlot === rotation.toSlot) {
    throw invalid("Rotation source and destination slots must differ.");
  }
  return rotation;
}

function parseClosure(value: unknown): RotationClosureReceipt {
  if (!isRecord(value)) throw invalid("Rotation closure receipt is invalid.");
  onlyKeys(
    value,
    [
      "rotationId",
      "outcome",
      "closedAt",
      "fromGenerationId",
      "toGenerationId",
      "startedAt",
      "overlapDeadline",
      "candidateVerifiedAt",
      "cutoverAt",
      "drainedAt",
      "revocationPreparedAt",
      "providerRevokedAt",
      "revocationVerifiedAt",
      "rolledBackAt",
      "candidateRevocationPreparedAt",
      "candidateProviderRevokedAt",
      "evidence",
    ],
    "Rotation closure receipt",
  );
  const outcomes: RotationClosureReceipt["outcome"][] = [
    "bootstrapped",
    "rotated",
    "aborted",
    "rolled_back",
  ];
  if (
    typeof value.outcome !== "string" ||
    !outcomes.includes(value.outcome as RotationClosureReceipt["outcome"]) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > 10
  ) {
    throw invalid("Rotation closure outcome is invalid.");
  }
  return {
    rotationId: uuid(value.rotationId, "Closure rotation ID"),
    outcome: value.outcome as RotationClosureReceipt["outcome"],
    closedAt: isoDate(value.closedAt, "Rotation closure time"),
    startedAt: isoDate(value.startedAt, "Rotation closure start time"),
    ...(value.overlapDeadline === undefined
      ? {}
      : {
          overlapDeadline: isoDate(
            value.overlapDeadline,
            "Rotation closure overlap deadline",
          ),
        }),
    ...(value.candidateVerifiedAt === undefined
      ? {}
      : {
          candidateVerifiedAt: isoDate(
            value.candidateVerifiedAt,
            "Rotation closure candidate verification time",
          ),
        }),
    ...(value.cutoverAt === undefined
      ? {}
      : { cutoverAt: isoDate(value.cutoverAt, "Rotation closure cutover time") }),
    ...(value.drainedAt === undefined
      ? {}
      : { drainedAt: isoDate(value.drainedAt, "Rotation closure drain time") }),
    ...(value.revocationPreparedAt === undefined
      ? {}
      : {
          revocationPreparedAt: isoDate(
            value.revocationPreparedAt,
            "Rotation closure revocation preparation time",
          ),
        }),
    ...(value.providerRevokedAt === undefined
      ? {}
      : {
          providerRevokedAt: isoDate(
            value.providerRevokedAt,
            "Rotation closure provider revocation time",
          ),
        }),
    ...(value.revocationVerifiedAt === undefined
      ? {}
      : {
          revocationVerifiedAt: isoDate(
            value.revocationVerifiedAt,
            "Rotation closure revocation verification time",
          ),
        }),
    ...(value.rolledBackAt === undefined
      ? {}
      : {
          rolledBackAt: isoDate(
            value.rolledBackAt,
            "Rotation closure rollback time",
          ),
        }),
    ...(value.candidateRevocationPreparedAt === undefined
      ? {}
      : {
          candidateRevocationPreparedAt: isoDate(
            value.candidateRevocationPreparedAt,
            "Rotation closure candidate revocation preparation time",
          ),
        }),
    ...(value.candidateProviderRevokedAt === undefined
      ? {}
      : {
          candidateProviderRevokedAt: isoDate(
            value.candidateProviderRevokedAt,
            "Rotation closure candidate revocation time",
          ),
        }),
    ...(value.fromGenerationId === undefined
      ? {}
      : {
          fromGenerationId: uuid(
            value.fromGenerationId,
            "Closure source generation",
          ),
        }),
    toGenerationId: uuid(value.toGenerationId, "Closure destination generation"),
    evidence: value.evidence.map(parseEvidence),
  };
}

function parseHistoryAnchor(value: unknown): CredentialHistoryAnchor | null {
  if (value === null) return null;
  if (!isRecord(value)) throw invalid("Credential history anchor is invalid.");
  onlyKeys(
    value,
    [
      "throughRotationId",
      "throughClosedAt",
      "effectiveGenerationId",
      "closureCount",
      "archiveDigest",
      "metadataHash",
    ],
    "Credential history anchor",
  );
  if (
    !Number.isSafeInteger(value.closureCount) ||
    (value.closureCount as number) <= 0 ||
    (value.effectiveGenerationId !== null &&
      typeof value.effectiveGenerationId !== "string") ||
    typeof value.archiveDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.archiveDigest) ||
    typeof value.metadataHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.metadataHash)
  ) {
    throw invalid("Credential history anchor is invalid.");
  }
  return {
    throughRotationId: uuid(
      value.throughRotationId,
      "History anchor rotation ID",
    ),
    throughClosedAt: isoDate(
      value.throughClosedAt,
      "History anchor closure time",
    ),
    effectiveGenerationId:
      value.effectiveGenerationId === null
        ? null
        : uuid(
            value.effectiveGenerationId,
            "History anchor generation",
          ),
    closureCount: value.closureCount as number,
    archiveDigest: value.archiveDigest,
    metadataHash: value.metadataHash,
  };
}

function sameAuth(
  left: ManagedCredentialAuth,
  right: ManagedCredentialAuth,
): boolean {
  return (
    left.kind === right.kind &&
    (left.headerName ?? "") === (right.headerName ?? "") &&
    (left.prefix ?? "") === (right.prefix ?? "")
  );
}

export function parseCredentialHandoffManifest(
  value: unknown,
): CredentialHandoffManifest {
  if (!isRecord(value)) throw invalid("Credential handoff manifest is invalid.");
  onlyKeys(
    value,
    [
      "schema",
      "revision",
      "credential",
      "provider",
      "purpose",
      "environment",
      "account",
      "auth",
      "verification",
      "createdAt",
      "updatedAt",
      "activeSlot",
      "slots",
      "rotation",
      "historyAnchor",
      "closures",
    ],
    "Credential handoff manifest",
  );
  if (
    value.schema !== AGENTCRED_HANDOFF_MANIFEST ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    ![null, "a", "b"].includes(value.activeSlot as string | null) ||
    !isRecord(value.slots) ||
    !Array.isArray(value.closures) ||
    value.closures.length > MAX_CREDENTIAL_CLOSURES
  ) {
    throw invalid("Credential handoff manifest is invalid.");
  }
  onlyKeys(value.slots, ["a", "b"], "Credential handoff slots");
  const manifest: CredentialHandoffManifest = {
    schema: AGENTCRED_HANDOFF_MANIFEST,
    revision: value.revision as number,
    credential: isCredentialAlias(value.credential)
      ? value.credential
      : (() => {
          throw invalid("Manifest credential is invalid.");
        })(),
    provider: safeId(value.provider, "Manifest provider"),
    purpose: safeId(value.purpose, "Manifest purpose"),
    environment: safeId(value.environment, "Manifest environment"),
    account: safeId(value.account, "Manifest account"),
    auth: parseAuth(value.auth),
    verification: parseVerificationProfile(value.verification),
    createdAt: isoDate(value.createdAt, "Manifest creation time"),
    updatedAt: isoDate(value.updatedAt, "Manifest update time"),
    activeSlot: value.activeSlot as KeychainSlotName | null,
    slots: {
      a: parseSlot(value.slots.a, "Keychain slot a"),
      b: parseSlot(value.slots.b, "Keychain slot b"),
    },
    rotation: parseRotation(value.rotation),
    historyAnchor: parseHistoryAnchor(value.historyAnchor),
    closures: value.closures.map(parseClosure),
  };
  validateManifestState(manifest);
  return manifest;
}

function evidenceByKind(
  evidence: RotationEvidence[],
  label: string,
): Map<RotationEvidence["kind"], RotationEvidence> {
  if (
    new Set(evidence.map((item) => item.evidenceId)).size !== evidence.length
  ) {
    throw invalid(`${label} evidence IDs must be unique.`);
  }
  const kinds = new Map(
    evidence.map((item) => [item.kind, item] as const),
  );
  if (kinds.size !== evidence.length) {
    throw invalid(`${label} evidence kinds must be unique.`);
  }
  return kinds;
}

function requireEvidenceKinds(
  kinds: Map<RotationEvidence["kind"], RotationEvidence>,
  required: RotationEvidence["kind"][],
  optional: RotationEvidence["kind"][] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((kind) => !kinds.has(kind)) ||
    [...kinds.keys()].some((kind) => !allowed.has(kind))
  ) {
    throw invalid("Credential lifecycle evidence does not match its phase.");
  }
}

function isBrokerEvidenceMatch(
  item: RotationEvidence | undefined,
  profileHash: string,
  generationId: string,
  status: number,
): boolean {
  return Boolean(
    item &&
      item.generationId === generationId &&
      item.verificationProfileHash === profileHash &&
      item.status === status,
  );
}

function assertAtOrAfter(
  value: string | undefined,
  boundary: string | undefined,
  message: string,
): void {
  if (
    value === undefined ||
    boundary === undefined ||
    Date.parse(value) < Date.parse(boundary)
  ) {
    throw invalid(message);
  }
}

function assertOrderedTimes(
  values: Array<string | undefined>,
  message: string,
): void {
  const present = values.filter((value): value is string => value !== undefined);
  if (
    present.some(
      (value, index) =>
        index > 0 && Date.parse(value) < Date.parse(present[index - 1]!),
    )
  ) {
    throw invalid(message);
  }
}

function assertEvidenceAt(
  item: RotationEvidence | undefined,
  at: string | undefined,
  message: string,
): void {
  if (!item || !at || item.at !== at) throw invalid(message);
}

function assertEvidenceBetween(
  item: RotationEvidence | undefined,
  after: string | undefined,
  before: string | undefined,
  message: string,
): void {
  if (
    !item ||
    !after ||
    !before ||
    Date.parse(item.at) < Date.parse(after) ||
    Date.parse(item.at) > Date.parse(before) ||
    Date.parse(before) - Date.parse(item.at) >
      MAX_LIFECYCLE_EVIDENCE_AGE_MS
  ) {
    throw invalid(message);
  }
}

function validateClosure(
  closure: RotationClosureReceipt,
  profile: CredentialVerificationProfile,
): void {
  if (
    closure.fromGenerationId &&
    closure.fromGenerationId === closure.toGenerationId
  ) {
    throw invalid("Rotation closure generations must be distinct.");
  }
  const kinds = evidenceByKind(closure.evidence, "Rotation closure");
  const profileHash = hashCredentialVerificationProfile(profile);
  const positive = kinds.get("broker-positive");
  if (
    positive &&
    !isBrokerEvidenceMatch(
      positive,
      profileHash,
      closure.toGenerationId,
      profile.successStatus,
    )
  ) {
    throw invalid("Rotation closure has invalid candidate evidence.");
  }

  if (closure.outcome === "bootstrapped") {
    requireEvidenceKinds(kinds, ["broker-positive"]);
    if (
      closure.fromGenerationId ||
      closure.overlapDeadline ||
      !closure.candidateVerifiedAt ||
      closure.cutoverAt ||
      closure.drainedAt ||
      closure.revocationPreparedAt ||
      closure.providerRevokedAt ||
      closure.revocationVerifiedAt ||
      closure.rolledBackAt ||
      closure.candidateRevocationPreparedAt ||
      closure.candidateProviderRevokedAt
    ) {
      throw invalid("Bootstrap closure contains rotation-only state.");
    }
  } else if (closure.outcome === "rotated") {
    const previousPreRevocationKind: RotationEvidence["kind"] = kinds.has(
      "pre-revocation-positive",
    )
      ? "pre-revocation-positive"
      : "pre-revocation-negative";
    requireEvidenceKinds(
      kinds,
      [
        "broker-positive",
        "consumer-drain",
        previousPreRevocationKind,
        "pre-revocation-active-positive",
        "revocation-intent",
        "provider-revocation",
        "broker-negative",
      ],
      [
        "overlap-override",
        "provider-revocation-active-positive",
        "broker-positive-after-revocation",
      ],
    );
    const previousPreRevocationIsValid =
      Boolean(
        closure.fromGenerationId &&
          isBrokerEvidenceMatch(
            kinds.get("pre-revocation-positive"),
            profileHash,
            closure.fromGenerationId,
            profile.successStatus,
          ),
      ) ||
      Boolean(
        closure.fromGenerationId &&
          isBrokerEvidenceMatch(
            kinds.get("pre-revocation-negative"),
            profileHash,
            closure.fromGenerationId,
            profile.revokedStatus,
          ),
      );
    const providerActive = kinds.get(
      "provider-revocation-active-positive",
    );
    const activeAfterRevocation = kinds.get(
      "broker-positive-after-revocation",
    );
    if (
      !closure.fromGenerationId ||
      !closure.overlapDeadline ||
      !closure.candidateVerifiedAt ||
      !closure.cutoverAt ||
      !closure.drainedAt ||
      !closure.revocationPreparedAt ||
      !closure.providerRevokedAt ||
      !closure.revocationVerifiedAt ||
      closure.rolledBackAt ||
      closure.candidateRevocationPreparedAt ||
      closure.candidateProviderRevokedAt ||
      !previousPreRevocationIsValid ||
      !isBrokerEvidenceMatch(
        kinds.get("pre-revocation-active-positive"),
        profileHash,
        closure.toGenerationId,
        profile.successStatus,
      ) ||
      !isBrokerEvidenceMatch(
        kinds.get("broker-negative"),
        profileHash,
        closure.fromGenerationId,
        profile.revokedStatus,
      ) ||
      (providerActive !== undefined &&
        !isBrokerEvidenceMatch(
          providerActive,
          profileHash,
          closure.toGenerationId,
          profile.successStatus,
        )) ||
      (activeAfterRevocation !== undefined &&
        !isBrokerEvidenceMatch(
          activeAfterRevocation,
          profileHash,
          closure.toGenerationId,
          profile.successStatus,
        ))
    ) {
      throw invalid("Rotated closure is inconsistent.");
    }
  } else if (closure.outcome === "aborted") {
    requireEvidenceKinds(
      kinds,
      ["revocation-intent", "provider-revocation"],
      ["broker-positive"],
    );
    if (
      Boolean(closure.candidateVerifiedAt) !== kinds.has("broker-positive") ||
      closure.cutoverAt ||
      closure.drainedAt ||
      closure.revocationPreparedAt ||
      closure.providerRevokedAt ||
      closure.revocationVerifiedAt ||
      closure.rolledBackAt ||
      !closure.candidateRevocationPreparedAt ||
      !closure.candidateProviderRevokedAt
    ) {
      throw invalid("Aborted closure is inconsistent.");
    }
  } else {
    requireEvidenceKinds(
      kinds,
      [
        "broker-positive",
        "rollback-positive",
        "rollback-reason",
        "revocation-intent",
        "provider-revocation",
      ],
      ["consumer-drain", "overlap-override"],
    );
    if (
      !closure.fromGenerationId ||
      !closure.overlapDeadline ||
      !closure.candidateVerifiedAt ||
      !closure.cutoverAt ||
      !closure.rolledBackAt ||
      !closure.candidateRevocationPreparedAt ||
      !closure.candidateProviderRevokedAt ||
      closure.revocationPreparedAt ||
      closure.providerRevokedAt ||
      closure.revocationVerifiedAt ||
      Boolean(closure.drainedAt) !== kinds.has("consumer-drain") ||
      !isBrokerEvidenceMatch(
        kinds.get("rollback-positive"),
        profileHash,
        closure.fromGenerationId,
        profile.successStatus,
      )
    ) {
      throw invalid("Rolled-back closure is inconsistent.");
    }
  }
  if (
    kinds.has("overlap-override") &&
    (!closure.overlapDeadline ||
      kinds.get("overlap-override")!.at !== closure.cutoverAt ||
      Date.parse(kinds.get("overlap-override")!.at) <
        Date.parse(closure.overlapDeadline))
  ) {
    throw invalid("Rotation closure overlap override is inconsistent.");
  }
  if (kinds.has("broker-positive")) {
    assertEvidenceBetween(
      kinds.get("broker-positive"),
      closure.startedAt,
      closure.candidateVerifiedAt,
      "Rotation closure candidate evidence is outside its verification window.",
    );
  }
  if (kinds.has("consumer-drain")) {
    assertEvidenceAt(
      kinds.get("consumer-drain"),
      closure.drainedAt,
      "Rotation closure drain evidence is not transition-bound.",
    );
  }
  if (
    kinds.has("pre-revocation-positive") ||
    kinds.has("pre-revocation-negative")
  ) {
    const previousPreRevocationKind: RotationEvidence["kind"] = kinds.has(
      "pre-revocation-positive",
    )
      ? "pre-revocation-positive"
      : "pre-revocation-negative";
    assertEvidenceBetween(
      kinds.get(previousPreRevocationKind),
      closure.drainedAt,
      closure.revocationPreparedAt,
      "Rotation closure pre-revocation evidence is outside its window.",
    );
    assertEvidenceAt(
      kinds.get("revocation-intent"),
      closure.revocationPreparedAt,
      "Rotation closure revocation intent is not transition-bound.",
    );
    assertEvidenceBetween(
      kinds.get("pre-revocation-active-positive"),
      closure.drainedAt,
      closure.revocationPreparedAt,
      "Rotation closure active pre-revocation evidence is outside its window.",
    );
  }
  if (closure.outcome === "rotated") {
    assertEvidenceAt(
      kinds.get("provider-revocation"),
      closure.providerRevokedAt,
      "Rotation closure provider evidence is not transition-bound.",
    );
    if (kinds.has("provider-revocation-active-positive")) {
      assertEvidenceBetween(
        kinds.get("provider-revocation-active-positive"),
        closure.revocationPreparedAt,
        closure.providerRevokedAt,
        "Rotation closure active revocation evidence is outside its window.",
      );
    }
    assertEvidenceBetween(
      kinds.get("broker-negative"),
      closure.providerRevokedAt,
      closure.revocationVerifiedAt,
      "Rotation closure negative evidence is outside its window.",
    );
    if (kinds.has("broker-positive-after-revocation")) {
      assertEvidenceBetween(
        kinds.get("broker-positive-after-revocation"),
        closure.providerRevokedAt,
        closure.revocationVerifiedAt,
        "Rotation closure active evidence is outside its window.",
      );
    }
  }
  if (closure.outcome === "rolled_back") {
    assertEvidenceBetween(
      kinds.get("rollback-positive"),
      closure.cutoverAt,
      closure.rolledBackAt,
      "Rotation closure rollback evidence is outside its window.",
    );
    assertEvidenceAt(
      kinds.get("rollback-reason"),
      closure.rolledBackAt,
      "Rotation closure rollback reason is not transition-bound.",
    );
  }
  if (
    closure.outcome === "aborted" ||
    closure.outcome === "rolled_back"
  ) {
    assertEvidenceAt(
      kinds.get("revocation-intent"),
      closure.candidateRevocationPreparedAt,
      "Candidate revocation intent is not transition-bound.",
    );
    assertEvidenceAt(
      kinds.get("provider-revocation"),
      closure.candidateProviderRevokedAt,
      "Candidate provider evidence is not transition-bound.",
    );
  }

  assertOrderedTimes(
    [
      closure.startedAt,
      closure.candidateVerifiedAt,
      closure.cutoverAt,
      closure.drainedAt,
      closure.revocationPreparedAt,
      closure.providerRevokedAt,
      closure.revocationVerifiedAt,
      closure.rolledBackAt,
      closure.candidateRevocationPreparedAt,
      closure.candidateProviderRevokedAt,
      closure.closedAt,
    ],
    "Rotation closure timestamps are out of order.",
  );
  for (const item of closure.evidence) {
    if (
      Date.parse(item.at) < Date.parse(closure.startedAt) ||
      Date.parse(item.at) > Date.parse(closure.closedAt)
    ) {
      throw invalid("Rotation closure evidence time is out of bounds.");
    }
  }
}

function validateManifestState(manifest: CredentialHandoffManifest): void {
  const first = manifest.slots.a;
  const second = manifest.slots.b;
  if (
    first &&
    second &&
    (first.generationId === second.generationId ||
      first.service === second.service ||
      (first.providerKeyId !== undefined &&
        first.providerKeyId === second.providerKeyId))
  ) {
    throw invalid("Keychain slots must identify distinct generations.");
  }
  if (manifest.activeSlot && !manifest.slots[manifest.activeSlot]) {
    throw invalid("Active Keychain slot is empty.");
  }
  if (Date.parse(manifest.updatedAt) < Date.parse(manifest.createdAt)) {
    throw invalid("Manifest timestamps are out of order.");
  }
  if (
    new Set(manifest.closures.map((item) => item.rotationId)).size !==
    manifest.closures.length
  ) {
    throw invalid("Rotation closure IDs must be unique.");
  }
  for (const closure of manifest.closures) {
    validateClosure(closure, manifest.verification);
  }
  if (
    manifest.closures.some(
      (closure) =>
        Date.parse(closure.startedAt) < Date.parse(manifest.createdAt) ||
        Date.parse(closure.closedAt) > Date.parse(manifest.updatedAt),
    )
  ) {
    throw invalid("Rotation closure is outside the manifest time bounds.");
  }
  for (let index = 1; index < manifest.closures.length; index += 1) {
    if (
      Date.parse(manifest.closures[index]!.startedAt) <
      Date.parse(manifest.closures[index - 1]!.closedAt)
    ) {
      throw invalid("Rotation closures are out of order.");
    }
  }
  const allEvidenceIds = manifest.closures.flatMap((item) =>
    item.evidence.map((evidence) => evidence.evidenceId),
  );
  if (new Set(allEvidenceIds).size !== allEvidenceIds.length) {
    throw invalid("Archived rotation evidence IDs must be unique.");
  }

  const rotation = manifest.rotation;
  let effectiveGeneration: string | null =
    manifest.historyAnchor?.effectiveGenerationId ?? null;
  const retainedDestinationGenerations = new Set<string>();
  if (
    manifest.historyAnchor &&
    (manifest.historyAnchor.metadataHash !==
      hashCredentialManifestMetadata(manifest) ||
      Date.parse(manifest.historyAnchor.throughClosedAt) <
        Date.parse(manifest.createdAt) ||
      Date.parse(manifest.historyAnchor.throughClosedAt) >
      Date.parse(manifest.updatedAt) ||
      (manifest.closures[0] &&
        Date.parse(manifest.closures[0].startedAt) <
          Date.parse(manifest.historyAnchor.throughClosedAt)))
  ) {
    throw invalid("Credential history anchor is out of order.");
  }
  for (const closure of manifest.closures) {
    if (retainedDestinationGenerations.has(closure.toGenerationId)) {
      throw invalid("Rotation closures reuse a destination generation.");
    }
    retainedDestinationGenerations.add(closure.toGenerationId);
    const expectedSource = closure.fromGenerationId ?? null;
    if (closure.outcome === "bootstrapped") {
      if (effectiveGeneration !== null || expectedSource !== null) {
        throw invalid("Bootstrap closure breaks the generation chain.");
      }
      effectiveGeneration = closure.toGenerationId;
    } else if (closure.outcome === "rotated") {
      if (
        effectiveGeneration === null ||
        expectedSource !== effectiveGeneration
      ) {
        throw invalid("Rotated closure breaks the generation chain.");
      }
      effectiveGeneration = closure.toGenerationId;
    } else {
      if (expectedSource !== effectiveGeneration) {
        throw invalid("Cleanup closure breaks the generation chain.");
      }
    }
  }
  if (!rotation) {
    const activeGeneration = manifest.activeSlot
      ? manifest.slots[manifest.activeSlot]!.generationId
      : null;
    if (activeGeneration !== effectiveGeneration) {
      throw invalid("Idle manifest does not match its generation history.");
    }
    const populatedSlots = [manifest.slots.a, manifest.slots.b].filter(
      Boolean,
    ).length;
    if (populatedSlots !== (manifest.activeSlot ? 1 : 0)) {
      throw invalid("Idle manifest retains a hidden Keychain slot.");
    }
    return;
  }
  if (
    manifest.closures.some(
      (closure) => closure.rotationId === rotation.rotationId,
    )
  ) {
    throw invalid("Open rotation ID is already closed.");
  }
  if (
    manifest.closures.at(-1) &&
    Date.parse(rotation.startedAt) <
      Date.parse(manifest.closures.at(-1)!.closedAt)
  ) {
    throw invalid("Open rotation predates its closure history.");
  }
  const kinds = evidenceByKind(rotation.evidence, "Rotation");
  if (
    rotation.evidence.some((item) => allEvidenceIds.includes(item.evidenceId))
  ) {
    throw invalid("Open rotation reuses archived evidence.");
  }
  const candidate = manifest.slots[rotation.toSlot];
  if (!candidate) throw invalid("Rotation candidate slot is empty.");
  const previous = rotation.fromSlot
    ? manifest.slots[rotation.fromSlot]
    : null;
  if (rotation.fromSlot && !previous) {
    throw invalid("Rotation previous slot is empty.");
  }
  if ((previous?.generationId ?? null) !== effectiveGeneration) {
    throw invalid("Open rotation breaks the generation chain.");
  }
  if (
    (rotation.fromSlot && !rotation.overlapDeadline) ||
    (!rotation.fromSlot && rotation.overlapDeadline) ||
    (rotation.overlapDeadline &&
      Date.parse(rotation.overlapDeadline) <= Date.parse(rotation.startedAt))
  ) {
    throw invalid("Rotation overlap deadline does not match its predecessor.");
  }
  if (
    candidate.expiresAt &&
    rotation.overlapDeadline &&
    Date.parse(candidate.expiresAt) <= Date.parse(rotation.overlapDeadline)
  ) {
    throw invalid("Candidate expiry must follow the overlap deadline.");
  }
  if (
    !rotation.fromSlot &&
    ![
      "provisioning",
      "staged",
      "verified_new",
      "candidate_revocation_pending",
      "deleting_candidate",
    ].includes(rotation.phase)
  ) {
    throw invalid("Bootstrap rotation cannot enter a post-cutover phase.");
  }

  const profileHash = hashCredentialVerificationProfile(
    manifest.verification,
  );
  const candidatePositive = isBrokerEvidenceMatch(
    kinds.get("broker-positive"),
    profileHash,
    candidate.generationId,
    manifest.verification.successStatus,
  );
  const previousPositive =
    previous &&
    isBrokerEvidenceMatch(
      kinds.get("pre-revocation-positive"),
      profileHash,
      previous.generationId,
      manifest.verification.successStatus,
    );
  const previousNegative =
    previous &&
    isBrokerEvidenceMatch(
      kinds.get("pre-revocation-negative"),
      profileHash,
      previous.generationId,
      manifest.verification.revokedStatus,
    );
  const activePreRevocationPositive = isBrokerEvidenceMatch(
    kinds.get("pre-revocation-active-positive"),
    profileHash,
    candidate.generationId,
    manifest.verification.successStatus,
  );
  const rollbackPositive =
    previous &&
    isBrokerEvidenceMatch(
      kinds.get("rollback-positive"),
      profileHash,
      previous.generationId,
      manifest.verification.successStatus,
    );

  const phase = rotation.phase;
  const previousPreRevocationKind: RotationEvidence["kind"] = kinds.has(
    "pre-revocation-positive",
  )
    ? "pre-revocation-positive"
    : "pre-revocation-negative";
  const candidateCleanup =
    phase === "candidate_revocation_pending" ||
    phase === "deleting_candidate";
  if (phase === "provisioning" || phase === "staged") {
    requireEvidenceKinds(kinds, []);
  } else if (phase === "verified_new" || phase === "cutover") {
    requireEvidenceKinds(
      kinds,
      ["broker-positive"],
      phase === "cutover" ? ["overlap-override"] : [],
    );
  } else if (phase === "draining") {
    requireEvidenceKinds(
      kinds,
      ["broker-positive", "consumer-drain"],
      ["overlap-override"],
    );
  } else if (phase === "revocation_pending") {
    requireEvidenceKinds(kinds, [
      "broker-positive",
      "consumer-drain",
      previousPreRevocationKind,
      "pre-revocation-active-positive",
      "revocation-intent",
    ], ["overlap-override"]);
  } else if (phase === "revoked_old") {
    requireEvidenceKinds(
      kinds,
      [
        "broker-positive",
        "consumer-drain",
        previousPreRevocationKind,
        "pre-revocation-active-positive",
        "revocation-intent",
        "provider-revocation",
      ],
      ["overlap-override", "provider-revocation-active-positive"],
    );
  } else if (phase === "verified_revoked" || phase === "deleting_previous") {
    requireEvidenceKinds(
      kinds,
      [
        "broker-positive",
        "consumer-drain",
        previousPreRevocationKind,
        "pre-revocation-active-positive",
        "revocation-intent",
        "provider-revocation",
        "broker-negative",
      ],
      [
        "overlap-override",
        "provider-revocation-active-positive",
        "broker-positive-after-revocation",
      ],
    );
  } else if (phase === "rolled_back") {
    requireEvidenceKinds(
      kinds,
      ["broker-positive", "rollback-positive", "rollback-reason"],
      ["consumer-drain", "overlap-override"],
    );
  } else if (candidateCleanup && rotation.cleanupOutcome === "aborted") {
    requireEvidenceKinds(
      kinds,
      [
        "revocation-intent",
        ...(phase === "deleting_candidate"
          ? (["provider-revocation"] as const)
          : []),
      ],
      ["broker-positive"],
    );
  } else if (
    candidateCleanup &&
    rotation.cleanupOutcome === "rolled_back"
  ) {
    requireEvidenceKinds(
      kinds,
      [
        "broker-positive",
        "rollback-positive",
        "rollback-reason",
        "revocation-intent",
        ...(phase === "deleting_candidate"
          ? (["provider-revocation"] as const)
          : []),
      ],
      ["consumer-drain", "overlap-override"],
    );
  } else {
    throw invalid("Candidate deletion lacks a cleanup outcome.");
  }

  const needsCandidatePositive =
    !["provisioning", "staged"].includes(phase) &&
    !(candidateCleanup && rotation.cleanupOutcome === "aborted");
  if (
    (needsCandidatePositive && !candidatePositive) ||
    (candidateCleanup &&
      kinds.has("broker-positive") &&
      !candidatePositive)
  ) {
    throw invalid("Rotation candidate verification is inconsistent.");
  }
  if (
    Boolean(rotation.candidateVerifiedAt) !== kinds.has("broker-positive")
  ) {
    throw invalid("Rotation candidate verification timestamp is inconsistent.");
  }

  const cutoverPhases = new Set<CredentialRotationPhase>([
    "cutover",
    "draining",
    "revocation_pending",
    "revoked_old",
    "verified_revoked",
    "rolled_back",
    "deleting_previous",
  ]);
  const needsCutover =
    cutoverPhases.has(phase) ||
    (candidateCleanup &&
      rotation.cleanupOutcome === "rolled_back");
  if (Boolean(rotation.cutoverAt) !== needsCutover) {
    throw invalid("Rotation cutover timestamp is inconsistent.");
  }

  const mandatoryDrain = new Set<CredentialRotationPhase>([
    "draining",
    "revocation_pending",
    "revoked_old",
    "verified_revoked",
    "deleting_previous",
  ]);
  const optionalRollbackDrain =
    (phase === "rolled_back" ||
      (candidateCleanup &&
        rotation.cleanupOutcome === "rolled_back")) &&
    kinds.has("consumer-drain");
  const needsDrain = mandatoryDrain.has(phase) || optionalRollbackDrain;
  if (
    Boolean(rotation.drainedAt) !== needsDrain ||
    kinds.has("consumer-drain") !== needsDrain
  ) {
    throw invalid("Rotation drain evidence is inconsistent.");
  }

  const revocationPreparedPhases = new Set<CredentialRotationPhase>([
    "revocation_pending",
    "revoked_old",
    "verified_revoked",
    "deleting_previous",
  ]);
  const needsRevocationPreparation = revocationPreparedPhases.has(phase);
  if (
    Boolean(rotation.revocationPreparedAt) !== needsRevocationPreparation ||
    (kinds.has("pre-revocation-positive") ||
      kinds.has("pre-revocation-negative")) !==
      needsRevocationPreparation ||
    (kinds.has("pre-revocation-positive") &&
      kinds.has("pre-revocation-negative")) ||
    kinds.has("pre-revocation-active-positive") !==
      needsRevocationPreparation ||
    (needsRevocationPreparation &&
      (!(previousPositive || previousNegative) ||
        !activePreRevocationPositive))
  ) {
    throw invalid("Rotation revocation preparation is inconsistent.");
  }

  const providerRevokedPhases = new Set<CredentialRotationPhase>([
    "revoked_old",
    "verified_revoked",
    "deleting_previous",
  ]);
  const needsPreviousRevocation = providerRevokedPhases.has(phase);
  const activeProviderRevocationPositive = isBrokerEvidenceMatch(
    kinds.get("provider-revocation-active-positive"),
    profileHash,
    candidate.generationId,
    manifest.verification.successStatus,
  );
  if (
    Boolean(rotation.providerRevokedAt) !== needsPreviousRevocation ||
    (needsPreviousRevocation && !kinds.has("provider-revocation")) ||
    (kinds.has("provider-revocation-active-positive") &&
      !activeProviderRevocationPositive)
  ) {
    throw invalid("Previous credential revocation is inconsistent.");
  }

  const needsRevocationProof =
    phase === "verified_revoked" || phase === "deleting_previous";
  const negativeRevocationProof = Boolean(
    previous &&
      isBrokerEvidenceMatch(
        kinds.get("broker-negative"),
        profileHash,
        previous.generationId,
        manifest.verification.revokedStatus,
      ),
  );
  const activeAfterRevocation = kinds.get(
    "broker-positive-after-revocation",
  );
  if (
    needsRevocationProof !== negativeRevocationProof ||
    (activeAfterRevocation !== undefined &&
      !isBrokerEvidenceMatch(
        activeAfterRevocation,
        profileHash,
        candidate.generationId,
        manifest.verification.successStatus,
      ))
  ) {
    throw invalid("Rotation revocation verification is inconsistent.");
  }
  if (Boolean(rotation.revocationVerifiedAt) !== needsRevocationProof) {
    throw invalid("Revocation verification timestamp is inconsistent.");
  }

  const isRollback =
    phase === "rolled_back" ||
    (candidateCleanup &&
      rotation.cleanupOutcome === "rolled_back");
  if (
    Boolean(rotation.rolledBackAt) !== isRollback ||
    kinds.has("rollback-reason") !== isRollback ||
    Boolean(rollbackPositive) !== isRollback
  ) {
    throw invalid("Rotation rollback evidence is inconsistent.");
  }
  const deletingCandidate = phase === "deleting_candidate";
  if (
    Boolean(rotation.cleanupOutcome) !== candidateCleanup ||
    Boolean(rotation.candidateRevocationPreparedAt) !== candidateCleanup ||
    Boolean(rotation.candidateProviderRevokedAt) !== deletingCandidate ||
    kinds.has("revocation-intent") !==
      (candidateCleanup || needsRevocationPreparation) ||
    (deletingCandidate && !kinds.has("provider-revocation"))
  ) {
    throw invalid("Candidate cleanup evidence is inconsistent.");
  }

  assertOrderedTimes(
    [
      rotation.startedAt,
      rotation.candidateVerifiedAt,
      rotation.cutoverAt,
      rotation.drainedAt,
      rotation.revocationPreparedAt,
      rotation.providerRevokedAt,
      rotation.revocationVerifiedAt,
      rotation.rolledBackAt,
      rotation.candidateRevocationPreparedAt,
      rotation.candidateProviderRevokedAt,
    ],
    "Rotation lifecycle timestamps are out of order.",
  );
  if (kinds.has("broker-positive")) {
    assertEvidenceBetween(
      kinds.get("broker-positive"),
      rotation.startedAt,
      rotation.candidateVerifiedAt,
      "Candidate evidence is outside its verification window.",
    );
  }
  if (needsDrain) {
    assertEvidenceAt(
      kinds.get("consumer-drain"),
      rotation.drainedAt,
      "Consumer-drain evidence is not transition-bound.",
    );
  }
  if (needsRevocationPreparation) {
    assertEvidenceBetween(
      kinds.get(previousPreRevocationKind),
      rotation.drainedAt,
      rotation.revocationPreparedAt,
      "Pre-revocation evidence is outside its window.",
    );
    assertEvidenceBetween(
      kinds.get("pre-revocation-active-positive"),
      rotation.drainedAt,
      rotation.revocationPreparedAt,
      "Active pre-revocation evidence is outside its window.",
    );
    assertEvidenceAt(
      kinds.get("revocation-intent"),
      rotation.revocationPreparedAt,
      "Revocation intent is not transition-bound.",
    );
  }
  if (needsPreviousRevocation) {
    assertEvidenceAt(
      kinds.get("provider-revocation"),
      rotation.providerRevokedAt,
      "Provider revocation evidence is not transition-bound.",
    );
    if (kinds.has("provider-revocation-active-positive")) {
      assertEvidenceBetween(
        kinds.get("provider-revocation-active-positive"),
        rotation.revocationPreparedAt,
        rotation.providerRevokedAt,
        "Active provider-revocation evidence is outside its window.",
      );
    }
  }
  if (needsRevocationProof) {
    assertEvidenceBetween(
      kinds.get("broker-negative"),
      rotation.providerRevokedAt,
      rotation.revocationVerifiedAt,
      "Negative evidence is outside its verification window.",
    );
    if (kinds.has("broker-positive-after-revocation")) {
      assertEvidenceBetween(
        kinds.get("broker-positive-after-revocation"),
        rotation.providerRevokedAt,
        rotation.revocationVerifiedAt,
        "Active evidence is outside its verification window.",
      );
    }
  }
  if (isRollback) {
    assertEvidenceBetween(
      kinds.get("rollback-positive"),
      rotation.cutoverAt,
      rotation.rolledBackAt,
      "Rollback evidence is outside its verification window.",
    );
    assertEvidenceAt(
      kinds.get("rollback-reason"),
      rotation.rolledBackAt,
      "Rollback reason is not transition-bound.",
    );
  }
  if (candidateCleanup) {
    assertEvidenceAt(
      kinds.get("revocation-intent"),
      rotation.candidateRevocationPreparedAt,
      "Candidate revocation intent is not transition-bound.",
    );
  }
  if (deletingCandidate) {
    assertEvidenceAt(
      kinds.get("provider-revocation"),
      rotation.candidateProviderRevokedAt,
      "Candidate provider evidence is not transition-bound.",
    );
  }
  if (
    kinds.has("overlap-override") &&
    (!rotation.overlapDeadline ||
      kinds.get("overlap-override")!.at !== rotation.cutoverAt ||
      Date.parse(kinds.get("overlap-override")!.at) <
        Date.parse(rotation.overlapDeadline))
  ) {
    throw invalid("Rotation overlap override is inconsistent.");
  }
  const transitionTimes = [
    rotation.startedAt,
    rotation.candidateVerifiedAt,
    rotation.cutoverAt,
    rotation.drainedAt,
    rotation.revocationPreparedAt,
    rotation.providerRevokedAt,
    rotation.revocationVerifiedAt,
    rotation.rolledBackAt,
    rotation.candidateRevocationPreparedAt,
    rotation.candidateProviderRevokedAt,
  ].filter((value): value is string => value !== undefined);
  if (
    transitionTimes.some(
      (value) => Date.parse(value) > Date.parse(manifest.updatedAt),
    ) ||
    rotation.evidence.some(
      (item) => Date.parse(item.at) > Date.parse(manifest.updatedAt),
    )
  ) {
    throw invalid("Rotation state is newer than the manifest revision.");
  }
  if (candidate.createdAt !== rotation.startedAt) {
    throw invalid("Candidate slot creation is not bound to the rotation.");
  }

  const beforeCutover = ["provisioning", "staged", "verified_new"].includes(
    phase,
  );
  const afterCutover = [
    "cutover",
    "draining",
    "revocation_pending",
    "revoked_old",
    "verified_revoked",
    "deleting_previous",
  ].includes(phase);
  if (
    (beforeCutover && manifest.activeSlot !== rotation.fromSlot) ||
    (afterCutover && manifest.activeSlot !== rotation.toSlot) ||
    ((phase === "rolled_back" || candidateCleanup) &&
      manifest.activeSlot !== rotation.fromSlot)
  ) {
    throw invalid("Rotation active slot is inconsistent with its phase.");
  }
}

export async function loadCredentialHandoffManifest(
  pathInput: string,
): Promise<CredentialHandoffManifest> {
  if (!isAbsolute(pathInput)) {
    throw invalid("Credential handoff manifest path must be absolute.");
  }
  const path = resolve(pathInput);
  const text = await readOwnerFile(path, {
    maxBytes: MAX_MANIFEST_BYTES,
    name: "Credential handoff manifest",
  });
  try {
    return parseCredentialHandoffManifest(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof AgentCredError) throw error;
    throw invalid("Credential handoff manifest is not valid JSON.");
  }
}

export async function saveCredentialHandoffManifest(
  pathInput: string,
  manifest: CredentialHandoffManifest,
  options: { create?: boolean } = {},
): Promise<void> {
  if (!isAbsolute(pathInput)) {
    throw invalid("Credential handoff manifest path must be absolute.");
  }
  const parsed = parseCredentialHandoffManifest(manifest);
  const text = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) {
    throw invalid("Credential handoff manifest exceeds its safe size limit.");
  }
  await writeOwnerFileAtomic(
    resolve(pathInput),
    text,
    {
      createDirectory: options.create,
      createOnly: options.create,
      name: "Credential handoff manifest",
    },
  );
}

export function assertCredentialHandoffManifestFits(
  manifest: CredentialHandoffManifest,
): void {
  const parsed = parseCredentialHandoffManifest(manifest);
  if (
    Buffer.byteLength(`${JSON.stringify(parsed, null, 2)}\n`, "utf8") >
    MAX_MANIFEST_BYTES
  ) {
    throw invalid("Credential handoff manifest exceeds its safe size limit.");
  }
}

export function createCredentialHandoffManifest(input: {
  credential: string;
  provider: string;
  purpose: string;
  environment: string;
  account: string;
  auth: ManagedCredentialAuth;
  verification: CredentialVerificationProfile;
  now?: Date;
}): CredentialHandoffManifest {
  const at = (input.now ?? new Date()).toISOString();
  return parseCredentialHandoffManifest({
    schema: AGENTCRED_HANDOFF_MANIFEST,
    revision: 0,
    credential: input.credential,
    provider: input.provider,
    purpose: input.purpose,
    environment: input.environment,
    account: input.account,
    auth: input.auth,
    verification: input.verification,
    createdAt: at,
    updatedAt: at,
    activeSlot: null,
    slots: { a: null, b: null },
    rotation: null,
    historyAnchor: null,
    closures: [],
  });
}

export function nextManifestRevision(
  manifest: CredentialHandoffManifest,
  now = new Date(),
): CredentialHandoffManifest {
  return {
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: now.toISOString(),
  };
}

export function makeKeychainSlotRecord(input: {
  now?: Date;
  providerKeyId?: string;
  expiresAt?: string;
} = {}): KeychainSlotRecord {
  const generationId = randomUUID();
  return parseSlot(
    {
      generationId,
      service: `agentcred-slot-${randomUUID()}`,
      createdAt: (input.now ?? new Date()).toISOString(),
      ...(input.providerKeyId ? { providerKeyId: input.providerKeyId } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    },
    "Keychain slot",
  )!;
}

export function selectManifestSlot(
  manifest: CredentialHandoffManifest,
  selection: KeychainSlotSelection,
): KeychainSlotRecord {
  let slot: KeychainSlotName | null;
  if (selection === "active") {
    slot = manifest.activeSlot;
  } else if (selection === "candidate") {
    slot = manifest.rotation?.toSlot ?? null;
    if (
      manifest.rotation &&
      !["staged", "verified_new"].includes(
        manifest.rotation.phase,
      )
    ) {
      slot = null;
    }
  } else {
    slot =
      manifest.rotation &&
      [
        "cutover",
        "draining",
        "revoked_old",
      ].includes(manifest.rotation.phase)
        ? manifest.rotation.fromSlot
        : null;
  }
  if (!slot || !manifest.slots[slot]) {
    throw new AgentCredError(
      "credential_not_found",
      "Requested credential generation is unavailable.",
    );
  }
  return { ...manifest.slots[slot]! };
}

export async function materializeManagedReference(
  reference: ManagedMacOSKeychainReference,
): Promise<MacOSKeychainReference> {
  return (await materializeManagedReferenceSnapshot(reference)).reference;
}

export async function materializeManagedReferenceSnapshot(
  reference: ManagedMacOSKeychainReference,
): Promise<{
  reference: MacOSKeychainReference;
  generationId: string;
}> {
  if (
    !isAbsolute(reference.manifestPath) ||
    !["active", "candidate", "previous"].includes(reference.selection)
  ) {
    throw invalid("Managed Keychain reference is invalid.");
  }
  validateCredentialAuth(reference.auth);
  const manifest = await loadCredentialHandoffManifest(reference.manifestPath);
  if (!sameAuth(reference.auth, manifest.auth)) {
    throw invalid("Managed Keychain auth metadata does not match its manifest.");
  }
  const slot = selectManifestSlot(manifest, reference.selection);
  return {
    reference: {
      backend: "macos-keychain",
      service: slot.service,
      account: manifest.account,
      auth: { ...manifest.auth },
    },
    generationId: slot.generationId,
  };
}

export function managedManifestPath(
  reference: ManagedMacOSKeychainReference,
): string {
  if (!isAbsolute(reference.manifestPath)) {
    throw invalid("Managed Keychain manifest path must be absolute.");
  }
  return resolve(reference.manifestPath);
}
