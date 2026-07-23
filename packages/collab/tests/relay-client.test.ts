import { describe, expect, test } from "bun:test";
import { CollabError } from "../src/errors.js";
import {
  CollabRelayClient,
  postRelayEnrolment,
  type RelayFetch,
} from "../src/relay-client.js";
import {
  requestSha256,
  type OperationBeginInput,
  type OperationResult,
} from "../src/relay-contract.js";
import {
  ACTION_ID,
  claimInput,
  credential,
  DEVICE_ID,
  enrolmentRequest,
  enrolmentResult,
  EVENT_ID,
  LEASE_ID,
  NOW,
  observationInput,
  observationResult,
  operationResult,
  profile,
  PROJECT_BEARER,
  RELAY_TOKEN,
  REPOSITORY_ID,
  SESSION_ID,
  SHA256,
  SOURCE_REVISION,
  TOKEN_PREFIX,
} from "./relay-fixtures.js";

function client(fetch: RelayFetch): CollabRelayClient {
  return new CollabRelayClient({
    credential,
    profile,
    fetch,
    timeout_ms: 1_000,
  });
}

const beginInput: OperationBeginInput = {
  schema: "agenttool.collab-operation-begin/1",
  idempotency_key: "begin:test",
  action_id: ACTION_ID,
  session_id: SESSION_ID,
  actor_label: "release-agent",
  operation: "npm.publish",
  environment: "npm",
  target: "@agenttool/collab@0.4.0",
  source_revision: SOURCE_REVISION,
  parameters_sha256: SHA256,
  lease_id: LEASE_ID,
  expected_version: 1,
  expected_generation: 1,
};

function replayedBeginResult(
  leaseExpiresAt = "2099-07-23T12:15:00.000Z",
): OperationResult {
  const claimed = operationResult();
  return {
    ...claimed,
    replayed: true,
    receipt: {
      idempotency_key: beginInput.idempotency_key,
      request_sha256: requestSha256(beginInput),
      recorded_at: NOW,
    },
    slot: {
      ...claimed.slot,
      sequence: 2,
      phase: "executing",
      lease_expires_at: leaseExpiresAt,
      version: 2,
    },
    run: {
      ...claimed.run,
      status: "executing",
      began_at: NOW,
    },
  };
}

function operationPage(slot: OperationResult["slot"]): unknown {
  return {
    schema: "agenttool.collab-operation-page/1",
    repository_id: REPOSITORY_ID,
    operations: [slot],
    next_after: 0,
    has_more: false,
  };
}

