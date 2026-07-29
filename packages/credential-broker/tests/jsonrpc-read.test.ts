import { afterEach, describe, expect, test } from "bun:test";
import { createConnection } from "node:net";
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  AgentCredClient,
  AgentCredError,
  type BrokerEvmJsonRpcReadCall,
  type JsonValue,
} from "../src/index.js";
import { encodeFrame, FrameDecoder } from "../src/framing.js";
import type { WireResponse } from "../src/wire.js";
import type {
  OutboundHttpRequest,
  OutboundHttpResponse,
} from "../src/http.js";
import {
  grantRequest,
  jsonRpcReadGrantRequest,
  makeBroker,
  TEST_SECRET,
  type BrokerFixture,
} from "./helpers.js";

const fixtures: BrokerFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

function requestEnvelope(request: OutboundHttpRequest): Record<string, unknown> {
  return JSON.parse(request.body.toString("utf8")) as Record<string, unknown>;
}

function rpcResponse(
  request: OutboundHttpRequest,
  result: JsonValue,
): OutboundHttpResponse {
  const envelope = requestEnvelope(request);
  return {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id: envelope.id,
        result,
      }),
      "utf8",
    ),
  };
}

async function rawExchange(
  socketPath: string,
  requests: readonly Record<string, unknown>[],
): Promise<WireResponse[]> {
  const socket = createConnection(socketPath);
  socket.on("error", () => undefined);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const responses: WireResponse[] = [];
  let wake: (() => void) | undefined;
  const decoder = new FrameDecoder((value) => {
    responses.push(value as WireResponse);
    wake?.();
    wake = undefined;
  });
  socket.on("data", (chunk) => decoder.push(chunk));
  try {
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index]!;
      const frame = encodeFrame(request);
      socket.write(frame, () => frame.fill(0));
      if (responses.length <= index) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
    return responses;
  } finally {
    decoder.clear();
    socket.destroy();
  }
}

