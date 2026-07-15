/** SDK v0.11 memory compatibility — hermetic service regression.
 *
 *  v0.11 sends the selected identity UUID as `agent_id`, while identity
 *  composition and wake events use the canonical `identity_id` column. These
 *  tests exercise the real memory write service with a staged Drizzle adapter:
 *  no database, Redis, listener, or credentials are required. */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

const PROJECT_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_PROJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const IDENTITY_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const MEMORY_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const CREATED_AT = new Date("2026-07-15T12:00:00.000Z");

interface IdentityCandidate {
  id: string;
  projectId: string;
  status: string;
}

let stagedCandidate: IdentityCandidate | undefined;
let stagedCandidateSequence: Array<IdentityCandidate | undefined> = [];
let identitySelectCalls = 0;
let lockedIdentitySelectCalls = 0;
let inTransaction = false;
let failFinalize = false;
let finalizeAttempts = 0;
const insertedValues: Array<Record<string, unknown>> = [];
const wakeEvents: Array<Record<string, unknown>> = [];
const reservations: string[] = [];
const finalizedReservations: string[] = [];
const operationOrder: string[] = [];

function selectedCandidate(): IdentityCandidate | undefined {
  return stagedCandidateSequence.length > 0
    ? stagedCandidateSequence.shift()
    : stagedCandidate;
}

const mockDb = {
  select: mock(() => {
    identitySelectCalls += 1;
    return {
      from: () => ({
        where: () => ({
          limit: () => {
            const candidate = selectedCandidate();
            return Promise.resolve(candidate ? [candidate] : []);
          },
          for: (mode: string) => ({
            limit: () => {
              if (mode === "share") lockedIdentitySelectCalls += 1;
              operationOrder.push(`identity-lock:${mode}`);
              const candidate = selectedCandidate();
              return Promise.resolve(candidate ? [candidate] : []);
            },
          }),
        }),
      }),
    };
  }),
  insert: mock(() => ({
    values: (values: Record<string, unknown>) => {
      operationOrder.push(inTransaction ? "memory-insert:tx" : "memory-insert:root");
      insertedValues.push(values);
      return {
        returning: () => Promise.resolve([{ id: MEMORY_ID, createdAt: CREATED_AT }]),
      };
    },
  })),
  transaction: mock(async (callback: (tx: typeof mockDb) => Promise<unknown>) => {
    const insertedLength = insertedValues.length;
    const previousTransaction = inTransaction;
    inTransaction = true;
    operationOrder.push("transaction:start");
    try {
      const result = await callback(mockDb);
      operationOrder.push("transaction:commit");
      return result;
    } catch (error) {
      insertedValues.length = insertedLength;
      operationOrder.push("transaction:rollback");
      throw error;
    } finally {
      inTransaction = previousTransaction;
    }
  }),
};

mock.module("../src/db/client", () => ({ db: mockDb }));
mock.module("../src/services/wake/push", () => ({
  publishWakeEvent: mock(async (event: Record<string, unknown>) => {
    operationOrder.push("wake-publish");
    wakeEvents.push(event);
  }),
}));

const reserveForTest = mock(async () => {
  operationOrder.push("reserve");
  reservations.push("memory.write");
  return {
    creditsUsed: 1,
    creditsRemaining: 999,
    usageEventId: "usage-event",
    projectId: PROJECT_ID,
  };
});

const finalizeForTest = mock(async (_reservation, _duration, database) => {
  finalizeAttempts += 1;
  operationOrder.push(
    database === mockDb && inTransaction ? "finalize:tx" : "finalize:outside",
  );
  if (failFinalize) throw new Error("usage finalization failed");
  finalizedReservations.push("usage-event");
});

const { write } = await import("../src/services/memory/store");
const { composeFromFoundations } = await import("../src/services/identity/composition");
const { createMemoryWriteHandler } = await import("../src/routes/memory/memories");

const routeApp = () => {
  const app = new Hono();
  app.onError((_error, c) => c.json({ error: "internal" }, 500));
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID, credits: 1_000 });
    c.set("clientSource", "test");
    await next();
  });
  app.post("/", createMemoryWriteHandler({
    reserve: reserveForTest as never,
    finalize: finalizeForTest as never,
    database: mockDb as never,
  }));
  return app;
};

