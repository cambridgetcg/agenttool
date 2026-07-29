import { AgentCredError } from "./errors.js";
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  DEFAULT_MAX_BODY_BYTES,
  type ConsentDecision,
  type ConsentProvider,
  type EvmChainId,
  type EvmJsonRpcReadGrantRequest,
  type EvmJsonRpcReadGrantScope,
  type EvmJsonRpcReadMethod,
  type GrantRequest,
  type HttpGrantRequest,
  type HttpGrantScope,
  type HttpMethod,
} from "./types.js";
import {
  normalizeEvmChainId,
  normalizeEvmJsonRpcReadMethods,
} from "./jsonrpc-validation.js";
import { isCredentialAlias } from "./identifiers.js";

export interface HttpBrokerPolicy {
  /** Omitted remains equivalent to the original agentcred/0.1 HTTP policy. */
  operation?: "http.fetch";
  credential: string;
  origin: string;
  methods: HttpMethod[];
  pathPrefixes: string[];
  queryNames?: string[];
  headerValues?: Record<string, string[]>;
  allowPaymentSignature?: boolean;
  maxTtlSeconds: number;
  maxUses: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  allowPrivateNetwork?: boolean;
}

export interface EvmJsonRpcReadBrokerPolicy {
  operation: "jsonrpc.read";
  profile: typeof AGENTCRED_EVM_JSONRPC_READ_PROFILE;
  credential: string;
  origin: string;
  chainId: EvmChainId;
  methods: EvmJsonRpcReadMethod[];
  maxTtlSeconds: number;
  maxUses: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  allowPrivateNetwork?: boolean;
}

export type BrokerPolicy =
  | HttpBrokerPolicy
  | EvmJsonRpcReadBrokerPolicy;

function normalizeOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AgentCredError("invalid_request", "Grant origin is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new AgentCredError("scope_denied", "Credentialed HTTP requires HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new AgentCredError("invalid_request", "Grant origin must contain only scheme, host, and port.");
  }
  if (url.hostname.endsWith(".")) {
    throw new AgentCredError("scope_denied", "Trailing-dot hostnames are not allowed.");
  }
  return url.origin;
}

export function normalizePathPrefix(input: string): string {
  if (!input.startsWith("/") || input.includes("\\") || /%(?:00|25|2e|2f|5c)/i.test(input)) {
    throw new AgentCredError("scope_denied", "Path prefix is not in the strict canonical profile.");
  }
  const url = new URL(input, "https://agentcred.invalid");
  if (url.search || url.hash || url.pathname !== input) {
    throw new AgentCredError("scope_denied", "Path prefix must be normalized and contain no query.");
  }
  return input;
}

export function pathWithinPrefix(path: string, prefix: string): boolean {
  if (prefix === "/") return true;
  if (path === prefix) return true;
  return prefix.endsWith("/") ? path.startsWith(prefix) : path.startsWith(`${prefix}/`);
}

function normalizeQueryNames(input: string[] | undefined): string[] {
  const names = input ?? [];
  const forbidden = new Set([
    "api_key",
    "apikey",
    "access_token",
    "authorization",
    "auth",
    "token",
    "secret",
    "password",
  ]);
  if (names.some((name) => typeof name !== "string")) {
    throw new AgentCredError("scope_denied", "Query-name scope is outside the strict profile.");
  }
  const output = names.map((name) => name.trim());
  if (
    output.some(
      (name) =>
        !name ||
        name.length > 128 ||
        !/^[A-Za-z0-9_.:-]+$/.test(name) ||
        forbidden.has(name.toLowerCase()),
    )
  ) {
    throw new AgentCredError("scope_denied", "Query-name scope is outside the strict profile.");
  }
  return [...new Set(output)];
}

function normalizeHeaderValues(
  input: Record<string, string[]> | undefined,
): Record<string, string[]> {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentCredError("scope_denied", "Header-value scope is outside the strict profile.");
  }
  const output: Record<string, string[]> = {};
  for (const [rawName, rawValues] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    if (
      name !== "x-agent-id" ||
      output[name] !== undefined ||
      !Array.isArray(rawValues) ||
      rawValues.length === 0 ||
      rawValues.length > 64
    ) {
      throw new AgentCredError("scope_denied", "Header-value scope is outside the strict profile.");
    }
    if (rawValues.some((value) => typeof value !== "string")) {
      throw new AgentCredError("scope_denied", "Header-value scope is outside the strict profile.");
    }
    const values = rawValues.map((value) => value.trim());
    if (
      values.some(
        (value) =>
          !value || value.length > 256 || /[\0\r\n]/.test(value),
      )
    ) {
      throw new AgentCredError("scope_denied", "Header-value scope is outside the strict profile.");
    }
    output[name] = [...new Set(values)];
  }
  return output;
}

