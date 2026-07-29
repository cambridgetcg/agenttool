import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  AgentCredError,
  AgentCredClient,
  BrokerServer,
  type BrokerServerOptions,
  type EvmJsonRpcReadGrantRequest,
  type HttpGrantRequest,
} from "../src/index.js";
import {
  AllowAllConsent,
  FakeClock,
  InMemoryCredentialSource,
  MemoryAuditSink,
} from "../src/testing.js";
import type {
  OutboundHttpRequest,
  OutboundHttpResponse,
  OutboundTransport,
} from "../src/http.js";

export const TEST_SECRET = "agentcred-test-sentinel-never-real";

export class FakeTransport implements OutboundTransport {
  calls: OutboundHttpRequest[] = [];
  response: OutboundHttpResponse = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from('{"ok":true}', "utf8"),
  };
  handler:
    | ((request: OutboundHttpRequest) => OutboundHttpResponse | Promise<OutboundHttpResponse>)
    | undefined;
  gate: Promise<void> | undefined;

  async send(request: OutboundHttpRequest): Promise<OutboundHttpResponse> {
    this.calls.push({
      ...request,
      headers: { ...request.headers },
      body: Buffer.from(request.body),
      url: new URL(request.url),
    });
    if (this.gate && request.signal) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          request.signal?.removeEventListener("abort", onAbort);
          reject(new AgentCredError("request_failed", "Fake transport cancelled."));
        };
        if (request.signal.aborted) {
          onAbort();
          return;
        }
        request.signal.addEventListener("abort", onAbort, { once: true });
        this.gate!.then(
          () => {
            request.signal?.removeEventListener("abort", onAbort);
            resolve();
          },
          reject,
        );
      });
    } else {
      await this.gate;
    }
    const response = this.handler
      ? await this.handler(request)
      : this.response;
    return {
      status: response.status,
      headers: { ...response.headers },
      body: Buffer.from(response.body),
    };
  }
}

export interface BrokerFixture {
  root: string;
  socketPath: string;
  broker: BrokerServer;
  client: AgentCredClient;
  credentials: InMemoryCredentialSource;
  transport: FakeTransport;
  audit: MemoryAuditSink;
  clock: FakeClock;
  resolverCalls: string[];
  close(): Promise<void>;
}

export async function makeBroker(
  overrides: Partial<BrokerServerOptions> = {},
): Promise<BrokerFixture> {
  const root = await mkdtemp(join(tmpdir(), "agentcred-test-"));
  await chmod(root, 0o700);
  const socketPath = join(root, "broker.sock");
  const credentials = new InMemoryCredentialSource();
  credentials.set("agenttool/default", TEST_SECRET);
  const transport = new FakeTransport();
  const audit = new MemoryAuditSink();
  const clock = new FakeClock();
  const resolverCalls: string[] = [];
  const defaultHttp: NonNullable<BrokerServerOptions["http"]> = {
    resolver: {
      async resolve(hostname) {
        resolverCalls.push(hostname);
        return [{ address: "8.8.8.8", family: 4 }];
      },
    },
    transport,
  };
  const broker = new BrokerServer({
    socketPath,
    credentials,
    consent: new AllowAllConsent(),
    audit,
    clock,
    ...overrides,
    http: { ...defaultHttp, ...overrides.http },
  });
  await broker.start();
  const client = new AgentCredClient({ socketPath, timeoutMs: 2_000, clientName: "test" });
  await client.connect();
  return {
    root,
    socketPath,
    broker,
    client,
    credentials,
    transport,
    audit,
    clock,
    resolverCalls,
    async close() {
      client.close();
      await broker.close();
      credentials.clear();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function grantRequest(overrides: Partial<HttpGrantRequest> = {}): HttpGrantRequest {
  return {
    alias: "agenttool-session",
    credential: "agenttool/default",
    operation: "http.fetch",
    scope: {
      origin: "https://api.example.com",
      methods: ["GET", "POST"],
      pathPrefixes: ["/v1"],
      ttlSeconds: 60,
      maxUses: 4,
      maxRequestBytes: 1024,
      maxResponseBytes: 4096,
    },
    ...overrides,
  };
}

export function jsonRpcReadGrantRequest(
  overrides: Partial<EvmJsonRpcReadGrantRequest> = {},
): EvmJsonRpcReadGrantRequest {
  return {
    alias: "agenttool-chain-observation",
    credential: "agenttool/default",
    operation: "jsonrpc.read",
    scope: {
      profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
      origin: "https://eth-mainnet.g.alchemy.com",
      chainId: "eip155:1",
      methods: [
        "eth_chainId",
        "eth_blockNumber",
        "eth_getBlockByNumber",
        "eth_getBalance",
        "eth_getCode",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
      ],
      ttlSeconds: 60,
      maxUses: 4,
      maxRequestBytes: 1024,
      maxResponseBytes: 4096,
    },
    ...overrides,
  };
}
