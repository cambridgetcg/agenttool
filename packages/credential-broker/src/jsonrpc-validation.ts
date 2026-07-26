import { AgentCredError } from "./errors.js";
import {
  DEFAULT_MAX_BODY_BYTES,
  EVM_JSONRPC_READ_METHODS,
  type BrokerEvmJsonRpcReadCall,
  type EvmBlockReference,
  type EvmChainId,
  type EvmJsonRpcReadGrantScope,
  type EvmJsonRpcReadMethod,
  type JsonValue,
} from "./types.js";

const METHOD_SET = new Set<string>(EVM_JSONRPC_READ_METHODS);
const BLOCK_TAGS = new Set(["latest", "safe", "finalized"]);
const CANONICAL_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 4_096;
const BOUNDED_RPC_ID = "00000000-0000-4000-8000-000000000000";

function record(
  value: unknown,
  name: string,
  code: "invalid_request" | "request_failed" = "invalid_request",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentCredError(code, `${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
  code: "invalid_request" | "request_failed" = "invalid_request",
): void {
  const allow = new Set(allowed);
  if (Object.keys(value).some((key) => !allow.has(key))) {
    throw new AgentCredError(code, `${name} contains an unknown field.`);
  }
}

export function normalizeEvmChainId(value: unknown, name = "chainId"): EvmChainId {
  if (
    typeof value !== "string" ||
    !/^eip155:[1-9][0-9]{0,19}$/.test(value)
  ) {
    throw new AgentCredError(
      "invalid_request",
      `${name} must be a canonical bounded EIP-155 CAIP-2 identifier.`,
    );
  }
  return value as EvmChainId;
}

export function normalizeEvmJsonRpcReadMethods(
  value: unknown,
  name = "methods",
): EvmJsonRpcReadMethod[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > EVM_JSONRPC_READ_METHODS.length) {
    throw new AgentCredError(
      "invalid_request",
      `${name} must be a non-empty bounded array.`,
    );
  }
  const methods = value.map((method) => {
    if (
      typeof method !== "string" ||
      method.length === 0 ||
      method.length > 64 ||
      !METHOD_SET.has(method)
    ) {
      throw new AgentCredError(
        "scope_denied",
        `${name} contains a method outside the read profile.`,
      );
    }
    return method as EvmJsonRpcReadMethod;
  });
  return [...new Set(methods)];
}

function canonicalQuantity(value: unknown, name: string): asserts value is `0x${string}` {
  if (
    typeof value !== "string" ||
    value.length > 66 ||
    !CANONICAL_QUANTITY.test(value)
  ) {
    throw new AgentCredError(
      "invalid_request",
      `${name} must be a canonical bounded hexadecimal quantity.`,
    );
  }
}

function blockReference(
  value: unknown,
  name: string,
): asserts value is EvmBlockReference {
  if (typeof value !== "string") {
    throw new AgentCredError("invalid_request", `${name} must be a block reference.`);
  }
  if (BLOCK_TAGS.has(value)) return;
  canonicalQuantity(value, name);
}

function address(value: unknown, name: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !EVM_ADDRESS.test(value)) {
    throw new AgentCredError("invalid_request", `${name} must be a 20-byte EVM address.`);
  }
}

function hash(value: unknown, name: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !EVM_HASH.test(value)) {
    throw new AgentCredError("invalid_request", `${name} must be a 32-byte EVM hash.`);
  }
}

/**
 * Parse the complete model-controlled call. There is deliberately no URL,
 * JSON-RPC id/version, headers, raw body, batch, or notification shape.
 */
export function parseEvmJsonRpcReadCall(value: unknown): BrokerEvmJsonRpcReadCall {
  const raw = record(value, "JSON-RPC read call");
  onlyKeys(raw, ["chainId", "method", "params"], "JSON-RPC read call");
  const chainId = normalizeEvmChainId(raw.chainId, "call.chainId");
  if (
    typeof raw.method !== "string" ||
    raw.method.length === 0 ||
    raw.method.length > 64 ||
    !METHOD_SET.has(raw.method)
  ) {
    throw new AgentCredError(
      "scope_denied",
      "JSON-RPC method is outside the read profile.",
    );
  }
  if (!Array.isArray(raw.params)) {
    throw new AgentCredError("invalid_request", "JSON-RPC params must be an array.");
  }

  const method = raw.method as EvmJsonRpcReadMethod;
  switch (method) {
    case "eth_chainId":
    case "eth_blockNumber":
      if (raw.params.length !== 0) {
        throw new AgentCredError("invalid_request", "JSON-RPC method requires empty params.");
      }
      return {
        chainId,
        method: method as "eth_chainId" | "eth_blockNumber",
        params: [],
      };
    case "eth_getBlockByNumber":
      if (raw.params.length !== 2 || raw.params[1] !== false) {
        throw new AgentCredError(
          "invalid_request",
          "eth_getBlockByNumber requires [blockReference, false].",
        );
      }
      blockReference(raw.params[0], "params[0]");
      return {
        chainId,
        method: "eth_getBlockByNumber",
        params: [raw.params[0], false],
      };
    case "eth_getBalance":
    case "eth_getCode":
      if (raw.params.length !== 2) {
        throw new AgentCredError(
          "invalid_request",
          `${method} requires [address, blockReference].`,
        );
      }
      address(raw.params[0], "params[0]");
      blockReference(raw.params[1], "params[1]");
      return {
        chainId,
        method,
        params: [raw.params[0], raw.params[1]],
      };
    case "eth_getTransactionByHash":
    case "eth_getTransactionReceipt":
      if (raw.params.length !== 1) {
        throw new AgentCredError(
          "invalid_request",
          `${method} requires one transaction hash.`,
        );
      }
      hash(raw.params[0], "params[0]");
      return {
        chainId,
        method,
        params: [raw.params[0]],
      };
  }
}

export function validateEvmJsonRpcReadCall(
  scope: Readonly<EvmJsonRpcReadGrantScope>,
  value: unknown,
): BrokerEvmJsonRpcReadCall {
  const call = parseEvmJsonRpcReadCall(value);
  if (
    call.chainId !== scope.chainId ||
    !scope.methods.includes(call.method)
  ) {
    throw new AgentCredError(
      "scope_denied",
      "JSON-RPC call is outside the granted read scope.",
    );
  }
  return call;
}

/** UUIDs have a fixed length, so this is the exact generated request size. */
export function validateEvmJsonRpcReadRequestBytes(
  scope: Readonly<EvmJsonRpcReadGrantScope>,
  call: Readonly<BrokerEvmJsonRpcReadCall>,
): number {
  const encoded = JSON.stringify({
    jsonrpc: "2.0",
    id: BOUNDED_RPC_ID,
    method: call.method,
    params: call.params,
  });
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes > (scope.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES)) {
    throw new AgentCredError(
      "scope_denied",
      "Generated JSON-RPC request exceeds the grant limit.",
    );
  }
  return bytes;
}

function assertJsonValue(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): asserts value is JsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new AgentCredError("request_failed", "Upstream JSON result is too complex.");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AgentCredError("request_failed", "Upstream JSON result is invalid.");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, state, depth + 1);
    return;
  }
  const object = record(value, "Upstream JSON result", "request_failed");
  for (const item of Object.values(object)) {
    assertJsonValue(item, state, depth + 1);
  }
}

function validateMethodResult(
  call: Readonly<BrokerEvmJsonRpcReadCall>,
  result: unknown,
): JsonValue {
  const { method, chainId } = call;
  switch (method) {
    case "eth_chainId": {
      try {
        canonicalQuantity(result, "eth_chainId result");
        const expected = BigInt(chainId.slice("eip155:".length));
        if (BigInt(result) !== expected) {
          throw new AgentCredError(
            "request_failed",
            "Upstream chain identifier does not match the grant.",
          );
        }
      } catch (error) {
        if (error instanceof AgentCredError && error.code === "request_failed") throw error;
        throw new AgentCredError("request_failed", "Upstream chain identifier is invalid.");
      }
      return result;
    }
    case "eth_blockNumber":
    case "eth_getBalance":
      try {
        canonicalQuantity(result, `${method} result`);
      } catch {
        throw new AgentCredError("request_failed", "Upstream quantity result is invalid.");
      }
      return result;
    case "eth_getCode":
      if (typeof result !== "string" || !HEX_DATA.test(result)) {
        throw new AgentCredError("request_failed", "Upstream byte result is invalid.");
      }
      return result;
    case "eth_getBlockByNumber": {
      if (result !== null && (!result || typeof result !== "object" || Array.isArray(result))) {
        throw new AgentCredError("request_failed", "Upstream object result is invalid.");
      }
      assertJsonValue(result, { nodes: 0 });
      if (result === null) return result;
      const block = result as Record<string, unknown>;
      try {
        canonicalQuantity(block.number, "eth_getBlockByNumber result.number");
      } catch {
        throw new AgentCredError("request_failed", "Upstream block identity is invalid.");
      }
      const requestedBlock = call.params[0];
      if (!BLOCK_TAGS.has(requestedBlock) && block.number !== requestedBlock) {
        throw new AgentCredError(
          "request_failed",
          "Upstream block identity does not match the request.",
        );
      }
      return result;
    }
    case "eth_getTransactionByHash": {
      if (result !== null && (!result || typeof result !== "object" || Array.isArray(result))) {
        throw new AgentCredError("request_failed", "Upstream object result is invalid.");
      }
      assertJsonValue(result, { nodes: 0 });
      if (result === null) return result;
      const transaction = result as Record<string, unknown>;
      if (
        typeof transaction.hash !== "string" ||
        !EVM_HASH.test(transaction.hash) ||
        transaction.hash.toLowerCase() !== call.params[0].toLowerCase()
      ) {
        throw new AgentCredError(
          "request_failed",
          "Upstream transaction identity does not match the request.",
        );
      }
      return result;
    }
    case "eth_getTransactionReceipt": {
      if (result !== null && (!result || typeof result !== "object" || Array.isArray(result))) {
        throw new AgentCredError("request_failed", "Upstream object result is invalid.");
      }
      assertJsonValue(result, { nodes: 0 });
      if (result === null) return result;
      const receipt = result as Record<string, unknown>;
      if (
        typeof receipt.transactionHash !== "string" ||
        !EVM_HASH.test(receipt.transactionHash) ||
        receipt.transactionHash.toLowerCase() !== call.params[0].toLowerCase()
      ) {
        throw new AgentCredError(
          "request_failed",
          "Upstream receipt identity does not match the request.",
        );
      }
      return result;
    }
  }
}

/** Validate an upstream envelope without reflecting its error text or data. */
export function parseEvmJsonRpcReadResponse(
  value: unknown,
  expectedId: string,
  call: Readonly<BrokerEvmJsonRpcReadCall>,
): JsonValue {
  const raw = record(value, "Upstream JSON-RPC response", "request_failed");
  if (raw.jsonrpc !== "2.0" || raw.id !== expectedId) {
    throw new AgentCredError("request_failed", "Upstream JSON-RPC envelope is invalid.");
  }
  if (Object.hasOwn(raw, "error")) {
    onlyKeys(raw, ["jsonrpc", "id", "error"], "Upstream JSON-RPC response", "request_failed");
    // Validate only the shape, then collapse the entire provider diagnostic.
    const error = record(raw.error, "Upstream JSON-RPC error", "request_failed");
    onlyKeys(error, ["code", "message", "data"], "Upstream JSON-RPC error", "request_failed");
    throw new AgentCredError("request_failed", "Upstream JSON-RPC returned an error.");
  }
  onlyKeys(raw, ["jsonrpc", "id", "result"], "Upstream JSON-RPC response", "request_failed");
  if (!Object.hasOwn(raw, "result")) {
    throw new AgentCredError("request_failed", "Upstream JSON-RPC response has no result.");
  }
  return validateMethodResult(call, raw.result);
}