function normalizeHttpGrantRequest(request: HttpGrantRequest): HttpGrantRequest {
  const methods = [...new Set(request.scope.methods.map((method) => method.toUpperCase() as HttpMethod))];
  const pathPrefixes = [...new Set(request.scope.pathPrefixes.map(normalizePathPrefix))];
  if (methods.length === 0 || pathPrefixes.length === 0) {
    throw new AgentCredError("invalid_request", "Grant must contain at least one method and path prefix.");
  }
  const alias = request.alias.trim();
  const credential = request.credential.trim();
  if (!alias || !credential) {
    throw new AgentCredError("invalid_request", "Grant alias and credential reference must not be blank.");
  }
  return {
    ...request,
    alias,
    credential,
    scope: {
      ...request.scope,
      origin: normalizeOrigin(request.scope.origin),
      methods,
      pathPrefixes,
      queryNames: normalizeQueryNames(request.scope.queryNames),
      headerValues: normalizeHeaderValues(request.scope.headerValues),
      allowPaymentSignature: request.scope.allowPaymentSignature ?? false,
      maxRequestBytes: request.scope.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES,
      maxResponseBytes: request.scope.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES,
      allowPrivateNetwork: request.scope.allowPrivateNetwork ?? false,
    },
  };
}

function normalizeEvmJsonRpcReadGrantRequest(
  request: EvmJsonRpcReadGrantRequest,
): EvmJsonRpcReadGrantRequest {
  const alias = request.alias.trim();
  const credential = request.credential.trim();
  if (!alias || !credential) {
    throw new AgentCredError("invalid_request", "Grant alias and credential reference must not be blank.");
  }
  if (request.scope.profile !== AGENTCRED_EVM_JSONRPC_READ_PROFILE) {
    throw new AgentCredError("unsupported", "JSON-RPC grant profile is not supported.");
  }
  return {
    ...request,
    alias,
    credential,
    scope: {
      ...request.scope,
      profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
      origin: normalizeOrigin(request.scope.origin),
      chainId: normalizeEvmChainId(request.scope.chainId, "scope.chainId"),
      methods: normalizeEvmJsonRpcReadMethods(request.scope.methods, "scope.methods"),
      maxRequestBytes: request.scope.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES,
      maxResponseBytes: request.scope.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES,
      allowPrivateNetwork: request.scope.allowPrivateNetwork ?? false,
    },
  };
}

export function normalizeGrantRequest(request: GrantRequest): GrantRequest {
  return request.operation === "http.fetch"
    ? normalizeHttpGrantRequest(request)
    : normalizeEvmJsonRpcReadGrantRequest(request);
}

function httpScopeFits(request: HttpGrantScope, policy: HttpBrokerPolicy): boolean {
  const policyOrigin = normalizeOrigin(policy.origin);
  const policyPaths = policy.pathPrefixes.map(normalizePathPrefix);
  const policyMethods = new Set(policy.methods);
  const policyQueries = new Set(normalizeQueryNames(policy.queryNames));
  const policyHeaders = normalizeHeaderValues(policy.headerValues);
  const requestHeaders = normalizeHeaderValues(request.headerValues);
  const requestMax = request.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES;
  const responseMax = request.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES;
  return (
    request.origin === policyOrigin &&
    request.methods.every((method) => policyMethods.has(method)) &&
    request.pathPrefixes.every((path) => policyPaths.some((parent) => pathWithinPrefix(path, parent))) &&
    (request.queryNames ?? []).every((name) => policyQueries.has(name)) &&
    Object.entries(requestHeaders).every(([name, values]) =>
      values.every((value) => (policyHeaders[name] ?? []).includes(value)),
    ) &&
    (!request.allowPaymentSignature || policy.allowPaymentSignature === true) &&
    request.ttlSeconds <= policy.maxTtlSeconds &&
    request.maxUses <= policy.maxUses &&
    requestMax <= (policy.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES) &&
    responseMax <= (policy.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES) &&
    (!request.allowPrivateNetwork || policy.allowPrivateNetwork === true)
  );
}

function jsonRpcScopeFits(
  request: EvmJsonRpcReadGrantScope,
  policy: EvmJsonRpcReadBrokerPolicy,
): boolean {
  const requestMax = request.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES;
  const responseMax = request.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES;
  const policyMethods = new Set(policy.methods);
  return (
    request.profile === AGENTCRED_EVM_JSONRPC_READ_PROFILE &&
    request.origin === normalizeOrigin(policy.origin) &&
    request.chainId === policy.chainId &&
    request.methods.every((method) => policyMethods.has(method)) &&
    request.ttlSeconds <= policy.maxTtlSeconds &&
    request.maxUses <= policy.maxUses &&
    requestMax <= (policy.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES) &&
    responseMax <= (policy.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES) &&
    (!request.allowPrivateNetwork || policy.allowPrivateNetwork === true)
  );
}

