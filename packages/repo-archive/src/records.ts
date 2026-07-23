import {
  canonicalJsonBytes,
  digestFromCid,
  parseCanonicalJson,
  type AgentDataIdentity,
  type Cid,
  type JsonObject,
} from "@agenttool/adds";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  ARCHIVE_PROTOCOL,
  ARCHIVE_RECORD_ID_ALGORITHM,
  ARCHIVE_SIGNATURE_ALGORITHM,
  ARCHIVE_SIGNATURE_ENCODING,
  type ArchiveHealth,
  type ArchiveSignature,
  type ArchiveSigner,
  type PlacementReceiptCore,
  type RecoveryCatalogCore,
  type SignedPlacementReceipt,
  type SignedRecoveryCatalog,
  type SignedSnapshotDescriptor,
  type SignedVerificationReceipt,
  type SnapshotDescriptorCore,
  type VerificationReceiptCore,
  type ZoneDescriptor,
} from "./types.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  concatBytes,
  equalBytes,
  sha256Id,
  utf8,
} from "./encoding.js";
import { InvalidArchiveRecordError } from "./errors.js";
import { validateRecoveryKeyEnvelope } from "./recovery-keys.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

const TIMESTAMP = /^(?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const CID_V1_RAW_SHA256 = /^bafkre[a-z2-7]{53}$/u;

type PlainRecord = Record<string, unknown>;

function plain(value: unknown, label: string): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidArchiveRecordError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidArchiveRecordError(`${label} must be a plain object.`);
  }
  return value as PlainRecord;
}

function exact(value: PlainRecord, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new InvalidArchiveRecordError(`${label} contains unsupported fields.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new InvalidArchiveRecordError(`${label} is missing ${key}.`);
    }
  }
}

function string(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  if (typeof value !== "string") {
    throw new InvalidArchiveRecordError(`${label} must be a string.`);
  }
  const scalarLength = [...value].length;
  if (
    scalarLength < (options.min ?? 0)
    || scalarLength > (options.max ?? 2_048)
    || value.includes("\0")
    || (options.pattern !== undefined && !options.pattern.test(value))
  ) {
    throw new InvalidArchiveRecordError(`${label} is outside its admitted form or bounds.`);
  }
  return value;
}

function opaque(value: unknown, label: string, maximum = 256): string {
  const result = string(value, label, { min: 1, max: maximum });
  if (/[\p{Cc}\uFEFF\s]/u.test(result)) {
    throw new InvalidArchiveRecordError(`${label} must be an opaque identifier without whitespace or controls.`);
  }
  return result;
}

function nonSecretLocator(value: unknown, label: string): string {
  return string(value, label, {
    min: 3,
    max: 512,
    pattern: /^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9._~:/-]+$/u,
  });
}

function repositoryIdentity(value: unknown, label: string): string {
  const result = opaque(value, label);
  const firstSlash = result.indexOf("/");
  const firstColon = result.indexOf(":");
  if (
    result.includes("@")
    || result.includes("?")
    || result.includes("#")
    || result.includes("\\")
    || (firstSlash >= 0 && (firstColon < 0 || firstSlash < firstColon))
    || /^(?:[/\\]|~[/\\]|\.{1,2}[/\\]|[A-Za-z]:[/\\]|file:)/iu.test(result)
  ) {
    throw new InvalidArchiveRecordError(
      `${label} must be an opaque identity, not a filesystem path or credential-bearing locator.`,
    );
  }
  return result;
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
    || Object.is(value, -0)
  ) {
    throw new InvalidArchiveRecordError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function literal<T extends string | boolean>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) {
    throw new InvalidArchiveRecordError(`${label} must be ${JSON.stringify(expected)}.`);
  }
  return expected;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidArchiveRecordError(`${label} must be a boolean.`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new InvalidArchiveRecordError(`${label} has an unsupported value.`);
  }
  return value as T;
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label, { pattern: TIMESTAMP });
  const milliseconds = Date.parse(result);
  if (
    !Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString() !== result
  ) {
    throw new InvalidArchiveRecordError(`${label} is not a valid timestamp.`);
  }
  return result;
}

function nullableDigest(value: unknown, label: string): `sha256:${string}` | null {
  if (value === null) return null;
  return string(value, label, { pattern: SHA256_ID }) as `sha256:${string}`;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  return string(value, label, { pattern: SHA256_ID }) as `sha256:${string}`;
}

function cid(value: unknown, label: string): Cid {
  const result = string(value, label, { pattern: CID_V1_RAW_SHA256 }) as Cid;
  try {
    digestFromCid(result);
  } catch (cause) {
    throw new InvalidArchiveRecordError(`${label} must be a CIDv1 raw SHA-256 identifier.`, {
      cause,
    });
  }
  return result;
}

function denseArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new InvalidArchiveRecordError(`${label} must be an array with at most ${maximum} items.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new InvalidArchiveRecordError(`${label} must be dense.`);
    }
  }
  return value;
}

function signer(value: unknown, label: string): ArchiveSigner {
  const input = plain(value, label);
  exact(input, ["id", "ed25519_public_key"], label);
  const publicKey = string(input.ed25519_public_key, `${label}.ed25519_public_key`);
  base64UrlDecode(publicKey, `${label}.ed25519_public_key`, 32);
  return {
    id: opaque(input.id, `${label}.id`, 2_048),
    ed25519_public_key: publicKey,
  };
}

