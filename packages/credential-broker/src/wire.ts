import { AgentCredError, type AgentCredErrorCode } from "./errors.js";
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  AGENTCRED_PROTOCOL,
  DEFAULT_MAX_BODY_BYTES,
  type AgentCredExtension,
  type BrokerEvmJsonRpcReadCall,
  type BrokerHttpRequest,
  type EvmJsonRpcReadGrantRequest,
  type GrantRequest,
  type HttpGrantRequest,
} from "./types.js";
import {
  normalizeEvmChainId,
  normalizeEvmJsonRpcReadMethods,
  parseEvmJsonRpcReadCall,
} from "./jsonrpc-validation.js";

export interface WireRequest {
  v: typeof AGENTCRED_PROTOCOL;
  id: string;
  seq: number;
  type: "hello" | "grant.request" | "grant.use" | "grant.revoke";
  payload: Record<string, unknown>;
}

export interface WireSuccess {
  v: typeof AGENTCRED_PROTOCOL;
  id: string;
  seq: number;
  ok: true;
  type:
    | "hello.ready"
    | "grant.ready"
    | "http.result"
    | "jsonrpc.result"
    | "grant.revoked";
  payload: Record<string, unknown>;
}

export interface WireFailure {
  v: typeof AGENTCRED_PROTOCOL;
  id: string;
  seq: number;
  ok: false;
  error: { code: AgentCredErrorCode; message: string; detail?: string };
}

