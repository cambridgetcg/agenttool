import { describe, expect, test } from "bun:test";

import {
  ALCHEMY_WATCH_ENDPOINTS,
  createAlchemyDepositWatchReconciler,
  type AlchemyWatchReconcilerConfig,
} from "../src/services/economy/crypto/alchemy-watch-reconciler";
import {
  alchemyDepositWatchTargetFingerprint,
} from "../src/services/economy/crypto/alchemy-notify";
import type { DepositWatchReconcileRequest } from "../src/services/economy/crypto/deposit-watch";

const AUTH_TOKEN = "obvious-test-auth-token-not-a-credential";
const WEBHOOK_ID = "wh_obvious_test_fixture";
const ADDRESS = "0x0000000000000000000000000000000000000001";
const OTHER_ADDRESS =
  "0x0000000000000000000000000000000000000002";
const THIRD_ADDRESS =
  "0x0000000000000000000000000000000000000003";
const CALLBACK_BASE_URL = "https://agenttool.example";
const CALLBACK_URL =
  `${CALLBACK_BASE_URL}/v1/billing/crypto-webhook/base`;
const TARGET_FINGERPRINT =
  alchemyDepositWatchTargetFingerprint({
    chain: "base",
    network: "testnet",
    webhookId: WEBHOOK_ID,
    callbackBaseUrl: CALLBACK_BASE_URL,
  })!;

function config(
  overrides: Partial<AlchemyWatchReconcilerConfig> = {},
): AlchemyWatchReconcilerConfig {
  return {
    authToken: AUTH_TOKEN,
    callbackBaseUrl: CALLBACK_BASE_URL,
    webhookIds: {
      base: {
        testnet: WEBHOOK_ID,
      },
    },
    requestTimeoutMs: 1_000,
    ...overrides,
  };
}

function request(
  overrides: Partial<DepositWatchReconcileRequest> = {},
): DepositWatchReconcileRequest {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    depositAddressId: "20000000-0000-4000-8000-000000000001",
    provider: "alchemy",
    chain: "base",
    network: "testnet",
    targetFingerprint: TARGET_FINGERPRINT,
    targetRevision: 1,
    address: ADDRESS,
    desiredState: "watching",
    observedState: "unknown",
    generation: 1,
    observedGeneration: null,
    attemptCount: 1,
    leaseExpiresAt: new Date("2026-07-26T08:01:00.000Z"),
    signal: new AbortController().signal,
    ...overrides,
  };
}

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    network: "BASE_SEPOLIA",
    webhook_type: "ADDRESS_ACTIVITY",
    webhook_url: CALLBACK_URL,
    is_active: true,
    signing_key: "obvious-upstream-test-secret-never-returned",
    ...overrides,
  };
}

function teamPayload(
  entries: unknown[] = [webhook()],
): Record<string, unknown> {
  return { data: entries };
}

function addressPage(options: {
  data: string[];
  totalCount: number;
  after?: string | null;
}): Record<string, unknown> {
  return {
    data: options.data,
    pagination: {
      cursors: {
        ...(options.after === undefined ? {} : { after: options.after }),
      },
      total_count: options.totalCount,
    },
  };
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });
}