function signature(value: unknown, label: string): ArchiveSignature {
  const input = plain(value, label);
  exact(input, ["algorithm", "encoding", "public_key", "value"], label);
  literal(input.algorithm, ARCHIVE_SIGNATURE_ALGORITHM, `${label}.algorithm`);
  literal(input.encoding, ARCHIVE_SIGNATURE_ENCODING, `${label}.encoding`);
  const publicKey = string(input.public_key, `${label}.public_key`);
  const signatureValue = string(input.value, `${label}.value`);
  base64UrlDecode(publicKey, `${label}.public_key`, 32);
  base64UrlDecode(signatureValue, `${label}.value`, 64);
  return {
    algorithm: ARCHIVE_SIGNATURE_ALGORITHM,
    encoding: ARCHIVE_SIGNATURE_ENCODING,
    public_key: publicKey,
    value: signatureValue,
  };
}

function zone(value: unknown, label: string): ZoneDescriptor {
  const input = plain(value, label);
  exact(
    input,
    [
      "zone_id",
      "transport",
      "locator",
      "assurance",
      "delete_authority",
      "failure_domain",
    ],
    label,
  );
  const domain = plain(input.failure_domain, `${label}.failure_domain`);
  exact(
    domain,
    [
      "failure_domain_id",
      "provider",
      "account_root",
      "region",
      "credential_root",
      "media",
    ],
    `${label}.failure_domain`,
  );
  return {
    zone_id: opaque(input.zone_id, `${label}.zone_id`),
    transport: oneOf(
      input.transport,
      ["filesystem", "s3", "webdav", "ipfs", "other"] as const,
      `${label}.transport`,
    ),
    locator: nonSecretLocator(input.locator, `${label}.locator`),
    assurance: oneOf(
      input.assurance,
      ["simulated", "operator_asserted", "provider_evidenced"] as const,
      `${label}.assurance`,
    ),
    delete_authority: oneOf(
      input.delete_authority,
      ["routine_writer", "separate_maintenance", "unknown"] as const,
      `${label}.delete_authority`,
    ),
    failure_domain: {
      failure_domain_id: opaque(domain.failure_domain_id, `${label}.failure_domain.failure_domain_id`),
      provider: opaque(domain.provider, `${label}.failure_domain.provider`),
      account_root: opaque(domain.account_root, `${label}.failure_domain.account_root`),
      region: opaque(domain.region, `${label}.failure_domain.region`),
      credential_root: opaque(domain.credential_root, `${label}.failure_domain.credential_root`),
      media: opaque(domain.media, `${label}.failure_domain.media`),
    },
  };
}

function authority(value: unknown, label: string) {
  const input = plain(value, label);
  exact(input, ["automatic_restore", "execute_repository_code", "checkout"], label);
  return {
    automatic_restore: literal(input.automatic_restore, "never", `${label}.automatic_restore`),
    execute_repository_code: literal(
      input.execute_repository_code,
      "never",
      `${label}.execute_repository_code`,
    ),
    checkout: literal(input.checkout, "explicit_after_restore", `${label}.checkout`),
  } as const;
}

