/**
 * Strict composition transport from @agenttool/alchemy to the negotiated
 * agentcred.evm-jsonrpc-read/0.1 profile.
 *
 * This package receives no credential, Keychain reference, caller-selected
 * endpoint, raw JSON-RPC envelope, or provider response body. It checks only
 * the non-secret exact origin recorded in a public grant receipt.
 *
 * Doctrine: docs/ALCHEMY.md.
 */

import {
  ALCHEMY_NETWORKS,
  MAX_ALCHEMY_RESPONSE_BYTES,
  type AlchemyNetwork,
  type AlchemyReadTransport,
  type AlchemyTransportRequest,
  type AlchemyTransportResponse,
} from "@agenttool/alchemy";
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  DEFAULT_MAX_BODY_BYTES,
  EVM_JSONRPC_READ_METHODS,
  type AgentCredClient,
  type BrokerEvmJsonRpcReadCall,
  type BrokerEvmJsonRpcReadResponse,
  type EvmChainId,
  type EvmJsonRpcReadMethod,
  type GrantHandle,
} from "@agenttool/credential-broker";

export const PACKAGE_NAME = "@agenttool/alchemy-agentcred";
export const PACKAGE_VERSION = "0.1.0-dev.1";
export const ADAPTER_PROTOCOL = "agenttool.alchemy-agentcred/0.1";

const ALCHEMY_TRANSPORT_PROTOCOL = "agenttool.alchemy.transport/0.1";
const METHOD_SET: ReadonlySet<string> = new Set(EVM_JSONRPC_READ_METHODS);
const AUDIT_ID_PATTERN = /^[A-Za-z0-9:._~-]+$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY_PATTERN = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "latest",
  "safe",
  "finalized",
]);

export type AlchemyAgentCredErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "unsupported_method"
  | "not_connected"
  | "grant_unavailable"
  | "grant_scope_denied"
  | "aborted"
  | "deadline_exceeded"
  | "broker_failed"
  | "broker_response_mismatch";

const ERROR_MESSAGES: Readonly<Record<AlchemyAgentCredErrorCode, string>> =
  Object.freeze({
    invalid_configuration: "Alchemy AgentCred adapter configuration is invalid.",
    invalid_request: "Alchemy transport request is invalid.",
    unsupported_method: "Method is outside the AgentCred EVM read profile.",
    not_connected: "Credential broker client is not connected.",
    grant_unavailable: "No credential grant is mapped to this Alchemy network.",
    grant_scope_denied: "Credential grant does not cover this Alchemy read.",
    aborted: "Alchemy read was aborted before AgentCred client handoff.",
    deadline_exceeded: "Alchemy read deadline passed before AgentCred client handoff.",
    broker_failed: "Credential broker read failed.",
    broker_response_mismatch: "Credential broker response does not match the Alchemy read.",
  });

/** Fixed-message errors never carry provider, endpoint, credential, or body data. */
export class AlchemyAgentCredError extends Error {
  readonly code: AlchemyAgentCredErrorCode;

  constructor(code: AlchemyAgentCredErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "AlchemyAgentCredError";
    this.code = code;
  }
}

export type AgentCredReadClient = Pick<
  AgentCredClient,
  "connected" | "callEvmJsonRpcRead"
>;

export type AlchemyAgentCredGrantMap = Readonly<
  Partial<Record<AlchemyNetwork, GrantHandle>>
>;

export interface CreateAlchemyAgentCredTransportOptions {
  /** An AgentCred client already connected by trusted host code. */
  readonly client: AgentCredReadClient;
  /** Trusted-host network selection; capabilities remain private in each handle. */
  readonly grants: AlchemyAgentCredGrantMap;
  /** Host wall clock, injectable only for deterministic boundary tests. */
  readonly now?: () => number;
}

interface ValidatedRequest {
  readonly operationId: number;
  readonly network: AlchemyNetwork;
  readonly chainId: EvmChainId;
  readonly call: BrokerEvmJsonRpcReadCall;
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
  readonly maxResponseBytes: number;
}

function fail(code: AlchemyAgentCredErrorCode): never {
  throw new AlchemyAgentCredError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: AlchemyAgentCredErrorCode,
): void {
  const allowedSet = new Set(allowed);
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !allowedSet.has(key),
    )
  ) {
    fail(code);
  }
}

