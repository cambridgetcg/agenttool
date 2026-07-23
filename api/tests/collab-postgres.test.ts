/** Opt-in real Postgres proof for relay serialization and recovery.
 *
 * Run against an empty disposable database:
 *   COLLAB_TEST_DATABASE_URL=postgres://.../agenttool_collab_test \
 *     bun test tests/collab-postgres.test.ts
 *
 * The setup refuses any database that already has `tools` or `collab`
 * schemas, then removes only the schemas it created. */

import { createHash } from "node:crypto";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import postgres from "postgres";

import type {
  CollabEnrolmentInput,
  CollabPrincipal,
  OperationClaimInput,
  ProviderObservationInput,
} from "../src/services/collab-relay/contracts";
import {
  collabEnrolmentIdempotencyKey,
} from "../src/services/collab-relay/canonical";
import type { PostgresCollabRelayStore } from "../src/services/collab-relay/postgres-store";

const TEST_DATABASE_URL = process.env.COLLAB_TEST_DATABASE_URL ?? "";
const databaseTest = TEST_DATABASE_URL ? test : test.skip;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const DEVICE_B = "bbbbbbbb-1111-4111-8111-111111111111";
const DEVICE_C = "cccccccc-1111-4111-8111-111111111111";
const DEVICE_D = "dddddddd-1111-4111-8111-111111111111";
const SESSION_A = "aaaaaaaa-2222-4222-8222-222222222222";
const SESSION_B = "bbbbbbbb-2222-4222-8222-222222222222";
const SESSION_C = "cccccccc-2222-4222-8222-222222222222";
const ACTION_A = "aaaaaaaa-3333-4333-8333-333333333333";
const ACTION_B = "bbbbbbbb-3333-4333-8333-333333333333";
const ACTION_C = "cccccccc-3333-4333-8333-333333333333";
const ACTION_D = "dddddddd-3333-4333-8333-333333333333";
const ACTION_E = "eeeeeeee-3333-4333-8333-333333333333";
const ACTION_F = "ffffffff-3333-4333-8333-333333333333";
const REVISION = "a".repeat(40);
const PARAMETERS_SHA256 = "b".repeat(64);
const PAYLOAD_SHA256 = "c".repeat(64);
const TOKEN_A_OLD = `atc_${"A".repeat(43)}`;
const TOKEN_A_NEW = `atc_${"D".repeat(43)}`;
const TOKEN_B = `atc_${"B".repeat(43)}`;
const TOKEN_C = `atc_${"C".repeat(43)}`;
const TOKEN_D = `atc_${"E".repeat(43)}`;

let sql: ReturnType<typeof postgres> | null = null;
let store: PostgresCollabRelayStore | null = null;
let ownsSchemas = false;

function tokenSha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function enrollment(input: {
  repositoryKey: string;
  providerId: string;
  displayName: string;
  deviceId: string;
  deviceLabel: string;
  token: string;
  expectedDeviceVersion?: number;
  profileSha256?: string;
  allowedProviders?: CollabEnrolmentInput[
    "observation_policy"
  ]["allowed_providers"];
}): CollabEnrolmentInput {
  const intent: Omit<CollabEnrolmentInput, "idempotency_key"> = {
    schema: "agenttool.collab-enrolment/1",
    expected_device_version: input.expectedDeviceVersion ?? 0,
    repository: {
      key: input.repositoryKey,
      provider: "github",
      provider_repository_id: input.providerId,
      display_name: input.displayName,
    },
    device: { id: input.deviceId, label: input.deviceLabel },
    observation_policy: {
      profile_sha256: input.profileSha256 ?? "d".repeat(64),
      allowed_providers: input.allowedProviders ?? [
        "cloudflare-pages",
        "fly",
        "github",
        "npm",
      ],
    },
    token: {
      prefix: input.token.slice(0, 12),
      sha256: tokenSha256(input.token),
    },
  };
  return {
    ...intent,
    idempotency_key: collabEnrolmentIdempotencyKey(intent),
  };
}