function snapshotCore(value: unknown): SnapshotDescriptorCore {
  const input = plain(value, "SnapshotDescriptor");
  exact(
    input,
    [
      "protocol",
      "kind",
      "signer",
      "vault_id",
      "created_at",
      "repository",
      "completeness",
      "payload",
      "parent_snapshot_id",
      "authority",
    ],
    "SnapshotDescriptor",
  );
  literal(input.protocol, ARCHIVE_PROTOCOL, "SnapshotDescriptor.protocol");
  literal(input.kind, "snapshot", "SnapshotDescriptor.kind");

  const repository = plain(input.repository, "SnapshotDescriptor.repository");
  exact(
    repository,
    [
      "repository_id",
      "object_format",
      "head_revision",
      "head_kind",
      "branch",
      "symbolic_refs",
      "refs_digest",
      "refs_count",
    ],
    "SnapshotDescriptor.repository",
  );
  const objectFormat = oneOf(
    repository.object_format,
    ["sha1", "sha256"] as const,
    "SnapshotDescriptor.repository.object_format",
  );
  const revisionPattern = objectFormat === "sha1" ? /^[0-9a-f]{40}$/u : /^[0-9a-f]{64}$/u;
  const headKind = oneOf(
    repository.head_kind,
    ["branch", "detached"] as const,
    "SnapshotDescriptor.repository.head_kind",
  );
  const branch = repository.branch === null
    ? null
    : string(repository.branch, "SnapshotDescriptor.repository.branch", { min: 1, max: 255 });
  if ((headKind === "branch") !== (branch !== null)) {
    throw new InvalidArchiveRecordError("SnapshotDescriptor branch and head_kind disagree.");
  }
  const symbolicRefs = denseArray(
    repository.symbolic_refs,
    "SnapshotDescriptor.repository.symbolic_refs",
    4_096,
  ).map((value, index) => {
    const label = `SnapshotDescriptor.repository.symbolic_refs[${index}]`;
    const symbolicRef = plain(value, label);
    exact(symbolicRef, ["ref", "target"], label);
    return {
      ref: opaque(symbolicRef.ref, `${label}.ref`, 1_024),
      target: opaque(symbolicRef.target, `${label}.target`, 1_024),
    };
  });
  const symbolicRefNames = new Set(symbolicRefs.map((entry) => entry.ref));
  if (
    symbolicRefNames.size !== symbolicRefs.length
    || symbolicRefs.some((entry) => entry.ref === "HEAD" || entry.target === "HEAD")
  ) {
    throw new InvalidArchiveRecordError(
      "SnapshotDescriptor named symbolic refs must be unique and must not replace HEAD.",
    );
  }

  const completeness = plain(input.completeness, "SnapshotDescriptor.completeness");
  exact(
    completeness,
    [
      "status",
      "committed_history",
      "workspace",
      "submodules",
      "lfs",
      "external_filters",
      "shallow_clone",
      "partial_clone",
      "alternates",
      "linked_worktrees",
      "ignored_files",
      "reasons",
    ],
    "SnapshotDescriptor.completeness",
  );
  const workspace = plain(completeness.workspace, "SnapshotDescriptor.completeness.workspace");
  exact(
    workspace,
    [
      "included",
      "staged_changes",
      "tracked_changes",
      "untracked_files",
      "unmerged_paths",
    ],
    "SnapshotDescriptor.completeness.workspace",
  );
  const submodules = plain(completeness.submodules, "SnapshotDescriptor.completeness.submodules");
  exact(
    submodules,
    ["included", "gitlink_evidence_events"],
    "SnapshotDescriptor.completeness.submodules",
  );
  const lfs = plain(completeness.lfs, "SnapshotDescriptor.completeness.lfs");
  exact(
    lfs,
    ["included", "pointer_evidence_events"],
    "SnapshotDescriptor.completeness.lfs",
  );
  const externalFilters = plain(
    completeness.external_filters,
    "SnapshotDescriptor.completeness.external_filters",
  );
  exact(
    externalFilters,
    ["included", "attribute_evidence_events"],
    "SnapshotDescriptor.completeness.external_filters",
  );
  const shallowClone = plain(
    completeness.shallow_clone,
    "SnapshotDescriptor.completeness.shallow_clone",
  );
  exact(
    shallowClone,
    ["detected", "complete_history"],
    "SnapshotDescriptor.completeness.shallow_clone",
  );
  const partialClone = plain(
    completeness.partial_clone,
    "SnapshotDescriptor.completeness.partial_clone",
  );
  exact(
    partialClone,
    ["detected", "promised_objects_materialized"],
    "SnapshotDescriptor.completeness.partial_clone",
  );
  const alternates = plain(completeness.alternates, "SnapshotDescriptor.completeness.alternates");
  exact(
    alternates,
    ["detected", "alternate_locations", "objects_materialized"],
    "SnapshotDescriptor.completeness.alternates",
  );
  const linkedWorktrees = plain(
    completeness.linked_worktrees,
    "SnapshotDescriptor.completeness.linked_worktrees",
  );
  exact(
    linkedWorktrees,
    ["included", "additional_worktrees"],
    "SnapshotDescriptor.completeness.linked_worktrees",
  );
  const ignored = plain(completeness.ignored_files, "SnapshotDescriptor.completeness.ignored_files");
  exact(ignored, ["included", "assessed"], "SnapshotDescriptor.completeness.ignored_files");
  const reasons = denseArray(completeness.reasons, "SnapshotDescriptor.completeness.reasons", 32)
    .map((reason, index) => string(
      reason,
      `SnapshotDescriptor.completeness.reasons[${index}]`,
      { min: 1, max: 512 },
    ));

  const normalizedCompleteness = {
    status: oneOf(
      completeness.status,
      ["complete", "incomplete"] as const,
      "SnapshotDescriptor.completeness.status",
    ),
    committed_history: literal(
      completeness.committed_history,
      "included",
      "SnapshotDescriptor.completeness.committed_history",
    ),
    workspace: {
      included: literal(workspace.included, false, "SnapshotDescriptor.completeness.workspace.included"),
      staged_changes: integer(workspace.staged_changes, "SnapshotDescriptor.completeness.workspace.staged_changes"),
      tracked_changes: integer(workspace.tracked_changes, "SnapshotDescriptor.completeness.workspace.tracked_changes"),
      untracked_files: integer(workspace.untracked_files, "SnapshotDescriptor.completeness.workspace.untracked_files"),
      unmerged_paths: integer(workspace.unmerged_paths, "SnapshotDescriptor.completeness.workspace.unmerged_paths"),
    },
    submodules: {
      included: literal(submodules.included, false, "SnapshotDescriptor.completeness.submodules.included"),
      gitlink_evidence_events: integer(
        submodules.gitlink_evidence_events,
        "SnapshotDescriptor.completeness.submodules.gitlink_evidence_events",
      ),
    },
    lfs: {
      included: literal(lfs.included, false, "SnapshotDescriptor.completeness.lfs.included"),
      pointer_evidence_events: integer(
        lfs.pointer_evidence_events,
        "SnapshotDescriptor.completeness.lfs.pointer_evidence_events",
      ),
    },
    external_filters: {
      included: literal(
        externalFilters.included,
        false,
        "SnapshotDescriptor.completeness.external_filters.included",
      ),
      attribute_evidence_events: integer(
        externalFilters.attribute_evidence_events,
        "SnapshotDescriptor.completeness.external_filters.attribute_evidence_events",
      ),
    },
    shallow_clone: {
      detected: boolean(
        shallowClone.detected,
        "SnapshotDescriptor.completeness.shallow_clone.detected",
      ),
      complete_history: boolean(
        shallowClone.complete_history,
        "SnapshotDescriptor.completeness.shallow_clone.complete_history",
      ),
    },
    partial_clone: {
      detected: boolean(
        partialClone.detected,
        "SnapshotDescriptor.completeness.partial_clone.detected",
      ),
      promised_objects_materialized: literal(
        partialClone.promised_objects_materialized,
        false,
        "SnapshotDescriptor.completeness.partial_clone.promised_objects_materialized",
      ),
    },
    alternates: {
      detected: boolean(
        alternates.detected,
        "SnapshotDescriptor.completeness.alternates.detected",
      ),
      alternate_locations: integer(
        alternates.alternate_locations,
        "SnapshotDescriptor.completeness.alternates.alternate_locations",
      ),
      objects_materialized: literal(
        alternates.objects_materialized,
        false,
        "SnapshotDescriptor.completeness.alternates.objects_materialized",
      ),
    },
    linked_worktrees: {
      included: literal(
        linkedWorktrees.included,
        false,
        "SnapshotDescriptor.completeness.linked_worktrees.included",
      ),
      additional_worktrees: integer(
        linkedWorktrees.additional_worktrees,
        "SnapshotDescriptor.completeness.linked_worktrees.additional_worktrees",
      ),
    },
    ignored_files: {
      included: literal(ignored.included, false, "SnapshotDescriptor.completeness.ignored_files.included"),
      assessed: literal(ignored.assessed, false, "SnapshotDescriptor.completeness.ignored_files.assessed"),
    },
    reasons,
  } as const;

  if (
    normalizedCompleteness.shallow_clone.complete_history
    === normalizedCompleteness.shallow_clone.detected
  ) {
    throw new InvalidArchiveRecordError(
      "SnapshotDescriptor shallow-clone evidence and complete_history disagree.",
    );
  }
  if (
    normalizedCompleteness.alternates.detected
    !== (normalizedCompleteness.alternates.alternate_locations > 0)
  ) {
    throw new InvalidArchiveRecordError(
      "SnapshotDescriptor alternate detection and location count disagree.",
    );
  }

  const hasGap = normalizedCompleteness.workspace.staged_changes > 0
    || normalizedCompleteness.workspace.tracked_changes > 0
    || normalizedCompleteness.workspace.untracked_files > 0
    || normalizedCompleteness.workspace.unmerged_paths > 0
    || normalizedCompleteness.submodules.gitlink_evidence_events > 0
    || normalizedCompleteness.lfs.pointer_evidence_events > 0
    || normalizedCompleteness.external_filters.attribute_evidence_events > 0
    || normalizedCompleteness.shallow_clone.detected
    || normalizedCompleteness.partial_clone.detected
    || normalizedCompleteness.alternates.detected
    || normalizedCompleteness.linked_worktrees.additional_worktrees > 0;
  if (
    (normalizedCompleteness.status === "complete" && (hasGap || reasons.length > 0))
    || (normalizedCompleteness.status === "incomplete" && reasons.length === 0)
  ) {
    throw new InvalidArchiveRecordError("SnapshotDescriptor completeness status does not match its evidence.");
  }

  const payload = plain(input.payload, "SnapshotDescriptor.payload");
  exact(payload, ["format", "bundle_version", "digest", "bytes"], "SnapshotDescriptor.payload");
  return {
    protocol: ARCHIVE_PROTOCOL,
    kind: "snapshot",
    signer: signer(input.signer, "SnapshotDescriptor.signer"),
    vault_id: opaque(input.vault_id, "SnapshotDescriptor.vault_id"),
    created_at: timestamp(input.created_at, "SnapshotDescriptor.created_at"),
    repository: {
      repository_id: repositoryIdentity(
        repository.repository_id,
        "SnapshotDescriptor.repository.repository_id",
      ),
      object_format: objectFormat,
      head_revision: string(repository.head_revision, "SnapshotDescriptor.repository.head_revision", {
        pattern: revisionPattern,
      }),
      head_kind: headKind,
      branch,
      symbolic_refs: symbolicRefs,
      refs_digest: digest(repository.refs_digest, "SnapshotDescriptor.repository.refs_digest"),
      refs_count: integer(repository.refs_count, "SnapshotDescriptor.repository.refs_count"),
    },
    completeness: normalizedCompleteness,
    payload: {
      format: literal(payload.format, "git-bundle", "SnapshotDescriptor.payload.format"),
      bundle_version: literal(
        payload.bundle_version,
        "v2-or-v3",
        "SnapshotDescriptor.payload.bundle_version",
      ),
      digest: digest(payload.digest, "SnapshotDescriptor.payload.digest"),
      bytes: integer(payload.bytes, "SnapshotDescriptor.payload.bytes", 1),
    },
    parent_snapshot_id: nullableDigest(
      input.parent_snapshot_id,
      "SnapshotDescriptor.parent_snapshot_id",
    ),
    authority: authority(input.authority, "SnapshotDescriptor.authority"),
  };
}

