#!/usr/bin/env bun
/**
 * Read-only Phase-B deployment guard.
 *
 * The guard classifies only the two states an ordinary deployment may cross:
 * the original absent/fail-closed state, or the completed configured-but-
 * resting generation state. Every provider, database, receipt, fleet, runtime,
 * or public-surface ambiguity is a refusal. Raw child output, Machine IDs,
 * provider digests, database targets, and receipt contents never reach stdout.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PHASE_B_PROOF_SCHEMA = "agenttool.phase-b-deploy-proof/1" as const;
export const PHASE_B_SOURCE_FLOOR =
  "2ca44b44bcfde9d571b27771f9d5fc516a4df41e" as const;

const APP = "agenttool";
const GENERATION_SECRET =
  "AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION";
const PRODUCTION_ORIGIN = "https://api.agenttool.dev";
const PRODUCTION_OPERATOR_HOME = "/Users/yournameisai";
const PRODUCTION_OPERATOR_NAME = "yournameisai";
const PRODUCTION_OPERATOR_UID = 501;
const HEALTH_URL = `${PRODUCTION_ORIGIN}/health`;
const FEDERATION_ABOUT_URL = `${PRODUCTION_ORIGIN}/federation/about`;
const RECEIPT_SCHEMA = "agenttool.covenant-v2-generation-ceremony/1";
const FINAL_RECEIPT_RELATIVE_PATH =
  ".local/state/agenttool/deploy-state/phase-b-authority-generation-receipt-v1.json";
const ACTIVE_MARKER_RELATIVE_PATH =
  ".local/state/agenttool/deploy-state/phase-b-authority-generation-active.json";
const FLY_PATH =
  "/usr/local/libexec/agenttool/phase-b-v1/flyctl-v0.4.74-darwin-arm64";
const NATIVE_PATH =
  "/usr/local/libexec/agenttool/phase-b-v1/agenttool-secret-macos";
const FLY_SHA256 =
  "7e919b0f42867e33d736398ba151ed00f2bfb577bf9424fbe57573bfee9ae1b3";
const FLY_BYTE_COUNT = 110_007_826;
const MAX_RECEIPT_BYTES = 65_536;
const MAX_FLY_SECRET_BYTES = 1_000_000;
const MAX_FLY_MACHINE_BYTES = 2_000_000;
const MAX_PUBLIC_BYTES = 200_000;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type JsonRecord = Record<string, unknown>;
type Phase = "preflight" | "postflight";
type ProviderSecretStatus = "Absent" | "Deployed";
type AuthorityState = "absent_fail_closed" | "configured";

export interface GuardRequest {
  phase: Phase;
  revision: string | null;
}

export interface PhaseBDeployProof {
  allowed_origins_count: 0;
  authoritative_v2_rows: 0;
  durable_hold: boolean;
  fleet_verified: boolean;
  observed_revision: string | null;
  phase: Phase;
  provider_secret_status: ProviderSecretStatus;
  reserved_generation_rows: 0;
  runtime_verified_count: 0 | 4;
  schema: typeof PHASE_B_PROOF_SCHEMA;
  source_floor_verified: boolean;
  standby_bound: boolean;
  state: AuthorityState;
}

export interface RuntimeVerificationRequest {
  machineID: string;
  receiptNonce: string;
  revision: string;
}

export interface PublicReadRequest {
  kind: "health" | "about";
  round: number;
  expectedRevision: string | null;
}

export interface PhaseBGuardDependencies {
  readAuthoritySnapshot(): Promise<unknown>;
  readFinalReceipt(): Promise<unknown | null>;
  readProviderSecretInventory(): Promise<unknown>;
  readFleetInventory(): Promise<unknown>;
  verifyDeployedRuntime(request: RuntimeVerificationRequest): Promise<void>;
  isRevisionDescendantOfFloor(revision: string): Promise<boolean>;
  readPublicJson(request: PublicReadRequest): Promise<unknown>;
  pause(milliseconds: number): Promise<void>;
  close(): Promise<void>;
}

export class PhaseBGuardError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PhaseBGuardError";
    this.code = /^[a-z0-9_]{1,64}$/.test(code) ? code : "internal_failure";
  }
}

function refuse(code: string): never {
  throw new PhaseBGuardError(code);
}

function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) refuse(code);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, code: string): JsonRecord {
  requireCondition(isRecord(value), code);
  return value;
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
  code: string,
): asserts value is JsonRecord {
  const record = requireRecord(value, code);
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  requireCondition(
    actual.length === wanted.length &&
      actual.every((key, index) => key === wanted[index]),
    code,
  );
}

/** Sorted, finite-integer JSON used only for private receipt/material comparison. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = requireRecord(value, "canonical_value");
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key).replaceAll("/", "\\/")}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  if (typeof value === "number") {
    requireCondition(Number.isSafeInteger(value), "canonical_number");
  }
  requireCondition(
    typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean",
    "canonical_value",
  );
  const encoded = JSON.stringify(value);
  requireCondition(encoded !== undefined, "canonical_value");
  return encoded.replaceAll("/", "\\/");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isMachineID(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{14}$/.test(value);
}

function isNonce(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(
      value,
    )
  ) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function numberValue(value: unknown, code: string): number {
  requireCondition(
    (typeof value === "number" && Number.isSafeInteger(value)) ||
      (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)),
    code,
  );
  const result = Number(value);
  requireCondition(Number.isSafeInteger(result), code);
  return result;
}

interface AuthoritySnapshot {
  settingsRows: 1;
  federationID: 1;
  enabled: false;
  instanceURL: typeof PRODUCTION_ORIGIN;
  allowedOrigins: [];
  durableHold: boolean;
  reservedGenerationRows: 0;
  authoritativeV2Rows: 0;
  databaseTargetSHA256: string;
}

function validateAuthoritySnapshot(raw: unknown): AuthoritySnapshot {
  exactKeys(
    raw,
    [
      "settings_rows", "federation_id", "federation_enabled",
      "federation_instance_url_exact", "federation_allowed_origins_count",
      "covenant_v2_generation_hold", "hold_column_count", "hold_column_type",
      "hold_column_not_null", "hold_column_default_exact", "hold_constraint_count",
      "hold_constraint_definition_exact", "reserved_generation_rows",
      "authoritative_v2_rows", "database_target_sha256",
    ],
    "database_authority_shape",
  );
  const value = raw as JsonRecord;
  requireCondition(
    numberValue(value.settings_rows, "database_settings_singleton") === 1 &&
      numberValue(value.federation_id, "database_settings_singleton") === 1,
    "database_settings_singleton",
  );
  requireCondition(value.federation_enabled === false, "database_federation_enabled");
  requireCondition(
    value.federation_instance_url_exact === true,
    "database_instance_url",
  );
  requireCondition(
    numberValue(
      value.federation_allowed_origins_count,
      "database_allowed_origins",
    ) === 0,
    "database_allowed_origins",
  );
  requireCondition(
    numberValue(value.hold_column_count, "database_hold_column_contract") === 1 &&
      value.hold_column_type === "boolean" &&
      value.hold_column_not_null === true &&
      value.hold_column_default_exact === true,
    "database_hold_column_contract",
  );
  requireCondition(
    numberValue(value.hold_constraint_count, "database_hold_constraint_contract") === 1 &&
      value.hold_constraint_definition_exact === true,
    "database_hold_constraint_contract",
  );
  requireCondition(
    typeof value.covenant_v2_generation_hold === "boolean",
    "database_hold_shape",
  );
  requireCondition(
    numberValue(value.reserved_generation_rows, "reserved_generation_rows") === 0,
    "reserved_generation_rows",
  );
  requireCondition(
    numberValue(value.authoritative_v2_rows, "authoritative_v2_rows") === 0,
    "authoritative_v2_rows",
  );
  requireCondition(isDigest(value.database_target_sha256), "database_target_shape");
  return {
    settingsRows: 1,
    federationID: 1,
    enabled: false,
    instanceURL: PRODUCTION_ORIGIN,
    allowedOrigins: [],
    durableHold: value.covenant_v2_generation_hold,
    reservedGenerationRows: 0,
    authoritativeV2Rows: 0,
    databaseTargetSHA256: value.database_target_sha256,
  };
}

interface ReceiptRoles {
  appMachineIDs: string[];
  thinkerPrimaryMachineID: string;
  thinkerStandbyMachineID: string;
  startedProbeOrder: string[];
}

interface CompletedReceipt {
  raw: JsonRecord;
  nonce: string;
  operatorRevision: string;
  nativeSHA256: string;
  roles: ReceiptRoles;
  machineSetSHA256: string;
  roleMapSHA256: string;
  baselineNonImageConfigSHA256: string;
  databaseTargetSHA256: string;
}

const ROOT_RECEIPT_KEYS = [
  "schema", "status", "checkpoint", "ceremony_nonce", "created_at",
  "updated_at", "bindings", "scope", "interlock", "generation", "attempts",
  "final",
] as const;
const BINDING_KEYS = [
  "operator_revision", "operator_source_sha256", "native_sha256",
  "native_cdhash", "native_team_id", "native_designated_requirement_sha256",
  "flyctl_sha256", "phase_a_resume_receipt_sha256",
] as const;
const SCOPE_KEYS = [
  "machine_set_sha256", "role_map_sha256", "app_machine_ids",
  "thinker_primary_machine_id", "thinker_standby_machine_id",
  "started_probe_order", "baseline_inventory_sha256",
  "baseline_non_image_config_sha256", "image_ref_sha256", "deployed_revision",
] as const;
const INTERLOCK_KEYS = [
  "row_id", "durable_hold_verified", "allowed_origins_count",
  "instance_url_sha256", "database_target_sha256",
] as const;
const ATTEMPT_KEYS = [
  "attempt_id", "status", "checkpoint", "started_at", "updated_at", "stage",
  "deploy", "runtime_probe", "final_gates_verified", "failure",
] as const;
const FINAL_KEYS = [
  "completed_at", "final_inventory_sha256", "final_secret_status",
  "runtime_verified_count", "reserved_generation_rows", "authoritative_v2_rows",
  "allowed_origins_count",
] as const;

function validateCompletedReceipt(raw: unknown): CompletedReceipt {
  exactKeys(raw, ROOT_RECEIPT_KEYS, "final_receipt_shape");
  const root = raw as JsonRecord;
  requireCondition(
    root.schema === RECEIPT_SCHEMA && root.status === "completed" &&
      root.checkpoint === "completed" && isNonce(root.ceremony_nonce) &&
      isTimestamp(root.created_at) && isTimestamp(root.updated_at),
    "final_receipt_state",
  );

  exactKeys(root.bindings, BINDING_KEYS, "final_receipt_bindings");
  const bindings = root.bindings as JsonRecord;
  requireCondition(
    isRevision(bindings.operator_revision) &&
      isDigest(bindings.operator_source_sha256) &&
      isDigest(bindings.native_sha256) &&
      typeof bindings.native_cdhash === "string" &&
      /^[0-9a-f]{40}$/.test(bindings.native_cdhash) &&
      typeof bindings.native_team_id === "string" &&
      /^[A-Z0-9]{10}$/.test(bindings.native_team_id) &&
      isDigest(bindings.native_designated_requirement_sha256) &&
      bindings.flyctl_sha256 === FLY_SHA256 &&
      isDigest(bindings.phase_a_resume_receipt_sha256),
    "final_receipt_bindings",
  );

  exactKeys(root.scope, SCOPE_KEYS, "final_receipt_scope");
  const scope = root.scope as JsonRecord;
  const apps = scope.app_machine_ids;
  const primary = scope.thinker_primary_machine_id;
  const standby = scope.thinker_standby_machine_id;
  const order = scope.started_probe_order;
  requireCondition(
    Array.isArray(apps) && apps.length === 3 && apps.every(isMachineID) &&
      apps.every((value, index) => index === 0 || apps[index - 1] < value) &&
      isMachineID(primary) && isMachineID(standby) && primary !== standby &&
      !apps.includes(primary) && !apps.includes(standby) &&
      Array.isArray(order) && order.length === 4 && order.every(isMachineID) &&
      canonicalJson(order) === canonicalJson([...apps, primary]) &&
      isDigest(scope.machine_set_sha256) && isDigest(scope.role_map_sha256) &&
      isDigest(scope.baseline_inventory_sha256) &&
      isDigest(scope.baseline_non_image_config_sha256) &&
      isDigest(scope.image_ref_sha256) && isRevision(scope.deployed_revision) &&
      scope.deployed_revision === bindings.operator_revision,
    "final_receipt_scope",
  );

  exactKeys(root.interlock, INTERLOCK_KEYS, "final_receipt_interlock");
  const interlock = root.interlock as JsonRecord;
  requireCondition(
    interlock.row_id === 1 && interlock.durable_hold_verified === true &&
      interlock.allowed_origins_count === 0 &&
      interlock.instance_url_sha256 === sha256(PRODUCTION_ORIGIN) &&
      isDigest(interlock.database_target_sha256),
    "final_receipt_interlock",
  );

  exactKeys(
    root.generation,
    ["create_attempted", "create_verified"],
    "final_receipt_generation",
  );
  const generation = root.generation as JsonRecord;
  requireCondition(
    generation.create_attempted === true && generation.create_verified === true,
    "final_receipt_generation",
  );

  requireCondition(
    Array.isArray(root.attempts) && root.attempts.length > 0 &&
      root.attempts.length <= 16,
    "final_receipt_attempts",
  );
  let sawCompleted = false;
  const attemptIDs = new Set<string>();
  for (const [index, rawAttempt] of root.attempts.entries()) {
    exactKeys(rawAttempt, ATTEMPT_KEYS, "final_receipt_attempt");
    const attempt = rawAttempt as JsonRecord;
    exactKeys(attempt.stage, ["attempted", "verified"], "final_receipt_attempt");
    exactKeys(attempt.deploy, ["attempted", "verified"], "final_receipt_attempt");
    exactKeys(
      attempt.runtime_probe,
      ["attempted_machine_ids", "verified_machine_ids"],
      "final_receipt_attempt",
    );
    const stage = attempt.stage as JsonRecord;
    const deploy = attempt.deploy as JsonRecord;
    const probe = attempt.runtime_probe as JsonRecord;
    const attemptedIDs = probe.attempted_machine_ids;
    const verifiedIDs = probe.verified_machine_ids;
    requireCondition(
      isNonce(attempt.attempt_id) &&
        !attemptIDs.has(attempt.attempt_id as string) &&
        ["failed_or_uncertain", "completed"].includes(String(attempt.status)) &&
        isTimestamp(attempt.started_at) && isTimestamp(attempt.updated_at) &&
        attempt.started_at <= attempt.updated_at &&
        typeof attempt.checkpoint === "string" &&
        /^[a-z0-9_]{1,64}$/.test(attempt.checkpoint) &&
        typeof stage.attempted === "boolean" && typeof stage.verified === "boolean" &&
        typeof deploy.attempted === "boolean" && typeof deploy.verified === "boolean" &&
        (!stage.verified || stage.attempted) && (!deploy.attempted || stage.verified) &&
        (!deploy.verified || deploy.attempted) &&
        Array.isArray(attemptedIDs) && Array.isArray(verifiedIDs) &&
        attemptedIDs.every(isMachineID) && verifiedIDs.every(isMachineID) &&
        canonicalJson(attemptedIDs) === canonicalJson(order.slice(0, attemptedIDs.length)) &&
        canonicalJson(verifiedIDs) === canonicalJson(attemptedIDs.slice(0, verifiedIDs.length)) &&
        new Set(attemptedIDs).size === attemptedIDs.length &&
        new Set(verifiedIDs).size === verifiedIDs.length &&
        typeof attempt.final_gates_verified === "boolean" &&
        (attempt.final_gates_verified !== true ||
          canonicalJson(verifiedIDs) === canonicalJson(order)),
      "final_receipt_attempt",
    );
    attemptIDs.add(attempt.attempt_id as string);
    if (attempt.status === "failed_or_uncertain") {
      exactKeys(
        attempt.failure,
        ["code", "at_checkpoint", "observed_at"],
        "final_receipt_failure",
      );
      const failure = attempt.failure as JsonRecord;
      requireCondition(
        typeof failure.code === "string" && /^[a-z0-9_]{1,64}$/.test(failure.code) &&
          typeof failure.at_checkpoint === "string" &&
          /^[a-z0-9_]{1,64}$/.test(failure.at_checkpoint) &&
          isTimestamp(failure.observed_at) && !sawCompleted,
        "final_receipt_failure",
      );
    } else {
      requireCondition(
        index === root.attempts.length - 1 && !sawCompleted &&
          attempt.checkpoint === "completed" && attempt.failure === null &&
          stage.attempted === true && stage.verified === true &&
          deploy.attempted === true && deploy.verified === true &&
          canonicalJson(attemptedIDs) === canonicalJson(order) &&
          canonicalJson(verifiedIDs) === canonicalJson(order) &&
          attempt.final_gates_verified === true,
        "final_receipt_completed_attempt",
      );
      sawCompleted = true;
    }
  }
  requireCondition(sawCompleted, "final_receipt_completed_attempt");

  exactKeys(root.final, FINAL_KEYS, "final_receipt_final");
  const final = root.final as JsonRecord;
  requireCondition(
    isTimestamp(final.completed_at) && isDigest(final.final_inventory_sha256) &&
      final.final_secret_status === "Deployed" &&
      final.runtime_verified_count === 4 && final.reserved_generation_rows === 0 &&
      final.authoritative_v2_rows === 0 && final.allowed_origins_count === 0,
    "final_receipt_final",
  );

  const roles: ReceiptRoles = {
    appMachineIDs: [...apps] as string[],
    thinkerPrimaryMachineID: primary as string,
    thinkerStandbyMachineID: standby as string,
    startedProbeOrder: [...order] as string[],
  };
  requireCondition(
    sha256(`${[
      ...roles.appMachineIDs,
      roles.thinkerPrimaryMachineID,
      roles.thinkerStandbyMachineID,
    ].sort().join("\n")}\n`) === scope.machine_set_sha256,
    "final_receipt_machine_set",
  );
  requireCondition(
    sha256(canonicalJson({
      app_machine_ids: roles.appMachineIDs,
      thinker_primary_machine_id: roles.thinkerPrimaryMachineID,
      thinker_standby_machine_id: roles.thinkerStandbyMachineID,
    })) === scope.role_map_sha256,
    "final_receipt_role_map",
  );

  return {
    raw: root,
    nonce: root.ceremony_nonce as string,
    operatorRevision: bindings.operator_revision as string,
    nativeSHA256: bindings.native_sha256 as string,
    roles,
    machineSetSHA256: scope.machine_set_sha256 as string,
    roleMapSHA256: scope.role_map_sha256 as string,
    baselineNonImageConfigSHA256:
      scope.baseline_non_image_config_sha256 as string,
    databaseTargetSHA256: interlock.database_target_sha256 as string,
  };
}

interface ProviderSecretProof {
  status: ProviderSecretStatus;
  materialSHA256: string;
}

function providerSecretStatus(raw: unknown): ProviderSecretProof {
  requireCondition(Array.isArray(raw) && raw.length <= 1024, "provider_secret_shape");
  const matches: JsonRecord[] = [];
  for (const entry of raw) {
    const record = requireRecord(entry, "provider_secret_shape");
    const hasUpperName = Object.prototype.hasOwnProperty.call(record, "Name");
    const hasLowerName = Object.prototype.hasOwnProperty.call(record, "name");
    const upperName = record.Name;
    const lowerName = record.name;
    requireCondition(
      hasUpperName !== hasLowerName,
      "provider_secret_shape",
    );
    const name = hasUpperName ? upperName : lowerName;
    requireCondition(typeof name === "string", "provider_secret_shape");
    requireCondition(name.length > 0 && name.length <= 256, "provider_secret_shape");
    if (name === GENERATION_SECRET) matches.push(record);
  }
  requireCondition(matches.length <= 1, "provider_secret_duplicate");
  if (matches.length === 0) {
    return { status: "Absent", materialSHA256: sha256(canonicalJson(null)) };
  }
  const match = matches[0];
  const hasUpperStatus = Object.prototype.hasOwnProperty.call(match, "Status");
  const hasLowerStatus = Object.prototype.hasOwnProperty.call(match, "status");
  const upperStatus = match.Status;
  const lowerStatus = match.status;
  requireCondition(
    hasUpperStatus !== hasLowerStatus,
    "provider_secret_shape",
  );
  const status = hasUpperStatus ? upperStatus : lowerStatus;
  requireCondition(typeof status === "string", "provider_secret_shape");
  requireCondition(status === "Deployed", "provider_secret_not_deployed");
  return { status: "Deployed", materialSHA256: sha256(canonicalJson(match)) };
}

function noSchedule(config: JsonRecord): boolean {
  const value = config.schedule;
  return value === undefined || value === null || value === "" ||
    (Array.isArray(value) && value.length === 0);
}

function stringArray(value: unknown, code: string): string[] {
  requireCondition(
    Array.isArray(value) && value.every((entry) => typeof entry === "string"),
    code,
  );
  return value as string[];
}

function standbys(machine: JsonRecord): string[] {
  const config = requireRecord(machine.config, "fleet_config");
  const value = config.standbys;
  if (value === undefined || value === null) return [];
  return stringArray(value, "fleet_standbys");
}

function requireRestart(machine: JsonRecord): void {
  const config = requireRecord(machine.config, "fleet_config");
  exactKeys(config.restart, ["max_retries", "policy"], "fleet_restart");
  const restart = config.restart as JsonRecord;
  requireCondition(
    restart.policy === "on-failure" && restart.max_retries === 10,
    "fleet_restart",
  );
}

function requireAppService(machine: JsonRecord): void {
  const config = requireRecord(machine.config, "fleet_config");
  requireCondition(
    Array.isArray(config.services) && config.services.length === 1,
    "fleet_app_service",
  );
  const service = requireRecord(config.services[0], "fleet_app_service");
  requireCondition(
    service.protocol === "tcp" && service.internal_port === 3000 &&
      service.autostart === true && [false, "off"].includes(service.autostop as never) &&
      service.min_machines_running === 1,
    "fleet_app_service",
  );
  requireCondition(Array.isArray(service.ports), "fleet_app_ports");
  const ports = service.ports.map((port) => requireRecord(port, "fleet_app_ports"));
  const port80 = ports.find((port) => port.port === 80);
  const port443 = ports.find((port) => port.port === 443);
  requireCondition(
    ports.length === 2 &&
      canonicalJson(port80?.handlers) === canonicalJson(["http"]) &&
      canonicalJson(port443?.handlers) === canonicalJson(["tls", "http"]),
    "fleet_app_ports",
  );
}

function cloneRecord(value: JsonRecord): JsonRecord {
  return structuredClone(value) as JsonRecord;
}

function nonImageConfig(machine: JsonRecord): JsonRecord {
  const config = cloneRecord(requireRecord(machine.config, "fleet_config"));
  delete config.image;
  if (
    config.standbys === undefined ||
    (Array.isArray(config.standbys) && config.standbys.length === 0)
  ) delete config.standbys;
  const environment = config.env;
  if (isRecord(environment) && environment.FLY_STANDBY_FOR === "") {
    delete environment.FLY_STANDBY_FOR;
  }
  return config;
}

interface FleetProof {
  materialCanonical: string;
  revision: string;
  runtimeMachineIDs: string[];
}

/** Narrow preactivation check: there is no completed receipt to authorize roles,
 * but all five extant Machines must still be unambiguous and free of a local
 * generation override before provider absence can count as fail-closed. */