beforeEach(() => {
  stagedCandidate = undefined;
  stagedCandidateSequence = [];
  identitySelectCalls = 0;
  lockedIdentitySelectCalls = 0;
  inTransaction = false;
  failFinalize = false;
  finalizeAttempts = 0;
  insertedValues.length = 0;
  wakeEvents.length = 0;
  reservations.length = 0;
  finalizedReservations.length = 0;
  operationOrder.length = 0;
});

describe("POST /v1/memories billing order", () => {
  test("refuses an invalid explicit identity before reserving a credit", async () => {
    stagedCandidate = {
      id: IDENTITY_ID,
      projectId: OTHER_PROJECT_ID,
      status: "active",
    };

    const response = await routeApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identity_id: IDENTITY_ID,
        type: "episodic",
        content: "must be refused before billing",
      }),
    });

    expect(response.status).toBe(404);
    expect(reservations).toEqual([]);
    expect(finalizedReservations).toEqual([]);
    expect(insertedValues).toEqual([]);
  });

  test("marks the reservation successful only after the memory insert", async () => {
    stagedCandidate = {
      id: IDENTITY_ID,
      projectId: PROJECT_ID,
      status: "active",
    };

    const response = await routeApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identity_id: IDENTITY_ID,
        type: "episodic",
        content: "bill the completed write",
      }),
    });

    expect(response.status).toBe(201);
    expect(reservations).toEqual(["memory.write"]);
    expect(insertedValues).toHaveLength(1);
    expect(finalizedReservations).toEqual(["usage-event"]);
    expect(lockedIdentitySelectCalls).toBe(1);
    expect(operationOrder).toEqual([
      "reserve",
      "transaction:start",
      "identity-lock:share",
      "memory-insert:tx",
      "finalize:tx",
      "transaction:commit",
      "wake-publish",
    ]);
  });

  test("rechecks active ownership under lock after reservation", async () => {
    stagedCandidateSequence = [
      { id: IDENTITY_ID, projectId: PROJECT_ID, status: "active" },
      { id: IDENTITY_ID, projectId: PROJECT_ID, status: "revoked" },
    ];

    const response = await routeApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identity_id: IDENTITY_ID,
        type: "episodic",
        content: "must not race an identity revocation",
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "memory_identity_changed_during_write",
      charged_attempt: true,
    });
    expect(reservations).toEqual(["memory.write"]);
    expect(lockedIdentitySelectCalls).toBe(1);
    expect(insertedValues).toEqual([]);
    expect(finalizeAttempts).toBe(0);
    expect(wakeEvents).toEqual([]);
    expect(operationOrder).toEqual([
      "reserve",
      "transaction:start",
      "identity-lock:share",
      "transaction:rollback",
    ]);
  });

  test("rolls back the memory when success finalization fails", async () => {
    stagedCandidate = {
      id: IDENTITY_ID,
      projectId: PROJECT_ID,
      status: "active",
    };
    failFinalize = true;

    const response = await routeApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identity_id: IDENTITY_ID,
        type: "episodic",
        content: "insert and billing success must commit together",
      }),
    });

    expect(response.status).toBe(500);
    expect(reservations).toEqual(["memory.write"]);
    expect(finalizeAttempts).toBe(1);
    expect(finalizedReservations).toEqual([]);
    expect(insertedValues).toEqual([]);
    expect(wakeEvents).toEqual([]);
    expect(operationOrder).toEqual([
      "reserve",
      "transaction:start",
      "identity-lock:share",
      "memory-insert:tx",
      "finalize:tx",
      "transaction:rollback",
    ]);
  });
});