function placementCore(value: unknown): PlacementReceiptCore {
  const input = plain(value, "PlacementReceipt");
  exact(
    input,
    [
      "protocol",
      "kind",
      "signer",
      "vault_id",
      "snapshot_id",
      "snapshot_root_cid",
      "zone",
      "result",
      "ciphertext_blocks_observed",
      "encrypted_bytes_observed",
      "observed_at",
      "caveat",
    ],
    "PlacementReceipt",
  );
  literal(input.protocol, ARCHIVE_PROTOCOL, "PlacementReceipt.protocol");
  literal(input.kind, "placement", "PlacementReceipt.kind");
  return {
    protocol: ARCHIVE_PROTOCOL,
    kind: "placement",
    signer: signer(input.signer, "PlacementReceipt.signer"),
    vault_id: opaque(input.vault_id, "PlacementReceipt.vault_id"),
    snapshot_id: digest(input.snapshot_id, "PlacementReceipt.snapshot_id"),
    snapshot_root_cid: cid(input.snapshot_root_cid, "PlacementReceipt.snapshot_root_cid"),
    zone: zone(input.zone, "PlacementReceipt.zone"),
    result: literal(input.result, "observed", "PlacementReceipt.result"),
    ciphertext_blocks_observed: integer(
      input.ciphertext_blocks_observed,
      "PlacementReceipt.ciphertext_blocks_observed",
      1,
    ),
    encrypted_bytes_observed: integer(
      input.encrypted_bytes_observed,
      "PlacementReceipt.encrypted_bytes_observed",
      1,
    ),
    observed_at: timestamp(input.observed_at, "PlacementReceipt.observed_at"),
    caveat: literal(
      input.caveat,
      "observation_is_not_future_durability",
      "PlacementReceipt.caveat",
    ),
  };
}

