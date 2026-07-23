/** Hermetic protocol/state locks for the cross-device collaboration relay. */

import { describe, expect, test } from "bun:test";

import {
  collabEnrolmentSchema,
  operationClaimSchema,
  providerObservationSchema,
  type CollabEnrolmentInput,
  type OperationSlotRecord,
  type ProviderObservationInput,
} from "../src/services/collab-relay/contracts";
import {
  collabEnrolmentIdempotencyKey,
  collabSha256,
  providerObservationProjectionSha256,
} from "../src/services/collab-relay/canonical";
import { CollabRelayError } from "../src/services/collab-relay/errors";
import { actionableReplayDecision } from "../src/services/collab-relay/replay";
import {
  enrollmentDeviceEvent,
  expiredLeaseTransition,
  SERVER_DERIVED_ATTRIBUTION,
} from "../src/services/collab-relay/state";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const REPOSITORY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPOSITORY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEVICE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SESSION_A = "aaaaaaaa-2222-4222-8222-222222222222";
const ACTION_A = "aaaaaaaa-3333-4333-8333-333333333333";
const SHA256_A = "a".repeat(64);
const REVISION_A = "b".repeat(40);

function enrollment(): CollabEnrolmentInput {
  const intent: Omit<CollabEnrolmentInput, "idempotency_key"> = {
    schema: "agenttool.collab-enrolment/1",
    expected_device_version: 0,
    repository: {
      key: "github:1261120431",
      provider: "github",
      provider_repository_id: "1261120431",
      display_name: "cambridgetcg/agenttool",
    },
    device: { id: DEVICE_A, label: "Yu MacBook" },
    observation_policy: {
      profile_sha256: "c".repeat(64),
      allowed_providers: [
        "cloudflare-pages",
        "fly",
        "github",
        "npm",
      ],
    },
    token: { prefix: "atc_12345678", sha256: SHA256_A },
  };
  return {
    ...intent,
    idempotency_key: collabEnrolmentIdempotencyKey(intent),
  };
}

function observation(
  overrides: Partial<ProviderObservationInput> = {},
): ProviderObservationInput {
  return providerObservationSchema.parse({
    schema: "agenttool.collab-provider-observation/1",
    idempotency_key: "obs-1",
    session_id: SESSION_A,
    actor_label: "codex-release",
    action_id: ACTION_A,
    provider: "npm",
    provider_event_id: "npm:@agenttool/collab@0.4.0",
    observed_at: "2026-07-23T20:00:00.000Z",
    occurred_at: "2026-07-23T19:59:00.000Z",
    resource_kind: "package_version",
    resource_id: "@agenttool/collab@0.4.0",
    native_state: "published",
    normalized_state: "succeeded",
    source_revision: REVISION_A,
    environment: "npm",
    url: "https://registry.npmjs.org/@agenttool/collab",
    payload_sha256: SHA256_A,
    ...overrides,
  });
}

function operationSlot(
  overrides: Partial<OperationSlotRecord> = {},
): OperationSlotRecord {
  return {
    sequence: 2,
    repository_id: REPOSITORY_A,
    operation: "npm.publish",
    environment: "npm",
    phase: "executing",
    action_id: ACTION_A,
    holder_device_id: DEVICE_A,
    session_id: SESSION_A,
    actor_label: "codex-release",
    lease_id: "aaaaaaaa-4444-4444-8444-444444444444",
    lease_expires_at: "2026-07-23T20:05:00.000Z",
    version: 2,
    generation: 1,
    target: "@agenttool/collab@0.4.0",
    source_revision: REVISION_A,
    parameters_sha256: SHA256_A,
    updated_at: "2026-07-23T20:00:00.000Z",
    ...overrides,
  };
}

class AtomicRelayReference {
  private tail = Promise.resolve();
  private readonly slots = new Map<
    string,
    { action: string; phase: "claimed" | "executing" | "recovery_required" }
  >();
  private readonly receipts = new Map<
    string,
    { requestHash: string; response: { action: string } }
  >();
  private readonly observations = new Map<
    string,
    { hash: string; sequence: number; occurredAt: string | null }
  >();
  private sequence = 0;

