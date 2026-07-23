/** Route/auth contract tests for the cross-device collaboration relay. */

import { describe, expect, test } from "bun:test";

import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { isStrictJsonProfileResponse } from "../src/middleware/strict-json-profile";
import { createCollabRouter } from "../src/routes/collab";
import {
  collabEnrolmentIdempotencyKey,
  collabSha256,
} from "../src/services/collab-relay/canonical";
import type {
  CollabEnrolmentInput,
  CollabEventPage,
  CollabPrincipal,
  EnrolmentResult,
  OperationPage,
  OperationResult,
  ProviderObservationPage,
  ProviderObservationResult,
} from "../src/services/collab-relay/contracts";
import type { CollabRelayService } from "../src/services/collab-relay/service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REPOSITORY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_REPOSITORY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEVICE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_DEVICE_ID = "bbbbbbbb-1111-4111-8111-111111111111";
const SESSION_ID = "aaaaaaaa-2222-4222-8222-222222222222";
const ACTION_ID = "aaaaaaaa-3333-4333-8333-333333333333";
const LEASE_ID = "aaaaaaaa-4444-4444-8444-444444444444";
const OBSERVATION_ID = "aaaaaaaa-5555-4555-8555-555555555555";
const TOKEN = `atc_${"A".repeat(43)}`;
const OTHER_TOKEN = `atc_${"B".repeat(43)}`;
const SHA256 = "a".repeat(64);
const REVISION = "b".repeat(40);
const NOW = "2026-07-23T20:00:00.000Z";

function principal(deviceId = DEVICE_ID): CollabPrincipal {
  return {
    project_id: PROJECT_ID,
    repository_id: REPOSITORY_ID,
    device_id: deviceId,
    device_label: deviceId === DEVICE_ID ? "Yu MacBook" : "review machine",
    token_prefix: deviceId === DEVICE_ID
      ? TOKEN.slice(0, 12)
      : OTHER_TOKEN.slice(0, 12),
    token_sha256: deviceId === DEVICE_ID
      ? "e".repeat(64)
      : "f".repeat(64),
  };
}

function enrolmentResult(created = true): EnrolmentResult {
  const request = enrollmentBody();
  return {
    schema: "agenttool.collab-enrolment-result/1",
    replayed: false,
    receipt: {
      idempotency_key: request.idempotency_key,
      request_sha256: collabSha256(request),
      recorded_at: NOW,
    },
    repository: {
      id: REPOSITORY_ID,
      key: "github:1261120431",
      provider: "github",
      provider_repository_id: "1261120431",
      display_name: "cambridgetcg/agenttool",
    },
    device: {
      id: DEVICE_ID,
      label: "Yu MacBook",
      token_prefix: TOKEN.slice(0, 12),
      active: true,
      version: 1,
    },
    observation_policy: {
      profile_sha256: "c".repeat(64),
      allowed_providers: [
        "cloudflare-pages",
        "fly",
        "github",
        "npm",
      ],
    },
    created,
  };
}

function operationResult(
  phase: OperationResult["slot"]["phase"] = "claimed",
): OperationResult {
  return {
    schema: "agenttool.collab-operation-result/1",
    replayed: false,
    receipt: {
      idempotency_key: "claim-1",
      request_sha256: SHA256,
      recorded_at: NOW,
    },
    slot: {
      sequence: 1,
      repository_id: REPOSITORY_ID,
      operation: "npm.publish",
      environment: "npm",
      phase,
      action_id: ACTION_ID,
      holder_device_id: DEVICE_ID,
      session_id: SESSION_ID,
      actor_label: "codex-release",
      lease_id: LEASE_ID,
      lease_expires_at: "2026-07-23T20:01:00.000Z",
      version: 1,
      generation: 1,
      target: "@agenttool/collab@0.4.0",
      source_revision: REVISION,
      parameters_sha256: SHA256,
      updated_at: NOW,
    },
    run: {
      action_id: ACTION_ID,
      operation: "npm.publish",
      environment: "npm",
      device_id: DEVICE_ID,
      session_id: SESSION_ID,
      actor_label: "codex-release",
      status: phase === "recovery_required"
        ? "recovery_required"
        : "claimed",
      lease_id: LEASE_ID,
      generation: 1,
      target: "@agenttool/collab@0.4.0",
      source_revision: REVISION,
      parameters_sha256: SHA256,
      claimed_at: NOW,
      began_at: null,
      completed_at: null,
      updated_at: NOW,
    },
    authority: {
      kind: "coordination_only",
      provider_authority_granted: false,
    },
  };
}