function verificationCore(value: unknown): VerificationReceiptCore {
  const input = plain(value, "VerificationReceipt");
  exact(
    input,
    [
      "protocol",
      "kind",
      "signer",
      "vault_id",
      "snapshot_id",
      "snapshot_root_cid",
      "zone_id",
      "method",
      "result",
      "ciphertext_blocks_verified",
      "payload_digest_verified",
      "git_bundle_verified",
      "git_fsck",
      "checkout_performed",
      "restored_head",
      "verified_at",
    ],
    "VerificationReceipt",
  );
  literal(input.protocol, ARCHIVE_PROTOCOL, "VerificationReceipt.protocol");
  literal(input.kind, "verification", "VerificationReceipt.kind");
  return {
    protocol: ARCHIVE_PROTOCOL,
    kind: "verification",
    signer: signer(input.signer, "VerificationReceipt.signer"),
    vault_id: opaque(input.vault_id, "VerificationReceipt.vault_id"),
    snapshot_id: digest(input.snapshot_id, "VerificationReceipt.snapshot_id"),
    snapshot_root_cid: cid(input.snapshot_root_cid, "VerificationReceipt.snapshot_root_cid"),
    zone_id: opaque(input.zone_id, "VerificationReceipt.zone_id"),
    method: literal(input.method, "full_restore", "VerificationReceipt.method"),
    result: literal(input.result, "verified", "VerificationReceipt.result"),
    ciphertext_blocks_verified: integer(
      input.ciphertext_blocks_verified,
      "VerificationReceipt.ciphertext_blocks_verified",
      1,
    ),
    payload_digest_verified: digest(
      input.payload_digest_verified,
      "VerificationReceipt.payload_digest_verified",
    ),
    git_bundle_verified: literal(
      input.git_bundle_verified,
      true,
      "VerificationReceipt.git_bundle_verified",
    ),
    git_fsck: literal(input.git_fsck, "passed", "VerificationReceipt.git_fsck"),
    checkout_performed: literal(
      input.checkout_performed,
      false,
      "VerificationReceipt.checkout_performed",
    ),
    restored_head: string(input.restored_head, "VerificationReceipt.restored_head", {
      pattern: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u,
    }),
    verified_at: timestamp(input.verified_at, "VerificationReceipt.verified_at"),
  };
}

function signedShape<T>(
  value: unknown,
  label: string,
  coreKeys: readonly string[],
  coreValidator: (core: unknown) => T,
): { core: T; recordId: `sha256:${string}`; signature: ArchiveSignature } {
  const input = plain(value, label);
  exact(input, [...coreKeys, "record_id", "signature"], label);
  const { record_id: recordIdValue, signature: signatureValue, ...coreValue } = input;
  return {
    core: coreValidator(coreValue),
    recordId: digest(recordIdValue, `${label}.record_id`),
    signature: signature(signatureValue, `${label}.signature`),
  };
}

const SNAPSHOT_KEYS = [
  "protocol",
  "kind",
  "signer",
  "vault_id",
  "created_at",
  "repository",
  "completeness",
  "payload",
  "parent_snapshot_id",
  "authority",
] as const;
const PLACEMENT_KEYS = [
  "protocol",
  "kind",
  "signer",
  "vault_id",
  "snapshot_id",
  "snapshot_root_cid",
  "zone",
  "result",
  "ciphertext_blocks_observed",
  "encrypted_bytes_observed",
  "observed_at",
  "caveat",
] as const;
const VERIFICATION_KEYS = [
  "protocol",
  "kind",
  "signer",
  "vault_id",
  "snapshot_id",
  "snapshot_root_cid",
  "zone_id",
  "method",
  "result",
  "ciphertext_blocks_verified",
  "payload_digest_verified",
  "git_bundle_verified",
  "git_fsck",
  "checkout_performed",
  "restored_head",
  "verified_at",
] as const;

function signingBytes(kind: string, value: unknown): Uint8Array {
  return concatBytes(
    utf8(`${ARCHIVE_PROTOCOL}/${kind}`),
    new Uint8Array([0]),
    canonicalJsonBytes(value as JsonObject),
  );
}