function canonicalBlockReference(value: unknown): boolean {
  return (
    (typeof value === "string" && BLOCK_TAGS.has(value)) ||
    (typeof value === "string" &&
      value.length <= 66 &&
      QUANTITY_PATTERN.test(value))
  );
}

function readWallClock(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    fail("invalid_configuration");
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("invalid_configuration");
  }
  return value;
}

function parseCall(
  value: unknown,
  chainId: EvmChainId,
): BrokerEvmJsonRpcReadCall {
  if (!isPlainRecord(value)) fail("invalid_request");
  exactKeys(value, ["method", "params"], "invalid_request");
  const method = value.method;
  const params = value.params;
  if (typeof method !== "string" || !METHOD_SET.has(method)) {
    fail("unsupported_method");
  }
  if (!Array.isArray(params)) fail("invalid_request");
  const paramCount = params.length;

  switch (method as EvmJsonRpcReadMethod) {
    case "eth_chainId":
    case "eth_blockNumber":
      if (paramCount !== 0) fail("invalid_request");
      return Object.freeze({
        chainId,
        method,
        params: Object.freeze([]),
      }) as BrokerEvmJsonRpcReadCall;
    case "eth_getBlockByNumber": {
      const blockReference = params[0];
      const includeTransactions = params[1];
      if (
        paramCount !== 2 ||
        !canonicalBlockReference(blockReference) ||
        includeTransactions !== false
      ) {
        fail("invalid_request");
      }
      return Object.freeze({
        chainId,
        method,
        params: Object.freeze([blockReference, false]),
      }) as BrokerEvmJsonRpcReadCall;
    }
    case "eth_getBalance":
    case "eth_getCode": {
      const address = params[0];
      const blockReference = params[1];
      if (
        paramCount !== 2 ||
        typeof address !== "string" ||
        !ADDRESS_PATTERN.test(address) ||
        !canonicalBlockReference(blockReference)
      ) {
        fail("invalid_request");
      }
      return Object.freeze({
        chainId,
        method,
        params: Object.freeze([address, blockReference]),
      }) as BrokerEvmJsonRpcReadCall;
    }
    case "eth_getTransactionByHash":
    case "eth_getTransactionReceipt": {
      const transactionHash = params[0];
      if (
        paramCount !== 1 ||
        typeof transactionHash !== "string" ||
        !HASH_PATTERN.test(transactionHash)
      ) {
        fail("invalid_request");
      }
      return Object.freeze({
        chainId,
        method,
        params: Object.freeze([transactionHash]),
      }) as BrokerEvmJsonRpcReadCall;
    }
  }
}

function validateRequest(
  value: unknown,
  now: () => number,
): ValidatedRequest {
  if (!isPlainRecord(value)) fail("invalid_request");
  exactKeys(
    value,
    [
      "protocol",
      "operationId",
      "network",
      "chainId",
      "call",
      "signal",
      "deadlineAtMs",
      "maxResponseBytes",
    ],
    "invalid_request",
  );
  const protocol = value.protocol;
  const operationId = value.operationId;
  const networkValue = value.network;
  const chainId = value.chainId;
  const callValue = value.call;
  const signal = value.signal;
  const deadlineValue = value.deadlineAtMs;
  const maxResponseBytes = value.maxResponseBytes;
  if (
    protocol !== ALCHEMY_TRANSPORT_PROTOCOL ||
    !Number.isSafeInteger(operationId) ||
    (operationId as number) < 1 ||
    typeof networkValue !== "string" ||
    !Object.hasOwn(ALCHEMY_NETWORKS, networkValue) ||
    !Number.isSafeInteger(deadlineValue) ||
    (deadlineValue as number) < 1 ||
    maxResponseBytes !== MAX_ALCHEMY_RESPONSE_BYTES
  ) {
    fail("invalid_request");
  }
  const network = networkValue as AlchemyNetwork;
  const expectedChainId = ALCHEMY_NETWORKS[network].caip2;
  if (chainId !== expectedChainId) fail("invalid_request");
  const deadlineAtMs = deadlineValue as number;
  if (deadlineAtMs <= readWallClock(now)) fail("deadline_exceeded");
  if (
    typeof signal !== "object" ||
    signal === null ||
    typeof (signal as AbortSignal).aborted !== "boolean" ||
    typeof (signal as AbortSignal).addEventListener !== "function" ||
    typeof (signal as AbortSignal).removeEventListener !== "function"
  ) {
    fail("invalid_request");
  }
  if ((signal as AbortSignal).aborted) fail("aborted");

  const call = parseCall(callValue, expectedChainId);
  return {
    operationId: operationId as number,
    network,
    chainId: expectedChainId,
    call,
    signal: signal as AbortSignal,
    deadlineAtMs,
    maxResponseBytes: maxResponseBytes as number,
  };
}