function observationResult(): ProviderObservationResult {
  return {
    schema: "agenttool.collab-provider-observation-result/1",
    deduplicated: false,
    replayed: false,
    receipt: {
      idempotency_key: "observation-1",
      request_sha256: SHA256,
      recorded_at: NOW,
    },
    observation: {
      sequence: 2,
      observation_id: OBSERVATION_ID,
      repository_id: REPOSITORY_ID,
      provider: "npm",
      provider_event_id: "npm:@agenttool/collab@0.4.0",
      action_id: ACTION_ID,
      provenance: "device_observed",
      observing_device_id: DEVICE_ID,
      observing_session_id: SESSION_ID,
      actor_label: "codex-release",
      observed_at: NOW,
      occurred_at: NOW,
      normalized_state: "succeeded",
      source_revision: REVISION,
      environment: "npm",
      resource_kind: "package_version",
      resource_id: "@agenttool/collab@0.4.0",
      native_state: "published",
      url: "https://registry.npmjs.org/@agenttool/collab",
      payload_sha256: SHA256,
      received_at: NOW,
    },
  };
}

function stubService(
  overrides: Partial<CollabRelayService> = {},
): CollabRelayService {
  const operations: OperationPage = {
    schema: "agenttool.collab-operation-page/1",
    repository_id: REPOSITORY_ID,
    operations: [operationResult().slot],
    next_after: 0,
    has_more: false,
  };
  const events: CollabEventPage = {
    schema: "agenttool.collab-event-page/1",
    repository_id: REPOSITORY_ID,
    events: [
      {
        sequence: 1,
        event_id: "aaaaaaaa-6666-4666-8666-666666666666",
        type: "operation.recovery_required",
        occurred_at: NOW,
        device_id: null,
        session_id: null,
        actor_label: null,
        body: { action_id: ACTION_ID, reason: "executing_lease_expired" },
        previous_hash: null,
        event_hash: SHA256,
      },
    ],
    next_after: 1,
    has_more: false,
  };
  const observations: ProviderObservationPage = {
    schema: "agenttool.collab-provider-observation-page/1",
    repository_id: REPOSITORY_ID,
    observations: [observationResult().observation],
    next_after: 2,
    has_more: false,
  };
  return {
    enrol: async () => enrolmentResult(),
    authenticate: async (rawToken) => {
      if (rawToken === TOKEN) return principal();
      if (rawToken === OTHER_TOKEN) return principal(OTHER_DEVICE_ID);
      return null;
    },
    listEvents: async () => events,
    listOperations: async () => operations,
    claim: async () => operationResult(),
    renew: async () => operationResult(),
    begin: async () => operationResult("executing"),
    complete: async () => operationResult("idle"),
    release: async () => operationResult("idle"),
    recover: async () => operationResult("idle"),
    importObservation: async () => observationResult(),
    listObservations: async () => observations,
    ...overrides,
  };
}

function appFor(service: CollabRelayService) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID } as never);
    await next();
  });
  app.route("/v1/collab", createCollabRouter(service));
  return app;
}

function enrollmentBody(): CollabEnrolmentInput {
  const intent: Omit<CollabEnrolmentInput, "idempotency_key"> = {
    schema: "agenttool.collab-enrolment/1",
    expected_device_version: 0,
    repository: {
      key: "github:1261120431",
      provider: "github",
      provider_repository_id: "1261120431",
      display_name: "cambridgetcg/agenttool",
    },
    device: { id: DEVICE_ID, label: "Yu MacBook" },
    observation_policy: {
      profile_sha256: "c".repeat(64),
      allowed_providers: [
        "cloudflare-pages",
        "fly",
        "github",
        "npm",
      ],
    },
    token: { prefix: TOKEN.slice(0, 12), sha256: SHA256 },
  };
  return {
    ...intent,
    idempotency_key: collabEnrolmentIdempotencyKey(intent),
  };
}

function claimBody() {
  return {
    schema: "agenttool.collab-operation-claim/1",
    idempotency_key: "claim-1",
    action_id: ACTION_ID,
    session_id: SESSION_ID,
    actor_label: "codex-release",
    operation: "npm.publish",
    environment: "npm",
    target: "@agenttool/collab@0.4.0",
    source_revision: REVISION,
    parameters_sha256: SHA256,
    lease_seconds: 60,
  };
}

function observationBody() {
  return {
    schema: "agenttool.collab-provider-observation/1",
    idempotency_key: "observation-1",
    session_id: SESSION_ID,
    actor_label: "codex-release",
    action_id: ACTION_ID,
    provider: "npm",
    provider_event_id: "npm:@agenttool/collab@0.4.0",
    observed_at: NOW,
    occurred_at: NOW,
    resource_kind: "package_version",
    resource_id: "@agenttool/collab@0.4.0",
    native_state: "published",
    normalized_state: "succeeded",
    source_revision: REVISION,
    environment: "npm",
    url: "https://registry.npmjs.org/@agenttool/collab",
    payload_sha256: SHA256,
  };
}