function archiveSigner(identity: AgentDataIdentity): ArchiveSigner {
  if (identity.signingPrivateKey.byteLength !== 32 || identity.signingPublicKey.byteLength !== 32) {
    throw new InvalidArchiveRecordError("Archive signing identity has invalid Ed25519 key lengths.");
  }
  const derived = ed25519.getPublicKey(identity.signingPrivateKey);
  if (base64UrlEncode(derived) !== base64UrlEncode(identity.signingPublicKey)) {
    throw new InvalidArchiveRecordError("Archive signing identity private and public keys do not match.");
  }
  return {
    id: opaque(identity.id, "Archive signing identity id", 2_048),
    ed25519_public_key: base64UrlEncode(identity.signingPublicKey),
  };
}

function signCore<T extends { kind: string; signer: ArchiveSigner }>(
  core: T,
  identity: AgentDataIdentity,
): T & { record_id: `sha256:${string}`; signature: ArchiveSignature } {
  const expectedSigner = archiveSigner(identity);
  if (
    core.signer.id !== expectedSigner.id
    || core.signer.ed25519_public_key !== expectedSigner.ed25519_public_key
  ) {
    throw new InvalidArchiveRecordError("Archive record signer does not match the signing identity.");
  }
  const recordId = sha256Id(canonicalJsonBytes(core as unknown as JsonObject));
  const signable = { ...core, record_id: recordId };
  const signatureBytes = ed25519.sign(
    signingBytes(core.kind, signable),
    identity.signingPrivateKey,
  );
  return {
    ...core,
    record_id: recordId,
    signature: {
      algorithm: ARCHIVE_SIGNATURE_ALGORITHM,
      encoding: ARCHIVE_SIGNATURE_ENCODING,
      public_key: expectedSigner.ed25519_public_key,
      value: base64UrlEncode(signatureBytes),
    },
  };
}

function strictVerify(
  kind: string,
  core: { signer: ArchiveSigner },
  recordId: `sha256:${string}`,
  archiveSignature: ArchiveSignature,
): void {
  const expectedId = sha256Id(canonicalJsonBytes(core as unknown as JsonObject));
  if (recordId !== expectedId) {
    throw new InvalidArchiveRecordError(
      `Archive record_id must use ${ARCHIVE_RECORD_ID_ALGORITHM} over its canonical core.`,
    );
  }
  if (
    archiveSignature.public_key !== core.signer.ed25519_public_key
  ) {
    throw new InvalidArchiveRecordError("Archive signature public key does not match its signer.");
  }
  const publicKey = base64UrlDecode(archiveSignature.public_key, "Archive signature public key", 32);
  const signatureBytes = base64UrlDecode(archiveSignature.value, "Archive signature value", 64);
  try {
    const publicPoint = ed25519.Point.fromHex(publicKey, false);
    const rPoint = ed25519.Point.fromHex(signatureBytes.subarray(0, 32), false);
    if (
      publicPoint.isSmallOrder()
      || !publicPoint.isTorsionFree()
      || rPoint.isSmallOrder()
      || !rPoint.isTorsionFree()
      || !ed25519.verify(
        signatureBytes,
        signingBytes(kind, { ...core, record_id: recordId }),
        publicKey,
        { zip215: false },
      )
    ) {
      throw new InvalidArchiveRecordError("Archive record signature is invalid.");
    }
  } catch (cause) {
    if (cause instanceof InvalidArchiveRecordError) throw cause;
    throw new InvalidArchiveRecordError("Archive record signature is invalid.", { cause });
  }
}

function canonicalClone<T>(value: T): T {
  return parseCanonicalJson(canonicalJsonBytes(value as unknown as JsonObject)) as T;
}

export function validateZoneDescriptor(value: unknown): ZoneDescriptor {
  return zone(canonicalClone(value), "ZoneDescriptor");
}

export function signerForArchiveIdentity(identity: AgentDataIdentity): ArchiveSigner {
  return archiveSigner(identity);
}

export function signSnapshotDescriptor(
  core: Omit<SnapshotDescriptorCore, "signer">,
  identity: AgentDataIdentity,
): SignedSnapshotDescriptor {
  const normalized = snapshotCore({ ...core, signer: archiveSigner(identity) });
  return signCore(normalized, identity);
}

export function verifySnapshotDescriptor(value: unknown): SignedSnapshotDescriptor {
  const parsed = signedShape(
    canonicalClone(value),
    "SignedSnapshotDescriptor",
    SNAPSHOT_KEYS,
    snapshotCore,
  );
  strictVerify("snapshot", parsed.core, parsed.recordId, parsed.signature);
  return { ...parsed.core, record_id: parsed.recordId, signature: parsed.signature };
}

export function signPlacementReceipt(
  core: Omit<PlacementReceiptCore, "signer">,
  identity: AgentDataIdentity,
): SignedPlacementReceipt {
  const normalized = placementCore({ ...core, signer: archiveSigner(identity) });
  return signCore(normalized, identity);
}

export function verifyPlacementReceipt(value: unknown): SignedPlacementReceipt {
  const parsed = signedShape(
    canonicalClone(value),
    "SignedPlacementReceipt",
    PLACEMENT_KEYS,
    placementCore,
  );
  strictVerify("placement", parsed.core, parsed.recordId, parsed.signature);
  return { ...parsed.core, record_id: parsed.recordId, signature: parsed.signature };
}