function claim(input: {
  actionId: string;
  sessionId: string;
  actorLabel: string;
  idempotencyKey: string;
}): OperationClaimInput {
  return {
    schema: "agenttool.collab-operation-claim/1",
    idempotency_key: input.idempotencyKey,
    action_id: input.actionId,
    session_id: input.sessionId,
    actor_label: input.actorLabel,
    operation: "npm.publish",
    environment: "npm",
    target: "@agenttool/collab@0.4.0",
    source_revision: REVISION,
    parameters_sha256: PARAMETERS_SHA256,
    lease_seconds: 30,
  };
}

function observation(input: {
  idempotencyKey: string;
  sessionId: string;
  actorLabel: string;
  actionId?: string;
  providerEventId: string;
  observedAt: string;
  occurredAt: string;
}): ProviderObservationInput {
  return {
    schema: "agenttool.collab-provider-observation/1",
    idempotency_key: input.idempotencyKey,
    session_id: input.sessionId,
    actor_label: input.actorLabel,
    ...(input.actionId ? { action_id: input.actionId } : {}),
    provider: "npm",
    provider_event_id: input.providerEventId,
    observed_at: input.observedAt,
    occurred_at: input.occurredAt,
    resource_kind: "package_version",
    resource_id: "@agenttool/collab@0.4.0",
    native_state: "published",
    normalized_state: "succeeded",
    source_revision: REVISION,
    environment: "npm",
    url: "https://registry.npmjs.org/@agenttool/collab",
    payload_sha256: PAYLOAD_SHA256,
  };
}

function requireStore(): PostgresCollabRelayStore {
  if (!store) throw new Error("collab Postgres test store is not initialized");
  return store;
}

async function requirePrincipal(token: string): Promise<CollabPrincipal> {
  const authenticated = await requireStore().authenticate(token);
  if (!authenticated) throw new Error("test scoped bearer did not authenticate");
  return authenticated;
}

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  sql = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
  });
  const [existing] = await sql<Array<{
    tools_schema: string | null;
    collab_schema: string | null;
  }>>`
    SELECT
      to_regnamespace('tools')::text AS tools_schema,
      to_regnamespace('collab')::text AS collab_schema
  `;
  if (existing?.tools_schema || existing?.collab_schema) {
    throw new Error(
      "COLLAB_TEST_DATABASE_URL must name a disposable database without tools or collab schemas",
    );
  }
  await sql.unsafe(`
    CREATE SCHEMA tools;
    CREATE TABLE tools.projects (id UUID PRIMARY KEY);
    INSERT INTO tools.projects (id)
    VALUES ('${PROJECT_ID}');
  `);
  ownsSchemas = true;
  const migration = await Bun.file(
    new URL(
      "../migrations/20260723T210000_collab_relay.sql",
      import.meta.url,
    ),
  ).text();
  await sql.unsafe(migration);
  const imported = await import(
    "../src/services/collab-relay/postgres-store"
  );
  store = new imported.PostgresCollabRelayStore();
});