function validateAbsentFleet(raw: unknown): string {
  requireCondition(Array.isArray(raw) && raw.length === 5, "absent_fleet_count");
  const machines = raw.map((entry) => requireRecord(entry, "absent_fleet_machine"));
  const ids = new Set<string>();
  for (const machine of machines) {
    requireCondition(isMachineID(machine.id) && !ids.has(machine.id), "absent_fleet_id");
    ids.add(machine.id);
    const config = requireRecord(machine.config, "absent_fleet_config");
    const environment = requireRecord(config.env, "absent_fleet_environment");
    requireCondition(
      !Object.prototype.hasOwnProperty.call(environment, GENERATION_SECRET),
      "absent_fleet_generation_override",
    );
  }
  return canonicalJson(
    machines
      .map((machine) => ({ id: machine.id, config: machine.config }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  );
}

function validateFleet(
  raw: unknown,
  receipt: CompletedReceipt,
  requestedRevision: string | null,
): FleetProof {
  requireCondition(Array.isArray(raw) && raw.length === 5, "fleet_count");
  const machines = raw.map((entry) => requireRecord(entry, "fleet_machine"));
  const byID = new Map<string, JsonRecord>();
  for (const machine of machines) {
    requireCondition(isMachineID(machine.id), "fleet_machine_id");
    requireCondition(!byID.has(machine.id), "fleet_duplicate_id");
    byID.set(machine.id, machine);
  }
  const expectedIDs = [
    ...receipt.roles.appMachineIDs,
    receipt.roles.thinkerPrimaryMachineID,
    receipt.roles.thinkerStandbyMachineID,
  ];
  requireCondition(
    canonicalJson([...byID.keys()].sort()) === canonicalJson([...expectedIDs].sort()),
    "fleet_id_set",
  );
  const appSet = new Set(receipt.roles.appMachineIDs);
  const imageReferences: string[] = [];
  const regionCounts = { lhr: 0, cdg: 0 };
  let observedRevision: string | null = null;
  for (const id of expectedIDs) {
    const machine = byID.get(id)!;
    const config = requireRecord(machine.config, "fleet_config");
    const environment = requireRecord(config.env, "fleet_environment");
    const isApp = appSet.has(id);
    requireCondition(machine.host_status === "ok", "fleet_host_status");
    requireCondition(
      typeof machine.instance_id === "string" && machine.instance_id.length > 0 &&
        machine.instance_id.length <= 256,
      "fleet_instance",
    );
    requireCondition(
      typeof machine.updated_at === "string" &&
        Number.isFinite(Date.parse(machine.updated_at)),
      "fleet_updated_at",
    );
    requireCondition(machine.cordoned === false, "fleet_cordoned");
    requireCondition(noSchedule(config), "fleet_schedule");
    requireRestart(machine);
    requireCondition(
      !Object.prototype.hasOwnProperty.call(environment, GENERATION_SECRET),
      "fleet_generation_override",
    );
    for (const name of ["DATABASE_URL", "DATABASE_SESSION_URL", "REDIS_URL"]) {
      requireCondition(
        !Object.prototype.hasOwnProperty.call(environment, name),
        "fleet_machine_override",
      );
    }
    requireCondition(environment.AGENTTOOL_DISABLE_WORKERS === "1", "fleet_worker_fence");
    const expectedCommand = isApp
      ? ["bun", "run", "src/index.ts"]
      : ["bun", "run", "src/thinker.ts"];
    const init = requireRecord(config.init, "fleet_command");
    requireCondition(
      canonicalJson(init.cmd) === canonicalJson(expectedCommand),
      "fleet_command",
    );
    const metadata = requireRecord(config.metadata, "fleet_role");
    requireCondition(
      metadata.fly_process_group === (isApp ? "app" : "thinker"),
      "fleet_role",
    );
    const guest = requireRecord(config.guest, "fleet_guest");
    requireCondition(
      guest.cpu_kind === "shared" && guest.cpus === 1 &&
        guest.memory_mb === (isApp ? 1024 : 256),
      "fleet_guest",
    );
    const image = requireRecord(machine.image_ref, "fleet_image");
    const labels = requireRecord(image.labels, "fleet_image");
    const imageRevision = labels["org.opencontainers.image.revision"];
    requireCondition(
      image.registry === "registry.fly.io" && image.repository === APP &&
        typeof image.tag === "string" && image.tag.length > 0 && image.tag.length <= 256 &&
        typeof image.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(image.digest) &&
        isRevision(imageRevision) && labels["dev.agenttool.source.dirty"] === "false",
      "fleet_image",
    );
    if (requestedRevision !== null) {
      requireCondition(imageRevision === requestedRevision, "fleet_revision");
    }
    if (observedRevision === null) observedRevision = imageRevision;
    requireCondition(observedRevision === imageRevision, "fleet_revision_uniform");
    imageReferences.push(canonicalJson(image));
    if (isApp) {
      requireCondition(machine.state === "started", "fleet_app_state");
      requireAppService(machine);
      requireCondition(machine.region === "lhr" || machine.region === "cdg", "fleet_app_region");
      regionCounts[machine.region] += 1;
      requireCondition(standbys(machine).length === 0, "fleet_app_standby");
      requireCondition(
        environment.FLY_STANDBY_FOR === undefined ||
          environment.FLY_STANDBY_FOR === "",
        "fleet_app_standby_env",
      );
    } else {
      const primary = id === receipt.roles.thinkerPrimaryMachineID;
      requireCondition(machine.state === (primary ? "started" : "stopped"), "fleet_thinker_state");
      requireCondition(machine.region === "lhr", "fleet_thinker_region");
      requireCondition(environment.AGENTOOL_ENABLE_THINKER === "1", "fleet_thinker_enable");
      requireCondition(
        !Array.isArray(config.services) || config.services.length === 0,
        "fleet_thinker_service",
      );
      const expectedStandbys = primary ? [] : [receipt.roles.thinkerPrimaryMachineID];
      requireCondition(
        canonicalJson(standbys(machine)) === canonicalJson(expectedStandbys),
        "fleet_thinker_standby",
      );
      requireCondition(
        (environment.FLY_STANDBY_FOR ?? "") ===
          (primary ? "" : receipt.roles.thinkerPrimaryMachineID),
        "fleet_thinker_standby_env",
      );
    }
  }
  requireCondition(regionCounts.lhr === 2 && regionCounts.cdg === 1, "fleet_app_regions");
  requireCondition(
    imageReferences.length === 5 &&
      imageReferences.every((value) => value === imageReferences[0]),
    "fleet_image_uniform",
  );
  const configProjection = [...expectedIDs].sort().map((id) => [
    id,
    nonImageConfig(byID.get(id)!),
  ]);
  requireCondition(
    sha256(canonicalJson(configProjection)) === receipt.baselineNonImageConfigSHA256,
    "fleet_receipt_config",
  );
  requireCondition(observedRevision !== null, "fleet_revision");
  const material = machines.map((machine) => ({
    id: machine.id,
    state: machine.state,
    region: machine.region,
    instance_id: machine.instance_id,
    updated_at: machine.updated_at,
    cordoned: machine.cordoned,
    host_status: machine.host_status,
    config: machine.config,
    image_ref: machine.image_ref,
  })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return {
    materialCanonical: canonicalJson(material),
    revision: observedRevision,
    runtimeMachineIDs: [...receipt.roles.startedProbeOrder],
  };
}

async function verifyPublicSurfaces(
  dependencies: PhaseBGuardDependencies,
  state: AuthorityState,
  expectedRevision: string | null,
): Promise<string> {
  let observedRevision: string | null = null;
  for (let round = 0; round < 3; round += 1) {
    const health = requireRecord(
      await dependencies.readPublicJson({ kind: "health", round, expectedRevision }),
      "public_health",
    );
    const build = requireRecord(health.build, "public_health");
    requireCondition(
      health.service === APP && health.status === "alive" &&
        isRevision(build.revision) && build.dirty === false &&
        health.covenant_v2_authority === state,
      "public_health",
    );
    if (expectedRevision !== null) {
      requireCondition(build.revision === expectedRevision, "public_health_revision");
    }
    if (observedRevision === null) observedRevision = build.revision;
    requireCondition(observedRevision === build.revision, "public_health_revision_drift");

    const about = requireRecord(
      await dependencies.readPublicJson({ kind: "about", round, expectedRevision }),
      "federation_about",
    );
    const federation = requireRecord(about.federation, "federation_about");
    const capabilities = requireRecord(about.capabilities, "federation_about");
    exactKeys(
      capabilities,
      ["inbox", "identity_resolution", "covenants", "wake_fragments"],
      "federation_capabilities",
    );
    requireCondition(
      about.protocol === "agenttool/federation/v1" &&
        about.covenant_v2_authority === state && federation.enabled === false &&
        federation.open === false && federation.instance_url === PRODUCTION_ORIGIN &&
        Array.isArray(federation.allowed_origins) &&
        federation.allowed_origins.length === 0 && capabilities.inbox === false &&
        capabilities.identity_resolution === false && capabilities.covenants === false &&
        capabilities.wake_fragments === false,
      "federation_about",
    );
    if (round < 2) await dependencies.pause(2_000);
  }
  requireCondition(observedRevision !== null, "public_health_revision");
  return observedRevision;
}

function sameAuthority(left: AuthoritySnapshot, right: AuthoritySnapshot): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function classifyState(
  authority: AuthoritySnapshot,
  receiptRaw: unknown | null,
  providerStatus: ProviderSecretStatus,
): AuthorityState {
  if (!authority.durableHold && receiptRaw === null && providerStatus === "Absent") {
    return "absent_fail_closed";
  }
  if (authority.durableHold && receiptRaw !== null && providerStatus === "Deployed") {
    return "configured";
  }
  return refuse("phase_b_mixed_state");
}

function proofFor(
  request: GuardRequest,
  state: AuthorityState,
): PhaseBDeployProof {
  return {
    allowed_origins_count: 0,
    authoritative_v2_rows: 0,
    durable_hold: state === "configured",
    fleet_verified: state === "configured",
    observed_revision: request.phase === "postflight" ? request.revision : null,
    phase: request.phase,
    provider_secret_status: state === "configured" ? "Deployed" : "Absent",
    reserved_generation_rows: 0,
    runtime_verified_count: state === "configured" ? 4 : 0,
    schema: PHASE_B_PROOF_SCHEMA,
    source_floor_verified: state === "configured",
    standby_bound: state === "configured",
    state,
  };
}

/** Exact public wire form consumed by deploy.sh. Proof keys are constructed in
 * lexical order above; standard JSON deliberately leaves the schema slash
 * unescaped, unlike the private ceremony receipt canonicalizer. */
export function serializePhaseBDeployProof(proof: PhaseBDeployProof): string {
  const keys = Object.keys(proof);
  requireCondition(
    keys.every((key, index) => index === 0 || keys[index - 1] < key),
    "proof_key_order",
  );
  return `${JSON.stringify(proof)}\n`;
}

/** Pure orchestration core. All filesystem, process, database, and HTTP effects are injected. */
export async function runPhaseBDeployGuard(
  request: GuardRequest,
  dependencies: PhaseBGuardDependencies,
): Promise<PhaseBDeployProof> {
  requireCondition(
    (request.phase === "preflight" && request.revision === null) ||
      (request.phase === "postflight" && isRevision(request.revision)),
    "invalid_invocation",
  );
  try {
    const authorityBefore = validateAuthoritySnapshot(
      await dependencies.readAuthoritySnapshot(),
    );
    const receiptBeforeRaw = await dependencies.readFinalReceipt();
    const providerBefore = providerSecretStatus(
      await dependencies.readProviderSecretInventory(),
    );
    const state = classifyState(authorityBefore, receiptBeforeRaw, providerBefore.status);

    if (state === "absent_fail_closed") {
      const absentFleetBefore = validateAbsentFleet(
        await dependencies.readFleetInventory(),
      );
      const publicRevision = await verifyPublicSurfaces(
        dependencies,
        state,
        request.revision,
      );
      if (request.revision !== null) {
        requireCondition(publicRevision === request.revision, "public_health_revision");
      }
      const authorityAfter = validateAuthoritySnapshot(
        await dependencies.readAuthoritySnapshot(),
      );
      const receiptAfter = await dependencies.readFinalReceipt();
      const providerAfter = providerSecretStatus(
        await dependencies.readProviderSecretInventory(),
      );
      const absentFleetAfter = validateAbsentFleet(
        await dependencies.readFleetInventory(),
      );
      requireCondition(
        sameAuthority(authorityBefore, authorityAfter) &&
          receiptAfter === null && providerAfter.status === "Absent" &&
          providerAfter.materialSHA256 === providerBefore.materialSHA256 &&
          absentFleetAfter === absentFleetBefore,
        "phase_b_state_drift",
      );
      return proofFor(request, state);
    }

    const receipt = validateCompletedReceipt(receiptBeforeRaw);
    requireCondition(
      receipt.databaseTargetSHA256 === authorityBefore.databaseTargetSHA256,
      "final_receipt_database_target",
    );
    const firstFleet = validateFleet(
      await dependencies.readFleetInventory(),
      receipt,
      request.revision,
    );
    requireCondition(
      await dependencies.isRevisionDescendantOfFloor(receipt.operatorRevision) &&
        await dependencies.isRevisionDescendantOfFloor(firstFleet.revision),
      "source_floor",
    );
    for (const machineID of firstFleet.runtimeMachineIDs) {
      await dependencies.verifyDeployedRuntime({
        machineID,
        receiptNonce: receipt.nonce,
        revision: firstFleet.revision,
      });
    }
    const publicRevision = await verifyPublicSurfaces(
      dependencies,
      state,
      firstFleet.revision,
    );
    requireCondition(publicRevision === firstFleet.revision, "public_health_revision");

    const providerAfter = providerSecretStatus(
      await dependencies.readProviderSecretInventory(),
    );
    const secondFleet = validateFleet(
      await dependencies.readFleetInventory(),
      receipt,
      request.revision,
    );
    const receiptAfterRaw = await dependencies.readFinalReceipt();
    const receiptAfter = validateCompletedReceipt(receiptAfterRaw);
    const authorityAfter = validateAuthoritySnapshot(
      await dependencies.readAuthoritySnapshot(),
    );
    requireCondition(
      providerAfter.status === "Deployed" &&
        providerAfter.materialSHA256 === providerBefore.materialSHA256 &&
        firstFleet.materialCanonical === secondFleet.materialCanonical &&
        firstFleet.revision === secondFleet.revision &&
        canonicalJson(receipt.raw) === canonicalJson(receiptAfter.raw) &&
        sameAuthority(authorityBefore, authorityAfter),
      "phase_b_state_drift",
    );
    return proofFor(request, state);
  } finally {
    await dependencies.close();
  }
}

export function parseGuardArguments(arguments_: readonly string[]): GuardRequest {
  if (arguments_.length === 1 && arguments_[0] === "preflight") {
    return { phase: "preflight", revision: null };
  }
  if (
    arguments_.length === 3 && arguments_[0] === "postflight" &&
    arguments_[1] === "--revision" && isRevision(arguments_[2])
  ) {
    return { phase: "postflight", revision: arguments_[2] };
  }
  return refuse("invalid_invocation");
}

export const AUTHORITY_ROW_SQL = `
  SELECT
    (SELECT count(*) FROM federation.settings) AS settings_rows,
    (SELECT id FROM federation.settings LIMIT 1) AS federation_id,
    (SELECT enabled FROM federation.settings LIMIT 1) AS federation_enabled,
    (SELECT instance_url = 'https://api.agenttool.dev'
       FROM federation.settings LIMIT 1) AS federation_instance_url_exact,
    (SELECT cardinality(allowed_origins)
       FROM federation.settings LIMIT 1) AS federation_allowed_origins_count,
    (SELECT covenant_v2_generation_hold FROM federation.settings LIMIT 1)
      AS covenant_v2_generation_hold,
    (SELECT count(*)
       FROM pg_catalog.pg_attribute AS attribute
       JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'federation'
        AND relation.relname = 'settings'
        AND relation.relkind IN ('r', 'p')
        AND attribute.attname = 'covenant_v2_generation_hold'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped) AS hold_column_count,
    (SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
       FROM pg_catalog.pg_attribute AS attribute
       JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'federation'
        AND relation.relname = 'settings'
        AND relation.relkind IN ('r', 'p')
        AND attribute.attname = 'covenant_v2_generation_hold'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped) AS hold_column_type,
    (SELECT attribute.attnotnull
       FROM pg_catalog.pg_attribute AS attribute
       JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'federation'
        AND relation.relname = 'settings'
        AND relation.relkind IN ('r', 'p')
        AND attribute.attname = 'covenant_v2_generation_hold'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped) AS hold_column_not_null,
    (SELECT pg_catalog.pg_get_expr(
              default_value.adbin, default_value.adrelid, true
            ) = 'false'
       FROM pg_catalog.pg_attribute AS attribute
       JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       LEFT JOIN pg_catalog.pg_attrdef AS default_value
         ON default_value.adrelid = attribute.attrelid
        AND default_value.adnum = attribute.attnum
      WHERE namespace.nspname = 'federation'
        AND relation.relname = 'settings'
        AND relation.relkind IN ('r', 'p')
        AND attribute.attname = 'covenant_v2_generation_hold'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped) AS hold_column_default_exact,
    (SELECT count(*)
       FROM pg_catalog.pg_constraint AS constraint_record
       JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'federation'
        AND relation.relname = 'settings'
        AND relation.relkind IN ('r', 'p')
        AND constraint_record.conname =
          'federation_settings_covenant_v2_generation_hold_empty'
        AND constraint_record.contype = 'c'
        AND constraint_record.convalidated) AS hold_constraint_count,
    (SELECT pg_catalog.pg_get_constraintdef(constraint_record.oid, true) =
              'CHECK (NOT covenant_v2_generation_hold OR cardinality(allowed_origins) = 0)'
       FROM pg_catalog.pg_constraint AS constraint_record
       JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'federation'
        AND relation.relname = 'settings'
        AND relation.relkind IN ('r', 'p')
        AND constraint_record.conname =
          'federation_settings_covenant_v2_generation_hold_empty'
        AND constraint_record.contype = 'c'
        AND constraint_record.convalidated) AS hold_constraint_definition_exact,
    (SELECT count(*) FROM agent_continuity.covenants
      WHERE protocol_version = 'v2'
        AND metadata ? 'agenttool.internal.v2_authority_generation')
      AS reserved_generation_rows,
    (SELECT count(*) FROM agent_continuity.covenants
      WHERE protocol_version = 'v2'
        AND metadata ? 'agenttool.internal.v2_authority_generation'
        AND nullif(metadata ->> 'agenttool.internal.v2_initiator_wire_did', '') IS NOT NULL
        AND nullif(metadata ->> 'agenttool.internal.v2_recipient_wire_did', '') IS NOT NULL
        AND ((received_from_instance IS NULL AND
              metadata ->> 'agenttool.internal.v2_recipient_wire_did' = counterparty_did)
          OR (received_from_instance IS NOT NULL AND
              metadata ->> 'agenttool.internal.v2_initiator_wire_did' = counterparty_did)))
      AS authoritative_v2_rows
`;

interface ChildResult {
  exitCode: number;
  stdout: Uint8Array;
}

let productionInterrupted: "SIGINT" | "SIGTERM" | null = null;
let activeProductionChild: any = null;
let activeProductionChildKind: "detached" | "native" | null = null;
let activeFetchAbort: AbortController | null = null;
let interruptHardKill: ReturnType<typeof setTimeout> | null = null;

function throwIfProductionInterrupted(): void {
  if (productionInterrupted) refuse("interrupted");
}

function requestProductionInterrupt(signal: "SIGINT" | "SIGTERM"): void {
  productionInterrupted ??= signal;
  activeFetchAbort?.abort();
  if (!activeProductionChild || activeProductionChildKind !== "detached") return;
  const pid = Number(activeProductionChild.pid);
  signalProcessGroup(pid, "SIGTERM");
  if (interruptHardKill) clearTimeout(interruptHardKill);
  interruptHardKill = setTimeout(() => signalProcessGroup(pid, "SIGKILL"), 2_000);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        complete = true;
        break;
      }
      total += result.value.byteLength;
      requireCondition(total <= maximumBytes, "child_output_bound");
      chunks.push(result.value);
    }
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // Refusal below remains authoritative.
      }
    }
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(isRecord(error) && error.code === "ESRCH");
  }
}

function signalProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Settlement check below decides whether the group is gone.
  }
}

async function terminateAndSettle(child: any): Promise<void> {
  const pid = Number(child.pid);
  signalProcessGroup(pid, "SIGTERM");
  await Promise.race([
    Promise.resolve(child.exited).catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (processGroupExists(pid)) signalProcessGroup(pid, "SIGKILL");
  try {
    await child.exited;
  } catch {
    // Settlement, not the direct wait error, is the relevant final fact.
  }
  const deadline = Date.now() + 2_000;
  while (processGroupExists(pid) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  requireCondition(!processGroupExists(pid), "child_tree_not_settled");
}

/** @internal Exported for focused process-boundary regression tests. */
export async function runBoundedReadOnlyChildForTest(
  argv: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    maximumBytes: number;
    timeoutMilliseconds: number;
  },
): Promise<ChildResult> {
  throwIfProductionInterrupted();
  requireCondition(activeProductionChild === null, "child_overlap");
  const child = Bun.spawn([...argv], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  activeProductionChild = child;
  activeProductionChildKind = "detached";
  let timedOut = false;
  let hardKill: ReturnType<typeof setTimeout> | null = null;
  const timer = setTimeout(() => {
    timedOut = true;
    signalProcessGroup(Number(child.pid), "SIGTERM");
    hardKill = setTimeout(
      () => signalProcessGroup(Number(child.pid), "SIGKILL"),
      2_000,
    );
  }, options.timeoutMilliseconds);
  try {
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      readBoundedStream(child.stdout, options.maximumBytes),
      readBoundedStream(child.stderr, options.maximumBytes),
    ]);
    if (timedOut || processGroupExists(Number(child.pid))) {
      await terminateAndSettle(child);
      refuse(timedOut ? "child_timeout" : "child_descendant_survived");
    }
    throwIfProductionInterrupted();
    return { exitCode, stdout };
  } catch (error) {
    await terminateAndSettle(child);
    if (error instanceof PhaseBGuardError) throw error;
    return refuse("child_failed");
  } finally {
    clearTimeout(timer);
    if (hardKill) clearTimeout(hardKill);
    if (interruptHardKill) {
      clearTimeout(interruptHardKill);
      interruptHardKill = null;
    }
    if (activeProductionChild === child) {
      activeProductionChild = null;
      activeProductionChildKind = null;
    }
  }
}

/** The signed native boundary owns its own 30-second Fly timeout and group settlement. */
async function runNativeSilently(argv: readonly string[], environment: Record<string, string>): Promise<void> {
  throwIfProductionInterrupted();
  requireCondition(activeProductionChild === null, "child_overlap");
  const child = Bun.spawn([...argv], {
    cwd: "/",
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  activeProductionChild = child;
  activeProductionChildKind = "native";
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      readBoundedStream(child.stdout, 4_096),
      readBoundedStream(child.stderr, 4_096),
    ]);
    requireCondition(
      exitCode === 0 && stdout.byteLength === 0 && stderr.byteLength === 0,
      "native_runtime_verification",
    );
    throwIfProductionInterrupted();
  } catch (error) {
    // The attested native process deliberately ignores TERM while its secret-
    // bearing Fly child is live, and settles that group before it returns.
    try {
      await child.exited;
    } catch {
      // Emit only the fixed refusal at the CLI boundary.
    }
    if (error instanceof PhaseBGuardError) throw error;
    refuse("native_runtime_verification");
  } finally {
    if (activeProductionChild === child) {
      activeProductionChild = null;
      activeProductionChildKind = null;
    }
  }
}