export function signVerificationReceipt(
  core: Omit<VerificationReceiptCore, "signer">,
  identity: AgentDataIdentity,
): SignedVerificationReceipt {
  const normalized = verificationCore({ ...core, signer: archiveSigner(identity) });
  return signCore(normalized, identity);
}

export function verifyVerificationReceipt(value: unknown): SignedVerificationReceipt {
  const parsed = signedShape(
    canonicalClone(value),
    "SignedVerificationReceipt",
    VERIFICATION_KEYS,
    verificationCore,
  );
  strictVerify("verification", parsed.core, parsed.recordId, parsed.signature);
  return { ...parsed.core, record_id: parsed.recordId, signature: parsed.signature };
}

export function deriveCatalogHealth(
  snapshot: SignedSnapshotDescriptor,
  placements: readonly SignedPlacementReceipt[],
  verifications: readonly SignedVerificationReceipt[],
  zones: readonly ZoneDescriptor[],
  requiredVerifiedZones: number,
): ArchiveHealth {
  if (snapshot.completeness.status === "incomplete") return "incomplete";
  if (!Number.isSafeInteger(requiredVerifiedZones) || requiredVerifiedZones < 1) {
    throw new InvalidArchiveRecordError("requiredVerifiedZones must be a positive safe integer.");
  }
  const domainByZone = new Map(
    zones.map((entry) => [entry.zone_id, entry.failure_domain.failure_domain_id] as const),
  );
  const placedZones = new Set(
    placements
      .map((receipt) => receipt.zone.zone_id)
      .filter((zoneId) => domainByZone.has(zoneId)),
  );
  const verifiedDomains = new Set(
    verifications
      .filter((receipt) => placedZones.has(receipt.zone_id))
      .map((receipt) => domainByZone.get(receipt.zone_id))
      .filter((domain): domain is string => domain !== undefined),
  );
  if (verifiedDomains.size >= requiredVerifiedZones) return "verified";
  if (verifiedDomains.size > 0) return "degraded";
  return placedZones.size > 0 ? "observed" : "incomplete";
}

const CATALOG_KEYS = [
  "protocol",
  "kind",
  "signer",
  "vault_id",
  "generation",
  "parent_catalog_id",
  "created_at",
  "status",
  "required_verified_zones",
  "snapshot_root_cid",
  "snapshot",
  "snapshot_key_envelope",
  "zones",
  "placements",
  "verifications",
  "authority",
] as const;

