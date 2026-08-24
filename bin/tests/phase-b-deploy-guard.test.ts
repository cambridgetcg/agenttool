import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  buildPhaseBClosedChildEnvironment,
  canonicalJson,
  parseGuardArguments,
  PHASE_B_PROOF_SCHEMA,
  PHASE_B_SOURCE_FLOOR,
  PhaseBGuardError,
  readCanonicalPrivateJsonFileForGuard,
  readStablePrivateFileForGuard,
  runBoundedReadOnlyChildForTest,
  runPhaseBDeployGuard,
  serializePhaseBDeployProof,
  type GuardRequest,
  type PhaseBGuardDependencies,
  type PublicReadRequest,
  type RuntimeVerificationRequest,
} from "../phase-b-deploy-guard";

const GENERATION_SECRET =
  "AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION";
const REVISION = "b".repeat(40);
const DATABASE_TARGET_SHA256 = "d".repeat(64);
const NATIVE_SHA256 = "e".repeat(64);
const TIMESTAMP = "2026-08-24T12:00:00.000Z";
const APP_IDS = ["11111111111111", "22222222222222", "33333333333333"];
const THINKER_PRIMARY = "44444444444444";
const THINKER_STANDBY = "55555555555555";
const STARTED_IDS = [...APP_IDS, THINKER_PRIMARY];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function image(revision = REVISION) {
  return {
    registry: "registry.fly.io",
    repository: "agenttool",
    tag: `deployment-${revision}`,
    digest: `sha256:${"a".repeat(64)}`,
    labels: {
      "dev.agenttool.source.dirty": "false",
      "org.opencontainers.image.revision": revision,
    },
  };
}

function appConfig() {
  return {
    env: { AGENTTOOL_DISABLE_WORKERS: "1" },
    init: { cmd: ["bun", "run", "src/index.ts"] },
    metadata: { fly_process_group: "app" },
    guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
    restart: { max_retries: 10, policy: "on-failure" },
    services: [{
      protocol: "tcp",
      internal_port: 3000,
      autostart: true,
      autostop: false,
      min_machines_running: 1,
      ports: [
        { handlers: ["http"], port: 80 },
        { handlers: ["tls", "http"], port: 443 },
      ],
    }],
  };
}

function thinkerConfig(standby: boolean) {
  return {
    env: {
      AGENTTOOL_DISABLE_WORKERS: "1",
      AGENTOOL_ENABLE_THINKER: "1",
      ...(standby ? { FLY_STANDBY_FOR: THINKER_PRIMARY } : {}),
    },
    init: { cmd: ["bun", "run", "src/thinker.ts"] },
    metadata: { fly_process_group: "thinker" },
    guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
    restart: { max_retries: 10, policy: "on-failure" },
    ...(standby ? { standbys: [THINKER_PRIMARY] } : {}),
    services: [],
  };
}

function fleet(revision = REVISION) {
  return [
    ...APP_IDS.map((id, index) => ({
      id,
      state: "started",
      region: index === 1 ? "cdg" : "lhr",
      instance_id: `instance-app-${index}`,
      updated_at: TIMESTAMP,
      cordoned: false,
      host_status: "ok",
      config: appConfig(),
      image_ref: image(revision),
    })),
    {
      id: THINKER_PRIMARY,
      state: "started",
      region: "lhr",
      instance_id: "instance-thinker-primary",
      updated_at: TIMESTAMP,
      cordoned: false,
      host_status: "ok",
      config: thinkerConfig(false),
      image_ref: image(revision),
    },
    {
      id: THINKER_STANDBY,
      state: "stopped",
      region: "lhr",
      instance_id: "instance-thinker-standby",
      updated_at: TIMESTAMP,
      cordoned: false,
      host_status: "ok",
      config: thinkerConfig(true),
      image_ref: image(revision),
    },
  ];
}

function normalizedConfig(machine: ReturnType<typeof fleet>[number]) {
  const config = clone(machine.config) as Record<string, unknown>;
  delete config.image;
  if (
    config.standbys === undefined ||
    (Array.isArray(config.standbys) && config.standbys.length === 0)
  ) delete config.standbys;
  const environment = config.env as Record<string, unknown>;
  if (environment.FLY_STANDBY_FOR === "") delete environment.FLY_STANDBY_FOR;
  return config;
}

