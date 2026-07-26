import { describe, expect, test } from "bun:test";

import {
  ALCHEMY_INTERNAL_MAX_RESPONSE_BYTES,
  ALCHEMY_INTERNAL_RPC_METHODS,
  ALCHEMY_SIMULATION_DEPRECATION_DATE,
  AlchemyInternalAdapterError,
  alchemyInternalEndpoint,
  createAlchemyInternalAdapter,
  type AlchemyInternalOperation,
} from "../src/services/economy/crypto/alchemy-internal-adapter";

const API_KEY = "unit-test-alchemy-secret";
const ADDRESS_A = "0x0000000000000000000000000000000000000001";
const ADDRESS_B = "0x0000000000000000000000000000000000000002";
const TX_HASH = `0x${"a".repeat(64)}`;
const OTHER_TX_HASH = `0x${"b".repeat(64)}`;
const TOPIC = `0x${"c".repeat(64)}`;

interface CapturedRequest {
  url: string;
  init: RequestInit;
  payload: {
    jsonrpc: string;
    id: number;
    method: string;
    params: unknown[];
  };
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function providerResult(
  payload: CapturedRequest["payload"],
): unknown {
  switch (payload.method) {
    case "eth_getBalance":
      return "0x2a";
    case "eth_getTransactionReceipt":
      return {
        transactionHash: payload.params[0],
        status: "0x1",
        logs: [],
      };
    case "eth_getLogs":
      return [];
    case "alchemy_getAssetTransfers":
      return { transfers: [], pageKey: "" };
    case "alchemy_simulateAssetChanges":
      return { changes: [], gasUsed: "0x0", error: null };
    case "alchemy_simulateExecution":
      return {
        calls: [],
        logs: [],
        error: "",
        revertReason: null,
      };
    default:
      throw new Error(`unexpected method in test transport: ${payload.method}`);
  }
}

function captureHarness(
  responder?: (
    request: CapturedRequest,
  ) => Response | Promise<Response>,
  options: {
    timeoutMs?: number;
    maxResponseBytes?: number;
    endpoint?: string;
  } = {},
) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const payload = JSON.parse(String(init.body)) as CapturedRequest["payload"];
    const request = {
      url: String(input),
      init,
      payload,
    };
    requests.push(request);
    if (responder) return await responder(request);
    return jsonResponse({
      jsonrpc: "2.0",
      id: payload.id,
      result: providerResult(payload),
    });
  }) as typeof fetch;

  const adapter = createAlchemyInternalAdapter({
    apiKey: API_KEY,
    chain: "base",
    network: "testnet",
    fetchImpl,
    timeoutMs: options.timeoutMs,
    maxResponseBytes: options.maxResponseBytes,
    // Deliberately exercise a runtime extra field: endpoint selection is not
    // configurable and this value must be ignored.
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
  } as Parameters<typeof createAlchemyInternalAdapter>[0]);

  return { adapter, requests };
}

async function capturedError(
  promise: Promise<unknown>,
): Promise<AlchemyInternalAdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AlchemyInternalAdapterError);
    return error as AlchemyInternalAdapterError;
  }
  throw new Error("expected adapter call to fail");
}