function readGrantScope(
  handle: GrantHandle,
  network: AlchemyNetwork,
  maximumResponseBytes: number,
  requestedMethod?: EvmJsonRpcReadMethod,
): void {
  if (typeof handle !== "object" || handle === null) {
    fail("grant_scope_denied");
  }
  const handleAlias = handle.alias;
  const receipt = handle.receipt;
  if (!isPlainRecord(receipt)) {
    fail("grant_scope_denied");
  }
  const receiptOperation = receipt.operation;
  const receiptAlias = receipt.alias;
  const receiptScope = receipt.scope;
  if (
    receiptOperation !== "jsonrpc.read" ||
    typeof handleAlias !== "string" ||
    receiptAlias !== handleAlias ||
    !isPlainRecord(receiptScope)
  ) {
    fail("grant_scope_denied");
  }
  const scope = receiptScope;
  const descriptor = ALCHEMY_NETWORKS[network];
  const expectedOrigin =
    `https://${descriptor.alchemyNetwork}.g.alchemy.com`;
  const profile = scope.profile;
  const origin = scope.origin;
  const chainId = scope.chainId;
  const allowPrivateNetwork = scope.allowPrivateNetwork;
  const configuredMaxResponseBytes = scope.maxResponseBytes;
  const configuredMethods = scope.methods;
  const effectiveMaxResponseBytes =
    configuredMaxResponseBytes === undefined
      ? DEFAULT_MAX_BODY_BYTES
      : configuredMaxResponseBytes;
  const allowedMaxResponseBytes = Math.min(
    maximumResponseBytes,
    DEFAULT_MAX_BODY_BYTES,
  );
  if (
    profile !== AGENTCRED_EVM_JSONRPC_READ_PROFILE ||
    origin !== expectedOrigin ||
    chainId !== descriptor.caip2 ||
    (allowPrivateNetwork !== undefined &&
      typeof allowPrivateNetwork !== "boolean") ||
    allowPrivateNetwork === true ||
    !Number.isSafeInteger(effectiveMaxResponseBytes) ||
    (effectiveMaxResponseBytes as number) < 1 ||
    (effectiveMaxResponseBytes as number) > allowedMaxResponseBytes ||
    !Array.isArray(configuredMethods) ||
    configuredMethods.length < 1 ||
    configuredMethods.length > EVM_JSONRPC_READ_METHODS.length
  ) {
    fail("grant_scope_denied");
  }
  const methods = new Set<string>();
  for (const method of configuredMethods) {
    if (typeof method !== "string" || !METHOD_SET.has(method)) {
      fail("grant_scope_denied");
    }
    methods.add(method);
  }
  if (
    methods.size !== configuredMethods.length ||
    (requestedMethod !== undefined && !methods.has(requestedMethod))
  ) {
    fail("grant_scope_denied");
  }
}

function snapshotGrantMap(value: unknown): AlchemyAgentCredGrantMap {
  if (!isPlainRecord(value)) fail("invalid_configuration");
  const snapshot: Partial<Record<AlchemyNetwork, GrantHandle>> =
    Object.create(null) as Partial<Record<AlchemyNetwork, GrantHandle>>;
  let count = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !Object.hasOwn(ALCHEMY_NETWORKS, key) ||
      value[key] === undefined
    ) {
      fail("invalid_configuration");
    }
    const network = key as AlchemyNetwork;
    const handle = value[key] as GrantHandle;
    readGrantScope(handle, network, MAX_ALCHEMY_RESPONSE_BYTES);
    snapshot[network] = handle;
    count += 1;
  }
  if (count === 0) fail("invalid_configuration");
  return Object.freeze(snapshot);
}