function configuredReceipt(machineFleet = fleet()) {
  const byID = new Map(machineFleet.map((machine) => [machine.id, machine]));
  const allIDs = [...APP_IDS, THINKER_PRIMARY, THINKER_STANDBY];
  const configProjection = [...allIDs].sort().map((id) => [
    id,
    normalizedConfig(byID.get(id)!),
  ]);
  const roleMap = {
    app_machine_ids: APP_IDS,
    thinker_primary_machine_id: THINKER_PRIMARY,
    thinker_standby_machine_id: THINKER_STANDBY,
  };
  return {
    schema: "agenttool.covenant-v2-generation-ceremony/1",
    status: "completed",
    checkpoint: "completed",
    ceremony_nonce: "c".repeat(32),
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    bindings: {
      operator_revision: REVISION,
      operator_source_sha256: "1".repeat(64),
      native_sha256: NATIVE_SHA256,
      native_cdhash: "2".repeat(40),
      native_team_id: "ABCDEFGHIJ",
      native_designated_requirement_sha256: "3".repeat(64),
      flyctl_sha256:
        "7e919b0f42867e33d736398ba151ed00f2bfb577bf9424fbe57573bfee9ae1b3",
      phase_a_resume_receipt_sha256: "4".repeat(64),
    },
    scope: {
      machine_set_sha256: sha256(`${[...allIDs].sort().join("\n")}\n`),
      role_map_sha256: sha256(canonicalJson(roleMap)),
      app_machine_ids: APP_IDS,
      thinker_primary_machine_id: THINKER_PRIMARY,
      thinker_standby_machine_id: THINKER_STANDBY,
      started_probe_order: STARTED_IDS,
      baseline_inventory_sha256: "5".repeat(64),
      baseline_non_image_config_sha256: sha256(canonicalJson(configProjection)),
      image_ref_sha256: "6".repeat(64),
      deployed_revision: REVISION,
    },
    interlock: {
      row_id: 1,
      durable_hold_verified: true,
      allowed_origins_count: 0,
      instance_url_sha256: sha256("https://api.agenttool.dev"),
      database_target_sha256: DATABASE_TARGET_SHA256,
    },
    generation: { create_attempted: true, create_verified: true },
    attempts: [{
      attempt_id: "7".repeat(32),
      status: "completed",
      checkpoint: "completed",
      started_at: TIMESTAMP,
      updated_at: TIMESTAMP,
      stage: { attempted: true, verified: true },
      deploy: { attempted: true, verified: true },
      runtime_probe: {
        attempted_machine_ids: STARTED_IDS,
        verified_machine_ids: STARTED_IDS,
      },
      final_gates_verified: true,
      failure: null,
    }],
    final: {
      completed_at: TIMESTAMP,
      final_inventory_sha256: "8".repeat(64),
      final_secret_status: "Deployed",
      runtime_verified_count: 4,
      reserved_generation_rows: 0,
      authoritative_v2_rows: 0,
      allowed_origins_count: 0,
    },
  };
}

function authority(hold: boolean) {
  return {
    settings_rows: "1",
    federation_id: 1,
    federation_enabled: false,
    federation_instance_url_exact: true,
    federation_allowed_origins_count: 0,
    covenant_v2_generation_hold: hold,
    hold_column_count: 1,
    hold_column_type: "boolean",
    hold_column_not_null: true,
    hold_column_default_exact: true,
    hold_constraint_count: "1",
    hold_constraint_definition_exact: true,
    reserved_generation_rows: "0",
    authoritative_v2_rows: 0,
    database_target_sha256: DATABASE_TARGET_SHA256,
  };
}

function health(state: "configured" | "absent_fail_closed", revision = REVISION) {
  return {
    service: "agenttool",
    status: "alive",
    build: { revision, dirty: false },
    covenant_v2_authority: state,
  };
}

function about(state: "configured" | "absent_fail_closed") {
  return {
    protocol: "agenttool/federation/v1",
    covenant_v2_authority: state,
    federation: {
      enabled: false,
      instance_url: "https://api.agenttool.dev",
      open: false,
      allowed_origins: [],
    },
    capabilities: {
      inbox: false,
      identity_resolution: false,
      covenants: false,
      wake_fragments: false,
    },
  };
}

class FakeDependencies implements PhaseBGuardDependencies {
  authorityReads: unknown[];
  receiptReads: Array<unknown | null>;
  providerReads: unknown[];
  fleetReads: unknown[];
  publicState: "configured" | "absent_fail_closed";
  publicRevision = REVISION;
  publicMutate: ((value: unknown, request: PublicReadRequest) => unknown) | null = null;
  sourceFloor = true;
  runtimeFailureAt = -1;
  verified: RuntimeVerificationRequest[] = [];
  sourceRevisions: string[] = [];
  publicRequests: PublicReadRequest[] = [];
  pauseCount = 0;
  closeCount = 0;