describe("negotiated EVM JSON-RPC read profile", () => {
  test("builds the fixed Alchemy request inside the broker", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    fixture.transport.handler = (request) => rpcResponse(request, "0x2a");
    const handle = await fixture.client.requestGrant(jsonRpcReadGrantRequest());

    const result = await fixture.client.callEvmJsonRpcRead(handle, {
      chainId: "eip155:1",
      method: "eth_getBalance",
      params: ["0x1111111111111111111111111111111111111111", "latest"],
    });

    expect(result).toMatchObject({
      profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
      chainId: "eip155:1",
      method: "eth_getBalance",
      result: "0x2a",
      redactions: 0,
    });
    expect(handle.receipt).toMatchObject({
      operation: "jsonrpc.read",
      scope: {
        profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
        origin: "https://eth-mainnet.g.alchemy.com",
        chainId: "eip155:1",
      },
    });
    const serializedHandle = JSON.stringify(handle);
    expect(serializedHandle).not.toContain(TEST_SECRET);
    expect(serializedHandle).not.toContain("capability");

    const outbound = fixture.transport.calls[0]!;
    expect(outbound.url.toString()).toBe("https://eth-mainnet.g.alchemy.com/v2");
    expect(outbound.method).toBe("POST");
    expect(outbound.headers).toMatchObject({
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${TEST_SECRET}`,
    });
    const envelope = requestEnvelope(outbound);
    expect(Object.keys(envelope).sort()).toEqual(["id", "jsonrpc", "method", "params"]);
    expect(envelope).toMatchObject({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: ["0x1111111111111111111111111111111111111111", "latest"],
    });
    expect(typeof envelope.id).toBe("string");
    expect(outbound.url.toString()).not.toContain(TEST_SECRET);
    expect(outbound.body.toString("utf8")).not.toContain(TEST_SECRET);

    const completed = fixture.audit.events.at(-1)!;
    expect(completed).toMatchObject({
      event: "use.completed",
      operation: "jsonrpc.read",
      targetOrigin: "https://eth-mainnet.g.alchemy.com",
      rpcMethod: "eth_getBalance",
      chainId: "eip155:1",
      outcome: "success",
    });
    expect(JSON.stringify(fixture.audit.events)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(fixture.audit.events)).not.toContain(
      "0x1111111111111111111111111111111111111111",
    );
  });

  test("rejects transaction and wallet submission methods before lookup or I/O", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const request = jsonRpcReadGrantRequest();
    request.scope.methods = ["eth_chainId"];
    request.scope.maxUses = 1;
    const handle = await fixture.client.requestGrant(request);

    for (const method of [
      "eth_sendRawTransaction",
      "wallet_sendPreparedCalls",
    ]) {
      await expect(
        fixture.client.callEvmJsonRpcRead(handle, {
          chainId: "eip155:1",
          method,
          params: [],
        } as never),
      ).rejects.toMatchObject({ code: "scope_denied" });
    }

    expect(fixture.credentials.calls).toBe(0);
    expect(fixture.resolverCalls).toHaveLength(0);
    expect(fixture.transport.calls).toHaveLength(0);

    fixture.transport.handler = (outbound) => rpcResponse(outbound, "0x1");
    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
      }),
    ).resolves.toMatchObject({ result: "0x1" });
    expect(fixture.credentials.calls).toBe(1);
  });

  test("rejects caller URL, raw envelope, notification, batch and unknown fields", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const request = jsonRpcReadGrantRequest();
    request.scope.methods = ["eth_chainId"];
    request.scope.maxUses = 1;
    const handle = await fixture.client.requestGrant(request);
    const invalid: unknown[] = [
      {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
        url: "https://attacker.invalid/v2",
      },
      {
        chainId: "eip155:1",
        jsonrpc: "2.0",
        id: null,
        method: "eth_chainId",
        params: [],
      },
      [
        {
          chainId: "eip155:1",
          method: "eth_chainId",
          params: [],
        },
      ],
      {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
        headers: { authorization: "attacker" },
      },
    ];
    for (const call of invalid) {
      await expect(
        fixture.client.callEvmJsonRpcRead(
          handle,
          call as BrokerEvmJsonRpcReadCall,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(fixture.credentials.calls).toBe(0);
    expect(fixture.resolverCalls).toHaveLength(0);
    expect(fixture.transport.calls).toHaveLength(0);

    fixture.transport.handler = (outbound) => rpcResponse(outbound, "0x1");
    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
      }),
    ).resolves.toMatchObject({ result: "0x1" });
  });

  test("rejects unknown grant and scope fields instead of retaining them", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const topLevel = {
      ...jsonRpcReadGrantRequest(),
      rawBody: '{"method":"eth_sendRawTransaction"}',
    };
    await expect(
      fixture.client.requestGrant(topLevel as never),
    ).rejects.toMatchObject({ code: "invalid_request" });

    const scoped = jsonRpcReadGrantRequest() as unknown as Record<string, unknown>;
    scoped.scope = {
      ...(scoped.scope as Record<string, unknown>),
      path: "/v2",
    };
    await expect(
      fixture.client.requestGrant(scoped as never),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fixture.credentials.calls).toBe(0);
    expect(fixture.resolverCalls).toHaveLength(0);
    expect(fixture.transport.calls).toHaveLength(0);
  });

  test("validates each method's bounded params before reserving a use", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const request = jsonRpcReadGrantRequest();
    request.scope.maxUses = 1;
    const handle = await fixture.client.requestGrant(request);
    const invalid = [
      {
        chainId: "eip155:1",
        method: "eth_getBalance",
        params: ["0x1234", "latest"],
      },
      {
        chainId: "eip155:1",
        method: "eth_getCode",
        params: ["0x1111111111111111111111111111111111111111", "pending"],
      },
      {
        chainId: "eip155:1",
        method: "eth_getBlockByNumber",
        params: ["latest", true],
      },
      {
        chainId: "eip155:1",
        method: "eth_getTransactionReceipt",
        params: ["0x1234"],
      },
      {
        chainId: "eip155:1",
        method: "eth_blockNumber",
        params: ["extra"],
      },
    ];
    for (const call of invalid) {
      await expect(
        fixture.client.callEvmJsonRpcRead(
          handle,
          call as BrokerEvmJsonRpcReadCall,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(fixture.credentials.calls).toBe(0);
    expect(fixture.resolverCalls).toHaveLength(0);

    fixture.transport.handler = (outbound) => rpcResponse(outbound, "0x2a");
    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_blockNumber",
        params: [],
      }),
    ).resolves.toMatchObject({ result: "0x2a" });
  });

  test("checks generated request bytes before reserving a use", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const request = jsonRpcReadGrantRequest();
    request.scope.methods = ["eth_chainId", "eth_getBalance"];
    request.scope.maxRequestBytes = 120;
    request.scope.maxUses = 1;
    const handle = await fixture.client.requestGrant(request);

    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_getBalance",
        params: ["0x1111111111111111111111111111111111111111", "latest"],
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });
    expect(fixture.credentials.calls).toBe(0);
    expect(fixture.resolverCalls).toHaveLength(0);
    expect(fixture.transport.calls).toHaveLength(0);

    fixture.transport.handler = (outbound) => rpcResponse(outbound, "0x1");
    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
      }),
    ).resolves.toMatchObject({ result: "0x1" });
  });

  test("supports only the seven documented read shapes", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const request = jsonRpcReadGrantRequest();
    request.scope.maxUses = 7;
    const handle = await fixture.client.requestGrant(request);
    const hash = `0x${"11".repeat(32)}` as `0x${string}`;
    const results: Record<string, JsonValue> = {
      eth_chainId: "0x1",
      eth_blockNumber: "0x2a",
      eth_getBlockByNumber: { number: "0x2a" },
      eth_getBalance: "0x0",
      eth_getCode: "0x6000",
      eth_getTransactionByHash: { hash: `0x${"11".repeat(32).toUpperCase()}` },
      eth_getTransactionReceipt: { transactionHash: hash, status: "0x1" },
    };
    fixture.transport.handler = (outbound) => {
      const envelope = requestEnvelope(outbound);
      return rpcResponse(outbound, results[envelope.method as string]!);
    };
    const calls: BrokerEvmJsonRpcReadCall[] = [
      { chainId: "eip155:1", method: "eth_chainId", params: [] },
      { chainId: "eip155:1", method: "eth_blockNumber", params: [] },
      {
        chainId: "eip155:1",
        method: "eth_getBlockByNumber",
        params: ["0x2a", false],
      },
      {
        chainId: "eip155:1",
        method: "eth_getBalance",
        params: ["0x1111111111111111111111111111111111111111", "safe"],
      },
      {
        chainId: "eip155:1",
        method: "eth_getCode",
        params: ["0x1111111111111111111111111111111111111111", "finalized"],
      },
      {
        chainId: "eip155:1",
        method: "eth_getTransactionByHash",
        params: [hash],
      },
      {
        chainId: "eip155:1",
        method: "eth_getTransactionReceipt",
        params: [hash],
      },
    ];
    for (const call of calls) {
      await expect(
        fixture.client.callEvmJsonRpcRead(handle, call),
      ).resolves.toMatchObject({
        method: call.method,
        result: results[call.method],
      });
    }
    expect(fixture.transport.calls).toHaveLength(7);
  });

  test("binds block, transaction and receipt objects to the requested identity", async () => {
    const requestedHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const wrongHash = `0x${"22".repeat(32)}` as `0x${string}`;
    const cases: Array<{
      call: BrokerEvmJsonRpcReadCall;
      result: JsonValue;
    }> = [
      {
        call: {
          chainId: "eip155:1",
          method: "eth_getBlockByNumber",
          params: ["0x2a", false],
        },
        result: { number: "0x2b" },
      },
      {
        call: {
          chainId: "eip155:1",
          method: "eth_getTransactionByHash",
          params: [requestedHash],
        },
        result: { hash: wrongHash },
      },
      {
        call: {
          chainId: "eip155:1",
          method: "eth_getTransactionReceipt",
          params: [requestedHash],
        },
        result: { transactionHash: wrongHash },
      },
    ];

    for (const item of cases) {
      const fixture = await makeBroker();
      fixtures.push(fixture);
      fixture.transport.handler = (request) => rpcResponse(request, item.result);
      const request = jsonRpcReadGrantRequest();
      request.scope.methods = [item.call.method];
      request.scope.maxUses = 1;
      const handle = await fixture.client.requestGrant(request);

      await expect(
        fixture.client.callEvmJsonRpcRead(handle, item.call),
      ).rejects.toMatchObject({ code: "request_failed" });
    }
  });

  test("a local JSON-RPC timeout does not recall work, while session close cancels it", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const client = new AgentCredClient({
      socketPath: fixture.socketPath,
      timeoutMs: 50,
      clientName: "jsonrpc-timeout-test",
    });
    await client.connect();
    try {
      const request = jsonRpcReadGrantRequest();
      request.scope.methods = ["eth_blockNumber"];
      request.scope.maxUses = 1;
      const handle = await client.requestGrant(request);
      fixture.transport.gate = new Promise<void>(() => undefined);

      const pending = client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_blockNumber",
        params: [],
      });
      for (
        let attempt = 0;
        attempt < 50 && fixture.transport.calls.length === 0;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(fixture.transport.calls).toHaveLength(1);
      await expect(pending).rejects.toMatchObject({ code: "request_failed" });
      expect(client.connected).toBe(true);
      expect(fixture.transport.calls[0]?.signal?.aborted).toBe(false);

      client.close();
      for (
        let attempt = 0;
        attempt < 50 && !fixture.transport.calls[0]?.signal?.aborted;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(fixture.transport.calls[0]?.signal?.aborted).toBe(true);
    } finally {
      client.close();
    }
  });

  test("chain and method must both fit the grant", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const request = jsonRpcReadGrantRequest();
    request.scope.methods = ["eth_getBalance"];
    request.scope.maxUses = 1;
    const handle = await fixture.client.requestGrant(request);

    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:8453",
        method: "eth_getBalance",
        params: ["0x1111111111111111111111111111111111111111", "latest"],
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });
    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_blockNumber",
        params: [],
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });
    expect(fixture.credentials.calls).toBe(0);
    expect(fixture.resolverCalls).toHaveLength(0);

    fixture.transport.handler = (outbound) => rpcResponse(outbound, "0x0");
    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_getBalance",
        params: ["0x1111111111111111111111111111111111111111", "finalized"],
      }),
    ).resolves.toMatchObject({ result: "0x0" });
  });

  test("rejects invalid, mismatched and provider-error responses without reflection", async () => {
    const cases: Array<{
      name: string;
      response(request: OutboundHttpRequest): OutboundHttpResponse;
    }> = [
      {
        name: "batch",
        response(request) {
          const id = requestEnvelope(request).id;
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(JSON.stringify([{ jsonrpc: "2.0", id, result: "0x1" }])),
          };
        },
      },
      {
        name: "wrong id",
        response() {
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: "caller-id", result: "0x1" })),
          };
        },
      },
      {
        name: "unknown field",
        response(request) {
          const id = requestEnvelope(request).id;
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(
              JSON.stringify({ jsonrpc: "2.0", id, result: "0x1", extra: true }),
            ),
          };
        },
      },
      {
        name: "provider error",
        response(request) {
          const id = requestEnvelope(request).id;
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32_000, message: `unsafe ${TEST_SECRET}` },
              }),
            ),
          };
        },
      },
    ];

    for (const item of cases) {
      const fixture = await makeBroker();
      fixtures.push(fixture);
      fixture.transport.handler = item.response;
      const request = jsonRpcReadGrantRequest();
      request.scope.methods = ["eth_chainId"];
      request.scope.maxUses = 1;
      const handle = await fixture.client.requestGrant(request);
      let observed: unknown;
      try {
        await fixture.client.callEvmJsonRpcRead(handle, {
          chainId: "eip155:1",
          method: "eth_chainId",
          params: [],
        });
      } catch (error) {
        observed = error;
      }
      expect(observed, item.name).toMatchObject({ code: "request_failed" });
      expect(JSON.stringify(observed), item.name).not.toContain(TEST_SECRET);
      expect(JSON.stringify(fixture.audit.events), item.name).not.toContain(TEST_SECRET);
    }
  });

  test("validates eth_chainId against the owner-asserted chain binding", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    fixture.transport.handler = (request) => rpcResponse(request, "0x2105");
    const request = jsonRpcReadGrantRequest();
    request.scope.methods = ["eth_chainId"];
    const handle = await fixture.client.requestGrant(request);

    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
      }),
    ).rejects.toMatchObject({ code: "request_failed" });
  });

  test("enforces response byte bounds and JSON content type", async () => {
    const oversized = await makeBroker();
    fixtures.push(oversized);
    const small = jsonRpcReadGrantRequest();
    small.scope.methods = ["eth_getCode"];
    small.scope.maxResponseBytes = 128;
    oversized.transport.handler = (request) =>
      rpcResponse(request, `0x${"00".repeat(100)}`);
    const oversizedHandle = await oversized.client.requestGrant(small);
    await expect(
      oversized.client.callEvmJsonRpcRead(oversizedHandle, {
        chainId: "eip155:1",
        method: "eth_getCode",
        params: ["0x1111111111111111111111111111111111111111", "latest"],
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });

    const wrongType = await makeBroker();
    fixtures.push(wrongType);
    wrongType.transport.handler = (request) => {
      const response = rpcResponse(request, "0x1");
      response.headers = { "content-type": "text/plain" };
      return response;
    };
    const wrongTypeRequest = jsonRpcReadGrantRequest();
    wrongTypeRequest.scope.methods = ["eth_chainId"];
    const wrongTypeHandle = await wrongType.client.requestGrant(wrongTypeRequest);
    await expect(
      wrongType.client.callEvmJsonRpcRead(wrongTypeHandle, {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
      }),
    ).rejects.toMatchObject({ code: "request_failed" });

    const missingType = await makeBroker();
    fixtures.push(missingType);
    missingType.transport.handler = (request) => {
      const response = rpcResponse(request, "0x1");
      response.headers = {};
      return response;
    };
    const missingTypeRequest = jsonRpcReadGrantRequest();
    missingTypeRequest.scope.methods = ["eth_chainId"];
    const missingTypeHandle =
      await missingType.client.requestGrant(missingTypeRequest);
    await expect(
      missingType.client.callEvmJsonRpcRead(missingTypeHandle, {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
      }),
    ).resolves.toMatchObject({ result: "0x1" });
  });

  test("requires a bearer mapping and never sends custom credential headers", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    fixture.credentials.set("agenttool/default", TEST_SECRET, {
      kind: "header",
      headerName: "x-api-key",
    });
    const request = jsonRpcReadGrantRequest();
    request.scope.methods = ["eth_chainId"];
    const handle = await fixture.client.requestGrant(request);

    await expect(
      fixture.client.callEvmJsonRpcRead(handle, {
        chainId: "eip155:1",
        method: "eth_chainId",
        params: [],
      }),
    ).rejects.toMatchObject({ code: "backend_unavailable" });
    expect(fixture.credentials.calls).toBe(1);
    expect(fixture.transport.calls).toHaveLength(0);
    expect(JSON.stringify(fixture.audit.events)).not.toContain(TEST_SECRET);
  });

  test("cannot use the extension unless hello negotiated its versioned profile", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    fixture.client.close();
    const baseOnly = new AgentCredClient({
      socketPath: fixture.socketPath,
      timeoutMs: 2_000,
      extensions: [],
    });
    await baseOnly.connect();
    try {
      const http = await baseOnly.requestGrant(grantRequest());
      await expect(
        baseOnly.fetch(http, {
          method: "GET",
          url: "https://api.example.com/v1/base-compatible",
        }),
      ).resolves.toMatchObject({ status: 200 });
      await expect(
        baseOnly.requestGrant(jsonRpcReadGrantRequest()),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(fixture.credentials.calls).toBe(1);
      expect(fixture.transport.calls).toHaveLength(1);
    } finally {
      baseOnly.close();
    }
  });

  test("server rejects an unnegotiated JSON-RPC grant from a raw client", async () => {
    let consentCalls = 0;
    const fixture = await makeBroker({
      consent: {
        async decide() {
          consentCalls += 1;
          return { allowed: true };
        },
      },
    });
    fixtures.push(fixture);
    const responses = await rawExchange(fixture.socketPath, [
      {
        v: "agentcred/0.1",
        id: "hello",
        seq: 0,
        type: "hello",
        payload: {
          clientNonce: "0123456789abcdef",
          clientName: "raw-base-client",
        },
      },
      {
        v: "agentcred/0.1",
        id: "grant",
        seq: 1,
        type: "grant.request",
        payload: jsonRpcReadGrantRequest(),
      },
    ]);
    expect(responses[0]).toMatchObject({
      ok: true,
      type: "hello.ready",
      payload: { extensions: [] },
    });
    expect(responses[1]).toMatchObject({
      ok: false,
      error: { code: "unsupported" },
    });
    expect(consentCalls).toBe(0);
    expect(fixture.credentials.calls).toBe(0);
    expect(fixture.transport.calls).toHaveLength(0);
  });
});