function decodeUtf8(bytes: Uint8Array, code: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refuse(code);
  }
}

function parseJsonBytes(bytes: Uint8Array, code: string): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes, code));
  } catch (error) {
    if (error instanceof PhaseBGuardError) throw error;
    return refuse(code);
  }
}

function requirePrivateDirectory(path: string): void {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    return refuse("private_directory_unavailable");
  }
  requireCondition(
    metadata.isDirectory() && !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.() && (metadata.mode & 0o777) === 0o700 &&
      realpathSync(path) === path,
    "private_directory_contract",
  );
}

function pathAbsent(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return true;
    return refuse("private_path_lookup");
  }
}

/** @internal Shared by the production receipt/config reader and boundary tests. */
export function readStablePrivateFileForGuard(
  path: string,
  maximumBytes: number,
): Uint8Array {
  let before;
  try {
    before = lstatSync(path);
  } catch {
    return refuse("private_file_unavailable");
  }
  requireCondition(
    before.isFile() && !before.isSymbolicLink() && before.uid === process.getuid?.() &&
      before.nlink === 1 && (before.mode & 0o777) === 0o600 &&
      before.size > 0 && before.size <= maximumBytes,
    "private_file_contract",
  );
  let descriptor = -1;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    requireCondition(
      opened.isFile() && opened.dev === before.dev && opened.ino === before.ino &&
        opened.uid === before.uid && opened.nlink === 1 &&
        (opened.mode & 0o777) === 0o600 && opened.size === before.size,
      "private_file_changed",
    );
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    requireCondition(
      after.dev === opened.dev && after.ino === opened.ino && after.uid === opened.uid &&
        after.nlink === 1 && (after.mode & 0o777) === 0o600 &&
        after.size === opened.size && bytes.byteLength === opened.size &&
        pathAfter.isFile() && !pathAfter.isSymbolicLink() &&
        pathAfter.dev === opened.dev && pathAfter.ino === opened.ino &&
        pathAfter.uid === opened.uid && pathAfter.nlink === 1 &&
        (pathAfter.mode & 0o777) === 0o600 && pathAfter.size === opened.size,
      "private_file_changed",
    );
    return bytes;
  } catch (error) {
    if (error instanceof PhaseBGuardError) throw error;
    return refuse("private_file_read");
  } finally {
    if (descriptor >= 0) closeSync(descriptor);
  }
}