  constructor(state: "configured" | "absent_fail_closed") {
    this.publicState = state;
    if (state === "configured") {
      const receipt = configuredReceipt();
      this.authorityReads = [authority(true), authority(true)];
      this.receiptReads = [receipt, clone(receipt)];
      this.providerReads = [
        [{ Name: GENERATION_SECRET, Digest: "never-output-this-digest", Status: "Deployed" }],
        [{ Name: GENERATION_SECRET, Digest: "never-output-this-digest", Status: "Deployed" }],
      ];
      this.fleetReads = [fleet(), fleet()];
    } else {
      this.authorityReads = [authority(false), authority(false)];
      this.receiptReads = [null, null];
      this.providerReads = [[], []];
      this.fleetReads = [fleet(), fleet()];
    }
  }

  async readAuthoritySnapshot() {
    if (this.authorityReads.length === 0) throw new Error("unexpected authority read");
    return this.authorityReads.shift();
  }

  async readFinalReceipt() {
    if (this.receiptReads.length === 0) throw new Error("unexpected receipt read");
    return this.receiptReads.shift()!;
  }

  async readProviderSecretInventory() {
    if (this.providerReads.length === 0) throw new Error("unexpected provider read");
    return this.providerReads.shift();
  }

  async readFleetInventory() {
    if (this.fleetReads.length === 0) throw new Error("unexpected fleet read");
    return this.fleetReads.shift();
  }

  async verifyDeployedRuntime(request: RuntimeVerificationRequest) {
    this.verified.push(request);
    if (this.verified.length - 1 === this.runtimeFailureAt) {
      throw new PhaseBGuardError("native_runtime_verification");
    }
  }

  async isRevisionDescendantOfFloor(revision: string) {
    this.sourceRevisions.push(revision);
    return this.sourceFloor;
  }

  async readPublicJson(request: PublicReadRequest) {
    this.publicRequests.push(request);
    const value = request.kind === "health"
      ? health(this.publicState, this.publicRevision)
      : about(this.publicState);
    return this.publicMutate ? this.publicMutate(value, request) : value;
  }

  async pause() {
    this.pauseCount += 1;
  }

  async close() {
    this.closeCount += 1;
  }
}