describe("collab exact response profile", () => {
  test("global body decorators leave every relay response wire shape intact", () => {
    const response = new Response("{}", {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    for (const path of [
      "/v1/collab/enrolments",
      `/v1/collab/repositories/${REPOSITORY_ID}/events`,
      `/v1/collab/repositories/${REPOSITORY_ID}/operations`,
      `/v1/collab/repositories/${REPOSITORY_ID}/operations/claim`,
      `/v1/collab/repositories/${REPOSITORY_ID}/operations/${ACTION_ID}/recover`,
      `/v1/collab/repositories/${REPOSITORY_ID}/observations`,
    ]) {
      expect(isStrictJsonProfileResponse(response, path), path).toBe(true);
    }
    expect(isStrictJsonProfileResponse(response, "/v1/wake")).toBe(false);
  });
});

describe("collab enrollment route", () => {
  test("returns hash-only enrollment metadata and never echoes a raw token", async () => {
    let projectId: string | null = null;
    const app = appFor(
      stubService({
        enrol: async (incomingProjectId) => {
          projectId = incomingProjectId;
          return enrolmentResult();
        },
      }),
    );
    const response = await app.request("/v1/collab/enrolments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": enrollmentBody().idempotency_key,
      },
      body: JSON.stringify(enrollmentBody()),
    });
    expect(response.status).toBe(201);
    expect(projectId).toBe(PROJECT_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-idempotency-supported")).toContain(
      "durable Postgres receipt",
    );
    const json = await response.json();
    expect(json).toEqual(enrolmentResult());
    expect(JSON.stringify(json)).not.toContain(TOKEN);
  });

  test("strictly refuses a raw token field without reflecting its value", async () => {
    let calls = 0;
    const app = appFor(
      stubService({
        enrol: async () => {
          calls += 1;
          return enrolmentResult();
        },
      }),
    );
    const response = await app.request("/v1/collab/enrolments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...enrollmentBody(),
        token: { ...enrollmentBody().token, raw: TOKEN },
      }),
    });
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
    const text = await response.text();
    expect(text).toContain("invalid_request");
    expect(text).not.toContain(TOKEN);
  });

  test("rejects an enrollment idempotency header that differs from the body", async () => {
    let calls = 0;
    const app = appFor(
      stubService({
        enrol: async () => {
          calls += 1;
          return enrolmentResult();
        },
      }),
    );
    const response = await app.request("/v1/collab/enrolments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "enrol:wrong",
      },
      body: JSON.stringify(enrollmentBody()),
    });
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_header_mismatch" },
    });
  });

  test("rejects oversized JSON before parsing", async () => {
    const app = appFor(stubService());
    const response = await app.request("/v1/collab/enrolments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...enrollmentBody(),
        repository: {
          ...enrollmentBody().repository,
          display_name: "x".repeat(70_000),
        },
      }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "request_body_too_large" },
    });
  });
});