function policyCommonIsValid(policy: BrokerPolicy): boolean {
  return (
    Boolean(policy) &&
    isCredentialAlias(policy.credential) &&
    typeof policy.origin === "string" &&
    policy.origin.length <= 2048 &&
    Number.isSafeInteger(policy.maxTtlSeconds) &&
    policy.maxTtlSeconds >= 1 &&
    policy.maxTtlSeconds <= 86_400 &&
    Number.isSafeInteger(policy.maxUses) &&
    policy.maxUses >= 1 &&
    policy.maxUses <= 10_000 &&
    (policy.maxRequestBytes === undefined ||
      (Number.isSafeInteger(policy.maxRequestBytes) &&
        policy.maxRequestBytes >= 0 &&
        policy.maxRequestBytes <= DEFAULT_MAX_BODY_BYTES)) &&
    (policy.maxResponseBytes === undefined ||
      (Number.isSafeInteger(policy.maxResponseBytes) &&
        policy.maxResponseBytes >= 0 &&
        policy.maxResponseBytes <= DEFAULT_MAX_BODY_BYTES)) &&
    (policy.allowPrivateNetwork === undefined ||
      typeof policy.allowPrivateNetwork === "boolean")
  );
}

function normalizeHttpPolicy(policy: HttpBrokerPolicy): HttpBrokerPolicy {
  const allowedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
  if (
    !policyCommonIsValid(policy) ||
    (policy.operation !== undefined && policy.operation !== "http.fetch") ||
    !Array.isArray(policy.methods) ||
    policy.methods.length === 0 ||
    policy.methods.some((method) => !allowedMethods.has(method)) ||
    !Array.isArray(policy.pathPrefixes) ||
    policy.pathPrefixes.length === 0 ||
    policy.pathPrefixes.some((path) => typeof path !== "string") ||
    (policy.queryNames !== undefined && !Array.isArray(policy.queryNames)) ||
    (policy.headerValues !== undefined &&
      (!policy.headerValues ||
        typeof policy.headerValues !== "object" ||
        Array.isArray(policy.headerValues))) ||
    (policy.allowPaymentSignature !== undefined &&
      typeof policy.allowPaymentSignature !== "boolean")
  ) {
    throw new AgentCredError("invalid_request", "Owner policy is invalid.");
  }
  return {
    ...policy,
    ...(policy.operation === "http.fetch" ? { operation: "http.fetch" as const } : {}),
    credential: policy.credential.trim(),
    origin: normalizeOrigin(policy.origin),
    methods: [...new Set(policy.methods)],
    pathPrefixes: [...new Set(policy.pathPrefixes.map(normalizePathPrefix))],
    queryNames: normalizeQueryNames(policy.queryNames),
    headerValues: normalizeHeaderValues(policy.headerValues),
    allowPaymentSignature: policy.allowPaymentSignature ?? false,
  };
}

function normalizeJsonRpcPolicy(
  policy: EvmJsonRpcReadBrokerPolicy,
): EvmJsonRpcReadBrokerPolicy {
  if (
    !policyCommonIsValid(policy) ||
    policy.operation !== "jsonrpc.read" ||
    policy.profile !== AGENTCRED_EVM_JSONRPC_READ_PROFILE
  ) {
    throw new AgentCredError("invalid_request", "Owner policy is invalid.");
  }
  return {
    ...policy,
    operation: "jsonrpc.read",
    profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
    credential: policy.credential.trim(),
    origin: normalizeOrigin(policy.origin),
    chainId: normalizeEvmChainId(policy.chainId, "policy.chainId"),
    methods: normalizeEvmJsonRpcReadMethods(policy.methods, "policy.methods"),
  };
}

/** Owner-authored standing policy. Repository/model text cannot modify it. */
export class PolicyConsent implements ConsentProvider {
  readonly #policies: BrokerPolicy[];

  constructor(policies: BrokerPolicy[]) {
    this.#policies = policies.map((policy) => {
      if (
        policy &&
        typeof policy === "object" &&
        (policy as { operation?: unknown }).operation === "jsonrpc.read"
      ) {
        return normalizeJsonRpcPolicy(policy as EvmJsonRpcReadBrokerPolicy);
      }
      return normalizeHttpPolicy(policy as HttpBrokerPolicy);
    });
  }

  async decide(request: Readonly<GrantRequest>): Promise<ConsentDecision> {
    const allowed = this.#policies.some((policy) => {
      if (policy.credential !== request.credential) return false;
      if (request.operation === "http.fetch") {
        return (
          policy.operation !== "jsonrpc.read" &&
          httpScopeFits(request.scope, policy)
        );
      }
      return (
        policy.operation === "jsonrpc.read" &&
        jsonRpcScopeFits(request.scope, policy)
      );
    });
    return allowed
      ? { allowed: true }
      : { allowed: false, reasonCode: "outside_owner_policy" };
  }
}

export class DenyAllConsent implements ConsentProvider {
  async decide(): Promise<ConsentDecision> {
    return { allowed: false, reasonCode: "no_consent_provider" };
  }
}