  private async atomic<T>(fn: () => T | Promise<T>): Promise<T> {
    const predecessor = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async claim(input: {
    project: string;
    repository: string;
    device: string;
    operation: string;
    environment: string;
    action: string;
    idempotencyKey: string;
    body: unknown;
  }): Promise<{ action: string; replayed: boolean }> {
    return this.atomic(() => {
      const requestHash = collabSha256(input.body);
      const receiptKey = [
        input.project,
        input.repository,
        input.device,
        input.idempotencyKey,
      ].join(":");
      const receipt = this.receipts.get(receiptKey);
      if (receipt) {
        if (receipt.requestHash !== requestHash) {
          throw new CollabRelayError(
            "idempotency_mismatch",
            "different canonical bytes",
            409,
          );
        }
        return { ...receipt.response, replayed: true };
      }
      const slotKey = [
        input.project,
        input.repository,
        input.operation,
        input.environment,
      ].join(":");
      if (this.slots.has(slotKey)) {
        throw new CollabRelayError(
          "operation_contended",
          "one repository operation already won",
          409,
        );
      }
      this.slots.set(slotKey, {
        action: input.action,
        phase: "claimed",
      });
      const response = { action: input.action };
      this.receipts.set(receiptKey, { requestHash, response });
      return { ...response, replayed: false };
    });
  }

  expireExecuting(input: {
    project: string;
    repository: string;
    operation: string;
    environment: string;
  }): string {
    const key = [
      input.project,
      input.repository,
      input.operation,
      input.environment,
    ].join(":");
    const slot = this.slots.get(key);
    if (!slot) throw new Error("missing slot");
    slot.phase = "executing";
    if (
      expiredLeaseTransition(
        slot.phase,
        new Date("2026-07-23T20:00:00.000Z"),
        new Date("2026-07-23T20:00:01.000Z"),
      ) === "require_recovery"
    ) {
      slot.phase = "recovery_required";
    }
    return slot.phase;
  }

  importObservation(input: {
    project: string;
    repository: string;
    observation: ProviderObservationInput;
  }): { deduplicated: boolean; sequence: number } {
    const providerEventId = input.observation.provider_event_id;
    const hash = providerObservationProjectionSha256(input.observation);
    const key = [
      input.project,
      input.repository,
      input.observation.provider,
      providerEventId ?? `receipt:${input.observation.idempotency_key}`,
    ].join(":");
    const existing = this.observations.get(key);
    if (existing) {
      if (existing.hash !== hash) {
        throw new CollabRelayError(
          "provider_event_mismatch",
          "provider ID names different projection",
          409,
        );
      }
      return { deduplicated: true, sequence: existing.sequence };
    }
    this.sequence += 1;
    this.observations.set(key, {
      hash,
      sequence: this.sequence,
      occurredAt: input.observation.occurred_at ?? null,
    });
    return { deduplicated: false, sequence: this.sequence };
  }

  occurrenceOrder(): Array<string | null> {
    return [...this.observations.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map((row) => row.occurredAt);
  }
}

describe("collab relay strict contracts", () => {
  test("enrollment accepts only a token prefix and digest, never a raw secret", () => {
    expect(collabEnrolmentSchema.parse(enrollment())).toEqual(enrollment());
    expect(enrollment().idempotency_key).toMatch(/^enrol:[0-9a-f]{64}$/);
    expect(
      collabEnrolmentIdempotencyKey({
        ...enrollment(),
        device: { ...enrollment().device, label: "another device label" },
      }),
    ).not.toBe(enrollment().idempotency_key);
    expect(
      collabEnrolmentSchema.safeParse({
        ...enrollment(),
        token: {
          ...enrollment().token,
          raw: `atc_${"x".repeat(43)}`,
        },
      }).success,
    ).toBe(false);
    expect(
      collabEnrolmentSchema.safeParse({
        ...enrollment(),
        device: { ...enrollment().device, label: "release\noperator" },
      }).success,
    ).toBe(false);
    for (const control of ["\t", "\u001f", "\u007f"]) {
      expect(
        collabEnrolmentSchema.safeParse({
          ...enrollment(),
          repository: {
            ...enrollment().repository,
            display_name: `release${control}operator`,
          },
        }).success,
      ).toBe(false);
    }
    expect(
      collabEnrolmentSchema.safeParse({
        ...enrollment(),
        observation_policy: {
          ...enrollment().observation_policy,
          allowed_providers: ["npm", "github"],
        },
      }).success,
    ).toBe(false);
  });

  test("operation claims require multi-session attribution and workflow bounds", () => {
    const claim = {
      schema: "agenttool.collab-operation-claim/1",
      idempotency_key: "claim-1",
      action_id: ACTION_A,
      session_id: SESSION_A,
      actor_label: "codex-release",
      operation: "npm.publish",
      environment: "npm",
      target: "@agenttool/collab@0.4.0",
      source_revision: REVISION_A,
      parameters_sha256: SHA256_A,
      lease_seconds: 60,
    };
    expect(operationClaimSchema.parse(claim).session_id).toBe(SESSION_A);
    expect(
      operationClaimSchema.safeParse({ ...claim, session_id: undefined })
        .success,
    ).toBe(false);
    expect(
      operationClaimSchema.safeParse({ ...claim, lease_seconds: 29 }).success,
    ).toBe(false);
    expect(
      operationClaimSchema.safeParse({ ...claim, operation: "NPM/PUBLISH" })
        .success,
    ).toBe(false);
  });

  test("provider imports reject raw bodies/logs and arbitrary normalized states", () => {
    expect(providerObservationSchema.parse(observation())).toBeTruthy();
    expect(
      providerObservationSchema.safeParse({
        ...observation(),
        raw_body: { secret: "must-not-enter-relay" },
      }).success,
    ).toBe(false);
    expect(
      providerObservationSchema.safeParse({
        ...observation(),
        normalized_state: "probably-fine",
      }).success,
    ).toBe(false);
    expect(
      providerObservationSchema.safeParse({
        ...observation(),
        resource_id: `atc_${"S".repeat(43)}`,
      }).success,
    ).toBe(false);
    expect(
      operationClaimSchema.safeParse({
        ...operationClaimSchema.parse({
          schema: "agenttool.collab-operation-claim/1",
          idempotency_key: "claim-secret-pattern",
          action_id: ACTION_A,
          session_id: SESSION_A,
          actor_label: "codex-release",
          operation: "npm.publish",
          environment: "npm",
          target: "@agenttool/collab@0.4.0",
          source_revision: REVISION_A,
          parameters_sha256: SHA256_A,
          lease_seconds: 60,
        }),
        target: `Bearer ${"S".repeat(24)}`,
      }).success,
    ).toBe(false);
    const credentialShape = `npm_${"s".repeat(20)}`;
    for (const candidate of [
      { ...observation(), idempotency_key: credentialShape },
      { ...observation(), environment: credentialShape },
      {
        schema: "agenttool.collab-operation-claim/1",
        idempotency_key: "claim-secret-parity",
        action_id: ACTION_A,
        session_id: SESSION_A,
        operation: credentialShape,
        environment: "npm",
        target: "@agenttool/collab@0.4.0",
        source_revision: REVISION_A,
        parameters_sha256: SHA256_A,
        lease_seconds: 60,
      },
    ]) {
      const schema = "provider" in candidate
        ? providerObservationSchema
        : operationClaimSchema;
      expect(schema.safeParse(candidate).success).toBe(false);
    }
    for (const url of [
      "https://token:secret@example.com/deploy",
      "https://example.com/deploy?access_token=secret",
      "https://example.com/deploy#secret",
      `https://example.com/artifacts/npm_${"s".repeat(20)}`,
      `https://example.com/artifacts/npm_%73${"s".repeat(19)}`,
    ]) {
      expect(
        providerObservationSchema.safeParse({ ...observation(), url }).success,
      ).toBe(false);
    }
  });
});

describe("collab durable semantics", () => {
  test("same provider fact deduplicates across observer/session/time attribution", () => {
    const first = observation();
    const second = observation({
      idempotency_key: "obs-other-device",
      session_id: "cccccccc-2222-4222-8222-222222222222",
      actor_label: "claude-review",
      observed_at: "2026-07-23T20:10:00.000Z",
    });
    expect(providerObservationProjectionSha256(second)).toBe(
      providerObservationProjectionSha256(first),
    );
    expect(
      providerObservationProjectionSha256(
        observation({ occurred_at: "2026-07-23T20:59:00+01:00" }),
      ),
    ).toBe(providerObservationProjectionSha256(first));
    expect(
      providerObservationProjectionSha256(
        observation({ native_state: "revoked", normalized_state: "failed" }),
      ),
    ).not.toBe(providerObservationProjectionSha256(first));
  });

  test("credential rotation and mutable labels are distinct from an exact retry", () => {
    expect(
      enrollmentDeviceEvent({
        exists: true,
        credential_changed: false,
        metadata_changed: false,
      }),
    ).toBeNull();
    expect(
      enrollmentDeviceEvent({
        exists: true,
        credential_changed: false,
        metadata_changed: true,
      }),
    ).toBe("device.metadata_updated");
    expect(
      enrollmentDeviceEvent({
        exists: true,
        credential_changed: true,
        metadata_changed: true,
      }),
    ).toBe("device.credential_rotated");
  });

  test("expired execution becomes recovery-required with server attribution", () => {
    expect(
      expiredLeaseTransition(
        "claimed",
        new Date("2026-07-23T20:00:00.000Z"),
        new Date("2026-07-23T20:00:01.000Z"),
      ),
    ).toBe("release_claim");
    expect(
      expiredLeaseTransition(
        "executing",
        new Date("2026-07-23T20:00:00.000Z"),
        new Date("2026-07-23T20:00:01.000Z"),
      ),
    ).toBe("require_recovery");
    expect(SERVER_DERIVED_ATTRIBUTION).toEqual({
      device_id: null,
      session_id: null,
      actor_label: null,
    });
  });

  test("actionable receipt replay is live only at the exact current fence", () => {
    const replayed = operationSlot();
    const beforeExpiry = new Date("2026-07-23T20:04:59.000Z");
    expect(
      actionableReplayDecision("begin", replayed, replayed, beforeExpiry),
    ).toBe("current");
    expect(
      actionableReplayDecision(
        "begin",
        replayed,
        operationSlot({ version: 3, sequence: 3 }),
        beforeExpiry,
      ),
    ).toBe("stale");
    expect(
      actionableReplayDecision(
        "begin",
        replayed,
        operationSlot({
          action_id: "dddddddd-3333-4333-8333-333333333333",
          lease_id: "dddddddd-4444-4444-8444-444444444444",
          generation: 2,
          version: 4,
          sequence: 4,
        }),
        beforeExpiry,
      ),
    ).toBe("stale");
    expect(
      actionableReplayDecision(
        "begin",
        replayed,
        operationSlot({
          phase: "recovery_required",
          version: 3,
          sequence: 3,
        }),
        beforeExpiry,
      ),
    ).toBe("recovery_required");
    expect(
      actionableReplayDecision(
        "begin",
        replayed,
        replayed,
        new Date("2026-07-23T20:05:00.000Z"),
      ),
    ).toBe("require_recovery");

    const claimed = operationSlot({
      sequence: 1,
      phase: "claimed",
      version: 1,
    });
    expect(
      actionableReplayDecision(
        "claim",
        claimed,
        claimed,
        new Date("2026-07-23T20:05:00.000Z"),
      ),
    ).toBe("release_claim");
  });

  test("exact idempotent retry replays and changed bytes conflict", async () => {
    const relay = new AtomicRelayReference();
    const base = {
      project: PROJECT_A,
      repository: REPOSITORY_A,
      device: DEVICE_A,
      operation: "npm.publish",
      environment: "npm",
      action: ACTION_A,
      idempotencyKey: "claim-1",
      body: { action_id: ACTION_A, target: "@agenttool/collab@0.4.0" },
    };
    expect(await relay.claim(base)).toEqual({
      action: ACTION_A,
      replayed: false,
    });
    expect(await relay.claim(base)).toEqual({
      action: ACTION_A,
      replayed: true,
    });
    await expect(
      relay.claim({ ...base, body: { ...base.body, target: "other" } }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch", status: 409 });
  });

  test("two concurrent contenders have exactly one winner", async () => {
    const relay = new AtomicRelayReference();
    const contenders = [ACTION_A, "dddddddd-3333-4333-8333-333333333333"].map(
      (action, index) =>
        relay.claim({
          project: PROJECT_A,
          repository: REPOSITORY_A,
          device: DEVICE_A,
          operation: "deploy.production",
          environment: "production",
          action,
          idempotencyKey: `claim-${index}`,
          body: { action_id: action },
        }),
    );
    const results = await Promise.allSettled(contenders);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "operation_contended",
      status: 409,
    });
  });

  test("tenant and repository keys isolate otherwise identical slots", async () => {
    const relay = new AtomicRelayReference();
    const common = {
      device: DEVICE_A,
      operation: "deploy.production",
      environment: "production",
      idempotencyKey: "claim-1",
      body: { target: "api" },
    };
    const results = await Promise.all([
      relay.claim({
        ...common,
        project: PROJECT_A,
        repository: REPOSITORY_A,
        action: ACTION_A,
      }),
      relay.claim({
        ...common,
        project: PROJECT_A,
        repository: REPOSITORY_B,
        action: "eeeeeeee-3333-4333-8333-333333333333",
      }),
      relay.claim({
        ...common,
        project: PROJECT_B,
        repository: REPOSITORY_A,
        action: "ffffffff-3333-4333-8333-333333333333",
      }),
    ]);
    expect(results).toHaveLength(3);
  });

  test("out-of-order provider occurrence is retained in receipt order and deduped", () => {
    const relay = new AtomicRelayReference();
    const laterProviderTime = observation({
      idempotency_key: "obs-later",
      provider_event_id: "npm:event-later",
      occurred_at: "2026-07-23T20:10:00.000Z",
    });
    const earlierProviderTime = observation({
      idempotency_key: "obs-earlier",
      provider_event_id: "npm:event-earlier",
      occurred_at: "2026-07-23T19:10:00.000Z",
    });
    expect(
      relay.importObservation({
        project: PROJECT_A,
        repository: REPOSITORY_A,
        observation: laterProviderTime,
      }),
    ).toEqual({ deduplicated: false, sequence: 1 });
    expect(
      relay.importObservation({
        project: PROJECT_A,
        repository: REPOSITORY_A,
        observation: earlierProviderTime,
      }),
    ).toEqual({ deduplicated: false, sequence: 2 });
    expect(relay.occurrenceOrder()).toEqual([
      "2026-07-23T20:10:00.000Z",
      "2026-07-23T19:10:00.000Z",
    ]);
    expect(
      relay.importObservation({
        project: PROJECT_A,
        repository: REPOSITORY_A,
        observation: observation({
          ...laterProviderTime,
          idempotency_key: "seen-on-other-device",
          session_id: "cccccccc-2222-4222-8222-222222222222",
          observed_at: "2026-07-23T21:00:00.000Z",
        }),
      }),
    ).toEqual({ deduplicated: true, sequence: 1 });
  });

  test("executing expiry blocks reuse until explicit recovery", async () => {
    const relay = new AtomicRelayReference();
    await relay.claim({
      project: PROJECT_A,
      repository: REPOSITORY_A,
      device: DEVICE_A,
      operation: "npm.publish",
      environment: "npm",
      action: ACTION_A,
      idempotencyKey: "claim",
      body: { action_id: ACTION_A },
    });
    expect(
      relay.expireExecuting({
        project: PROJECT_A,
        repository: REPOSITORY_A,
        operation: "npm.publish",
        environment: "npm",
      }),
    ).toBe("recovery_required");
  });
});

describe("collab Postgres authority wiring", () => {
  test("uses a repository FOR UPDATE stream and no Redis idempotency", async () => {
    const source = await Bun.file(
      new URL(
        "../src/services/collab-relay/postgres-store.ts",
        import.meta.url,
      ),
    ).text();
    const index = await Bun.file(
      new URL("../src/index.ts", import.meta.url),
    ).text();
    expect(source).toContain(".from(collabRepositoryStreams)");
    expect(source).toContain('.for("update")');
    expect(source).toContain(
      "eq(collabDevices.tokenSha256, tokenSha256)",
    );
    expect(source).toContain("/^atc_[A-Za-z0-9_-]{43}$/");
    expect(source).toContain("collabMutationReceipts");
    expect(source).not.toContain("redis");
    expect(index).toContain('app.route("/v1/collab", collabRouter)');
    expect(index).not.toContain(
      'app.use("/v1/collab/*", idempotency())',
    );
  });

  test("migration enforces scoped rows and nullable-ID provider dedupe", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260723T210000_collab_relay.sql",
        import.meta.url,
      ),
    ).text();
    for (const table of [
      "devices",
      "repository_streams",
      "events",
      "mutation_receipts",
      "operation_slots",
      "operation_runs",
      "provider_observations",
    ]) {
      const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS collab.${table}`);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(migration.slice(start, start + 900)).toContain("project_id UUID NOT NULL");
      expect(migration.slice(start, start + 900)).toContain("repository_id UUID NOT NULL");
    }
    expect(migration).toContain("WHERE provider_event_id IS NOT NULL");
    expect(migration).toContain(
      "PRIMARY KEY (project_id, repository_id, device_id, idempotency_key)",
    );
    expect(migration).toContain(
      "CHECK (version BETWEEN 1 AND 9007199254740991)",
    );
    expect(migration).toContain(
      "REFERENCES collab.devices(project_id, repository_id, id) ON DELETE RESTRICT",
    );
  });
});
