#!/usr/bin/env node

import { userInfo } from "node:os";
import { hashAuditPath } from "./audit.js";
import {
  activateStagedCredential,
  archiveCredentialClosures,
  attestCandidateCredentialRevoked,
  attestPreviousCredentialRevoked,
  closeCredentialAbort,
  closeCredentialRotation,
  credentialLifecycleStatus,
  MacOSKeychainController,
  markConsumersDrained,
  prepareCredentialAbort,
  preparePreviousCredentialRevocation,
  recoverStagedCredential,
  rollbackCredential,
  stageCredential,
  verifyPreviousCredentialRevoked,
  verifyCredentialClosureArchive,
  verifyStagedCredential,
  type BrokerAuditEvidence,
} from "./controller.js";
import {
  loadBrokerConfig,
  requireManagedCredential,
  type BrokerConfig,
} from "./config.js";
import { AgentCredError } from "./errors.js";
import {
  createCredentialHandoffManifest,
  loadCredentialHandoffManifest,
  saveCredentialHandoffManifest,
  type ManagedMacOSKeychainReference,
  type ManagedCredentialAuth,
  type CredentialVerificationProfile,
} from "./keychain-slots.js";
import {
  inspectOwnerLifecycleLock,
  readOwnerFile,
  recoverOwnerLifecycleLock,
} from "./owner-files.js";
import type { AuditEvent } from "./types.js";

const COMMANDS = [
  "init",
  "status",
  "lock-status",
  "recover-lock",
  "stage",
  "recover-stage",
  "verify-new",
  "activate",
  "drain",
  "prepare-old-revoke",
  "attest-old-revoked",
  "verify-revoked",
  "rollback",
  "prepare-abort",
  "attest-candidate-revoked",
  "close-abort",
  "close",
  "archive",
  "verify-archive",
] as const;

type Command = (typeof COMMANDS)[number];

function usage(): never {
  process.stderr.write(
    "usage: agentcred-control init --manifest PATH --credential ALIAS --provider ID --purpose ID --environment ID --auth bearer|header --verify-operation http.fetch --verify-origin ORIGIN --verify-path PATH --verify-method GET|HEAD --verify-success-status N --verify-revoked-status N [--account NAME] [--header-name NAME]\n" +
      "       agentcred-control status --manifest PATH\n" +
      "       agentcred-control lock-status --manifest PATH\n" +
      "       agentcred-control recover-lock --manifest PATH --nonce UUID --confirm-stale-lock\n" +
      "       agentcred-control stage --config PATH --credential CANDIDATE_ALIAS [--provider-key-id ID] [--expires-at ISO] [--overlap-deadline ISO]\n" +
      "       agentcred-control recover-stage --config PATH --credential CANDIDATE_ALIAS\n" +
      "       agentcred-control verify-new --config PATH --credential CANDIDATE_ALIAS --audit-id UUID\n" +
      "       agentcred-control activate --config PATH --credential CANDIDATE_ALIAS [--emergency-overlap-evidence ID --confirm-expired-overlap]\n" +
      "       agentcred-control drain --config PATH --credential ACTIVE_ALIAS --evidence ID\n" +
      "       agentcred-control prepare-old-revoke --config PATH --previous-credential ALIAS --active-credential ALIAS --previous-audit-id UUID --active-audit-id UUID --evidence ID --confirm-no-rollback\n" +
      "       agentcred-control attest-old-revoked --config PATH --credential ACTIVE_ALIAS [--audit-id UUID] --evidence ID --confirm-provider-revoked\n" +
      "       agentcred-control verify-revoked --config PATH --previous-credential ALIAS --previous-audit-id UUID [--active-credential ALIAS --active-audit-id UUID]\n" +
      "       agentcred-control rollback --config PATH --previous-credential ALIAS --audit-id UUID --reason ID\n" +
      "       agentcred-control prepare-abort --config PATH --credential CANDIDATE_ALIAS --evidence ID --confirm-candidate-revocation\n" +
      "       agentcred-control attest-candidate-revoked --config PATH --credential CANDIDATE_ALIAS --evidence ID --confirm-provider-revoked\n" +
      "       agentcred-control close-abort --config PATH --credential CANDIDATE_ALIAS --confirm-delete-local\n" +
      "       agentcred-control close --config PATH --credential ACTIVE_ALIAS --confirm-delete-local\n" +
      "       agentcred-control archive --manifest PATH --archive PATH\n" +
      "       agentcred-control verify-archive --archive PATH [--manifest PATH] [--previous-archive PATH]\n" +
      "       IDs/evidence/origin/path fields are non-secret metadata; never embed or pass credential values.\n",
  );
  process.exit(2);
}