function validateBrokerResponse(
  value: unknown,
  request: ValidatedRequest,
): BrokerEvmJsonRpcReadResponse {
  if (!isPlainRecord(value)) fail("broker_response_mismatch");
  exactKeys(
    value,
    ["profile", "chainId", "method", "result", "auditId", "redactions"],
    "broker_response_mismatch",
  );
  const profile = value.profile;
  const chainId = value.chainId;
  const method = value.method;
  const hasResult = Object.hasOwn(value, "result");
  const result = value.result;
  const auditId = value.auditId;
  const redactions = value.redactions;
  if (
    profile !== AGENTCRED_EVM_JSONRPC_READ_PROFILE ||
    chainId !== request.chainId ||
    method !== request.call.method ||
    !hasResult ||
    typeof auditId !== "string" ||
    auditId.length < 1 ||
    auditId.length > 128 ||
    !AUDIT_ID_PATTERN.test(auditId) ||
    !Number.isInteger(redactions) ||
    (redactions as number) < 0 ||
    (redactions as number) > 1_000_000
  ) {
    fail("broker_response_mismatch");
  }
  return Object.freeze({
    profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
    chainId: request.chainId,
    method: request.call.method,
    result,
    auditId,
    redactions,
  }) as BrokerEvmJsonRpcReadResponse;
}

/**
 * Build one Alchemy transport over already-issued, connection-bound AgentCred
 * grants. This function never connects, requests a grant, or reads a secret.
 */
export function createAlchemyAgentCredTransport(
  options: CreateAlchemyAgentCredTransportOptions,
): AlchemyReadTransport {
  let client: AgentCredReadClient;
  let grants: AlchemyAgentCredGrantMap;
  let now: () => number;
  try {
    if (!isPlainRecord(options)) fail("invalid_configuration");
    exactKeys(options, ["client", "grants", "now"], "invalid_configuration");
    const candidate = options.client;
    const configuredGrants = options.grants;
    const configuredNow = options.now;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.connected !== "boolean" ||
      typeof candidate.callEvmJsonRpcRead !== "function"
    ) {
      fail("invalid_configuration");
    }
    if (!candidate.connected) fail("not_connected");
    if (configuredNow !== undefined && typeof configuredNow !== "function") {
      fail("invalid_configuration");
    }
    client = candidate;
    grants = snapshotGrantMap(configuredGrants);
    now = configuredNow ?? Date.now;
  } catch (error) {
    if (error instanceof AlchemyAgentCredError) throw error;
    fail("invalid_configuration");
  }

  return Object.freeze({
    async send(input: AlchemyTransportRequest): Promise<AlchemyTransportResponse> {
      let request: ValidatedRequest;
      let handle: GrantHandle;
      try {
        request = validateRequest(input, now);
        const mapped = grants[request.network];
        if (mapped === undefined) fail("grant_unavailable");
        handle = mapped;
        readGrantScope(
          handle,
          request.network,
          request.maxResponseBytes,
          request.call.method,
        );
      } catch (error) {
        if (error instanceof AlchemyAgentCredError) throw error;
        fail("invalid_request");
      }

      try {
        if (!client.connected) fail("not_connected");
        if (request.signal.aborted) fail("aborted");
        if (request.deadlineAtMs <= readWallClock(now)) {
          fail("deadline_exceeded");
        }
      } catch (error) {
        if (error instanceof AlchemyAgentCredError) throw error;
        fail("invalid_configuration");
      }

      let brokerResponse: unknown;
      try {
        brokerResponse = await client.callEvmJsonRpcRead(
          handle,
          request.call,
        );
      } catch {
        fail("broker_failed");
      }

      let response: BrokerEvmJsonRpcReadResponse;
      try {
        response = validateBrokerResponse(brokerResponse, request);
      } catch (error) {
        if (
          error instanceof AlchemyAgentCredError &&
          error.code === "broker_response_mismatch"
        ) {
          throw error;
        }
        fail("broker_response_mismatch");
      }

      return Object.freeze({
        operationId: request.operationId,
        chainId: response.chainId,
        method: response.method,
        result: response.result,
        auditId: response.auditId,
        redactions: response.redactions,
      });
    },
  });
}