/** @internal Canonical private JSON reader used by the completed receipt path. */
export function readCanonicalPrivateJsonFileForGuard(
  path: string,
  maximumBytes = MAX_RECEIPT_BYTES,
): unknown {
  const bytes = readStablePrivateFileForGuard(path, maximumBytes);
  requireCondition(bytes.at(-1) === 0x0a, "private_json_canonical");
  const text = decodeUtf8(bytes, "private_json_utf8");
  const value = parseJsonBytes(bytes, "private_json_parse");
  requireCondition(`${canonicalJson(value)}\n` === text, "private_json_canonical");
  return value;
}

function requireRootOwnedArtifact(path: string, exactBytes?: number): Uint8Array {
  for (const directory of [
    "/usr", "/usr/local", "/usr/local/libexec", "/usr/local/libexec/agenttool",
    "/usr/local/libexec/agenttool/phase-b-v1",
  ]) {
    const metadata = lstatSync(directory);
    requireCondition(
      metadata.isDirectory() && !metadata.isSymbolicLink() && metadata.uid === 0 &&
        metadata.gid === 0 && (metadata.mode & 0o777) === 0o755,
      "artifact_directory_contract",
    );
  }
  const metadata = lstatSync(path);
  requireCondition(
    metadata.isFile() && !metadata.isSymbolicLink() && metadata.uid === 0 &&
      metadata.gid === 0 && metadata.nlink === 1 &&
      (metadata.mode & 0o777) === 0o555 && metadata.size > 0 &&
      (exactBytes === undefined ? metadata.size <= 50_000_000 : metadata.size === exactBytes),
    "artifact_file_contract",
  );
  return readFileSync(path);
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  requireCondition(response.body !== null, "public_body");
  return readBoundedStream(response.body, maximumBytes);
}