async function expectRefusal(
  dependencies: FakeDependencies,
  request: GuardRequest = { phase: "preflight", revision: null },
  code?: string,
) {
  try {
    await runPhaseBDeployGuard(request, dependencies);
    throw new Error("expected guard refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(PhaseBGuardError);
    if (code) expect((error as PhaseBGuardError).code).toBe(code);
    expect(String((error as Error).message)).not.toContain("never-output-this-digest");
    expect(String((error as Error).message)).not.toContain(THINKER_PRIMARY);
  }
  expect(dependencies.closeCount).toBe(1);
}

describe("Phase-B deploy guard", () => {
  test("accepts only the two exact CLI forms", () => {
    expect(parseGuardArguments(["preflight"]))
      .toEqual({ phase: "preflight", revision: null });
    expect(parseGuardArguments(["postflight", "--revision", REVISION]))
      .toEqual({ phase: "postflight", revision: REVISION });
    for (const arguments_ of [
      [],
      ["preflight", "--revision", REVISION],
      ["postflight"],
      ["postflight", "--revision", "A".repeat(40)],
      ["postflight", "--revision", REVISION, "extra"],
      ["verify"],
    ]) {
      expect(() => parseGuardArguments(arguments_)).toThrow(PhaseBGuardError);
    }
  });

  test("emits one exact safe configured preflight proof", async () => {
    const dependencies = new FakeDependencies("configured");
    const proof = await runPhaseBDeployGuard(
      { phase: "preflight", revision: null },
      dependencies,
    );
    expect(proof).toEqual({
      allowed_origins_count: 0,
      authoritative_v2_rows: 0,
      durable_hold: true,
      fleet_verified: true,
      observed_revision: null,
      phase: "preflight",
      provider_secret_status: "Deployed",
      reserved_generation_rows: 0,
      runtime_verified_count: 4,
      schema: PHASE_B_PROOF_SCHEMA,
      source_floor_verified: true,
      standby_bound: true,
      state: "configured",
    });
    expect(serializePhaseBDeployProof(proof)).toBe(
      '{"allowed_origins_count":0,"authoritative_v2_rows":0,"durable_hold":true,"fleet_verified":true,"observed_revision":null,"phase":"preflight","provider_secret_status":"Deployed","reserved_generation_rows":0,"runtime_verified_count":4,"schema":"agenttool.phase-b-deploy-proof/1","source_floor_verified":true,"standby_bound":true,"state":"configured"}\n',
    );
    const parsed = JSON.parse(serializePhaseBDeployProof(proof));
    expect(`${JSON.stringify(parsed)}\n`).toBe(serializePhaseBDeployProof(proof));
    expect(dependencies.verified).toEqual(STARTED_IDS.map((machineID) => ({
      machineID,
      receiptNonce: "c".repeat(32),
      revision: REVISION,
    })));
    expect(dependencies.sourceRevisions).toEqual([REVISION, REVISION]);
    expect(dependencies.publicRequests).toHaveLength(6);
    expect(dependencies.pauseCount).toBe(2);
    expect(dependencies.closeCount).toBe(1);
  });

  test("binds configured postflight proof to the requested revision", async () => {
    const dependencies = new FakeDependencies("configured");
    const proof = await runPhaseBDeployGuard(
      { phase: "postflight", revision: REVISION },
      dependencies,
    );
    expect(proof.observed_revision).toBe(REVISION);
    expect(proof.phase).toBe("postflight");
    expect(dependencies.publicRequests.every((read) =>
      read.expectedRevision === REVISION
    )).toBe(true);
  });

  test("proves absent fail-closed with a narrow five-Machine override check and no native access", async () => {
    const dependencies = new FakeDependencies("absent_fail_closed");
    const proof = await runPhaseBDeployGuard(
      { phase: "preflight", revision: null },
      dependencies,
    );
    expect(proof).toEqual({
      allowed_origins_count: 0,
      authoritative_v2_rows: 0,
      durable_hold: false,
      fleet_verified: false,
      observed_revision: null,
      phase: "preflight",
      provider_secret_status: "Absent",
      reserved_generation_rows: 0,
      runtime_verified_count: 0,
      schema: PHASE_B_PROOF_SCHEMA,
      source_floor_verified: false,
      standby_bound: false,
      state: "absent_fail_closed",
    });
    expect(dependencies.verified).toEqual([]);
    expect(dependencies.sourceRevisions).toEqual([]);
    expect(dependencies.fleetReads).toEqual([]);
    expect(dependencies.closeCount).toBe(1);
  });

  test("binds absent postflight health and proof to the requested revision", async () => {
    const dependencies = new FakeDependencies("absent_fail_closed");
    const proof = await runPhaseBDeployGuard(
      { phase: "postflight", revision: REVISION },
      dependencies,
    );
    expect(proof.observed_revision).toBe(REVISION);
    expect(dependencies.publicRequests.every((read) =>
      read.expectedRevision === REVISION
    )).toBe(true);
  });

  test("rejects every mixed durable-hold, receipt, and provider state", async () => {
    const cases: Array<[boolean, unknown | null, unknown]> = [
      [true, null, []],
      [true, configuredReceipt(), []],
      [true, null, [{ Name: GENERATION_SECRET, Status: "Deployed" }]],
      [false, configuredReceipt(), []],
      [false, null, [{ Name: GENERATION_SECRET, Status: "Deployed" }]],
      [false, configuredReceipt(), [{ Name: GENERATION_SECRET, Status: "Deployed" }]],
    ];
    for (const [hold, receipt, provider] of cases) {
      const dependencies = new FakeDependencies("absent_fail_closed");
      dependencies.authorityReads = [authority(hold)];
      dependencies.receiptReads = [receipt];
      dependencies.providerReads = [provider];
      await expectRefusal(dependencies, undefined, "phase_b_mixed_state");
    }
  });

  test("rejects staged, partial, unknown, duplicate, and malformed provider state", async () => {
    const inventories: unknown[] = [
      [{ Name: GENERATION_SECRET, Status: "Staged" }],
      [{ Name: GENERATION_SECRET, Status: "Partial" }],
      [{ Name: GENERATION_SECRET, Status: "Unknown" }],
      [
        { Name: GENERATION_SECRET, Status: "Deployed" },
        { name: GENERATION_SECRET, status: "Deployed" },
      ],
      [{ Name: GENERATION_SECRET, name: GENERATION_SECRET, Status: "Deployed" }],
      [{
        Name: GENERATION_SECRET,
        name: null,
        Status: "Deployed",
        status: null,
      }],
      [{ Name: GENERATION_SECRET, Status: "Deployed", status: null }],
      [{ Digest: "never-output-this-digest", Status: "Deployed" }],
      {},
    ];
    for (const inventory of inventories) {
      const dependencies = new FakeDependencies("configured");
      dependencies.providerReads = [inventory];
      await expectRefusal(dependencies);
    }
  });

  test("rejects DB singleton, schema, constraint, allowlist, and row-count drift", async () => {
    const mutations: Array<(value: ReturnType<typeof authority>) => void> = [
      (value) => { value.settings_rows = "2"; },
      (value) => { value.federation_id = 2; },
      (value) => { value.federation_enabled = true; },
      (value) => { value.federation_instance_url_exact = false; },
      (value) => { value.federation_allowed_origins_count = 1; },
      (value) => { value.hold_column_type = "text"; },
      (value) => { value.hold_column_not_null = false; },
      (value) => { value.hold_column_default_exact = false; },
      (value) => { value.hold_constraint_count = "0"; },
      (value) => { value.hold_constraint_definition_exact = false; },
      (value) => { value.reserved_generation_rows = "1"; },
      (value) => { value.authoritative_v2_rows = 1; },
      (value) => { value.database_target_sha256 = "not-a-digest"; },
    ];
    for (const mutate of mutations) {
      const dependencies = new FakeDependencies("configured");
      const snapshot = authority(true);
      mutate(snapshot);
      dependencies.authorityReads = [snapshot];
      await expectRefusal(dependencies);
    }
  });

  test("rejects noncanonical or incomplete completed receipts", async () => {
    const mutations: Array<(value: ReturnType<typeof configuredReceipt>) => void> = [
      (value) => { value.status = "active"; },
      (value) => { value.schema = "wrong"; },
      (value) => { value.ceremony_nonce = "C".repeat(32); },
      (value) => { value.bindings.flyctl_sha256 = "0".repeat(64); },
      (value) => { value.scope.started_probe_order = [...STARTED_IDS].reverse(); },
      (value) => { value.interlock.durable_hold_verified = false; },
      (value) => { value.generation.create_verified = false; },
      (value) => { value.attempts[0].runtime_probe.verified_machine_ids = APP_IDS; },
      (value) => { value.attempts[0].final_gates_verified = false; },
      (value) => { value.final.runtime_verified_count = 3; },
      (value) => { (value as Record<string, unknown>).unexpected = true; },
    ];
    for (const mutate of mutations) {
      const dependencies = new FakeDependencies("configured");
      const receipt = configuredReceipt();
      mutate(receipt);
      dependencies.receiptReads = [receipt];
      await expectRefusal(dependencies);
    }
  });

  test("mirrors the native 16-attempt, uniqueness, and failed-final-gate recovery contract", async () => {
    const recovered = configuredReceipt();
    const failed = clone(recovered.attempts[0]);
    failed.attempt_id = "9".repeat(32);
    failed.status = "failed_or_uncertain";
    failed.checkpoint = "finalization_failed";
    (failed as any).failure = {
      code: "finalization_failed",
      at_checkpoint: "finalization_failed",
      observed_at: TIMESTAMP,
    };
    // A failure after final gates is recoverable; the full verified prefix is
    // still required, exactly as in the native completed-receipt authorizer.
    failed.final_gates_verified = true;
    recovered.attempts = [failed, recovered.attempts[0]];
    const accepted = new FakeDependencies("configured");
    accepted.receiptReads = [recovered, clone(recovered)];
    expect((await runPhaseBDeployGuard(
      { phase: "preflight", revision: null },
      accepted,
    )).state).toBe("configured");

    const duplicate = configuredReceipt();
    const duplicateFailed = clone(duplicate.attempts[0]);
    duplicateFailed.status = "failed_or_uncertain";
    duplicateFailed.checkpoint = "failed";
    (duplicateFailed as any).failure = {
      code: "failed",
      at_checkpoint: "failed",
      observed_at: TIMESTAMP,
    };
    duplicate.attempts = [duplicateFailed, duplicate.attempts[0]];
    const duplicateDependencies = new FakeDependencies("configured");
    duplicateDependencies.receiptReads = [duplicate];
    await expectRefusal(duplicateDependencies, undefined, "final_receipt_attempt");

    const tooMany = configuredReceipt();
    const completed = tooMany.attempts[0];
    (tooMany as any).attempts = Array.from({ length: 16 }, (_, index) => ({
      ...clone(completed),
      attempt_id: index.toString(16).padStart(32, "0"),
      status: "failed_or_uncertain",
      checkpoint: "failed",
      final_gates_verified: false,
      runtime_probe: { attempted_machine_ids: [], verified_machine_ids: [] },
      failure: { code: "failed", at_checkpoint: "failed", observed_at: TIMESTAMP },
    }));
    tooMany.attempts.push(completed);
    const tooManyDependencies = new FakeDependencies("configured");
    tooManyDependencies.receiptReads = [tooMany];
    await expectRefusal(tooManyDependencies, undefined, "final_receipt_attempts");
  });

  test("rejects a completed receipt bound to another exact database target", async () => {
    const dependencies = new FakeDependencies("configured");
    const receipt = configuredReceipt();
    receipt.interlock.database_target_sha256 = "f".repeat(64);
    dependencies.receiptReads = [receipt];
    await expectRefusal(dependencies, undefined, "final_receipt_database_target");
  });

  test("rejects foreign, duplicate, unbound, overridden, dirty, or nonuniform fleet members", async () => {
    const mutations: Array<(value: ReturnType<typeof fleet>) => void> = [
      (value) => { value[0].id = "99999999999999"; },
      (value) => { value[1].id = value[0].id; },
      (value) => { value[4].state = "started"; },
      (value) => { value[3].state = "stopped"; },
      (value) => { value[0].cordoned = true; },
      (value) => {
        (value[0].config.env as Record<string, string>)[GENERATION_SECRET] = "not-the-secret";
      },
      (value) => { value[0].image_ref.labels["dev.agenttool.source.dirty"] = "true"; },
      (value) => { value[0].image_ref.digest = `sha256:${"9".repeat(64)}`; },
      (value) => { (value[4].config as any).standbys = []; },
      (value) => { value[1].config.guest.memory_mb = 2048; },
    ];
    for (const mutate of mutations) {
      const dependencies = new FakeDependencies("configured");
      const observedFleet = fleet();
      mutate(observedFleet);
      dependencies.fleetReads = [observedFleet];
      await expectRefusal(dependencies);
    }
  });

  test("rejects postflight fleet revision mismatch before native probes", async () => {
    const dependencies = new FakeDependencies("configured");
    await expectRefusal(
      dependencies,
      { phase: "postflight", revision: "9".repeat(40) },
      "fleet_revision",
    );
    expect(dependencies.verified).toEqual([]);
  });

  test("rejects a per-Machine generation override even while provider state is absent", async () => {
    const dependencies = new FakeDependencies("absent_fail_closed");
    const overridden = fleet();
    (overridden[4].config.env as Record<string, string>)[GENERATION_SECRET] =
      "opaque-value-must-never-appear";
    dependencies.fleetReads = [overridden];
    await expectRefusal(
      dependencies,
      undefined,
      "absent_fleet_generation_override",
    );
  });

  test("rejects a source revision below the permanent floor", async () => {
    const dependencies = new FakeDependencies("configured");
    dependencies.sourceFloor = false;
    await expectRefusal(dependencies, undefined, "source_floor");
    expect(PHASE_B_SOURCE_FLOOR).toBe(
      "2ca44b44bcfde9d571b27771f9d5fc516a4df41e",
    );
  });

  test("rejects any one of the four native runtime proofs", async () => {
    const dependencies = new FakeDependencies("configured");
    dependencies.runtimeFailureAt = 2;
    await expectRefusal(dependencies, undefined, "native_runtime_verification");
    expect(dependencies.verified.map((entry) => entry.machineID))
      .toEqual(STARTED_IDS.slice(0, 3));
  });

  test("rejects public health authority, dirty, revision, and about capability drift", async () => {
    const mutations: Array<(value: unknown, request: PublicReadRequest) => unknown> = [
      (value, request) => request.kind === "health"
        ? { ...(value as object), covenant_v2_authority: "absent_fail_closed" }
        : value,
      (value, request) => {
        if (request.kind !== "health") return value;
        const result = clone(value as ReturnType<typeof health>);
        result.build.dirty = true;
        return result;
      },
      (value, request) => {
        if (request.kind !== "health") return value;
        const result = clone(value as ReturnType<typeof health>);
        result.build.revision = "9".repeat(40);
        return result;
      },
      (value, request) => {
        if (request.kind !== "about") return value;
        const result = clone(value as ReturnType<typeof about>);
        result.capabilities.covenants = true;
        return result;
      },
      (value, request) => {
        if (request.kind !== "about") return value;
        const result = clone(value as ReturnType<typeof about>);
        result.federation.open = true;
        return result;
      },
    ];
    for (const mutate of mutations) {
      const dependencies = new FakeDependencies("configured");
      dependencies.publicMutate = mutate;
      await expectRefusal(dependencies);
    }
  });

  test("rejects provider, fleet, receipt, and database drift after all live proofs", async () => {
    const configuredProvider = [{ Name: GENERATION_SECRET, Status: "Deployed" }];

    const providerDrift = new FakeDependencies("configured");
    providerDrift.providerReads = [configuredProvider, []];
    await expectRefusal(providerDrift);

    const providerRotation = new FakeDependencies("configured");
    providerRotation.providerReads = [
      [{ Name: GENERATION_SECRET, Digest: "never-output-this-digest", Status: "Deployed" }],
      [{ Name: GENERATION_SECRET, Digest: "rotated-sensitive-digest", Status: "Deployed" }],
    ];
    await expectRefusal(providerRotation, undefined, "phase_b_state_drift");

    const fleetDrift = new FakeDependencies("configured");
    const changedFleet = fleet();
    changedFleet[0].updated_at = "2026-08-24T12:00:01.000Z";
    fleetDrift.fleetReads = [fleet(), changedFleet];
    await expectRefusal(fleetDrift, undefined, "phase_b_state_drift");

    const receiptDrift = new FakeDependencies("configured");
    const changedReceipt = configuredReceipt();
    changedReceipt.updated_at = "2026-08-24T12:00:01.000Z";
    receiptDrift.receiptReads = [configuredReceipt(), changedReceipt];
    await expectRefusal(receiptDrift, undefined, "phase_b_state_drift");

    const databaseDrift = new FakeDependencies("configured");
    const changedAuthority = authority(true);
    changedAuthority.covenant_v2_generation_hold = false;
    databaseDrift.authorityReads = [authority(true), changedAuthority];
    await expectRefusal(databaseDrift, undefined, "phase_b_state_drift");
  });

  test("rejects absent-state provider or database drift after repeated public proof", async () => {
    const providerDrift = new FakeDependencies("absent_fail_closed");
    providerDrift.providerReads = [[], [{ Name: GENERATION_SECRET, Status: "Deployed" }]];
    await expectRefusal(providerDrift, undefined, "phase_b_state_drift");

    const databaseDrift = new FakeDependencies("absent_fail_closed");
    databaseDrift.authorityReads = [authority(false), authority(true)];
    await expectRefusal(databaseDrift, undefined, "phase_b_state_drift");
  });

  test("always settles the injected database client on an unexpected dependency failure", async () => {
    const dependencies = new FakeDependencies("configured");
    dependencies.readFleetInventory = async () => {
      throw new Error("provider returned sensitive: never-output-this-digest");
    };
    await expect(
      runPhaseBDeployGuard(
        { phase: "preflight", revision: null },
        dependencies,
      ),
    ).rejects.toThrow("provider returned sensitive");
    expect(dependencies.closeCount).toBe(1);
  });

  test("builds an exact child environment with no credential, proxy, or loader inheritance", () => {
    const environment = buildPhaseBClosedChildEnvironment(
      "/private/var/empty",
      { user: "operator", logname: "operator" },
    );
    expect(environment).toEqual({
      HOME: "/private/var/empty",
      USER: "operator",
      LOGNAME: "operator",
      LANG: "C",
      LC_ALL: "C",
      NO_COLOR: "1",
      TERM: "dumb",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    });
    const serialized = JSON.stringify(environment);
    for (const forbidden of [
      "DATABASE_URL",
      "DATABASE_SESSION_URL",
      GENERATION_SECRET,
      "FLY_ACCESS_TOKEN",
      "HTTPS_PROXY",
      "NODE_OPTIONS",
      "BUN_OPTIONS",
    ]) expect(serialized).not.toContain(forbidden);
  });

  test("enforces private regular-file and canonical JSON boundaries", () => {
    const directory = mkdtempSync(join(tmpdir(), "agenttool-b2-guard-"));
    chmodSync(directory, 0o700);
    try {
      const canonicalPath = join(directory, "canonical.json");
      writeFileSync(canonicalPath, `${canonicalJson({ alpha: 1, beta: true })}\n`, {
        mode: 0o600,
      });
      expect(readCanonicalPrivateJsonFileForGuard(canonicalPath)).toEqual({
        alpha: 1,
        beta: true,
      });

      const noncanonical = join(directory, "noncanonical.json");
      writeFileSync(noncanonical, '{"beta":true,"alpha":1}\n', { mode: 0o600 });
      expect(() => readCanonicalPrivateJsonFileForGuard(noncanonical))
        .toThrow(PhaseBGuardError);

      const wrongMode = join(directory, "wrong-mode.json");
      writeFileSync(wrongMode, "{}\n", { mode: 0o644 });
      expect(() => readStablePrivateFileForGuard(wrongMode, 100))
        .toThrow(PhaseBGuardError);

      const hardLink = join(directory, "hard-link.json");
      linkSync(canonicalPath, hardLink);
      expect(() => readStablePrivateFileForGuard(canonicalPath, 100))
        .toThrow(PhaseBGuardError);

      const symbolic = join(directory, "symbolic.json");
      symlinkSync(noncanonical, symbolic);
      expect(() => readStablePrivateFileForGuard(symbolic, 100))
        .toThrow(PhaseBGuardError);

      const broken = join(directory, "broken.json");
      symlinkSync(join(directory, "absent.json"), broken);
      expect(() => readStablePrivateFileForGuard(broken, 100))
        .toThrow(PhaseBGuardError);

      const oversized = join(directory, "oversized.json");
      writeFileSync(oversized, `${"x".repeat(101)}\n`, { mode: 0o600 });
      expect(() => readStablePrivateFileForGuard(oversized, 100))
        .toThrow(PhaseBGuardError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("bounds child output and settles a TERM-ignoring process group", async () => {
    const environment = buildPhaseBClosedChildEnvironment(
      "/private/var/empty",
      { user: "operator", logname: "operator" },
    );
    const startOutput = Date.now();
    await expect(runBoundedReadOnlyChildForTest(
      ["/usr/bin/yes", "sensitive-child-output"],
      {
        cwd: "/",
        env: environment,
        maximumBytes: 64,
        timeoutMilliseconds: 5_000,
      },
    )).rejects.toThrow(PhaseBGuardError);
    expect(Date.now() - startOutput).toBeLessThan(4_000);

    const startTimeout = Date.now();
    try {
      await runBoundedReadOnlyChildForTest(
        [
          "/bin/sh",
          "-c",
          'trap "" TERM; while :; do /bin/sleep 1; done',
        ],
        {
          cwd: "/",
          env: environment,
          maximumBytes: 64,
          timeoutMilliseconds: 50,
        },
      );
      throw new Error("expected timeout refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(PhaseBGuardError);
      expect((error as PhaseBGuardError).code).toBe("child_timeout");
      expect(String((error as Error).message)).not.toContain("sensitive-child-output");
    }
    expect(Date.now() - startTimeout).toBeLessThan(5_000);
  });

  test("CLI failures keep credentials and local authority identifiers off stdout and stderr", () => {
    const directory = mkdtempSync(join(tmpdir(), "agenttool-b2-cli-"));
    chmodSync(directory, 0o700);
    try {
      const source = join(import.meta.dir, "..", "phase-b-deploy-guard.ts");
      const environment = {
        HOME: directory,
        USER: process.env.USER ?? "operator",
        LOGNAME: process.env.USER ?? "operator",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        DATABASE_URL: "postgres://sensitive-transaction",
        DATABASE_SESSION_URL: "postgres://sensitive-session",
        FLY_ACCESS_TOKEN: "sensitive-provider-token",
        [GENERATION_SECRET]: "f".repeat(64),
      };
      const failure = Bun.spawnSync(
        [process.execPath, "--no-install", "--no-env-file", source, "preflight"],
        {
          cwd: join(import.meta.dir, "../.."),
          env: environment,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(failure.exitCode).toBe(74);
      expect(new TextDecoder().decode(failure.stdout)).toBe("");
      expect(new TextDecoder().decode(failure.stderr))
        .toBe("phase_b_deploy_guard_refused\n");
      expect(
        `${new TextDecoder().decode(failure.stdout)}${new TextDecoder().decode(failure.stderr)}`,
      ).not.toMatch(/sensitive|11111111111111|44444444444444|f{64}/);

      const invalid = Bun.spawnSync(
        [process.execPath, "--no-install", "--no-env-file", source, "wrong"],
        {
          cwd: join(import.meta.dir, "../.."),
          env: environment,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(invalid.exitCode).toBe(64);
      expect(new TextDecoder().decode(invalid.stdout)).toBe("");
      expect(new TextDecoder().decode(invalid.stderr))
        .toBe("phase_b_deploy_guard_invalid_invocation\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