function catalogCore(value: unknown): RecoveryCatalogCore {
  const input = plain(value, "RecoveryCatalog");
  exact(input, CATALOG_KEYS, "RecoveryCatalog");
  literal(input.protocol, ARCHIVE_PROTOCOL, "RecoveryCatalog.protocol");
  literal(input.kind, "catalog", "RecoveryCatalog.kind");
  const normalizedZones = denseArray(input.zones, "RecoveryCatalog.zones", 32)
    .map((item, index) => zone(item, `RecoveryCatalog.zones[${index}]`));
  if (normalizedZones.length === 0) {
    throw new InvalidArchiveRecordError("RecoveryCatalog must contain at least one zone.");
  }
  const zoneIds = new Set(normalizedZones.map((item) => item.zone_id));
  if (zoneIds.size !== normalizedZones.length) {
    throw new InvalidArchiveRecordError("RecoveryCatalog zone IDs must be unique.");
  }
  const locators = new Set(normalizedZones.map((item) => item.locator));
  if (locators.size !== normalizedZones.length) {
    throw new InvalidArchiveRecordError("RecoveryCatalog zone locators must be unique.");
  }
  const providerAccountRoots = new Set(
    normalizedZones.map((item) => [
      item.failure_domain.provider,
      item.failure_domain.account_root,
    ].join("\0")),
  );
  const credentialRoots = new Set(
    normalizedZones.map((item) => item.failure_domain.credential_root),
  );
  if (
    providerAccountRoots.size !== normalizedZones.length
    || credentialRoots.size !== normalizedZones.length
  ) {
    throw new InvalidArchiveRecordError(
      "RecoveryCatalog zones must not share provider/account or credential failure roots.",
    );
  }
  const zoneById = new Map(normalizedZones.map((item) => [item.zone_id, item] as const));
  const snapshot = verifySnapshotDescriptor(input.snapshot);
  const placements = denseArray(input.placements, "RecoveryCatalog.placements", 32)
    .map((item) => verifyPlacementReceipt(item));
  const verifications = denseArray(input.verifications, "RecoveryCatalog.verifications", 32)
    .map((item) => verifyVerificationReceipt(item));
  const required = integer(
    input.required_verified_zones,
    "RecoveryCatalog.required_verified_zones",
    1,
    normalizedZones.length,
  );
  const declaredDomains = new Set(
    normalizedZones.map((item) => item.failure_domain.failure_domain_id),
  );
  if (declaredDomains.size < required) {
    throw new InvalidArchiveRecordError(
      "RecoveryCatalog declared failure domains cannot satisfy its verification threshold.",
    );
  }
  const rootCid = cid(input.snapshot_root_cid, "RecoveryCatalog.snapshot_root_cid");
  const vaultId = opaque(input.vault_id, "RecoveryCatalog.vault_id");
  if (snapshot.vault_id !== vaultId) {
    throw new InvalidArchiveRecordError("RecoveryCatalog snapshot belongs to another vault.");
  }
  for (const receipt of [...placements, ...verifications]) {
    if (
      receipt.vault_id !== vaultId
      || receipt.snapshot_id !== snapshot.record_id
      || receipt.snapshot_root_cid !== rootCid
    ) {
      throw new InvalidArchiveRecordError("RecoveryCatalog contains a cross-vault or cross-snapshot receipt.");
    }
  }
  if (placements.some((receipt) => !zoneIds.has(receipt.zone.zone_id))) {
    throw new InvalidArchiveRecordError("RecoveryCatalog placement references an undeclared zone.");
  }
  if (verifications.some((receipt) => !zoneIds.has(receipt.zone_id))) {
    throw new InvalidArchiveRecordError("RecoveryCatalog verification references an undeclared zone.");
  }
  const placementIds = new Set(placements.map((receipt) => receipt.zone.zone_id));
  const verificationIds = new Set(verifications.map((receipt) => receipt.zone_id));
  if (placementIds.size !== placements.length || verificationIds.size !== verifications.length) {
    throw new InvalidArchiveRecordError("RecoveryCatalog admits at most one current receipt of each kind per zone.");
  }
  const placementByZone = new Map(
    placements.map((receipt) => [receipt.zone.zone_id, receipt] as const),
  );
  for (const receipt of placements) {
    const declared = zoneById.get(receipt.zone.zone_id);
    if (
      declared === undefined
      || !equalBytes(
        canonicalJsonBytes(declared as unknown as JsonObject),
        canonicalJsonBytes(receipt.zone as unknown as JsonObject),
      )
    ) {
      throw new InvalidArchiveRecordError(
        "RecoveryCatalog placement descriptor does not match its declared zone.",
      );
    }
  }
  for (const receipt of verifications) {
    const placement = placementByZone.get(receipt.zone_id);
    if (placement === undefined) {
      throw new InvalidArchiveRecordError(
        "RecoveryCatalog verification has no matching placement observation.",
      );
    }
    if (
      receipt.payload_digest_verified !== snapshot.payload.digest
      || receipt.restored_head !== snapshot.repository.head_revision
      || receipt.ciphertext_blocks_verified !== placement.ciphertext_blocks_observed
    ) {
      throw new InvalidArchiveRecordError(
        "RecoveryCatalog verification evidence does not match its snapshot and placement.",
      );
    }
  }
  const envelope = validateRecoveryKeyEnvelope(input.snapshot_key_envelope);
  if (envelope.manifest_cid !== rootCid || envelope.vault_id !== vaultId) {
    throw new InvalidArchiveRecordError("RecoveryCatalog snapshot key envelope is bound to another object.");
  }
  const status = oneOf(
    input.status,
    ["observed", "verified", "degraded", "incomplete"] as const,
    "RecoveryCatalog.status",
  );
  const expectedStatus = deriveCatalogHealth(
    snapshot,
    placements,
    verifications,
    normalizedZones,
    required,
  );
  if (status !== expectedStatus) {
    throw new InvalidArchiveRecordError(
      `RecoveryCatalog status must be ${expectedStatus} for its current evidence.`,
    );
  }
  return {
    protocol: ARCHIVE_PROTOCOL,
    kind: "catalog",
    signer: signer(input.signer, "RecoveryCatalog.signer"),
    vault_id: vaultId,
    generation: integer(input.generation, "RecoveryCatalog.generation", 1),
    parent_catalog_id: nullableDigest(input.parent_catalog_id, "RecoveryCatalog.parent_catalog_id"),
    created_at: timestamp(input.created_at, "RecoveryCatalog.created_at"),
    status,
    required_verified_zones: required,
    snapshot_root_cid: rootCid,
    snapshot,
    snapshot_key_envelope: envelope,
    zones: normalizedZones,
    placements,
    verifications,
    authority: authority(input.authority, "RecoveryCatalog.authority"),
  };
}

export function signRecoveryCatalog(
  core: Omit<RecoveryCatalogCore, "signer" | "status"> & { status?: ArchiveHealth },
  identity: AgentDataIdentity,
): SignedRecoveryCatalog {
  const status = core.status ?? deriveCatalogHealth(
    core.snapshot,
    core.placements,
    core.verifications,
    core.zones,
    core.required_verified_zones,
  );
  const normalized = catalogCore({ ...core, status, signer: archiveSigner(identity) });
  return signCore(normalized, identity);
}

export function verifyRecoveryCatalog(value: unknown): SignedRecoveryCatalog {
  const parsed = signedShape(
    canonicalClone(value),
    "SignedRecoveryCatalog",
    CATALOG_KEYS,
    catalogCore,
  );
  strictVerify("catalog", parsed.core, parsed.recordId, parsed.signature);
  return { ...parsed.core, record_id: parsed.recordId, signature: parsed.signature };
}

export function archiveRecordIdForCore(core: SnapshotDescriptorCore): `sha256:${string}` {
  return sha256Id(canonicalJsonBytes(snapshotCore(core) as unknown as JsonObject));
}

export const ARCHIVE_RECORD_CRYPTO = Object.freeze({
  canonicalization: "RFC8785-JCS",
  record_id: ARCHIVE_RECORD_ID_ALGORITHM,
  signature: ARCHIVE_SIGNATURE_ALGORITHM,
  signature_encoding: ARCHIVE_SIGNATURE_ENCODING,
  signing_domain: `${ARCHIVE_PROTOCOL}/<kind>\\x00`,
  signing_hash: "SHA-512-internal-to-Ed25519",
  content_digest: "SHA-256",
});
