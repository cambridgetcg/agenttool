/** Public, secret-free types for agentcred/0.1 and negotiated extensions. */

export const AGENTCRED_PROTOCOL = "agentcred/0.1" as const;
export const AGENTCRED_EVM_JSONRPC_READ_PROFILE =
  "agentcred.evm-jsonrpc-read/0.1" as const;
export const EVM_JSONRPC_READ_PATH = "/v2" as const;
export const MAX_CONTROL_FRAME_BYTES = 64 * 1024;
// Leaves room for base64 + the JSON envelope inside the 64 KiB control frame.
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024;

export type AgentCredExtension =
  typeof AGENTCRED_EVM_JSONRPC_READ_PROFILE;

export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export interface HttpGrantScope {
  /** Exact HTTPS origin, including a non-default port when used. */
  origin: string;
  methods: HttpMethod[];
  /** Normalized absolute path prefixes. Query strings are never matched. */
  pathPrefixes: string[];
  /** Exact non-secret query parameter names; omitted means no query allowed. */
  queryNames?: string[];
  /** Exact values for authority-sensitive optional headers such as x-agent-id. */
  headerValues?: Record<string, string[]>;
  /** Permit a caller-supplied x402 PAYMENT-SIGNATURE. Requires owner-policy opt-in. */
  allowPaymentSignature?: boolean;
  ttlSeconds: number;
  maxUses: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** Private/reserved IP destinations remain denied unless the owner policy opts in. */
  allowPrivateNetwork?: boolean;
}

export const EVM_JSONRPC_READ_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
] as const;

export type EvmJsonRpcReadMethod =
  (typeof EVM_JSONRPC_READ_METHODS)[number];

/** Canonical CAIP-2 EVM chain identifier, for example `eip155:1`. */
export type EvmChainId = `eip155:${string}`;

export type EvmBlockReference =
  | "latest"
  | "safe"
  | "finalized"
  | `0x${string}`;

export type BrokerEvmJsonRpcReadCall =
  | {
      chainId: EvmChainId;
      method: "eth_chainId" | "eth_blockNumber";
      params: [];
    }
  | {
      chainId: EvmChainId;
      method: "eth_getBlockByNumber";
      params: [EvmBlockReference, false];
    }
  | {
      chainId: EvmChainId;
      method: "eth_getBalance" | "eth_getCode";
      params: [`0x${string}`, EvmBlockReference];
    }
  | {
      chainId: EvmChainId;
      method: "eth_getTransactionByHash" | "eth_getTransactionReceipt";
      params: [`0x${string}`];
    };

export interface EvmJsonRpcReadGrantScope {
  /** Exact versioned validation semantics for this negotiated extension. */
  profile: typeof AGENTCRED_EVM_JSONRPC_READ_PROFILE;
  /** Exact HTTPS origin. The profile itself fixes the path to `/v2`. */
  origin: string;
  /** Owner-asserted CAIP-2 binding for the exact origin. */
  chainId: EvmChainId;
  methods: EvmJsonRpcReadMethod[];
  ttlSeconds: number;
  maxUses: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  allowPrivateNetwork?: boolean;
}

interface GrantRequestBase {
  /** A model-safe label. It carries no authority. */
  alias: string;
  /** Opaque owner-configured reference; never a backend service/account name. */
  credential: string;
  /** Untrusted explanatory text shown separately by consent UIs. */
  rationale?: string;
}

export interface HttpGrantRequest extends GrantRequestBase {
  operation: "http.fetch";
  scope: HttpGrantScope;
}

export interface EvmJsonRpcReadGrantRequest extends GrantRequestBase {
  operation: "jsonrpc.read";
  scope: EvmJsonRpcReadGrantScope;
}

export type GrantRequest =
  | HttpGrantRequest
  | EvmJsonRpcReadGrantRequest;

interface GrantReceiptBase {
  alias: string;
  receiptId: string;
  expiresAt: string;
  maxUses: number;
}

export interface HttpGrantReceipt extends GrantReceiptBase {
  operation: "http.fetch";
  scope: HttpGrantScope;
}

export interface EvmJsonRpcReadGrantReceipt extends GrantReceiptBase {
  operation: "jsonrpc.read";
  scope: EvmJsonRpcReadGrantScope;
}

export type GrantReceipt =
  | HttpGrantReceipt
  | EvmJsonRpcReadGrantReceipt;

export interface BrokerHttpRequest {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  /** Base64-encoded request bytes. */
  bodyBase64?: string;
  /** Required for state-changing methods. The broker does not retry them. */
  idempotencyKey?: string;
}

export interface BrokerHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Base64-encoded, bounded, redacted response bytes. */
  bodyBase64: string;
  auditId: string;
  redactions: number;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface BrokerEvmJsonRpcReadResponse {
  profile: typeof AGENTCRED_EVM_JSONRPC_READ_PROFILE;
  chainId: EvmChainId;
  method: EvmJsonRpcReadMethod;
  result: JsonValue;
  auditId: string;
  redactions: number;
}

export interface AuditEvent {
  auditId: string;
  at: string;
  sessionId: string;
  receiptId?: string;
  event: "grant.allowed" | "grant.denied" | "grant.revoked" | "use.completed" | "use.denied";
  credential?: string;
  /** Random controller generation ID from the broker's startup snapshot. */
  credentialGenerationId?: string;
  operation?: "http.fetch" | "jsonrpc.read";
  targetOrigin?: string;
  targetPathHash?: string;
  method?: HttpMethod;
  rpcMethod?: EvmJsonRpcReadMethod;
  chainId?: EvmChainId;
  requestBytes?: number;
  responseBytes?: number;
  status?: number;
  durationMs?: number;
  redactions?: number;
  outcome: "allowed" | "denied" | "success" | "error";
  reasonCode?: string;
  peerId?: string;
}

export interface CredentialAuth {
  kind: "bearer" | "header";
  /** Required for kind=header. Authorization is reserved for bearer. */
  headerName?: string;
  /** Defaults to "Bearer " for bearer and empty for header. */
  prefix?: string;
}

export interface CredentialMaterial {
  /** Caller must zero this buffer after use. */
  value: Uint8Array;
  auth: CredentialAuth;
}

/** Implementations run only inside the trusted broker process. */
export interface CredentialSource {
  withCredential<T>(
    alias: string,
    use: (material: CredentialMaterial) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}

export interface ConsentDecision {
  allowed: boolean;
  reasonCode?: string;
}

/** OS-observed workload identity supplied by a native host, never by the client. */
export interface PeerIdentity {
  /** Stable, non-secret identifier suitable for capability binding and audit. */
  id: string;
  /** Human-recognizable label for the trusted consent surface. */
  displayName: string;
}

export interface ConsentContext {
  sessionId: string;
  peer?: Readonly<PeerIdentity>;
  signal: AbortSignal;
}

export interface ConsentProvider {
  decide(
    request: Readonly<GrantRequest>,
    context: Readonly<ConsentContext>,
  ): Promise<ConsentDecision>;
}

export interface AuditSink {
  record(event: Readonly<AuditEvent>): Promise<void> | void;
}

export interface Clock {
  wallNow(): Date;
  monotonicNowMs(): number;
}

export interface HostResolver {
  resolve(
    hostname: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<{ address: string; family: 4 | 6 }>>;
}
