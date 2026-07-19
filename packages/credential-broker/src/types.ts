/** Public, secret-free types for agentcred/0.1. */

export const AGENTCRED_PROTOCOL = "agentcred/0.1" as const;
export const MAX_CONTROL_FRAME_BYTES = 64 * 1024;
// Leaves room for base64 + the JSON envelope inside the 64 KiB control frame.
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024;

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
  ttlSeconds: number;
  maxUses: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** Private/reserved IP destinations remain denied unless the owner policy opts in. */
  allowPrivateNetwork?: boolean;
}

export interface GrantRequest {
  /** A model-safe label. It carries no authority. */
  alias: string;
  /** Opaque owner-configured reference; never a backend service/account name. */
  credential: string;
  operation: "http.fetch";
  scope: HttpGrantScope;
  /** Untrusted explanatory text shown separately by consent UIs. */
  rationale?: string;
}

export interface GrantReceipt {
  alias: string;
  receiptId: string;
  operation: "http.fetch";
  scope: HttpGrantScope;
  expiresAt: string;
  maxUses: number;
}

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

export interface AuditEvent {
  auditId: string;
  at: string;
  sessionId: string;
  receiptId?: string;
  event: "grant.allowed" | "grant.denied" | "grant.revoked" | "use.completed" | "use.denied";
  credential?: string;
  operation?: "http.fetch";
  targetOrigin?: string;
  targetPathHash?: string;
  method?: HttpMethod;
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