describe("collab repository scoped auth", () => {
  test("rejects a project-wide at_ bearer on repository routes", async () => {
    const app = appFor(stubService());
    const response = await app.request(
      `/v1/collab/repositories/${REPOSITORY_ID}/events`,
      { headers: { Authorization: "Bearer at_project-wide" } },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "collab_token_invalid" },
    });
  });

  test("rejects a valid scoped token used against another repository", async () => {
    const app = appFor(stubService());
    const response = await app.request(
      `/v1/collab/repositories/${OTHER_REPOSITORY_ID}/events`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "repository_scope_mismatch" },
    });
  });

  test("returns system-derived events without false device attribution", async () => {
    const app = appFor(stubService());
    const response = await app.request(
      `/v1/collab/repositories/${REPOSITORY_ID}/events`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-idempotency-supported")).toBeNull();
    expect(await response.json()).toMatchObject({
      events: [{ device_id: null, session_id: null }],
    });
  });

  test("keeps repository reads usage-neutral and records mutation usage", async () => {
    const usage: Array<{ method: string; record_usage: boolean | undefined }> =
      [];
    let currentMethod = "";
    const app = appFor(
      stubService({
        authenticate: async (rawToken, options) => {
          usage.push({
            method: currentMethod,
            record_usage: options?.record_usage,
          });
          return rawToken === TOKEN ? principal() : null;
        },
      }),
    );
    const request = async (
      method: string,
      path: string,
      body?: Record<string, unknown>,
    ) => {
      currentMethod = method;
      return app.request(path, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...(body
            ? {
                "Content-Type": "application/json",
                "Idempotency-Key": String(body.idempotency_key),
              }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    };

    expect((await request(
      "GET",
      `/v1/collab/repositories/${REPOSITORY_ID}/events`,
    )).status).toBe(200);
    expect((await request(
      "GET",
      `/v1/collab/repositories/${REPOSITORY_ID}/operations`,
    )).status).toBe(200);
    expect((await request(
      "GET",
      `/v1/collab/repositories/${REPOSITORY_ID}/observations`,
    )).status).toBe(200);
    expect((await request(
      "POST",
      `/v1/collab/repositories/${REPOSITORY_ID}/operations/claim`,
      claimBody(),
    )).status).toBe(200);
    expect((await request(
      "POST",
      `/v1/collab/repositories/${REPOSITORY_ID}/observations`,
      observationBody(),
    )).status).toBe(200);

    expect(usage).toEqual([
      { method: "GET", record_usage: false },
      { method: "GET", record_usage: false },
      { method: "GET", record_usage: false },
      { method: "POST", record_usage: true },
      { method: "POST", record_usage: true },
    ]);
  });
});

describe("collab operation routes", () => {
  test("accepts a session-bound claim and advertises durable idempotency", async () => {
    let captured: unknown;
    const app = appFor(
      stubService({
        claim: async (_principal, input) => {
          captured = input;
          return operationResult();
        },
      }),
    );
    const response = await app.request(
      `/v1/collab/repositories/${REPOSITORY_ID}/operations/claim`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "claim-1",
        },
        body: JSON.stringify(claimBody()),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-idempotency-supported")).toContain(
      "durable Postgres receipt",
    );
    expect(captured).toMatchObject({
      action_id: ACTION_ID,
      session_id: SESSION_ID,
      operation: "npm.publish",
    });
    expect(await response.json()).toMatchObject({
      authority: {
        kind: "coordination_only",
        provider_authority_granted: false,
      },
    });
  });

  test("refuses a header/body idempotency mismatch", async () => {
    let calls = 0;
    const app = appFor(
      stubService({
        claim: async () => {
          calls += 1;
          return operationResult();
        },
      }),
    );
    const response = await app.request(
      `/v1/collab/repositories/${REPOSITORY_ID}/operations/claim`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "different",
        },
        body: JSON.stringify(claimBody()),
      },
    );
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_header_mismatch" },
    });
  });

  test("explicit recovery may be performed by another enrolled same-repo device", async () => {
    let recoveringDevice: string | null = null;
    const app = appFor(
      stubService({
        recover: async (incomingPrincipal) => {
          recoveringDevice = incomingPrincipal.device_id;
          return operationResult("idle");
        },
      }),
    );
    const response = await app.request(
      `/v1/collab/repositories/${REPOSITORY_ID}/operations/${ACTION_ID}/recover`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OTHER_TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "recover-1",
        },
        body: JSON.stringify({
          schema: "agenttool.collab-operation-recover/1",
          idempotency_key: "recover-1",
          action_id: ACTION_ID,
          session_id: "bbbbbbbb-2222-4222-8222-222222222222",
          actor_label: "claude-recovery",
          operation: "npm.publish",
          environment: "npm",
          target: "@agenttool/collab@0.4.0",
          source_revision: REVISION,
          parameters_sha256: SHA256,
          expected_version: 3,
          expected_generation: 1,
          disposition: "succeeded",
          reason: "Registry metadata and artifact digest independently match.",
          observation_ids: [OBSERVATION_ID],
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(recoveringDevice).toBe(OTHER_DEVICE_ID);
  });
});

describe("collab observation routes", () => {
  test("imports only a bounded projection and includes repository attribution", async () => {
    const app = appFor(stubService());
    const response = await app.request(
      `/v1/collab/repositories/${REPOSITORY_ID}/observations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "observation-1",
        },
        body: JSON.stringify(observationBody()),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      replayed: false,
      receipt: { idempotency_key: "observation-1" },
      observation: {
        repository_id: REPOSITORY_ID,
        observing_device_id: DEVICE_ID,
        observing_session_id: SESSION_ID,
      },
    });
  });

  test("refuses credentialized, signed-query, and fragment provider URLs", async () => {
    const app = appFor(stubService());
    for (const url of [
      "https://token:secret@example.com/deploy",
      "https://example.com/deploy?token=secret",
      "https://example.com/deploy#secret",
      `https://example.com/artifacts/npm_${"s".repeat(20)}`,
      `https://example.com/artifacts/npm_%73${"s".repeat(19)}`,
    ]) {
      const response = await app.request(
        `/v1/collab/repositories/${REPOSITORY_ID}/observations`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...observationBody(), url }),
        },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "invalid_request" },
      });
    }
  });

  test("refuses repeated cursor parameters instead of silently choosing one", async () => {
    const app = appFor(stubService());
    const response = await app.request(
      `/v1/collab/repositories/${REPOSITORY_ID}/observations?after=1&after=2`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "invalid_request",
        details: { parameter: "after" },
      },
    });
  });
});