export function buildPhaseBClosedChildEnvironment(
  home: string,
  identity: { user: string; logname: string } = {
    user: process.env.USER ?? "",
    logname: process.env.LOGNAME ?? process.env.USER ?? "",
  },
): Record<string, string> {
  const username = identity.user;
  const logname = identity.logname;
  requireCondition(
    /^[A-Za-z0-9._-]{1,64}$/.test(username) && logname === username,
    "local_identity",
  );
  return {
    HOME: home,
    USER: username,
    LOGNAME: logname,
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    TERM: "dumb",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  };
}

export async function createProductionDependencies(): Promise<PhaseBGuardDependencies> {
  const userHome = homedir();
  requireCondition(
    userHome === PRODUCTION_OPERATOR_HOME &&
      process.env.HOME === PRODUCTION_OPERATOR_HOME &&
      process.env.USER === PRODUCTION_OPERATOR_NAME &&
      process.env.LOGNAME === PRODUCTION_OPERATOR_NAME &&
      process.getuid?.() === PRODUCTION_OPERATOR_UID &&
      realpathSync(userHome) === PRODUCTION_OPERATOR_HOME,
    "canonical_home",
  );
  const deployState = join(userHome, ".local/state/agenttool/deploy-state");
  const activeMarker = join(userHome, ACTIVE_MARKER_RELATIVE_PATH);
  const finalReceipt = join(userHome, FINAL_RECEIPT_RELATIVE_PATH);
  const flyHome = join(userHome, ".local/state/agenttool/phase-b/fly-home");
  requirePrivateDirectory(deployState);
  requirePrivateDirectory(flyHome);
  requirePrivateDirectory(join(flyHome, ".fly"));
  readStablePrivateFileForGuard(join(flyHome, ".fly/config.yml"), 65_536);
  requireCondition(pathAbsent(activeMarker), "active_marker_present");
  const flyBytes = requireRootOwnedArtifact(FLY_PATH, FLY_BYTE_COUNT);
  requireCondition(sha256(flyBytes) === FLY_SHA256, "fly_artifact_hash");
  requireCondition(
    canonicalJson([...flyBytes.slice(0, 8)]) ===
      canonicalJson([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]),
    "fly_artifact_architecture",
  );

  const flyEnvironment = buildPhaseBClosedChildEnvironment(flyHome);
  const nativeEnvironment = buildPhaseBClosedChildEnvironment(userHome);
  let database: any = null;
  let databaseTargetSHA256: string | null = null;

  const ensureDatabase = async (): Promise<any> => {
    if (database) return database;
    const transactionURL = process.env.DATABASE_URL ?? "";
    const sessionURL = process.env.DATABASE_SESSION_URL ?? "";
    requireCondition(transactionURL.length > 0 && sessionURL.length > 0, "database_credentials");
    try {
      // Computed local module locators keep this standalone bin program from
      // pulling the whole API graph into its focused TypeScript check.
      const targetModulePath = "../api/src/db/supabase-target.ts";
      const postgresModulePath = "../api/src/db/verified-postgres.ts";
      const [{ validateFlyDatabaseTargets }, postgresModule] = await Promise.all([
        import(targetModulePath),
        import(postgresModulePath),
      ]);
      const target = validateFlyDatabaseTargets(transactionURL, sessionURL);
      databaseTargetSHA256 = sha256(canonicalJson(target));
      database = postgresModule.default(sessionURL, {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 30,
        max_lifetime: 120,
        onnotice: () => {},
        connection: { application_name: "agenttool_phase_b_deploy_guard_v1" },
      });
      return database;
    } catch (error) {
      if (error instanceof PhaseBGuardError) throw error;
      return refuse("database_target_or_tls_verification");
    }
  };

  const readAuthoritySnapshot = async (): Promise<unknown> => {
    throwIfProductionInterrupted();
    const sql = await ensureDatabase();
    let outerTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const query = sql.begin(
        "read only isolation level repeatable read",
        async (transaction: any) => {
          await transaction.unsafe("SET LOCAL statement_timeout = 15000");
          await transaction.unsafe("SET LOCAL lock_timeout = 5000");
          await transaction.unsafe("SET LOCAL idle_in_transaction_session_timeout = 30000");
          const rows = await transaction.unsafe(AUTHORITY_ROW_SQL);
          requireCondition(rows.length === 1, "database_authority_shape");
          return {
            ...rows[0],
            database_target_sha256: databaseTargetSHA256,
          };
        },
      );
      const result = await Promise.race([
        query,
        new Promise<never>((_, reject) =>
          outerTimer = setTimeout(
            () => reject(new PhaseBGuardError("database_outer_timeout")),
            20_000,
          )
        ),
      ]);
      throwIfProductionInterrupted();
      return result;
    } catch (error) {
      if (error instanceof PhaseBGuardError) throw error;
      return refuse("database_authority_query");
    } finally {
      if (outerTimer) clearTimeout(outerTimer);
    }
  };

  const readFinalReceipt = async (): Promise<unknown | null> => {
    throwIfProductionInterrupted();
    requireCondition(pathAbsent(activeMarker), "active_marker_present");
    if (pathAbsent(finalReceipt)) {
      requireCondition(pathAbsent(activeMarker), "active_marker_present");
      return null;
    }
    const value = readCanonicalPrivateJsonFileForGuard(
      finalReceipt,
      MAX_RECEIPT_BYTES,
    );
    requireCondition(pathAbsent(activeMarker), "active_marker_present");
    throwIfProductionInterrupted();
    return value;
  };

  const runFlyJson = async (arguments_: readonly string[], maximumBytes: number): Promise<unknown> => {
    throwIfProductionInterrupted();
    const result = await runBoundedReadOnlyChildForTest(
      [FLY_PATH, ...arguments_],
      {
        cwd: "/",
        env: flyEnvironment,
        maximumBytes,
        timeoutMilliseconds: 30_000,
      },
    );
    requireCondition(result.exitCode === 0, "fly_read_failed");
    throwIfProductionInterrupted();
    return parseJsonBytes(result.stdout, "fly_json");
  };

  return {
    readAuthoritySnapshot,
    readFinalReceipt,
    readProviderSecretInventory: () =>
      runFlyJson(
        ["secrets", "list", "--json", "--app", APP],
        MAX_FLY_SECRET_BYTES,
      ),
    readFleetInventory: () =>
      runFlyJson(
        ["machine", "list", "--app", APP, "--json"],
        MAX_FLY_MACHINE_BYTES,
      ),
    verifyDeployedRuntime: async (request) => {
      throwIfProductionInterrupted();
      const receipt = await readFinalReceipt();
      const completed = validateCompletedReceipt(receipt);
      requireCondition(completed.nativeSHA256 === sha256(requireRootOwnedArtifact(NATIVE_PATH)), "native_artifact_hash");
      await runNativeSilently(
        [
          NATIVE_PATH,
          "verify-deployed-fly",
          "--receipt-nonce",
          request.receiptNonce,
          "--revision",
          request.revision,
          "--machine",
          request.machineID,
        ],
        nativeEnvironment,
      );
      throwIfProductionInterrupted();
    },
    isRevisionDescendantOfFloor: async (revision) => {
      requireCondition(isRevision(revision), "source_revision");
      const result = await runBoundedReadOnlyChildForTest(
        [
          "/usr/bin/git", "-c", "core.fsmonitor=false", "-c",
          "core.untrackedCache=false", "merge-base", "--is-ancestor",
          PHASE_B_SOURCE_FLOOR, revision,
        ],
        {
          cwd: REPOSITORY_ROOT,
          env: {
            ...buildPhaseBClosedChildEnvironment(userHome),
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_OPTIONAL_LOCKS: "0",
            GIT_PAGER: "cat",
            GIT_TERMINAL_PROMPT: "0",
          },
          maximumBytes: 4_096,
          timeoutMilliseconds: 15_000,
        },
      );
      requireCondition(result.exitCode === 0 || result.exitCode === 1, "source_floor_query");
      return result.exitCode === 0;
    },
    readPublicJson: async ({ kind, round, expectedRevision }) => {
      throwIfProductionInterrupted();
      const base = kind === "health" ? HEALTH_URL : FEDERATION_ABOUT_URL;
      const url = new URL(base);
      url.searchParams.set("phase_b_guard", `${round + 1}`);
      if (expectedRevision !== null) url.searchParams.set("revision", expectedRevision);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      activeFetchAbort = controller;
      try {
        const response = await fetch(url, {
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: { accept: "application/json", "cache-control": "no-cache" },
        });
        requireCondition(response.status === 200, "public_http_status");
        const result = parseJsonBytes(
          await readBoundedResponse(response, MAX_PUBLIC_BYTES),
          "public_json",
        );
        throwIfProductionInterrupted();
        return result;
      } catch (error) {
        if (error instanceof PhaseBGuardError) throw error;
        return refuse("public_read_failed");
      } finally {
        clearTimeout(timeout);
        if (activeFetchAbort === controller) activeFetchAbort = null;
      }
    },
    pause: (milliseconds) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    close: async () => {
      if (!database) return;
      const client = database;
      database = null;
      let closeTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          client.end({ timeout: 2 }),
          new Promise((_, reject) =>
            closeTimer = setTimeout(
              () => reject(new Error("database close timeout")),
              5_000,
            )
          ),
        ]);
      } catch {
        try {
          await client.end({ timeout: 0 });
        } catch {
          // The fixed close refusal below remains authoritative.
        }
        refuse("database_close");
      } finally {
        if (closeTimer) clearTimeout(closeTimer);
      }
    },
  };
}