afterAll(async () => {
  if (!sql) return;
  try {
    if (ownsSchemas) {
      await sql.unsafe(
        "DROP SCHEMA IF EXISTS collab CASCADE; DROP SCHEMA IF EXISTS tools CASCADE;",
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});

describe("collab relay — real Postgres authority", () => {
  databaseTest(
    "serializes contenders, replays exact bytes, recovers expiry, and isolates observations",
    async () => {
      const relay = requireStore();
      const firstEnrollmentInput = enrollment({
        repositoryKey: "github:1261120431",
        providerId: "1261120431",
        displayName: "agenttool old display",
        deviceId: DEVICE_A,
        deviceLabel: "old device label",
        token: TOKEN_A_OLD,
      });
      const firstEnrollment = await relay.enrol(
        PROJECT_ID,
        firstEnrollmentInput,
      );
      expect(firstEnrollment.created).toBe(true);
      expect(firstEnrollment.replayed).toBe(false);
      expect(firstEnrollment.device.version).toBe(1);
      const firstEnrollmentReplay = await relay.enrol(
        PROJECT_ID,
        firstEnrollmentInput,
      );
      expect(firstEnrollmentReplay.replayed).toBe(true);
      expect(firstEnrollmentReplay.receipt).toEqual(firstEnrollment.receipt);
      expect(await relay.authenticate(TOKEN_A_OLD)).not.toBeNull();
      const stalePrincipalA = await requirePrincipal(TOKEN_A_OLD);

      const concurrentEnrollmentInput = enrollment({
        repositoryKey: "github:1261120431",
        providerId: "1261120431",
        displayName: "agenttool old display",
        deviceId: DEVICE_D,
        deviceLabel: "concurrent enrollment device",
        token: TOKEN_D,
      });
      const identicalEnrollments = await Promise.all([
        relay.enrol(PROJECT_ID, concurrentEnrollmentInput),
        relay.enrol(PROJECT_ID, concurrentEnrollmentInput),
      ]);
      expect(
        identicalEnrollments.filter((result) => !result.replayed),
      ).toHaveLength(1);
      expect(
        identicalEnrollments.filter((result) => result.replayed),
      ).toHaveLength(1);
      expect(
        identicalEnrollments.every(
          (result) =>
            result.created
            && result.device.version === 1
            && result.device.id === DEVICE_D,
        ),
      ).toBe(true);
      expect(identicalEnrollments[0]!.receipt).toEqual(
        identicalEnrollments[1]!.receipt,
      );

      const concurrentUpdateLeft = enrollment({
        repositoryKey: "github:1261120431",
        providerId: "1261120431",
        displayName: "agenttool old display",
        deviceId: DEVICE_D,
        deviceLabel: "concurrent update left",
        token: TOKEN_D,
        expectedDeviceVersion: 1,
        profileSha256: "e".repeat(64),
      });
      const concurrentUpdateRight = enrollment({
        repositoryKey: "github:1261120431",
        providerId: "1261120431",
        displayName: "agenttool old display",
        deviceId: DEVICE_D,
        deviceLabel: "concurrent update right",
        token: TOKEN_D,
        expectedDeviceVersion: 1,
        profileSha256: "f".repeat(64),
      });
      const divergentUpdates = await Promise.allSettled([
        relay.enrol(PROJECT_ID, concurrentUpdateLeft),
        relay.enrol(PROJECT_ID, concurrentUpdateRight),
      ]);
      const successfulUpdates = divergentUpdates.filter(
        (result): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof relay.enrol>>
        > => result.status === "fulfilled",
      );
      const staleUpdates = divergentUpdates.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(successfulUpdates).toHaveLength(1);
      expect(successfulUpdates[0]!.value).toMatchObject({
        created: false,
        replayed: false,
        device: { id: DEVICE_D, version: 2 },
      });
      expect(staleUpdates).toHaveLength(1);
      expect(staleUpdates[0]!.reason).toMatchObject({
        code: "device_version_conflict",
        status: 409,
        details: {
          expected_device_version: 1,
          current_device_version: 2,
        },
      });

      const delayedEnrollment = enrollment({
        repositoryKey: "github:1261120431",
        providerId: "1261120431",
        displayName: "delayed display",
        deviceId: DEVICE_A,
        deviceLabel: "delayed device label",
        token: TOKEN_A_OLD,
        expectedDeviceVersion: 1,
      });
      const rotatedInput = enrollment({
        repositoryKey: "github:1261120431",
        providerId: "1261120431",
        displayName: "cambridgetcg/agenttool",
        deviceId: DEVICE_A,
        deviceLabel: "Yu MacBook",
        token: TOKEN_A_NEW,
        expectedDeviceVersion: 1,
      });
      const rotated = await relay.enrol(PROJECT_ID, rotatedInput);
      expect(rotated.created).toBe(false);
      expect(rotated.device.version).toBe(2);
      expect(rotated.repository.display_name).toBe("cambridgetcg/agenttool");
      expect(rotated.device.label).toBe("Yu MacBook");
      expect(await relay.authenticate(TOKEN_A_OLD)).toBeNull();
      await expect(
        relay.claim(
          stalePrincipalA,
          claim({
            actionId: ACTION_E,
            sessionId: SESSION_A,
            actorLabel: "stale-credential-request",
            idempotencyKey: "claim-stale-credential",
          }),
        ),
      ).rejects.toMatchObject({
        code: "collab_token_stale",
        status: 401,
      });
      expect(await relay.authenticate(`atc_${"D".repeat(42)}`)).toBeNull();
      expect(await relay.authenticate(`atc_${"D".repeat(44)}`)).toBeNull();
      await expect(
        relay.enrol(PROJECT_ID, firstEnrollmentInput),
      ).rejects.toMatchObject({
        code: "enrolment_replay_stale",
        status: 409,
      });
      await expect(
        relay.enrol(PROJECT_ID, delayedEnrollment),
      ).rejects.toMatchObject({
        code: "device_version_conflict",
        status: 409,
        details: {
          expected_device_version: 1,
          current_device_version: 2,
        },
      });
      const currentNoop = await relay.enrol(
        PROJECT_ID,
        enrollment({
          repositoryKey: "github:1261120431",
          providerId: "1261120431",
          displayName: "cambridgetcg/agenttool",
          deviceId: DEVICE_A,
          deviceLabel: "Yu MacBook",
          token: TOKEN_A_NEW,
          expectedDeviceVersion: 2,
        }),
      );
      expect(currentNoop.device.version).toBe(2);
      expect(currentNoop.created).toBe(false);
      const principalA = await requirePrincipal(TOKEN_A_NEW);

      await relay.enrol(
        PROJECT_ID,
        enrollment({
          repositoryKey: "github:1261120431",
          providerId: "1261120431",
          displayName: "cambridgetcg/agenttool",
          deviceId: DEVICE_B,
          deviceLabel: "review device",
          token: TOKEN_B,
        }),
      );
      const principalB = await requirePrincipal(TOKEN_B);

      const claimA = claim({
        actionId: ACTION_A,
        sessionId: SESSION_A,
        actorLabel: "codex-release",
        idempotencyKey: "claim-a",
      });
      const claimB = claim({
        actionId: ACTION_B,
        sessionId: SESSION_B,
        actorLabel: "claude-release",
        idempotencyKey: "claim-b",
      });
      const contenders = await Promise.allSettled([
        relay.claim(principalA, claimA),
        relay.claim(principalB, claimB),
      ]);
      const fulfilled = contenders.filter(
        (result): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof relay.claim>>
        > => result.status === "fulfilled",
      );
      const rejected = contenders.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        code: "operation_contended",
        status: 409,
      });

      const winnerIsA = fulfilled[0]!.value.run.action_id === ACTION_A;
      const winnerPrincipal = winnerIsA ? principalA : principalB;
      const recoveryPrincipal = winnerIsA ? principalB : principalA;
      const winnerInput = winnerIsA ? claimA : claimB;
      const winner = fulfilled[0]!.value;
      const replay = await relay.claim(winnerPrincipal, winnerInput);
      expect(replay.replayed).toBe(true);
      expect(replay.run.action_id).toBe(winner.run.action_id);
      await expect(
        relay.claim(winnerPrincipal, {
          ...winnerInput,
          target: "@agenttool/collab@0.4.1",
        }),
      ).rejects.toMatchObject({
        code: "idempotency_mismatch",
        status: 409,
      });

      const beginInput = {
        schema: "agenttool.collab-operation-begin/1",
        idempotency_key: "begin-winner",
        action_id: winner.run.action_id,
        session_id: winner.run.session_id,
        actor_label: winner.run.actor_label ?? undefined,
        operation: winner.run.operation,
        environment: winner.run.environment,
        target: winner.run.target,
        source_revision: winner.run.source_revision,
        parameters_sha256: winner.run.parameters_sha256,
        lease_id: winner.run.lease_id,
        expected_version: winner.slot.version,
        expected_generation: winner.slot.generation,
      } as const;
      const began = await relay.begin(winnerPrincipal, beginInput);
      expect(began.slot.phase).toBe("executing");
      const liveBeginReplay = await relay.begin(winnerPrincipal, beginInput);
      expect(liveBeginReplay.replayed).toBe(true);
      expect(liveBeginReplay.slot).toEqual(began.slot);
      await sql!`
        UPDATE collab.operation_slots
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE project_id = ${PROJECT_ID}
          AND repository_id = ${winnerPrincipal.repository_id}
          AND action_id = ${winner.run.action_id}
      `;
      const completedStatusCycle = await relay.listOperations(
        recoveryPrincipal,
        {
          after: began.slot.sequence,
          limit: 100,
        },
      );
      expect(completedStatusCycle.operations).toEqual([]);
      expect(completedStatusCycle.has_more).toBe(false);
      expect(completedStatusCycle.next_after).toBe(0);
      const effective = await relay.listOperations(recoveryPrincipal, {
        after: 0,
        limit: 100,
      });
      const recoverySlot = effective.operations.find(
        (slot) => slot.action_id === winner.run.action_id,
      );
      expect(recoverySlot?.phase).toBe("recovery_required");
      const eventsBeforeMaterialization = await relay.listEvents(
        winnerPrincipal,
        {
          after: 0,
          limit: 200,
        },
      );
      expect(
        eventsBeforeMaterialization.events.find(
          (event) => event.type === "operation.recovery_required",
        ),
      ).toBeUndefined();
      await expect(
        relay.begin(winnerPrincipal, beginInput),
      ).rejects.toMatchObject({
        code: "recovery_required",
        status: 409,
      });
      const events = await relay.listEvents(winnerPrincipal, {
        after: 0,
        limit: 200,
      });
      expect(
        events.events.find(
          (event) => event.type === "operation.recovery_required",
        ),
      ).toMatchObject({
        device_id: null,
        session_id: null,
        actor_label: null,
      });

      const uncertain = await relay.recover(recoveryPrincipal, {
        schema: "agenttool.collab-operation-recover/1",
        idempotency_key: "recover-uncertain",
        action_id: winner.run.action_id,
        session_id: winnerIsA ? SESSION_B : SESSION_A,
        actor_label: "independent-recovery",
        operation: winner.run.operation,
        environment: winner.run.environment,
        target: winner.run.target,
        source_revision: winner.run.source_revision,
        parameters_sha256: winner.run.parameters_sha256,
        expected_version: recoverySlot!.version,
        expected_generation: recoverySlot!.generation,
        disposition: "uncertain",
        reason: "Provider facts are still incomplete.",
      });
      expect(uncertain.slot.phase).toBe("recovery_required");
      const recovered = await relay.recover(recoveryPrincipal, {
        schema: "agenttool.collab-operation-recover/1",
        idempotency_key: "recover-terminal",
        action_id: winner.run.action_id,
        session_id: winnerIsA ? SESSION_B : SESSION_A,
        actor_label: "independent-recovery",
        operation: winner.run.operation,
        environment: winner.run.environment,
        target: winner.run.target,
        source_revision: winner.run.source_revision,
        parameters_sha256: winner.run.parameters_sha256,
        expected_version: uncertain.slot.version,
        expected_generation: uncertain.slot.generation,
        disposition: "succeeded",
        reason: "Registry artifact digest and package metadata now match.",
      });
      expect(recovered.slot.phase).toBe("idle");
      expect(recovered.run.status).toBe("succeeded");
      await expect(
        relay.begin(winnerPrincipal, beginInput),
      ).rejects.toMatchObject({
        code: "stale_fence",
        status: 409,
      });

      const nextClaim = await relay.claim(
        recoveryPrincipal,
        claim({
          actionId: ACTION_C,
          sessionId: winnerIsA ? SESSION_B : SESSION_A,
          actorLabel: "next-generation-release",
          idempotencyKey: "claim-next-generation",
        }),
      );
      expect(nextClaim.slot.generation).toBeGreaterThan(
        began.slot.generation,
      );
      await expect(
        relay.begin(winnerPrincipal, beginInput),
      ).rejects.toMatchObject({
        code: "stale_fence",
        status: 409,
      });
      await relay.release(recoveryPrincipal, {
        schema: "agenttool.collab-operation-release/1",
        idempotency_key: "release-next-generation",
        action_id: nextClaim.run.action_id,
        session_id: nextClaim.run.session_id,
        actor_label: nextClaim.run.actor_label ?? undefined,
        operation: nextClaim.run.operation,
        environment: nextClaim.run.environment,
        target: nextClaim.run.target,
        source_revision: nextClaim.run.source_revision,
        parameters_sha256: nextClaim.run.parameters_sha256,
        lease_id: nextClaim.run.lease_id,
        expected_version: nextClaim.slot.version,
        expected_generation: nextClaim.slot.generation,
        reason: "Regression cleanup after the newer-generation replay fence.",
      });

      const directClaim = await relay.claim(
        recoveryPrincipal,
        claim({
          actionId: ACTION_D,
          sessionId: winnerIsA ? SESSION_B : SESSION_A,
          actorLabel: "direct-recovery-release",
          idempotencyKey: "claim-direct-recovery",
        }),
      );
      const directBegin = await relay.begin(recoveryPrincipal, {
        schema: "agenttool.collab-operation-begin/1",
        idempotency_key: "begin-direct-recovery",
        action_id: directClaim.run.action_id,
        session_id: directClaim.run.session_id,
        actor_label: directClaim.run.actor_label ?? undefined,
        operation: directClaim.run.operation,
        environment: directClaim.run.environment,
        target: directClaim.run.target,
        source_revision: directClaim.run.source_revision,
        parameters_sha256: directClaim.run.parameters_sha256,
        lease_id: directClaim.run.lease_id,
        expected_version: directClaim.slot.version,
        expected_generation: directClaim.slot.generation,
      });
      await sql!`
        UPDATE collab.operation_slots
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE project_id = ${PROJECT_ID}
          AND repository_id = ${recoveryPrincipal.repository_id}
          AND action_id = ${directClaim.run.action_id}
      `;
      const directEffective = await relay.listOperations(
        recoveryPrincipal,
        { after: 0, limit: 100 },
      );
      const directRecoverySlot = directEffective.operations.find(
        (slot) => slot.action_id === directClaim.run.action_id,
      );
      expect(directRecoverySlot).toMatchObject({
        phase: "recovery_required",
        version: directBegin.slot.version + 1,
      });
      const directEventsBefore = await relay.listEvents(
        recoveryPrincipal,
        { after: 0, limit: 200 },
      );
      expect(
        directEventsBefore.events.find(
          (event) =>
            event.type === "operation.recovery_required"
            && event.body.action_id === directClaim.run.action_id,
        ),
      ).toBeUndefined();
      const directRecovered = await relay.recover(recoveryPrincipal, {
        schema: "agenttool.collab-operation-recover/1",
        idempotency_key: "recover-direct-expiry",
        action_id: directClaim.run.action_id,
        session_id: directClaim.run.session_id,
        actor_label: directClaim.run.actor_label ?? undefined,
        operation: directClaim.run.operation,
        environment: directClaim.run.environment,
        target: directClaim.run.target,
        source_revision: directClaim.run.source_revision,
        parameters_sha256: directClaim.run.parameters_sha256,
        expected_version: directRecoverySlot!.version,
        expected_generation: directRecoverySlot!.generation,
        disposition: "succeeded",
        reason: "Provider facts show the direct-recovery action completed.",
      });
      expect(directRecovered.slot.phase).toBe("idle");
      expect(directRecovered.run.status).toBe("succeeded");
      const directEventsAfter = await relay.listEvents(
        recoveryPrincipal,
        { after: 0, limit: 200 },
      );
      expect(
        directEventsAfter.events.find(
          (event) =>
            event.type === "operation.recovery_required"
            && event.body.action_id === directClaim.run.action_id,
        ),
      ).toMatchObject({
        device_id: null,
        session_id: null,
        actor_label: null,
      });

      const paginationClaim = await relay.claim(recoveryPrincipal, {
        ...claim({
          actionId: ACTION_F,
          sessionId: winnerIsA ? SESSION_B : SESSION_A,
          actorLabel: "operation-pagination",
          idempotencyKey: "claim-operation-pagination",
        }),
        operation: "github.merge",
        environment: "github",
        target: "refs/heads/main",
      });
      const paginationRelease = await relay.release(recoveryPrincipal, {
        schema: "agenttool.collab-operation-release/1",
        idempotency_key: "release-operation-pagination",
        action_id: paginationClaim.run.action_id,
        session_id: paginationClaim.run.session_id,
        actor_label: paginationClaim.run.actor_label ?? undefined,
        operation: paginationClaim.run.operation,
        environment: paginationClaim.run.environment,
        target: paginationClaim.run.target,
        source_revision: paginationClaim.run.source_revision,
        parameters_sha256: paginationClaim.run.parameters_sha256,
        lease_id: paginationClaim.run.lease_id,
        expected_version: paginationClaim.slot.version,
        expected_generation: paginationClaim.slot.generation,
        reason: "Leave a second durable slot for operation-page pagination.",
      });
      expect(paginationRelease.slot.phase).toBe("idle");

      const firstOperationPage = await relay.listOperations(
        recoveryPrincipal,
        { after: 0, limit: 1 },
      );
      expect(firstOperationPage.operations).toHaveLength(1);
      expect(firstOperationPage.has_more).toBe(true);
      expect(firstOperationPage.next_after).toBe(
        firstOperationPage.operations[0]!.sequence,
      );
      const terminalOperationPage = await relay.listOperations(
        recoveryPrincipal,
        { after: firstOperationPage.next_after, limit: 1 },
      );
      expect(terminalOperationPage.operations).toHaveLength(1);
      expect(terminalOperationPage.has_more).toBe(false);
      expect(terminalOperationPage.next_after).toBe(0);
      expect(
        [
          ...firstOperationPage.operations,
          ...terminalOperationPage.operations,
        ].map((slot) => `${slot.operation}/${slot.environment}`).sort(),
      ).toEqual(["github.merge/github", "npm.publish/npm"]);

      await expect(
        relay.importObservation(winnerPrincipal, {
          ...observation({
            idempotencyKey: "observation-vercel-disabled",
            sessionId: winner.run.session_id,
            actorLabel: "unbound-vercel-observer",
            providerEventId: "vercel:deployment:unbound",
            observedAt: "2026-07-23T19:58:00.000Z",
            occurredAt: "2026-07-23T19:58:00.000Z",
          }),
          provider: "vercel",
          resource_kind: "deployment",
          resource_id: "unbound-deployment",
          native_state: "READY",
          url: "https://vercel.com/example/deployment",
        }),
      ).rejects.toMatchObject({
        code: "provider_not_enabled",
        status: 403,
      });

      const providerEventId = "npm:@agenttool/collab@0.4.0";
      const firstObservationInput = observation({
        idempotencyKey: "observation-a",
        sessionId: winner.run.session_id,
        actorLabel: "first-observer",
        actionId: winner.run.action_id,
        providerEventId,
        observedAt: "2026-07-23T20:00:00.000Z",
        occurredAt: "2026-07-23T19:59:00.000Z",
      });
      const firstObservation = await relay.importObservation(
        winnerPrincipal,
        firstObservationInput,
      );
      const deduplicated = await relay.importObservation(
        recoveryPrincipal,
        observation({
          idempotencyKey: "observation-b",
          sessionId: winnerIsA ? SESSION_B : SESSION_A,
          actorLabel: "second-observer",
          actionId: winner.run.action_id,
          providerEventId,
          observedAt: "2026-07-23T21:00:00.000Z",
          occurredAt: "2026-07-23T20:59:00+01:00",
        }),
      );
      expect(firstObservation.deduplicated).toBe(false);
      expect(deduplicated.deduplicated).toBe(true);
      expect(deduplicated.observation.observation_id).toBe(
        firstObservation.observation.observation_id,
      );

      await relay.importObservation(
        winnerPrincipal,
        observation({
          idempotencyKey: "observation-out-of-order",
          sessionId: winner.run.session_id,
          actorLabel: "first-observer",
          actionId: winner.run.action_id,
          providerEventId: "npm:older-provider-event",
          observedAt: "2026-07-23T21:01:00.000Z",
          occurredAt: "2026-07-22T19:59:00.000Z",
        }),
      );
      const winnerToken = winnerIsA ? TOKEN_A_NEW : TOKEN_B;
      const narrowed = await relay.enrol(
        PROJECT_ID,
        enrollment({
          repositoryKey: "github:1261120431",
          providerId: "1261120431",
          displayName: "cambridgetcg/agenttool",
          deviceId: winnerPrincipal.device_id,
          deviceLabel: winnerPrincipal.device_label,
          token: winnerToken,
          expectedDeviceVersion: winnerIsA ? 2 : 1,
          profileSha256: "e".repeat(64),
          allowedProviders: [
            "cloudflare-pages",
            "fly",
            "github",
          ],
        }),
      );
      expect(narrowed.device.version).toBe(winnerIsA ? 3 : 2);
      expect(await requirePrincipal(winnerToken)).not.toBeNull();
      const historicalObservationReplay = await relay.importObservation(
        winnerPrincipal,
        firstObservationInput,
      );
      expect(historicalObservationReplay.replayed).toBe(true);
      expect(historicalObservationReplay.receipt).toEqual(
        firstObservation.receipt,
      );
      await expect(
        relay.importObservation(
          winnerPrincipal,
          observation({
            idempotencyKey: "observation-after-policy-narrowing",
            sessionId: winner.run.session_id,
            actorLabel: "first-observer",
            providerEventId: "npm:new-after-policy-narrowing",
            observedAt: "2026-07-23T21:02:00.000Z",
            occurredAt: "2026-07-23T21:02:00.000Z",
          }),
        ),
      ).rejects.toMatchObject({
        code: "provider_not_enabled",
        status: 403,
      });
      const repositoryAPage = await relay.listObservations(winnerPrincipal, {
        after: 0,
        limit: 100,
      });
      expect(repositoryAPage.observations.map((row) => row.occurred_at)).toEqual([
        "2026-07-23T19:59:00.000Z",
        "2026-07-22T19:59:00.000Z",
      ]);

      const repositoryC = await relay.enrol(
        PROJECT_ID,
        enrollment({
          repositoryKey: "github:999999999",
          providerId: "999999999",
          displayName: "cambridgetcg/other",
          deviceId: DEVICE_C,
          deviceLabel: "other repository device",
          token: TOKEN_C,
        }),
      );
      const principalC = await requirePrincipal(TOKEN_C);
      expect(principalC.repository_id).toBe(repositoryC.repository.id);
      const isolated = await relay.importObservation(
        principalC,
        observation({
          idempotencyKey: "observation-isolated",
          sessionId: SESSION_C,
          actorLabel: "other-repo-observer",
          providerEventId,
          observedAt: "2026-07-23T22:00:00.000Z",
          occurredAt: "2026-07-23T19:59:00.000Z",
        }),
      );
      expect(isolated.deduplicated).toBe(false);
      const repositoryCPage = await relay.listObservations(principalC, {
        after: 0,
        limit: 100,
      });
      expect(repositoryCPage.observations).toHaveLength(1);
      expect(repositoryCPage.observations[0]?.repository_id).toBe(
        repositoryC.repository.id,
      );
      expect(
        repositoryAPage.observations.every(
          (row) => row.repository_id === winnerPrincipal.repository_id,
        ),
      ).toBe(true);
    },
    60_000,
  );
});