describe("HTTP collaboration relay client", () => {
  test("retries an exact idempotent mutation once and verifies its receipt digest", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const liveClaim = {
      ...operationResult(),
      slot: {
        ...operationResult().slot,
        lease_expires_at: "2099-07-23T12:15:00.000Z",
      },
    };
    const fetch: RelayFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      if (new URL(String(input)).pathname.endsWith("/operations")) {
        return Response.json(operationPage(liveClaim.slot));
      }
      if (calls.length === 1) {
        return Response.json(
          { error: { code: "temporarily_unavailable", message: "retry" } },
          { status: 503 },
        );
      }
      return Response.json(liveClaim);
    };

    const result = await client(fetch).claim(claimInput);
    expect(result.slot.action_id).toBe(ACTION_ID);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe(
      `https://relay.example/v1/collab/repositories/${REPOSITORY_ID}/operations/claim`,
    );
    expect(calls[0]!.init?.body).toBe(calls[1]!.init?.body);
    expect(calls[0]!.init?.headers).toEqual(calls[1]!.init?.headers);
    expect((calls[0]!.init?.headers as Record<string, string>)["Idempotency-Key"])
      .toBe(claimInput.idempotency_key);
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization)
      .toBe(`Bearer ${RELAY_TOKEN}`);
    expect(calls[2]!.url).toContain("/operations?");
  });

  test("accepts an actionable replay only after status confirms its exact live fence", async () => {
    const replay = replayedBeginResult();
    const calls: string[] = [];
    const result = await client(async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      return path.endsWith("/begin")
        ? Response.json(replay)
        : Response.json(operationPage(replay.slot));
    }).begin(beginInput);

    expect(result.replayed).toBe(true);
    expect(result.slot.phase).toBe("executing");
    expect(calls).toEqual([
      `/v1/collab/repositories/${REPOSITORY_ID}/operations/${ACTION_ID}/begin`,
      `/v1/collab/repositories/${REPOSITORY_ID}/operations`,
    ]);
  });

  test("status-confirms a fresh begin and rejects a delayed already-expired response before use", async () => {
    const fresh = { ...replayedBeginResult(), replayed: false };
    const calls: string[] = [];
    const accepted = await client(async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      return path.endsWith("/begin")
        ? Response.json(fresh)
        : Response.json(operationPage(fresh.slot));
    }).begin(beginInput);
    expect(accepted.replayed).toBe(false);
    expect(calls).toHaveLength(2);

    let expiredCalls = 0;
    await expect(client(async () => {
      expiredCalls += 1;
      return Response.json({
        ...fresh,
        slot: {
          ...fresh.slot,
          lease_expires_at: "2020-01-01T00:00:00.000Z",
        },
      });
    }).begin(beginInput)).rejects.toMatchObject({
      code: "recovery_required",
    });
    expect(expiredCalls).toBe(1);
  });

  test("rejects an actionable replay after expiry, recovery, or a newer generation", async () => {
    const replay = replayedBeginResult();
    const expired = {
      ...replay.slot,
      lease_expires_at: "2020-01-01T00:00:00.000Z",
    };
    const recovery = {
      ...expired,
      sequence: 3,
      phase: "recovery_required" as const,
      version: 3,
    };
    const newer = {
      ...replay.slot,
      sequence: 4,
      phase: "claimed" as const,
      action_id: "88888888-8888-4888-8888-888888888888",
      lease_id: "99999999-9999-4999-8999-999999999999",
      version: 4,
      generation: 2,
    };

    for (const [slot, code] of [
      [expired, "recovery_required"],
      [recovery, "recovery_required"],
      [newer, "stale_fence"],
    ] as const) {
      let calls = 0;
      await expect(client(async () => {
        calls += 1;
        return calls === 1
          ? Response.json(replay)
          : Response.json(operationPage(slot));
      }).begin(beginInput)).rejects.toMatchObject({ code });
      expect(calls).toBe(2);
    }
  });

  test("fails closed after retryable network failure and assumes no local success", async () => {
    let calls = 0;
    try {
      await client(async () => {
        calls += 1;
        throw new Error(`socket failed ${RELAY_TOKEN}`);
      }).claim(claimInput);
      throw new Error("expected claim to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CollabError);
      expect((error as CollabError).code).toBe("relay_unavailable");
      expect((error as Error).message).toContain(
        "no remote coordination mutation was assumed",
      );
      expect(JSON.stringify(error)).not.toContain(RELAY_TOKEN);
    }
    expect(calls).toBe(2);
  });

  test("preserves safe contention details but withholds credentials and controls", async () => {
    try {
      await client(async () => Response.json({
        error: {
          code: "operation_contended",
          message: "Operation is held by another enrolled device",
          details: {
            holder_device_id: DEVICE_ID,
            version: 4,
            generation: 2,
          },
        },
      }, { status: 409 })).claim(claimInput);
      throw new Error("expected contention");
    } catch (error) {
      expect(error).toMatchObject({
        code: "operation_contended",
        details: {
          http_status: 409,
          relay_details: {
            holder_device_id: DEVICE_ID,
            version: 4,
            generation: 2,
          },
        },
      });
    }

    for (const remote of [
      {
        code: "operation_contended",
        message: `reflected ${RELAY_TOKEN}`,
      },
      {
        code: "operation_contended",
        message: "unsafe\u001b[31mcontrol",
      },
      {
        code: "operation_contended",
        message: "unsafe details",
        details: { authorization: `Bearer ${RELAY_TOKEN}` },
      },
    ]) {
      try {
        await client(async () => Response.json(
          { error: remote },
          { status: 409 },
        )).claim(claimInput);
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(CollabError);
        expect((error as CollabError).code).toBe("relay_http_error");
        expect(JSON.stringify(error)).not.toContain(RELAY_TOKEN);
        expect((error as Error).message).not.toContain("\u001b");
      }
    }
  });

  test("rejects strict response drift and mismatched mutation receipts", async () => {
    await expect(client(async () => Response.json({
      ...operationResult(),
      raw_log: "must not cross the boundary",
    })).claim(claimInput)).rejects.toMatchObject({
      code: "relay_invalid_response",
    });

    await expect(client(async () => Response.json({
      ...operationResult(),
      receipt: {
        ...operationResult().receipt,
        request_sha256: "f".repeat(64),
      },
    })).claim(claimInput)).rejects.toMatchObject({
      code: "relay_receipt_mismatch",
    });
  });

  test("parses bounded pages including system events with a null device", async () => {
    const paths: string[] = [];
    const relay = client(async (input) => {
      const url = new URL(String(input));
      paths.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/events")) {
        return Response.json({
          schema: "agenttool.collab-event-page/1",
          repository_id: REPOSITORY_ID,
          events: [{
            sequence: 1,
            event_id: EVENT_ID,
            type: "operation.expired",
            occurred_at: NOW,
            device_id: null,
            session_id: null,
            actor_label: null,
            body: { action_id: ACTION_ID },
            previous_hash: null,
            event_hash: SHA256,
          }],
          next_after: 1,
          has_more: false,
        });
      }
      return Response.json({
        schema: "agenttool.collab-operation-page/1",
        repository_id: REPOSITORY_ID,
        operations: [operationResult().slot],
        next_after: 0,
        has_more: false,
      });
    });

    expect((await relay.events({ after: 0, limit: 10 })).events[0]!.device_id)
      .toBeNull();
    expect((await relay.operations({
      after: 0,
      limit: 10,
      operation: "npm.publish",
      environment: "npm",
    })).operations).toHaveLength(1);
    expect(paths).toEqual([
      `/v1/collab/repositories/${REPOSITORY_ID}/events?after=0&limit=10`,
      `/v1/collab/repositories/${REPOSITORY_ID}/operations?after=0&limit=10&operation=npm.publish&environment=npm`,
    ]);
  });

  test("rejects every response shape that escapes the credential repository scope", async () => {
    const otherRepository = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await expect(client(async () => Response.json({
      schema: "agenttool.collab-event-page/1",
      repository_id: otherRepository,
      events: [],
      next_after: 0,
      has_more: false,
    })).events()).rejects.toMatchObject({ code: "relay_scope_mismatch" });

    await expect(client(async () => Response.json({
      schema: "agenttool.collab-operation-page/1",
      repository_id: otherRepository,
      operations: [],
      next_after: 0,
      has_more: false,
    })).operations()).rejects.toMatchObject({ code: "relay_scope_mismatch" });

    await expect(client(async () => Response.json({
      ...operationResult(),
      slot: {
        ...operationResult().slot,
        repository_id: otherRepository,
      },
    })).claim(claimInput)).rejects.toMatchObject({
      code: "relay_scope_mismatch",
    });

    await expect(client(async () => Response.json({
      schema: "agenttool.collab-provider-observation-page/1",
      repository_id: otherRepository,
      observations: [],
      next_after: 0,
      has_more: false,
    })).observations()).rejects.toMatchObject({
      code: "relay_scope_mismatch",
    });

    await expect(client(async () => Response.json({
      ...observationResult(),
      observation: {
        ...observationResult().observation,
        repository_id: otherRepository,
      },
    })).observe(observationInput)).rejects.toMatchObject({
      code: "relay_scope_mismatch",
    });
  });

  test("defers current observation policy to the relay so exact historical retries remain possible", async () => {
    const relay = client(async () => Response.json(observationResult()));
    expect((await relay.observe(observationInput)).observation)
      .toMatchObject({
        repository_id: REPOSITORY_ID,
        observing_session_id: SESSION_ID,
        provenance: "device_observed",
      });
    const historicalInput = {
      ...observationInput,
      provider: "vercel",
      resource_kind: "project",
      resource_id: "unbound",
    } as const;
    const historicalResult = {
      ...observationResult(),
      receipt: {
        ...observationResult().receipt,
        idempotency_key: historicalInput.idempotency_key,
        request_sha256: requestSha256(historicalInput),
      },
      observation: {
        ...observationResult().observation,
        provider: "vercel",
        resource_kind: "project",
        resource_id: "unbound",
      },
    } as const;
    const historical = client(async () => Response.json(historicalResult));
    expect((await historical.observe(historicalInput)).observation.provider)
      .toBe("vercel");

    const currentPolicy = client(async () => Response.json({
      error: {
        code: "provider_not_allowed",
        message: "Provider is not allowed by the enrolled policy",
      },
    }, { status: 403 }));
    await expect(currentPolicy.observe({
      ...historicalInput,
      idempotency_key: "observe:vercel:new",
    })).rejects.toMatchObject({ code: "provider_not_allowed" });
  });

  test("requires exact profile scope and validates malformed JS profiles before use", () => {
    expect(() => new CollabRelayClient({
      credential,
      profile: {
        ...profile,
        repository: {
          ...profile.repository,
          key: "github:999",
        },
      },
      fetch: async () => Response.json({}),
    })).toThrowError(expect.objectContaining({
      code: "project_profile_invalid",
    }));

    expect(() => new CollabRelayClient({
      credential,
      profile: null as unknown as typeof profile,
    })).toThrowError(expect.objectContaining({
      code: "project_profile_invalid",
    }));
  });

  test("enrollment accepts only exact AgentTool at_ project bearer format", async () => {
    const request = enrolmentRequest;
    let authorization: string | undefined;
    let idempotencyKey: string | undefined;
    const result = await postRelayEnrolment({
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      request,
      fetch: async (_input, init) => {
        authorization =
          (init?.headers as Record<string, string> | undefined)?.Authorization;
        idempotencyKey =
          (init?.headers as Record<string, string> | undefined)?.[
            "Idempotency-Key"
          ];
        return Response.json(enrolmentResult);
      },
    });
    expect(result.repository.id).toBe(REPOSITORY_ID);
    expect(authorization).toBe(`Bearer ${PROJECT_BEARER}`);
    expect(idempotencyKey).toBe(request.idempotency_key);

    for (const invalid of [
      "github_pat_" + "x".repeat(60),
      "npm_" + "x".repeat(40),
      "at_too-short",
      `atc_${"x".repeat(43)}`,
    ]) {
      await expect(postRelayEnrolment({
        relay_url: "https://relay.example",
        project_bearer: invalid,
        request,
        fetch: async () => {
          throw new Error("must not send an invalid credential");
        },
      })).rejects.toMatchObject({ code: "project_bearer_invalid" });
    }
  });
});