describe("Alchemy internal endpoint boundary", () => {
  test("resolves only the exact HTTPS Alchemy Node API origins and /v2 path", () => {
    const expected = {
      ethereum: {
        mainnet: "https://eth-mainnet.g.alchemy.com/v2",
        testnet: "https://eth-sepolia.g.alchemy.com/v2",
      },
      base: {
        mainnet: "https://base-mainnet.g.alchemy.com/v2",
        testnet: "https://base-sepolia.g.alchemy.com/v2",
      },
      polygon: {
        mainnet: "https://polygon-mainnet.g.alchemy.com/v2",
        testnet: "https://polygon-amoy.g.alchemy.com/v2",
      },
      arbitrum: {
        mainnet: "https://arb-mainnet.g.alchemy.com/v2",
        testnet: "https://arb-sepolia.g.alchemy.com/v2",
      },
      optimism: {
        mainnet: "https://opt-mainnet.g.alchemy.com/v2",
        testnet: "https://opt-sepolia.g.alchemy.com/v2",
      },
    } as const;

    for (const [chain, networks] of Object.entries(expected)) {
      for (const [network, endpoint] of Object.entries(networks)) {
        expect(
          alchemyInternalEndpoint(
            chain as Parameters<typeof alchemyInternalEndpoint>[0],
            network as Parameters<typeof alchemyInternalEndpoint>[1],
          ),
        ).toBe(endpoint);
        const parsed = new URL(endpoint);
        expect(parsed.protocol).toBe("https:");
        expect(parsed.pathname).toBe("/v2");
        expect(parsed.search).toBe("");
        expect(parsed.username).toBe("");
        expect(parsed.password).toBe("");
      }
    }

    expect(() =>
      alchemyInternalEndpoint("evil" as never, "mainnet"),
    ).toThrow("configuration is invalid");
    expect(() =>
      alchemyInternalEndpoint("base", "preview" as never),
    ).toThrow("configuration is invalid");
  });

  test("ignores endpoint-like input and sends the credential only as Bearer auth", async () => {
    const { adapter, requests } = captureHarness(undefined, {
      endpoint: "http://127.0.0.1:1/private",
    });

    await adapter.execute({
      operation: "balance",
      address: ADDRESS_A,
    });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe("https://base-sepolia.g.alchemy.com/v2");
    expect(request.url).not.toContain(API_KEY);
    expect(request.init.method).toBe("POST");
    expect(request.init.redirect).toBe("error");
    const headers = new Headers(request.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect([...headers.keys()].sort()).toEqual([
      "authorization",
      "content-type",
    ]);
    expect(String(request.init.body)).not.toContain(API_KEY);
  });

  test("rejects malformed credentials and unbounded transport configuration", () => {
    for (const apiKey of ["", "short", `bad\nheader`, " padded-key "]) {
      expect(() =>
        createAlchemyInternalAdapter({
          apiKey,
          chain: "base",
          network: "mainnet",
        }),
      ).toThrow("configuration is invalid");
    }
    expect(() =>
      createAlchemyInternalAdapter({
        apiKey: API_KEY,
        chain: "base",
        network: "mainnet",
        timeoutMs: 30_001,
      }),
    ).toThrow("configuration is invalid");
    expect(() =>
      createAlchemyInternalAdapter({
        apiKey: API_KEY,
        chain: "base",
        network: "mainnet",
        maxResponseBytes: ALCHEMY_INTERNAL_MAX_RESPONSE_BYTES + 1,
      }),
    ).toThrow("configuration is invalid");
  });
});

describe("closed named Alchemy operations", () => {
  test("maps all six names to fixed official JSON-RPC shapes", async () => {
    const { adapter, requests } = captureHarness();
    const transaction = {
      from: ADDRESS_A,
      to: ADDRESS_B,
      value: "0x1",
      data: "0xaabb",
      maxFeePerGas: "0x2",
      maxPriorityFeePerGas: "0x1",
    };
    const operations: AlchemyInternalOperation[] = [
      {
        operation: "balance",
        address: ADDRESS_A,
        block: "safe",
      },
      {
        operation: "receipt",
        transactionHash: TX_HASH.toUpperCase().replace("0X", "0x"),
      },
      {
        operation: "logs",
        fromBlock: "0x10",
        toBlock: "0x19",
        address: [ADDRESS_A, ADDRESS_B],
        topics: [TOPIC, null],
      },
      {
        operation: "transfers",
        fromBlock: "0x10",
        toBlock: "0x20",
        category: ["external", "erc20"],
        fromAddress: ADDRESS_A,
        contractAddresses: [ADDRESS_B],
        maxCount: 10,
        order: "desc",
        withMetadata: true,
      },
      {
        operation: "simulate_asset_changes",
        transaction,
      },
      {
        operation: "simulate_execution",
        transaction,
        blockTag: "finalized",
      },
    ];

    const results = [];
    for (const operation of operations) {
      results.push(await adapter.execute(operation));
    }

    expect(requests.map((request) => request.payload.method)).toEqual([
      "eth_getBalance",
      "eth_getTransactionReceipt",
      "eth_getLogs",
      "alchemy_getAssetTransfers",
      "alchemy_simulateAssetChanges",
      "alchemy_simulateExecution",
    ]);
    expect(requests[0]?.payload.params).toEqual([ADDRESS_A, "safe"]);
    expect(requests[1]?.payload.params).toEqual([TX_HASH]);
    expect(requests[2]?.payload.params).toEqual([
      {
        fromBlock: "0x10",
        toBlock: "0x19",
        address: [ADDRESS_A, ADDRESS_B],
        topics: [TOPIC, null],
      },
    ]);
    expect(requests[3]?.payload.params).toEqual([
      {
        fromBlock: "0x10",
        toBlock: "0x20",
        category: ["external", "erc20"],
        maxCount: "0xa",
        excludeZeroValue: true,
        withMetadata: true,
        fromAddress: ADDRESS_A,
        contractAddresses: [ADDRESS_B],
        order: "desc",
      },
    ]);
    expect(requests[4]?.payload.params).toEqual([transaction]);
    expect(requests[5]?.payload.params).toEqual([
      "FLAT",
      transaction,
      "finalized",
    ]);

    for (const request of requests) {
      expect(request.payload.jsonrpc).toBe("2.0");
      expect(request.payload.id).toBe(1);
      expect(Object.values(ALCHEMY_INTERNAL_RPC_METHODS)).toContain(
        request.payload.method,
      );
    }
    for (const result of results) {
      expect(result).toMatchObject({
        provider: "alchemy",
        chain: "base",
        network: "testnet",
        finality: "not_established",
        stateChanged: false,
        endpoint: {
          origin: "https://base-sepolia.g.alchemy.com",
          path: "/v2",
        },
      });
      expect(JSON.stringify(result)).not.toContain(API_KEY);
    }
    expect(results[0]?.kind).toBe("read");
    expect(results[0]?.simulationDeprecationDate).toBeUndefined();
    expect(results[4]).toMatchObject({
      kind: "simulation",
      simulationDeprecationDate: ALCHEMY_SIMULATION_DEPRECATION_DATE,
    });
    expect(results[5]).toMatchObject({
      kind: "simulation",
      simulationDeprecationDate: "2026-09-30",
    });
  });

  test("cannot smuggle an arbitrary or state-changing RPC method", async () => {
    const { adapter, requests } = captureHarness();
    const attempts: unknown[] = [
      {
        operation: "balance",
        address: ADDRESS_A,
        method: "eth_sendRawTransaction",
      },
      {
        operation: "eth_sendTransaction",
        params: [{ from: ADDRESS_A, to: ADDRESS_B }],
      },
      {
        operation: "simulate_execution",
        transaction: {
          from: ADDRESS_A,
          to: ADDRESS_B,
          rawTransaction: `0x${"11".repeat(40)}`,
        },
      },
      {
        operation: "simulate_asset_changes",
        transaction: {
          from: ADDRESS_A,
          to: ADDRESS_B,
          privateKey: "not-a-real-key",
        },
      },
    ];

    for (const attempt of attempts) {
      const error = await capturedError(
        adapter.execute(attempt as AlchemyInternalOperation),
      );
      expect(error).toMatchObject({
        code: "invalid_operation",
        retryable: false,
        status: null,
      });
    }
    expect(requests).toHaveLength(0);
    expect(
      Object.values(ALCHEMY_INTERNAL_RPC_METHODS).some((method) =>
        /(?:send|sign|submit)/i.test(method),
      ),
    ).toBe(false);
  });

  test("bounds logs, transfers, topics, pagination, and calldata before fetch", async () => {
    const { adapter, requests } = captureHarness();
    const invalid: unknown[] = [
      {
        operation: "logs",
        fromBlock: "0x0",
        toBlock: "0xa",
        address: ADDRESS_A,
      },
      {
        operation: "logs",
        fromBlock: "0x0",
        toBlock: "0x1",
      },
      {
        operation: "logs",
        fromBlock: "0x0",
        toBlock: "0x1",
        topics: [TOPIC, TOPIC, TOPIC, TOPIC, TOPIC],
      },
      {
        operation: "transfers",
        fromBlock: "0x0",
        toBlock: "0x2710",
        category: ["erc20"],
        fromAddress: ADDRESS_A,
      },
      {
        operation: "transfers",
        fromBlock: "0x0",
        toBlock: "0x1",
        category: ["erc20"],
      },
      {
        operation: "transfers",
        fromBlock: "0x0",
        toBlock: "0x1",
        category: ["erc20"],
        fromAddress: ADDRESS_A,
        maxCount: 101,
      },
      {
        operation: "transfers",
        fromBlock: "0x0",
        toBlock: "0x1",
        category: ["erc20"],
        fromAddress: ADDRESS_A,
        pageKey: `ok\nnot-ok`,
      },
      {
        operation: "simulate_execution",
        transaction: {
          from: ADDRESS_A,
          to: ADDRESS_B,
          data: `0x${"aa".repeat(32 * 1024 + 1)}`,
        },
      },
    ];

    for (const attempt of invalid) {
      const error = await capturedError(
        adapter.execute(attempt as AlchemyInternalOperation),
      );
      expect(error.code).toBe("invalid_operation");
    }
    expect(requests).toHaveLength(0);
  });
});

describe("bounded transport and sanitized failures", () => {
  test("enforces the streamed body size even without a trustworthy length header", async () => {
    const fetchImpl = (async () => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: `0x${"a".repeat(200)}`,
        }),
      );
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, 40));
            controller.enqueue(bytes.slice(40));
            controller.close();
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const adapter = createAlchemyInternalAdapter({
      apiKey: API_KEY,
      chain: "ethereum",
      network: "mainnet",
      fetchImpl,
      maxResponseBytes: 64,
    });

    const error = await capturedError(
      adapter.execute({ operation: "balance", address: ADDRESS_A }),
    );
    expect(error).toMatchObject({
      code: "response_too_large",
      retryable: false,
      status: null,
    });
  });

  test("rejects an oversized declared body without parsing provider content", async () => {
    const { adapter } = captureHarness(
      () =>
        new Response(`provider says ${API_KEY}`, {
          status: 200,
          headers: { "content-length": "1000" },
        }),
      { maxResponseBytes: 64 },
    );
    const error = await capturedError(
      adapter.execute({ operation: "balance", address: ADDRESS_A }),
    );
    expect(error.code).toBe("response_too_large");
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect(error.message).not.toContain(API_KEY);
  });

  test("returns at the local deadline even when an injected transport ignores abort", async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as typeof fetch;
    const adapter = createAlchemyInternalAdapter({
      apiKey: API_KEY,
      chain: "ethereum",
      network: "testnet",
      fetchImpl,
      timeoutMs: 5,
    });
    const started = performance.now();
    const error = await capturedError(
      adapter.execute({ operation: "balance", address: ADDRESS_A }),
    );
    expect(error).toMatchObject({
      code: "timeout",
      retryable: true,
      status: null,
    });
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("never reflects transport, HTTP, or JSON-RPC credential-bearing detail", async () => {
    const cases: Array<{
      fetchImpl: typeof fetch;
      code: string;
      status: number | null;
    }> = [
      {
        fetchImpl: (async () => {
          throw new Error(`failed endpoint /v2/${API_KEY}`);
        }) as typeof fetch,
        code: "transport_unavailable",
        status: null,
      },
      {
        fetchImpl: (async () =>
          new Response(`upstream reflected ${API_KEY}`, {
            status: 503,
          })) as typeof fetch,
        code: "provider_http_error",
        status: 503,
      },
      {
        fetchImpl: (async () =>
          jsonResponse({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: -32_000,
              message: `provider reflected ${API_KEY}`,
              data: { endpoint: `https://example.invalid/${API_KEY}` },
            },
          })) as typeof fetch,
        code: "provider_rpc_error",
        status: null,
      },
    ];

    for (const item of cases) {
      const adapter = createAlchemyInternalAdapter({
        apiKey: API_KEY,
        chain: "ethereum",
        network: "mainnet",
        fetchImpl: item.fetchImpl,
      });
      const error = await capturedError(
        adapter.execute({ operation: "balance", address: ADDRESS_A }),
      );
      expect(error.code).toBe(item.code);
      expect(error.status).toBe(item.status);
      expect(error.message).not.toContain(API_KEY);
      expect(
        JSON.stringify({
          name: error.name,
          code: error.code,
          message: error.message,
          status: error.status,
          retryable: error.retryable,
        }),
      ).not.toContain(API_KEY);
    }
  });

  test("fails closed on response ID, receipt identity, and transfer-count mismatch", async () => {
    const responders: Array<(request: CapturedRequest) => Response> = [
      () =>
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: "0x1",
        }),
      (request) =>
        jsonResponse({
          jsonrpc: "2.0",
          id: request.payload.id,
          result: {
            transactionHash: OTHER_TX_HASH,
            status: "0x1",
            logs: [],
          },
        }),
      (request) =>
        jsonResponse({
          jsonrpc: "2.0",
          id: request.payload.id,
          result: {
            transfers: [{}, {}],
          },
        }),
    ];
    const operations: AlchemyInternalOperation[] = [
      { operation: "balance", address: ADDRESS_A },
      { operation: "receipt", transactionHash: TX_HASH },
      {
        operation: "transfers",
        fromBlock: "0x1",
        toBlock: "0x2",
        category: ["erc20"],
        fromAddress: ADDRESS_A,
        maxCount: 1,
      },
    ];

    for (let index = 0; index < responders.length; index += 1) {
      const { adapter } = captureHarness(responders[index]);
      const error = await capturedError(adapter.execute(operations[index]!));
      expect(error.code).toBe("invalid_response");
    }
  });
});