function rejectSensitiveAmbientOverrides(): void {
  const forbiddenExact = new Set([
    GENERATION_SECRET,
    "BUN_CONFIG_CA",
    "BUN_CONFIG_CONNECT_TO",
    "BUN_CONFIG_TLS_REJECT_UNAUTHORIZED",
    "BUN_BE_BUN",
    "BUN_OPTIONS",
    "BUN_PRELOAD",
    "BASH_ENV",
    "CURL_CA_BUNDLE",
    "ENV",
    "FLY_ACCESS_TOKEN",
    "HOSTALIASES",
    "LOCALDOMAIN",
    "NODE_EXTRA_CA_CERTS",
    "NODE_DEBUG",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "REQUESTS_CA_BUNDLE",
    "RES_OPTIONS",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SSLKEYLOGFILE",
  ]);
  for (const rawName of Object.keys(process.env)) {
    const name = rawName.toUpperCase();
    requireCondition(
      !forbiddenExact.has(name) && !name.endsWith("_PROXY") &&
        !name.startsWith("DYLD_") && !name.startsWith("LD_") &&
        !/^PG(?:CHANNELBINDING|DATABASE|HOST|HOSTADDR|PASSFILE|PASSWORD|PORT|SERVICE|SERVICEFILE|SSL|TARGET_SESSION_ATTRS|USER)/.test(name),
      "ambient_override",
    );
  }
}

async function main(): Promise<void> {
  let dependencies: PhaseBGuardDependencies | null = null;
  const onInterrupt = () => requestProductionInterrupt("SIGINT");
  const onTermination = () => requestProductionInterrupt("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTermination);
  try {
    const request = parseGuardArguments(process.argv.slice(2));
    rejectSensitiveAmbientOverrides();
    dependencies = await createProductionDependencies();
    const proof = await runPhaseBDeployGuard(request, dependencies);
    dependencies = null;
    throwIfProductionInterrupted();
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTermination);
    process.stdout.write(serializePhaseBDeployProof(proof));
  } catch (error) {
    if (dependencies) {
      try {
        await dependencies.close();
      } catch {
        // The fixed refusal remains the only emitted detail.
      }
    }
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTermination);
    const invalid = error instanceof PhaseBGuardError &&
      error.code === "invalid_invocation";
    process.stderr.write(
      invalid
        ? "phase_b_deploy_guard_invalid_invocation\n"
        : "phase_b_deploy_guard_refused\n",
    );
    process.exit(invalid ? 64 : 74);
  }
}

if (import.meta.main) await main();