export type WireResponse = WireSuccess | WireFailure;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentCredError("invalid_request", `${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new AgentCredError("invalid_request", `${name} must be a non-empty string.`);
  }
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new AgentCredError("invalid_request", `${name} is outside its allowed range.`);
  }
  return value as number;
}

function stringArray(value: unknown, name: string, maxItems = 32, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maxItems) {
    throw new AgentCredError(
      "invalid_request",
      `${name} must be a ${allowEmpty ? "bounded" : "non-empty bounded"} array.`,
    );
  }
  return value.map((item, index) => string(item, `${name}[${index}]`, 2048));
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const allow = new Set(allowed);
  if (Object.keys(value).some((key) => !allow.has(key))) {
    throw new AgentCredError("invalid_request", `${name} contains an unknown field.`);
  }
}

export function parseWireRequest(value: unknown): WireRequest {
  const raw = record(value, "request");
  if (raw.v !== AGENTCRED_PROTOCOL) {
    throw new AgentCredError("protocol_error", `Expected protocol ${AGENTCRED_PROTOCOL}.`);
  }
  const type = string(raw.type, "type") as WireRequest["type"];
  if (!["hello", "grant.request", "grant.use", "grant.revoke"].includes(type)) {
    throw new AgentCredError("unsupported", "Unsupported protocol operation.");
  }
  return {
    v: AGENTCRED_PROTOCOL,
    id: string(raw.id, "id", 128),
    seq: integer(raw.seq, "seq", 0, Number.MAX_SAFE_INTEGER),
    type,
    payload: record(raw.payload, "payload"),
  };
}

export interface HelloRequest {
  clientNonce: string;
  clientName?: string;
  extensions: string[];
}

export function parseHelloRequest(value: unknown): HelloRequest {
  const raw = record(value, "hello");
  const output: HelloRequest = {
    clientNonce: string(raw.clientNonce, "hello.clientNonce", 256),
    extensions: [],
  };
  if (output.clientNonce.length < 16) {
    throw new AgentCredError("invalid_request", "hello.clientNonce is invalid.");
  }
  if (raw.clientName !== undefined) {
    output.clientName = string(raw.clientName, "hello.clientName", 256);
  }
  if (raw.extensions !== undefined) {
    const extensions = stringArray(raw.extensions, "hello.extensions", 16, true);
    if (extensions.some((extension) => extension.length > 128)) {
      throw new AgentCredError("invalid_request", "hello.extensions is invalid.");
    }
    output.extensions = [...new Set(extensions)];
  }
  return output;
}

function parseHttpGrantRequest(raw: Record<string, unknown>): HttpGrantRequest {
  const scope = record(raw.scope, "scope");
  const methods = stringArray(scope.methods, "scope.methods", 6);
  const allowedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
  if (methods.some((method) => !allowedMethods.has(method))) {
    throw new AgentCredError("invalid_request", "scope.methods contains an unsupported method.");
  }

  const request: HttpGrantRequest = {
    alias: string(raw.alias, "alias", 128),
    credential: string(raw.credential, "credential", 256),
    operation: "http.fetch",
    scope: {
      origin: string(scope.origin, "scope.origin", 2048),
      methods: methods as HttpGrantRequest["scope"]["methods"],
      pathPrefixes: stringArray(scope.pathPrefixes, "scope.pathPrefixes", 32),
      ttlSeconds: integer(scope.ttlSeconds, "scope.ttlSeconds", 1, 86_400),
      maxUses: integer(scope.maxUses, "scope.maxUses", 1, 10_000),
    },
  };
  if (scope.queryNames !== undefined) {
    request.scope.queryNames = stringArray(scope.queryNames, "scope.queryNames", 64, true);
  }
  if (scope.headerValues !== undefined) {
    const rawHeaders = record(scope.headerValues, "scope.headerValues");
    const entries = Object.entries(rawHeaders);
    if (entries.length > 8) {
      throw new AgentCredError("invalid_request", "scope.headerValues has too many entries.");
    }
    request.scope.headerValues = Object.fromEntries(
      entries.map(([name, values]) => [
        string(name, "scope.headerValues name", 128),
        stringArray(values, `scope.headerValues.${name}`, 64),
      ]),
    );
  }
  if (scope.allowPaymentSignature !== undefined) {
    if (typeof scope.allowPaymentSignature !== "boolean") {
      throw new AgentCredError("invalid_request", "scope.allowPaymentSignature must be boolean.");
    }
    request.scope.allowPaymentSignature = scope.allowPaymentSignature;
  }
  if (raw.rationale !== undefined) request.rationale = string(raw.rationale, "rationale", 1000);
  if (scope.maxRequestBytes !== undefined) {
    request.scope.maxRequestBytes = integer(scope.maxRequestBytes, "scope.maxRequestBytes", 0, DEFAULT_MAX_BODY_BYTES);
  }
  if (scope.maxResponseBytes !== undefined) {
    request.scope.maxResponseBytes = integer(scope.maxResponseBytes, "scope.maxResponseBytes", 0, DEFAULT_MAX_BODY_BYTES);
  }
  if (scope.allowPrivateNetwork !== undefined) {
    if (typeof scope.allowPrivateNetwork !== "boolean") {
      throw new AgentCredError("invalid_request", "scope.allowPrivateNetwork must be boolean.");
    }
    request.scope.allowPrivateNetwork = scope.allowPrivateNetwork;
  }
  return request;
}

function parseEvmJsonRpcReadGrantRequest(
  raw: Record<string, unknown>,
): EvmJsonRpcReadGrantRequest {
  onlyKeys(
    raw,
    ["alias", "credential", "operation", "scope", "rationale"],
    "JSON-RPC grant request",
  );
  const scope = record(raw.scope, "scope");
  onlyKeys(
    scope,
    [
      "profile",
      "origin",
      "chainId",
      "methods",
      "ttlSeconds",
      "maxUses",
      "maxRequestBytes",
      "maxResponseBytes",
      "allowPrivateNetwork",
    ],
    "JSON-RPC grant scope",
  );
  if (scope.profile !== AGENTCRED_EVM_JSONRPC_READ_PROFILE) {
    throw new AgentCredError("unsupported", "JSON-RPC grant profile is not supported.");
  }
  const request: EvmJsonRpcReadGrantRequest = {
    alias: string(raw.alias, "alias", 128),
    credential: string(raw.credential, "credential", 256),
    operation: "jsonrpc.read",
    scope: {
      profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
      origin: string(scope.origin, "scope.origin", 2048),
      chainId: normalizeEvmChainId(scope.chainId, "scope.chainId"),
      methods: normalizeEvmJsonRpcReadMethods(scope.methods, "scope.methods"),
      ttlSeconds: integer(scope.ttlSeconds, "scope.ttlSeconds", 1, 86_400),
      maxUses: integer(scope.maxUses, "scope.maxUses", 1, 10_000),
    },
  };
  if (raw.rationale !== undefined) {
    request.rationale = string(raw.rationale, "rationale", 1000);
  }
  if (scope.maxRequestBytes !== undefined) {
    request.scope.maxRequestBytes = integer(
      scope.maxRequestBytes,
      "scope.maxRequestBytes",
      0,
      DEFAULT_MAX_BODY_BYTES,
    );
  }
  if (scope.maxResponseBytes !== undefined) {
    request.scope.maxResponseBytes = integer(
      scope.maxResponseBytes,
      "scope.maxResponseBytes",
      0,
      DEFAULT_MAX_BODY_BYTES,
    );
  }
  if (scope.allowPrivateNetwork !== undefined) {
    if (typeof scope.allowPrivateNetwork !== "boolean") {
      throw new AgentCredError("invalid_request", "scope.allowPrivateNetwork must be boolean.");
    }
    request.scope.allowPrivateNetwork = scope.allowPrivateNetwork;
  }
  return request;
}

export function parseGrantRequest(value: unknown): GrantRequest {
  const raw = record(value, "grant request");
  const operation = string(raw.operation, "operation");
  if (operation === "http.fetch") return parseHttpGrantRequest(raw);
  if (operation === "jsonrpc.read") return parseEvmJsonRpcReadGrantRequest(raw);
  throw new AgentCredError("unsupported", "Grant operation is not supported.");
}

export function parseHttpRequest(value: unknown): BrokerHttpRequest {
  const raw = record(value, "HTTP request");
  const method = string(raw.method, "method") as BrokerHttpRequest["method"];
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new AgentCredError("invalid_request", "Unsupported HTTP method.");
  }
  const request: BrokerHttpRequest = {
    url: string(raw.url, "url", 8192),
    method,
  };
  if (raw.headers !== undefined) {
    const input = record(raw.headers, "headers");
    const entries = Object.entries(input);
    if (entries.length > 64) throw new AgentCredError("invalid_request", "Too many request headers.");
    request.headers = Object.fromEntries(
      entries.map(([name, item]) => [string(name, "header name", 128), string(item, `header ${name}`, 4096)]),
    );
  }
  if (raw.bodyBase64 !== undefined) request.bodyBase64 = string(raw.bodyBase64, "bodyBase64", 48 * 1024);
  if (raw.idempotencyKey !== undefined) {
    request.idempotencyKey = string(raw.idempotencyKey, "idempotencyKey", 256);
  }
  return request;
}

export function parseCapability(payload: Record<string, unknown>): string {
  return string(payload.capability, "capability", 128);
}

export function parseEvmJsonRpcReadUse(
  payload: Record<string, unknown>,
): { capability: string; request: BrokerEvmJsonRpcReadCall } {
  onlyKeys(payload, ["capability", "request"], "JSON-RPC grant use");
  return {
    capability: parseCapability(payload),
    request: parseEvmJsonRpcReadCall(payload.request),
  };
}

export function negotiateExtensions(
  offered: readonly string[],
): AgentCredExtension[] {
  return offered.includes(AGENTCRED_EVM_JSONRPC_READ_PROFILE)
    ? [AGENTCRED_EVM_JSONRPC_READ_PROFILE]
    : [];
}

export function safeWireFailure(
  id: string,
  seq: number,
  error: AgentCredError,
): WireFailure {
  return {
    v: AGENTCRED_PROTOCOL,
    id,
    seq,
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.safeDetail ? { detail: error.safeDetail } : {}),
    },
  };
}