function invalid(message: string): AgentCredError {
  return new AgentCredError("invalid_request", message);
}

function parseFlags(
  args: string[],
  allowedValues: readonly string[],
  allowedBooleans: readonly string[] = [],
): Map<string, string | true> {
  const values = new Set(allowedValues);
  const booleans = new Set(allowedBooleans);
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag?.startsWith("--") || parsed.has(flag)) usage();
    if (booleans.has(flag)) {
      parsed.set(flag, true);
      continue;
    }
    if (!values.has(flag)) usage();
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    parsed.set(flag, value);
    index += 1;
  }
  return parsed;
}

function required(flags: Map<string, string | true>, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string") usage();
  return value;
}

function optional(
  flags: Map<string, string | true>,
  name: string,
): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function assertHumanTerminal(): void {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw invalid(
      "Controller mutations require an interactive terminal as an anti-pipe check; this does not authenticate human presence.",
    );
  }
}

async function configAndReference(
  flags: Map<string, string | true>,
  option: string,
  selection: ManagedMacOSKeychainReference["selection"],
): Promise<{
  config: BrokerConfig;
  alias: string;
  reference: ManagedMacOSKeychainReference;
}> {
  const config = await loadBrokerConfig(required(flags, "--config"));
  const alias = required(flags, option);
  return {
    config,
    alias,
    reference: requireManagedCredential(config, alias, selection),
  };
}

function sameManifest(
  left: ManagedMacOSKeychainReference,
  right: ManagedMacOSKeychainReference,
): void {
  if (left.manifestPath !== right.manifestPath) {
    throw invalid("Credential verification mappings use different manifests.");
  }
}

function pathWithinPrefix(path: string, prefix: string): boolean {
  return (
    prefix === "/" ||
    path === prefix ||
    path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
  );
}

function assertVerificationPolicy(
  config: BrokerConfig,
  alias: string,
  profile: CredentialVerificationProfile,
): void {
  const matches = config.policies.some(
    (policy) =>
      policy.operation !== "jsonrpc.read" &&
      policy.credential === alias &&
      policy.origin === profile.origin &&
      policy.methods.includes(profile.method) &&
      policy.pathPrefixes.some((prefix) =>
        pathWithinPrefix(profile.path, prefix),
      ) &&
      (policy.queryNames === undefined || policy.queryNames.length === 0),
  );
  if (!matches) {
    throw invalid(
      "Broker credential lacks a no-query policy for its exact verification profile.",
    );
  }
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as AuditEvent).auditId === "string" &&
    typeof (value as AuditEvent).at === "string" &&
    typeof (value as AuditEvent).event === "string" &&
    typeof (value as AuditEvent).outcome === "string"
  );
}

async function auditEvidence(
  config: BrokerConfig,
  auditId: string,
  brokerCredential: string,
): Promise<BrokerAuditEvidence> {
  const text = await readOwnerFile(config.auditPath, {
    maxBytes: 11 * 1024 * 1024,
    name: "Broker audit log",
  });
  let match: AuditEvent | undefined;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw invalid("Broker audit log is invalid.");
    }
    if (!isAuditEvent(value)) {
      throw invalid("Broker audit log contains an invalid event.");
    }
    if (value.auditId !== auditId) continue;
    if (match) throw invalid("Broker audit ID is not unique.");
    match = value;
  }
  if (
    !match ||
    match.event !== "use.completed" ||
    match.outcome !== "success" ||
    match.credential !== brokerCredential ||
    typeof match.credentialGenerationId !== "string" ||
    match.operation !== "http.fetch" ||
    typeof match.targetOrigin !== "string" ||
    typeof match.targetPathHash !== "string" ||
    !["GET", "HEAD"].includes(match.method as string) ||
    typeof match.status !== "number"
  ) {
    throw invalid("Broker audit evidence does not match a completed use.");
  }
  return {
    auditId,
    at: match.at,
    brokerCredential,
    generationId: match.credentialGenerationId,
    operation: match.operation,
    targetOrigin: match.targetOrigin,
    targetPathHash: match.targetPathHash,
    method: match.method as "GET" | "HEAD",
    status: match.status,
  };
}

