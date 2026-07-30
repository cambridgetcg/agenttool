import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_ALCHEMY_RESPONSE_BYTES,
  createAlchemyReadClient,
  type AlchemyNetwork,
  type AlchemyTransportRequest,
} from "@agenttool/alchemy";
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  AgentCredClient,
  BrokerServer,
  DEFAULT_MAX_BODY_BYTES,
  EVM_JSONRPC_READ_METHODS,
  type BrokerEvmJsonRpcReadCall,
  type BrokerEvmJsonRpcReadResponse,
  type GrantHandle,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
  type OutboundTransport,
} from "@agenttool/credential-broker";
import {
  AllowAllConsent,
  InMemoryCredentialSource,
  MemoryAuditSink,
} from "@agenttool/credential-broker/testing";

import {
  ADAPTER_PROTOCOL,
  AlchemyAgentCredError,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  createAlchemyAgentCredTransport,
  type AgentCredReadClient,
} from "../src/index.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"a".repeat(64)}`;
const TEST_SENTINEL = "alchemy-agentcred-test-sentinel-never-real";
const activeFixtures: Array<{
  client: AgentCredClient;
  broker: BrokerServer;
  credentials: InMemoryCredentialSource;
  root: string;
}> = [];

afterEach(async () => {
  await Promise.all(
    activeFixtures.splice(0).map(async (fixture) => {
      fixture.client.close();
      await fixture.broker.close();
      fixture.credentials.clear();
      await rm(fixture.root, { recursive: true, force: true });
    }),
  );
});

function fakeGrant(
  methods: readonly string[] = EVM_JSONRPC_READ_METHODS,
  chainId = "eip155:1",
  profile: string = AGENTCRED_EVM_JSONRPC_READ_PROFILE,
): GrantHandle {
  return {
    alias: "ethereum-read",
    receipt: {
      alias: "ethereum-read",
      receiptId: "receipt-test",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxUses: 100,
      operation: "jsonrpc.read",
      scope: {
        profile,
        origin: "https://eth-mainnet.g.alchemy.com",
        chainId,
        methods: [...methods],
        ttlSeconds: 60,
        maxUses: 100,
      },
    },
  } as unknown as GrantHandle;
}

function fakeResponse(
  call: BrokerEvmJsonRpcReadCall,
  result: BrokerEvmJsonRpcReadResponse["result"],
): BrokerEvmJsonRpcReadResponse {
  return {
    profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
    chainId: call.chainId,
    method: call.method,
    result,
    auditId: "audit_test",
    redactions: 0,
  };
}

function request(
  operationId: number,
  call: unknown,
  overrides: Partial<AlchemyTransportRequest> = {},
): AlchemyTransportRequest {
  return {
    protocol: "agenttool.alchemy.transport/0.1",
    operationId,
    network: "ethereum-mainnet",
    chainId: "eip155:1",
    call: call as AlchemyTransportRequest["call"],
    signal: new AbortController().signal,
    deadlineAtMs: Date.now() + 10_000,
    maxResponseBytes: MAX_ALCHEMY_RESPONSE_BYTES,
    ...overrides,
  };
}

function fakeClient(
  use: (
    handle: GrantHandle,
    call: BrokerEvmJsonRpcReadCall,
  ) => Promise<BrokerEvmJsonRpcReadResponse>,
): AgentCredReadClient & { calls: BrokerEvmJsonRpcReadCall[] } {
  const calls: BrokerEvmJsonRpcReadCall[] = [];
  return {
    connected: true,
    calls,
    async callEvmJsonRpcRead(handle, call) {
      calls.push(call);
      return use(handle, call);
    },
  };
}