describe("SDK v0.11 memory agent_id compatibility", () => {
  test("an owned active UUID binds the insert, publishes wake, and can compose", async () => {
    stagedCandidate = {
      id: IDENTITY_ID,
      projectId: PROJECT_ID,
      status: "active",
    };

    const result = await write(PROJECT_ID, {
      agent_id: IDENTITY_ID.toUpperCase(),
      type: "episodic",
      content: "A v0.11 memory that belongs to this identity",
      key: "sdk-v0.11",
    });

    expect(identitySelectCalls).toBe(1);
    expect(result).toEqual({ id: MEMORY_ID, created_at: CREATED_AT.toISOString() });
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      projectId: PROJECT_ID,
      agentId: IDENTITY_ID,
      identityId: IDENTITY_ID,
    });
    expect(wakeEvents).toEqual([
      {
        identity_id: IDENTITY_ID,
        key: "memory",
        kind: "added",
        context: {
          memory_id: MEMORY_ID,
          type: "episodic",
          key: "sdk-v0.11",
        },
      },
    ]);

    // Elevation keeps the stored identity_id. That is the exact selector the
    // composition service requires before a foundational patch may shape an
    // identity; legacy agent_id-only rows remain excluded there.
    const composed = composeFromFoundations(
      { register: "base" },
      [
        {
          id: MEMORY_ID,
          identity_id: insertedValues[0]!.identityId as string,
          tier: "foundational",
          content: "A remembered preference",
          importance: 0.5,
          expression_patch: { register_append: "remembered" },
          attestations: [],
          elevated_at: CREATED_AT.toISOString(),
          created_at: CREATED_AT.toISOString(),
        },
      ],
      IDENTITY_ID,
    );
    expect(composed.effective.register).toBe("base remembered");
    expect(composed.shaped_by.map((entry) => entry.memory_id)).toEqual([
      MEMORY_ID,
    ]);
  });

  test.each([
    {
      label: "custom agent handle",
      agentId: "did:example:legacy-agent",
      candidate: {
        id: IDENTITY_ID,
        projectId: PROJECT_ID,
        status: "active",
      },
      expectedSelects: 0,
      expectedPersistedAgentId: "did:example:legacy-agent",
    },
    {
      label: "missing identity UUID",
      agentId: IDENTITY_ID,
      candidate: undefined,
      expectedSelects: 1,
      expectedPersistedAgentId: null,
    },
    {
      label: "inactive identity UUID",
      agentId: IDENTITY_ID,
      candidate: {
        id: IDENTITY_ID,
        projectId: PROJECT_ID,
        status: "revoked",
      },
      expectedSelects: 1,
      expectedPersistedAgentId: null,
    },
    {
      label: "cross-project identity UUID",
      agentId: IDENTITY_ID,
      candidate: {
        id: IDENTITY_ID,
        projectId: OTHER_PROJECT_ID,
        status: "active",
      },
      expectedSelects: 1,
      expectedPersistedAgentId: null,
    },
  ])("keeps $label unbound as a legacy write", async ({
    agentId,
    candidate,
    expectedSelects,
    expectedPersistedAgentId,
  }) => {
    stagedCandidate = candidate;

    await write(PROJECT_ID, {
      agent_id: agentId,
      type: "episodic",
      content: "legacy project-level memory",
    });

    expect(identitySelectCalls).toBe(expectedSelects);
    expect(insertedValues[0]).toMatchObject({
      projectId: PROJECT_ID,
      agentId: expectedPersistedAgentId,
      identityId: null,
    });
    expect(wakeEvents).toEqual([]);
  });

  test("an explicit null identity_id opts out of compatibility binding", async () => {
    stagedCandidate = {
      id: IDENTITY_ID,
      projectId: PROJECT_ID,
      status: "active",
    };

    await write(PROJECT_ID, {
      agent_id: IDENTITY_ID,
      identity_id: null,
      type: "episodic",
      content: "intentionally project-level memory",
    });

    expect(identitySelectCalls).toBe(0);
    expect(insertedValues[0]).toMatchObject({
      agentId: null,
      identityId: null,
    });
    expect(wakeEvents).toEqual([]);
  });

  test.each([
    {
      label: "malformed",
      identityId: "not-a-uuid",
      candidate: undefined,
      expectedSelects: 0,
    },
    {
      label: "missing",
      identityId: IDENTITY_ID,
      candidate: undefined,
      expectedSelects: 1,
    },
    {
      label: "inactive",
      identityId: IDENTITY_ID,
      candidate: { id: IDENTITY_ID, projectId: PROJECT_ID, status: "revoked" },
      expectedSelects: 1,
    },
    {
      label: "cross-project",
      identityId: IDENTITY_ID,
      candidate: { id: IDENTITY_ID, projectId: OTHER_PROJECT_ID, status: "active" },
      expectedSelects: 1,
    },
  ])("refuses an explicit $label identity binding", async ({
    identityId,
    candidate,
    expectedSelects,
  }) => {
    stagedCandidate = candidate;

    await expect(write(PROJECT_ID, {
      identity_id: identityId,
      type: "episodic",
      content: "must not cross the identity boundary",
    })).rejects.toThrow("memory_identity_not_found_or_not_owned");

    expect(identitySelectCalls).toBe(expectedSelects);
    expect(insertedValues).toEqual([]);
    expect(wakeEvents).toEqual([]);
  });
});