function parseAuth(flags: Map<string, string | true>): ManagedCredentialAuth {
  const kind = required(flags, "--auth");
  if (!["bearer", "header"].includes(kind)) usage();
  if (kind === "bearer") {
    if (optional(flags, "--header-name")) usage();
    return { kind: "bearer" };
  }
  return {
    kind: "header",
    headerName: required(flags, "--header-name"),
  };
}

function integerFlag(
  flags: Map<string, string | true>,
  name: string,
): number {
  const raw = required(flags, name);
  if (!/^[0-9]{3}$/.test(raw)) usage();
  return Number(raw);
}

function verificationProfile(
  flags: Map<string, string | true>,
): CredentialVerificationProfile {
  const operation = required(flags, "--verify-operation");
  const origin = required(flags, "--verify-origin");
  const path = required(flags, "--verify-path");
  if (
    !path.startsWith("/") ||
    path.length > 2048 ||
    /[?#\0\r\n]/.test(path)
  ) {
    usage();
  }
  const common = {
    origin,
    targetPathHash: hashAuditPath(path),
    successStatus: integerFlag(flags, "--verify-success-status"),
    revokedStatus: integerFlag(flags, "--verify-revoked-status"),
  };
  if (
    operation !== "http.fetch" ||
    !["GET", "HEAD"].includes(required(flags, "--verify-method"))
  ) {
    usage();
  }
  return {
    operation: "http.fetch",
    ...common,
    path,
    method: required(flags, "--verify-method") as "GET" | "HEAD",
  };
}

async function init(args: string[]): Promise<unknown> {
  const flags = parseFlags(args, [
    "--manifest",
    "--credential",
    "--provider",
    "--purpose",
    "--environment",
    "--account",
    "--auth",
    "--header-name",
    "--verify-operation",
    "--verify-origin",
    "--verify-path",
    "--verify-method",
    "--verify-success-status",
    "--verify-revoked-status",
  ]);
  const manifest = createCredentialHandoffManifest({
    credential: required(flags, "--credential"),
    provider: required(flags, "--provider"),
    purpose: required(flags, "--purpose"),
    environment: required(flags, "--environment"),
    account: optional(flags, "--account") ?? userInfo().username,
    auth: parseAuth(flags),
    verification: verificationProfile(flags),
  });
  await saveCredentialHandoffManifest(required(flags, "--manifest"), manifest, {
    create: true,
  });
  return {
    credential: manifest.credential,
    provider: manifest.provider,
    purpose: manifest.purpose,
    environment: manifest.environment,
    revision: manifest.revision,
    phase: "unprovisioned",
  };
}

async function run(command: Command, args: string[]): Promise<unknown> {
  if (command === "init") return init(args);
  if (command === "status") {
    const flags = parseFlags(args, ["--manifest"]);
    return credentialLifecycleStatus(required(flags, "--manifest"));
  }
  if (command === "lock-status") {
    const flags = parseFlags(args, ["--manifest"]);
    return inspectOwnerLifecycleLock(required(flags, "--manifest"));
  }
  if (command === "verify-archive") {
    const flags = parseFlags(args, [
      "--archive",
      "--manifest",
      "--previous-archive",
    ]);
    return verifyCredentialClosureArchive(required(flags, "--archive"), {
      ...(optional(flags, "--manifest")
        ? { manifestPath: optional(flags, "--manifest") }
        : {}),
      ...(optional(flags, "--previous-archive")
        ? { previousArchivePath: optional(flags, "--previous-archive") }
        : {}),
    });
  }
  assertHumanTerminal();
  if (command === "recover-lock") {
    const flags = parseFlags(
      args,
      ["--manifest", "--nonce"],
      ["--confirm-stale-lock"],
    );
    if (flags.get("--confirm-stale-lock") !== true) usage();
    return recoverOwnerLifecycleLock(required(flags, "--manifest"), {
      confirmStaleLock: true,
      expectedNonce: required(flags, "--nonce"),
    });
  }
  if (command === "archive") {
    const flags = parseFlags(args, ["--manifest", "--archive"]);
    return archiveCredentialClosures({
      manifestPath: required(flags, "--manifest"),
      archivePath: required(flags, "--archive"),
    });
  }
  const backend = new MacOSKeychainController();

  if (command === "stage") {
    const flags = parseFlags(args, [
      "--config",
      "--credential",
      "--provider-key-id",
      "--expires-at",
      "--overlap-deadline",
    ]);
    const { reference } = await configAndReference(
      flags,
      "--credential",
      "candidate",
    );
    return stageCredential({
      manifestPath: reference.manifestPath,
      backend,
      ...(optional(flags, "--provider-key-id")
        ? { providerKeyId: optional(flags, "--provider-key-id") }
        : {}),
      ...(optional(flags, "--expires-at")
        ? { expiresAt: optional(flags, "--expires-at") }
        : {}),
      ...(optional(flags, "--overlap-deadline")
        ? { overlapDeadline: optional(flags, "--overlap-deadline") }
        : {}),
    });
  }
  if (command === "recover-stage") {
    const flags = parseFlags(args, ["--config", "--credential"]);
    const { reference } = await configAndReference(
      flags,
      "--credential",
      "candidate",
    );
    return recoverStagedCredential({
      manifestPath: reference.manifestPath,
      backend,
    });
  }
  if (command === "verify-new") {
    const flags = parseFlags(args, [
      "--config",
      "--credential",
      "--audit-id",
    ]);
    const { config, alias, reference } = await configAndReference(
      flags,
      "--credential",
      "candidate",
    );
    const manifest = await loadCredentialHandoffManifest(
      reference.manifestPath,
    );
    assertVerificationPolicy(config, alias, manifest.verification);
    return verifyStagedCredential({
      manifestPath: reference.manifestPath,
      evidence: await auditEvidence(
        config,
        required(flags, "--audit-id"),
        alias,
      ),
    });
  }
  if (command === "activate") {
    const flags = parseFlags(
      args,
      ["--config", "--credential", "--emergency-overlap-evidence"],
      ["--confirm-expired-overlap"],
    );
    const { reference } = await configAndReference(
      flags,
      "--credential",
      "candidate",
    );
    return activateStagedCredential({
      manifestPath: reference.manifestPath,
      ...(optional(flags, "--emergency-overlap-evidence")
        ? {
            emergencyOverlapEvidenceId: optional(
              flags,
              "--emergency-overlap-evidence",
            ),
          }
        : {}),
      confirmExpiredOverlap:
        flags.get("--confirm-expired-overlap") === true,
    });
  }
  if (command === "drain") {
    const flags = parseFlags(args, [
      "--config",
      "--credential",
      "--evidence",
    ]);
    const { reference } = await configAndReference(
      flags,
      "--credential",
      "active",
    );
    return markConsumersDrained({
      manifestPath: reference.manifestPath,
      evidenceId: required(flags, "--evidence"),
    });
  }
  if (command === "prepare-old-revoke") {
    const flags = parseFlags(
      args,
      [
        "--config",
        "--previous-credential",
        "--active-credential",
        "--previous-audit-id",
        "--active-audit-id",
        "--evidence",
      ],
      ["--confirm-no-rollback"],
    );
    const previous = await configAndReference(
      flags,
      "--previous-credential",
      "previous",
    );
    const active = await configAndReference(
      flags,
      "--active-credential",
      "active",
    );
    sameManifest(previous.reference, active.reference);
    const manifest = await loadCredentialHandoffManifest(
      active.reference.manifestPath,
    );
    assertVerificationPolicy(
      active.config,
      previous.alias,
      manifest.verification,
    );
    assertVerificationPolicy(
      active.config,
      active.alias,
      manifest.verification,
    );
    return preparePreviousCredentialRevocation({
      manifestPath: active.reference.manifestPath,
      previousEvidence: await auditEvidence(
        active.config,
        required(flags, "--previous-audit-id"),
        previous.alias,
      ),
      activeEvidence: await auditEvidence(
        active.config,
        required(flags, "--active-audit-id"),
        active.alias,
      ),
      evidenceId: required(flags, "--evidence"),
      confirmNoRollback: flags.get("--confirm-no-rollback") === true,
    });
  }
  if (command === "attest-old-revoked") {
    const flags = parseFlags(
      args,
      ["--config", "--credential", "--audit-id", "--evidence"],
      ["--confirm-provider-revoked"],
    );
    const { config, alias, reference } = await configAndReference(
      flags,
      "--credential",
      "active",
    );
    const manifest = await loadCredentialHandoffManifest(
      reference.manifestPath,
    );
    const auditId = optional(flags, "--audit-id");
    if (auditId) {
      assertVerificationPolicy(config, alias, manifest.verification);
    }
    return attestPreviousCredentialRevoked({
      manifestPath: reference.manifestPath,
      ...(auditId
        ? {
            activeEvidence: await auditEvidence(config, auditId, alias),
          }
        : {}),
      evidenceId: required(flags, "--evidence"),
      confirmed: flags.get("--confirm-provider-revoked") === true,
    });
  }
  if (command === "verify-revoked") {
    const flags = parseFlags(args, [
      "--config",
      "--previous-credential",
      "--active-credential",
      "--previous-audit-id",
      "--active-audit-id",
    ]);
    const previous = await configAndReference(
      flags,
      "--previous-credential",
      "previous",
    );
    const manifest = await loadCredentialHandoffManifest(
      previous.reference.manifestPath,
    );
    assertVerificationPolicy(
      previous.config,
      previous.alias,
      manifest.verification,
    );
    const activeAlias = optional(flags, "--active-credential");
    const activeAuditId = optional(flags, "--active-audit-id");
    if (Boolean(activeAlias) !== Boolean(activeAuditId)) {
      throw invalid(
        "Active credential alias and audit ID must be supplied together.",
      );
    }
    const active = activeAlias
      ? await configAndReference(flags, "--active-credential", "active")
      : undefined;
    if (active) {
      sameManifest(previous.reference, active.reference);
      assertVerificationPolicy(
        active.config,
        active.alias,
        manifest.verification,
      );
    }
    return verifyPreviousCredentialRevoked({
      manifestPath: previous.reference.manifestPath,
      previousEvidence: await auditEvidence(
        previous.config,
        required(flags, "--previous-audit-id"),
        previous.alias,
      ),
      ...(active && activeAuditId
        ? {
            activeEvidence: await auditEvidence(
              active.config,
              activeAuditId,
              active.alias,
            ),
          }
        : {}),
    });
  }
  if (command === "rollback") {
    const flags = parseFlags(args, [
      "--config",
      "--previous-credential",
      "--audit-id",
      "--reason",
    ]);
    const { config, alias, reference } = await configAndReference(
      flags,
      "--previous-credential",
      "previous",
    );
    const manifest = await loadCredentialHandoffManifest(
      reference.manifestPath,
    );
    assertVerificationPolicy(config, alias, manifest.verification);
    return rollbackCredential({
      manifestPath: reference.manifestPath,
      previousEvidence: await auditEvidence(
        config,
        required(flags, "--audit-id"),
        alias,
      ),
      reasonEvidenceId: required(flags, "--reason"),
    });
  }
  if (command === "prepare-abort") {
    const flags = parseFlags(
      args,
      ["--config", "--credential", "--evidence"],
      ["--confirm-candidate-revocation"],
    );
    const { reference } = await configAndReference(
      flags,
      "--credential",
      "candidate",
    );
    return prepareCredentialAbort({
      manifestPath: reference.manifestPath,
      evidenceId: required(flags, "--evidence"),
      confirmed:
        flags.get("--confirm-candidate-revocation") === true,
    });
  }
  if (command === "attest-candidate-revoked") {
    const flags = parseFlags(
      args,
      ["--config", "--credential", "--evidence"],
      ["--confirm-provider-revoked"],
    );
    const { reference } = await configAndReference(
      flags,
      "--credential",
      "candidate",
    );
    return attestCandidateCredentialRevoked({
      manifestPath: reference.manifestPath,
      evidenceId: required(flags, "--evidence"),
      confirmed: flags.get("--confirm-provider-revoked") === true,
    });
  }
  if (command === "close-abort") {
    const flags = parseFlags(
      args,
      ["--config", "--credential"],
      ["--confirm-delete-local"],
    );
    const { reference } = await configAndReference(
      flags,
      "--credential",
      "candidate",
    );
    return closeCredentialAbort({
      manifestPath: reference.manifestPath,
      backend,
      deleteLocalConfirmed: flags.get("--confirm-delete-local") === true,
    });
  }
  const flags = parseFlags(
    args,
    ["--config", "--credential"],
    ["--confirm-delete-local"],
  );
  const { reference } = await configAndReference(
    flags,
    "--credential",
    "active",
  );
  return closeCredentialRotation({
    manifestPath: reference.manifestPath,
    backend,
    deleteLocalConfirmed: flags.get("--confirm-delete-local") === true,
  });
}

async function main(): Promise<void> {
  process.umask(0o077);
  const command = process.argv[2];
  if (!COMMANDS.includes(command as Command)) usage();
  const result = await run(command as Command, process.argv.slice(3));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const message =
    error instanceof AgentCredError
      ? error.message
      : "agentcred controller failed safely.";
  process.stderr.write(`agentcred-control: ${message}\n`);
  process.exit(1);
});