describe("closed adapter boundary", () => {
  test("exports only a transport constructor, fixed metadata, and safe errors", () => {
    expect(PACKAGE_NAME).toBe("@agenttool/alchemy-agentcred");
    expect(PACKAGE_VERSION).toBe("0.1.0-dev.0");
    expect(ADAPTER_PROTOCOL).toBe("agenttool.alchemy-agentcred/0.1");
    const error = new AlchemyAgentCredError("broker_failed");
    expect(error.message).toBe("Credential broker read failed.");
    expect(error).not.toHaveProperty("cause");
  });

  test("dispatches exactly the seven profile methods and binds operation identity", async () => {
    const results: Record<string, BrokerEvmJsonRpcReadResponse["result"]> = {
      eth_chainId: "0x1",
      eth_blockNumber: "0x10",
      eth_getBlockByNumber: null,
      eth_getBalance: "0x0",
      eth_getCode: "0x",
      eth_getTransactionByHash: null,
      eth_getTransactionReceipt: null,
    };
    const client = fakeClient(async (_handle, call) =>
      fakeResponse(call, results[call.method] ?? null),
    );
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    const calls: Array<{ method: string; params: readonly unknown[] }> = [
      { method: "eth_chainId", params: [] },
      { method: "eth_blockNumber", params: [] },
      { method: "eth_getBlockByNumber", params: ["latest", false] },
      { method: "eth_getBalance", params: [ADDRESS, "safe"] },
      { method: "eth_getCode", params: [ADDRESS, "finalized"] },
      { method: "eth_getTransactionByHash", params: [HASH] },
      { method: "eth_getTransactionReceipt", params: [HASH] },
    ];

    const responses = await Promise.all(
      calls.map((call, index) => transport.send(request(index + 1, call))),
    );

    expect(client.calls.map((call) => call.method)).toEqual([
      ...EVM_JSONRPC_READ_METHODS,
    ]);
    expect(responses.map((response) => response.operationId)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(responses.map((response) => response.method)).toEqual([
      ...EVM_JSONRPC_READ_METHODS,
    ]);
  });

  test("keeps concurrent operation IDs bound when broker replies out of order", async () => {
    const resolvers = new Map<
      string,
      (response: BrokerEvmJsonRpcReadResponse) => void
    >();
    const client = fakeClient(
      async (_handle, call) =>
        new Promise((resolve) => {
          resolvers.set(call.method, resolve);
        }),
    );
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    const first = transport.send(
      request(41, { method: "eth_blockNumber", params: [] }),
    );
    const second = transport.send(
      request(42, { method: "eth_chainId", params: [] }),
    );
    await Promise.resolve();
    resolvers.get("eth_chainId")?.(
      fakeResponse(
        { chainId: "eip155:1", method: "eth_chainId", params: [] },
        "0x1",
      ),
    );
    resolvers.get("eth_blockNumber")?.(
      fakeResponse(
        { chainId: "eip155:1", method: "eth_blockNumber", params: [] },
        "0x10",
      ),
    );

    expect((await second).operationId).toBe(42);
    expect((await first).operationId).toBe(41);
  });

  test("rejects transfers, generic RPC, and state-changing methods before dispatch", async () => {
    const client = fakeClient(async (_handle, call) =>
      fakeResponse(call, null),
    );
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    const denied = [
      {
        method: "alchemy_getAssetTransfers",
        params: [{ fromBlock: "0x1" }],
      },
      { method: "eth_call", params: [] },
      { method: "eth_sendRawTransaction", params: ["0x00"] },
      { method: "wallet_sendPreparedCalls", params: [] },
    ];

    for (const call of denied) {
      await expect(transport.send(request(1, call))).rejects.toMatchObject({
        code: "unsupported_method",
      });
    }
    expect(client.calls).toHaveLength(0);
  });

  test("rejects malformed envelopes and params before dispatch", async () => {
    const client = fakeClient(async (_handle, call) =>
      fakeResponse(call, null),
    );
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    const malformed = [
      request(1, {
        method: "eth_getBlockByNumber",
        params: ["latest", true],
      }),
      request(2, {
        method: "eth_getBalance",
        params: [ADDRESS, "pending"],
      }),
      request(3, {
        method: "eth_getTransactionReceipt",
        params: ["0x12"],
      }),
      {
        ...request(4, { method: "eth_chainId", params: [] }),
        url: "https://example.invalid",
      },
    ];

    for (const input of malformed) {
      await expect(
        transport.send(input as AlchemyTransportRequest),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(client.calls).toHaveLength(0);
  });

  test("snapshots hostile tuple elements and never hands off unvalidated content", async () => {
    const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
    let addressReads = 0;
    let blockReads = 0;
    const changingParams = new Proxy([ADDRESS, "safe"], {
      get(target, property, receiver) {
        if (property === "0") {
          addressReads += 1;
          return addressReads === 1 ? ADDRESS : OTHER_ADDRESS;
        }
        if (property === "1") {
          blockReads += 1;
          return blockReads === 1 ? "safe" : "pending";
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const client = fakeClient(async (_handle, call) => {
      expect(call.params).toEqual([ADDRESS, "safe"]);
      return fakeResponse(call, "0x0");
    });
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });

    await expect(
      transport.send(
        request(1, {
          method: "eth_getBalance",
          params: changingParams,
        }),
      ),
    ).resolves.toMatchObject({ method: "eth_getBalance" });
    expect(addressReads).toBe(1);
    expect(blockReads).toBe(1);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.params).toEqual([ADDRESS, "safe"]);

    let invalidReads = 0;
    const invalidThenValid = new Proxy(["not-an-address", "safe"], {
      get(target, property, receiver) {
        if (property === "0") {
          invalidReads += 1;
          return invalidReads === 1 ? "not-an-address" : ADDRESS;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const deniedClient = fakeClient(async (_handle, call) =>
      fakeResponse(call, "0x0"),
    );
    const deniedTransport = createAlchemyAgentCredTransport({
      client: deniedClient,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    await expect(
      deniedTransport.send(
        request(2, {
          method: "eth_getBalance",
          params: invalidThenValid,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(invalidReads).toBe(1);
    expect(deniedClient.calls).toHaveLength(0);
  });

  test("validates grant operation, profile, chain, and closed method scope", async () => {
    const variants: GrantHandle[] = [
      fakeGrant(EVM_JSONRPC_READ_METHODS, "eip155:1", "wrong-profile"),
      fakeGrant(EVM_JSONRPC_READ_METHODS, "eip155:8453"),
      fakeGrant(["eth_getBalance", "eth_sendRawTransaction"]),
      fakeGrant(["eth_getBalance", "eth_getBalance"]),
    ];
    for (const grant of variants) {
      const client = fakeClient(async (_handle, call) =>
        fakeResponse(call, "0x0"),
      );
      expect(() =>
        createAlchemyAgentCredTransport({
          client,
          grants: { "ethereum-mainnet": grant },
        }),
      ).toThrow(AlchemyAgentCredError);
      expect(client.calls).toHaveLength(0);
    }

    const client = fakeClient(async (_handle, call) =>
      fakeResponse(call, "0x0"),
    );
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: {
        "ethereum-mainnet": fakeGrant(["eth_getBalance"]),
      },
    });
    await expect(
      transport.send(request(1, { method: "eth_getCode", params: [ADDRESS, "latest"] })),
    ).rejects.toMatchObject({ code: "grant_scope_denied" });
    expect(client.calls).toHaveLength(0);
  });

  test("rejects a wrong origin, private-network opt-in, or oversized receipt", () => {
    const client = fakeClient(async (_handle, call) =>
      fakeResponse(call, "0x1"),
    );
    const base = fakeGrant() as unknown as {
      alias: string;
      receipt: {
        scope: Record<string, unknown>;
      };
    };
    const variants = [
      {
        ...base,
        receipt: {
          ...(base as unknown as { receipt: Record<string, unknown> }).receipt,
          scope: {
            ...base.receipt.scope,
            origin: "https://base-mainnet.g.alchemy.com",
          },
        },
      },
      {
        ...base,
        receipt: {
          ...(base as unknown as { receipt: Record<string, unknown> }).receipt,
          scope: {
            ...base.receipt.scope,
            allowPrivateNetwork: true,
          },
        },
      },
      {
        ...base,
        receipt: {
          ...(base as unknown as { receipt: Record<string, unknown> }).receipt,
          scope: {
            ...base.receipt.scope,
            maxResponseBytes: DEFAULT_MAX_BODY_BYTES + 1,
          },
        },
      },
    ];

    for (const grant of variants) {
      expect(() =>
        createAlchemyAgentCredTransport({
          client,
          grants: {
            "ethereum-mainnet": grant as unknown as GrantHandle,
          },
        }),
      ).toThrow(AlchemyAgentCredError);
    }
    expect(client.calls).toHaveLength(0);
  });

  test("rechecks the deadline immediately before client handoff", async () => {
    const clockReads = [100, 200];
    const client = fakeClient(async (_handle, call) =>
      fakeResponse(call, "0x1"),
    );
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
      now() {
        const value = clockReads.shift();
        if (value === undefined) throw new Error("unexpected clock read");
        return value;
      },
    });

    await expect(
      transport.send(
        request(
          1,
          { method: "eth_chainId", params: [] },
          { deadlineAtMs: 150 },
        ),
      ),
    ).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(client.calls).toHaveLength(0);
    expect(clockReads).toHaveLength(0);
  });

  test("reads the Alchemy response ceiling once before dispatch", async () => {
    const client = fakeClient(async (_handle, call) =>
      fakeResponse(call, "0x1"),
    );
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    const input = request(1, { method: "eth_chainId", params: [] }) as
      AlchemyTransportRequest & Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(input, "maxResponseBytes", {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? MAX_ALCHEMY_RESPONSE_BYTES : 1;
      },
    });

    await expect(transport.send(input)).resolves.toMatchObject({
      operationId: 1,
      method: "eth_chainId",
    });
    expect(reads).toBe(1);
    expect(client.calls).toHaveLength(1);
  });

  test("requires an already-connected client and rechecks before each use", async () => {
    let connected = true;
    const calls: BrokerEvmJsonRpcReadCall[] = [];
    const client: AgentCredReadClient = {
      get connected() {
        return connected;
      },
      async callEvmJsonRpcRead(_handle, call) {
        calls.push(call);
        return fakeResponse(call, "0x1");
      },
    };
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    connected = false;
    await expect(
      transport.send(request(1, { method: "eth_chainId", params: [] })),
    ).rejects.toMatchObject({ code: "not_connected" });
    expect(calls).toHaveLength(0);

    expect(() =>
      createAlchemyAgentCredTransport({
        client,
        grants: { "ethereum-mainnet": fakeGrant() },
      }),
    ).toThrow(AlchemyAgentCredError);
  });

  test("does not dispatch an already-aborted read", async () => {
    const client = fakeClient(async (_handle, call) =>
      fakeResponse(call, "0x1"),
    );
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      transport.send(
        request(
          1,
          { method: "eth_chainId", params: [] },
          { signal: controller.signal },
        ),
      ),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(client.calls).toHaveLength(0);
  });

  test("collapses arbitrary broker exceptions without carrying their text", async () => {
    const client = fakeClient(async () => {
      throw new Error(`provider diagnostic ${TEST_SENTINEL}`);
    });
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    let observed: unknown;
    try {
      await transport.send(
        request(1, { method: "eth_chainId", params: [] }),
      );
    } catch (error) {
      observed = error;
    }
    expect(observed).toMatchObject({ code: "broker_failed" });
    expect(String(observed)).not.toContain(TEST_SENTINEL);
    expect(observed).not.toHaveProperty("cause");
  });

  test("rejects mismatched broker response identity", async () => {
    const client = fakeClient(async (_handle, call) => ({
      ...fakeResponse(call, "0x1"),
      method: "eth_blockNumber",
    }));
    const transport = createAlchemyAgentCredTransport({
      client,
      grants: { "ethereum-mainnet": fakeGrant() },
    });
    await expect(
      transport.send(request(9, { method: "eth_chainId", params: [] })),
    ).rejects.toMatchObject({ code: "broker_response_mismatch" });
  });
});

class HermeticJsonRpcTransport implements OutboundTransport {
  readonly calls: Array<{ url: string; method: string; rpcMethod: string }> = [];
  sawAuthorization = false;

  async send(request: OutboundHttpRequest): Promise<OutboundHttpResponse> {
    if (
      typeof request.headers.authorization !== "string" ||
      request.headers.authorization.length === 0
    ) {
      throw new Error("expected broker authentication injection");
    }
    this.sawAuthorization = true;
    const envelope = JSON.parse(request.body.toString("utf8")) as {
      id: string;
      method: string;
    };
    this.calls.push({
      url: request.url.toString(),
      method: request.method,
      rpcMethod: envelope.method,
    });
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: envelope.id,
          result: "0x2a",
        }),
        "utf8",
      ),
    };
  }
}

describe("hermetic AgentCred socket composition", () => {
  test("uses a real local broker grant without revealing the sentinel", async () => {
    const root = await mkdtemp(join(tmpdir(), "alchemy-agentcred-test-"));
    await chmod(root, 0o700);
    const socketPath = join(root, "broker.sock");
    const credentials = new InMemoryCredentialSource();
    credentials.set("alchemy/test-read", TEST_SENTINEL);
    const outbound = new HermeticJsonRpcTransport();
    const audit = new MemoryAuditSink();
    const broker = new BrokerServer({
      socketPath,
      credentials,
      consent: new AllowAllConsent(),
      audit,
      http: {
        resolver: {
          async resolve() {
            return [{ address: "8.8.8.8", family: 4 }];
          },
        },
        transport: outbound,
      },
    });
    await broker.start();
    const client = new AgentCredClient({
      socketPath,
      timeoutMs: 2_000,
      clientName: "alchemy-agentcred-test",
    });
    await client.connect();
    activeFixtures.push({ client, broker, credentials, root });

    const grant = await client.requestGrant({
      alias: "ethereum-read",
      credential: "alchemy/test-read",
      operation: "jsonrpc.read",
      scope: {
        profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
        origin: "https://eth-mainnet.g.alchemy.com",
        chainId: "eip155:1",
        methods: ["eth_getBalance"],
        ttlSeconds: 60,
        maxUses: 1,
        maxRequestBytes: 1_024,
        maxResponseBytes: 4_096,
      },
    });
    const alchemy = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport: createAlchemyAgentCredTransport({
        client,
        grants: { "ethereum-mainnet": grant },
      }),
    });

    const observation = await alchemy.getBalance({
      address: ADDRESS,
      block: "safe",
    });

    expect(observation.balanceHex).toBe("0x2a");
    expect(observation.provenance.method).toBe("eth_getBalance");
    expect(observation.provenance.transportAuditId).not.toBeNull();
    expect(outbound.calls).toEqual([
      {
        url: "https://eth-mainnet.g.alchemy.com/v2",
        method: "POST",
        rpcMethod: "eth_getBalance",
      },
    ]);
    expect(credentials.calls).toBe(1);
    expect(outbound.sawAuthorization).toBe(true);
    expect(JSON.stringify(observation)).not.toContain(TEST_SENTINEL);
    expect(JSON.stringify(audit.events)).not.toContain(TEST_SENTINEL);
  });
});