describe("Alchemy deposit-watch reconciler", () => {
  test("independently verifies exact webhook identity and current membership", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === ALCHEMY_WATCH_ENDPOINTS.teamWebhooks) {
        return jsonResponse(teamPayload());
      }
      return jsonResponse(
        addressPage({ data: [ADDRESS], totalCount: 1, after: null }),
      );
    }) as typeof fetch;

    const reconciler = createAlchemyDepositWatchReconciler({
      config: config(),
      fetchImpl: fakeFetch,
    });
    const outcome = await reconciler(request());

    expect(outcome).toEqual({
      kind: "verified",
      observedState: "watching",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(ALCHEMY_WATCH_ENDPOINTS.teamWebhooks);
    const membershipUrl = new URL(calls[1]!.url);
    expect(membershipUrl.origin + membershipUrl.pathname).toBe(
      ALCHEMY_WATCH_ENDPOINTS.webhookAddresses,
    );
    expect(membershipUrl.searchParams.get("webhook_id")).toBe(WEBHOOK_ID);
    expect(membershipUrl.searchParams.get("limit")).toBe("100");
    expect(membershipUrl.searchParams.has("after")).toBe(false);

    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(call.url).not.toContain(AUTH_TOKEN);
      expect(headers.get("X-Alchemy-Token")).toBe(AUTH_TOKEN);
      expect(headers.has("Authorization")).toBe(false);
      expect(call.init?.method).toBe("GET");
      expect(call.init?.redirect).toBe("error");
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  test("does not contact or mutate an older configured target generation", async () => {
    let calls = 0;
    const reconciler = createAlchemyDepositWatchReconciler({
      config: config(),
      fetchImpl: (async () => {
        calls += 1;
        throw new Error("must not contact the provider");
      }) as typeof fetch,
    });

    expect(
      await reconciler(
        request({ targetFingerprint: "f".repeat(64) }),
      ),
    ).toEqual({
      kind: "retryable",
      code: "provider_target_mismatch",
    });
    expect(calls).toBe(0);
  });

  test("rejects a target revision mismatch before provider I/O", async () => {
    let calls = 0;
    const reconciler = createAlchemyDepositWatchReconciler({
      config: config({ targetRevision: 8 }),
      fetchImpl: (async () => {
        calls += 1;
        throw new Error("must not contact the provider");
      }) as typeof fetch,
    });

    expect(
      await reconciler(request({ targetRevision: 7 })),
    ).toEqual({
      kind: "retryable",
      code: "provider_target_mismatch",
    });
    expect(calls).toBe(0);
  });

  test("boundedly accepts both official team-webhook envelope variants", async () => {
    for (const teamResponse of [
      teamPayload(),
      [teamPayload()],
    ]) {
      let calls = 0;
      const fakeFetch = (async (input: string | URL | Request) => {
        calls += 1;
        return String(input) === ALCHEMY_WATCH_ENDPOINTS.teamWebhooks
          ? jsonResponse(teamResponse)
          : jsonResponse(
              addressPage({
                data: [ADDRESS],
                totalCount: 1,
                after: null,
              }),
            );
      }) as typeof fetch;
      const reconciler = createAlchemyDepositWatchReconciler({
        config: config(),
        fetchImpl: fakeFetch,
      });

      expect(await reconciler(request())).toEqual({
        kind: "verified",
        observedState: "watching",
      });
      expect(calls).toBe(2);
    }
  });

  test("rejects every mismatched webhook identity field before membership", async () => {
    const cases: Array<[string, unknown[]]> = [
      ["missing", [webhook({ id: "wh_other" })]],
      ["duplicate", [webhook(), webhook()]],
      ["type", [webhook({ webhook_type: "GRAPHQL" })]],
      ["network", [webhook({ network: "BASE_MAINNET" })]],
      ["inactive", [webhook({ is_active: false })]],
      [
        "destination",
        [webhook({ webhook_url: "https://other.example/callback" })],
      ],
    ];

    for (const [_name, entries] of cases) {
      let calls = 0;
      const fakeFetch = (async () => {
        calls += 1;
        return jsonResponse(teamPayload(entries));
      }) as typeof fetch;
      const reconciler = createAlchemyDepositWatchReconciler({
        config: config(),
        fetchImpl: fakeFetch,
      });

      expect(await reconciler(request())).toEqual({
        kind: "terminal",
        code: "provider_rejected",
      });
      expect(calls).toBe(1);
    }
  });

  test("proves absence only after bounded cursor pagination completes", async () => {
    const urls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url === ALCHEMY_WATCH_ENDPOINTS.teamWebhooks) {
        return jsonResponse(teamPayload());
      }
      const after = new URL(url).searchParams.get("after");
      return after === null
        ? jsonResponse(
            addressPage({
              data: [OTHER_ADDRESS],
              totalCount: 2,
              after: "cursor+/=",
            }),
          )
        : jsonResponse(
            addressPage({
              data: [THIRD_ADDRESS],
              totalCount: 2,
              after: null,
            }),
          );
    }) as typeof fetch;

    const reconciler = createAlchemyDepositWatchReconciler({
      config: config(),
      fetchImpl: fakeFetch,
    });
    const outcome = await reconciler(
      request({ desiredState: "not_watching" }),
    );

    expect(outcome).toEqual({
      kind: "verified",
      observedState: "not_watching",
    });
    expect(urls).toHaveLength(3);
    expect(new URL(urls[2]!).searchParams.get("after")).toBe("cursor+/=");
  });

  test("idempotently adds or removes one address but never verifies from PATCH", async () => {
    const cases: Array<{
      desiredState: "watching" | "not_watching";
      members: string[];
      add: string[];
      remove: string[];
    }> = [
      {
        desiredState: "watching",
        members: [],
        add: [ADDRESS],
        remove: [],
      },
      {
        desiredState: "not_watching",
        members: [ADDRESS],
        add: [],
        remove: [ADDRESS],
      },
    ];

    for (const testCase of cases) {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fakeFetch = (async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === ALCHEMY_WATCH_ENDPOINTS.teamWebhooks) {
          return jsonResponse(teamPayload());
        }
        if (url.startsWith(ALCHEMY_WATCH_ENDPOINTS.webhookAddresses)) {
          return jsonResponse(
            addressPage({
              data: testCase.members,
              totalCount: testCase.members.length,
              after: null,
            }),
          );
        }
        return jsonResponse({
          ignored: "PATCH acknowledgement is not observation",
        });
      }) as typeof fetch;
      const reconciler = createAlchemyDepositWatchReconciler({
        config: config(),
        fetchImpl: fakeFetch,
      });

      expect(
        await reconciler(
          request({ desiredState: testCase.desiredState }),
        ),
      ).toEqual({ kind: "mutation_accepted" });
      expect(calls).toHaveLength(3);
      const patch = calls[2]!;
      expect(patch.url).toBe(
        ALCHEMY_WATCH_ENDPOINTS.updateWebhookAddresses,
      );
      expect(patch.init?.method).toBe("PATCH");
      expect(patch.init?.redirect).toBe("error");
      const headers = new Headers(patch.init?.headers);
      expect(headers.get("X-Alchemy-Token")).toBe(AUTH_TOKEN);
      expect(headers.has("Authorization")).toBe(false);
      expect(JSON.parse(String(patch.init?.body))).toEqual({
        webhook_id: WEBHOOK_ID,
        addresses_to_add: testCase.add,
        addresses_to_remove: testCase.remove,
      });
    }
  });

  test("maps only timeout, rate limit, 5xx, and transport to retryable codes", async () => {
    const cases: Array<
      [number, "provider_timeout" | "provider_rate_limited" | "provider_unavailable" | "provider_rejected"]
    > = [
      [408, "provider_timeout"],
      [429, "provider_rate_limited"],
      [500, "provider_unavailable"],
      [503, "provider_unavailable"],
      [400, "provider_rejected"],
      [401, "provider_rejected"],
    ];

    for (const [status, code] of cases) {
      const fakeFetch = (async () =>
        new Response("obvious-upstream-body-never-reflected", {
          status,
        })) as typeof fetch;
      const reconciler = createAlchemyDepositWatchReconciler({
        config: config(),
        fetchImpl: fakeFetch,
      });
      const outcome = await reconciler(request());

      expect(outcome).toEqual({
        kind: code === "provider_rejected" ? "terminal" : "retryable",
        code,
      });
      expect(JSON.stringify(outcome)).not.toContain("upstream");
    }

    const transportFetch = (async () => {
      throw new Error(`transport failed with ${AUTH_TOKEN}`);
    }) as typeof fetch;
    const transportOutcome = await createAlchemyDepositWatchReconciler({
      config: config(),
      fetchImpl: transportFetch,
    })(request());
    expect(transportOutcome).toEqual({
      kind: "retryable",
      code: "provider_unavailable",
    });
    expect(JSON.stringify(transportOutcome)).not.toContain(AUTH_TOKEN);
  });

  test("enforces a real request deadline even when transport waits for abort", async () => {
    let observedAbort = false;
    const fakeFetch = (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            reject(new Error(`aborted with ${AUTH_TOKEN}`));
          },
          { once: true },
        );
      })) as typeof fetch;
    const reconciler = createAlchemyDepositWatchReconciler({
      config: config({ requestTimeoutMs: 5 }),
      fetchImpl: fakeFetch,
    });

    expect(await reconciler(request())).toEqual({
      kind: "retryable",
      code: "provider_timeout",
    });
    expect(observedAbort).toBe(true);
  });

  test("fails closed on oversized responses and retries unstable pagination", async () => {
    let oversizedCalls = 0;
    const oversizedFetch = (async () => {
      oversizedCalls += 1;
      return jsonResponse(teamPayload(), 200, {
        "content-length": "999",
      });
    }) as typeof fetch;
    const oversizedReconciler = createAlchemyDepositWatchReconciler({
      config: config({ maxResponseBytes: 128 }),
      fetchImpl: oversizedFetch,
    });
    expect(await oversizedReconciler(request())).toEqual({
      kind: "terminal",
      code: "provider_rejected",
    });
    expect(oversizedCalls).toBe(1);

    let membershipPage = 0;
    const cyclicFetch = (async (input: string | URL | Request) => {
      if (String(input) === ALCHEMY_WATCH_ENDPOINTS.teamWebhooks) {
        return jsonResponse(teamPayload());
      }
      membershipPage += 1;
      return jsonResponse(
        addressPage({
          data: [
            membershipPage === 1 ? OTHER_ADDRESS : THIRD_ADDRESS,
          ],
          totalCount: 3,
          after: "same-cursor",
        }),
      );
    }) as typeof fetch;
    const cyclicReconciler = createAlchemyDepositWatchReconciler({
      config: config({
        pageSize: 1,
        maxPages: 3,
        maxAddresses: 3,
      }),
      fetchImpl: cyclicFetch,
    });
    expect(await cyclicReconciler(request())).toEqual({
      kind: "retryable",
      code: "provider_unavailable",
    });
    expect(membershipPage).toBe(2);
  });

  test("retries a changing or incomplete membership snapshot", async () => {
    for (const pages of [
      [
        addressPage({
          data: [OTHER_ADDRESS],
          totalCount: 2,
          after: "next",
        }),
        addressPage({
          data: [THIRD_ADDRESS],
          totalCount: 3,
          after: null,
        }),
      ],
      [
        addressPage({
          data: [OTHER_ADDRESS],
          totalCount: 2,
          after: null,
        }),
      ],
      [
        addressPage({
          data: [ADDRESS],
          totalCount: 0,
          after: null,
        }),
      ],
    ]) {
      let membershipPage = 0;
      const fakeFetch = (async (input: string | URL | Request) => {
        if (String(input) === ALCHEMY_WATCH_ENDPOINTS.teamWebhooks) {
          return jsonResponse(teamPayload());
        }
        const page = pages[membershipPage++];
        if (!page) throw new Error("unexpected extra test request");
        return jsonResponse(page);
      }) as typeof fetch;
      const reconciler = createAlchemyDepositWatchReconciler({
        config: config(),
        fetchImpl: fakeFetch,
      });

      expect(
        await reconciler(request({ desiredState: "not_watching" })),
      ).toEqual({
        kind: "retryable",
        code: "provider_unavailable",
      });
    }
  });

  test("uses stable terminal outcomes for unsupported and missing targets", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return jsonResponse(teamPayload());
    }) as typeof fetch;
    const reconciler = createAlchemyDepositWatchReconciler({
      config: config(),
      fetchImpl: fakeFetch,
    });

    expect(
      await reconciler(request({ provider: "other-provider" })),
    ).toEqual({
      kind: "terminal",
      code: "provider_unsupported",
    });
    expect(await reconciler(request({ chain: "solana" }))).toEqual({
      kind: "terminal",
      code: "provider_unsupported",
    });
    expect(
      await createAlchemyDepositWatchReconciler({
        config: config({ webhookIds: {} }),
        fetchImpl: fakeFetch,
      })(request()),
    ).toEqual({
      kind: "terminal",
      code: "provider_configuration_missing",
    });
    expect(
      await createAlchemyDepositWatchReconciler({
        config: config({ callbackBaseUrl: "http://localhost:3000" }),
        fetchImpl: fakeFetch,
      })(request()),
    ).toEqual({
      kind: "terminal",
      code: "provider_configuration_missing",
    });
    expect(
      await createAlchemyDepositWatchReconciler({
        config: config({ targetRevision: 0 }),
        fetchImpl: fakeFetch,
      })(request()),
    ).toEqual({
      kind: "terminal",
      code: "provider_configuration_missing",
    });
    expect(calls).toBe(0);
  });

  test("refuses incomplete scans at the configured page/count boundary", async () => {
    let calls = 0;
    const fakeFetch = (async (input: string | URL | Request) => {
      calls += 1;
      if (String(input) === ALCHEMY_WATCH_ENDPOINTS.teamWebhooks) {
        return jsonResponse(teamPayload());
      }
      return jsonResponse(
        addressPage({
          data: [OTHER_ADDRESS],
          totalCount: 1,
          after: "there-is-another-page",
        }),
      );
    }) as typeof fetch;
    const reconciler = createAlchemyDepositWatchReconciler({
      config: config({
        pageSize: 1,
        maxPages: 1,
        maxAddresses: 1,
      }),
      fetchImpl: fakeFetch,
    });

    expect(
      await reconciler(request({ desiredState: "not_watching" })),
    ).toEqual({
      kind: "terminal",
      code: "provider_rejected",
    });
    expect(calls).toBe(2);
  });
});
