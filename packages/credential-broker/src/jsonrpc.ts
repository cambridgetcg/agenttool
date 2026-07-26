import { randomUUID } from "node:crypto";
import { AgentCredError } from "./errors.js";
import type { ReservedGrant } from "./grants.js";
import {
  performBrokerBearerHttp,
  type BrokerHttpDependencies,
} from "./http.js";
import {
  parseEvmJsonRpcReadResponse,
  validateEvmJsonRpcReadCall,
} from "./jsonrpc-validation.js";
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  DEFAULT_MAX_BODY_BYTES,
  EVM_JSONRPC_READ_PATH,
  type BrokerEvmJsonRpcReadCall,
  type BrokerEvmJsonRpcReadResponse,
  type JsonValue,
} from "./types.js";

export interface BrokerEvmJsonRpcReadExecution
  extends BrokerEvmJsonRpcReadResponse {
  requestBytes: number;
  responseBytes: number;
  status: number;
}

function jsonUtf8(value: unknown, name: string): Buffer {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new AgentCredError("invalid_request", `${name} is not serializable JSON.`);
  }
  const buffer = Buffer.from(encoded, "utf8");
  if (buffer.toString("utf8") !== encoded) {
    buffer.fill(0);
    throw new AgentCredError("invalid_request", `${name} is not canonical UTF-8 JSON.`);
  }
  return buffer;
}

function decodeJson(buffer: Buffer): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new AgentCredError("request_failed", "Upstream response is not valid UTF-8.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentCredError("request_failed", "Upstream response is not valid JSON.");
  }
}

/**
 * Execute one negotiated EVM read. The caller controls only chainId, one
 * allowlisted method, and that method's bounded params.
 */
export async function performBrokerEvmJsonRpcRead(
  grant: ReservedGrant,
  input: BrokerEvmJsonRpcReadCall,
  auditId: string,
  dependencies: BrokerHttpDependencies,
): Promise<BrokerEvmJsonRpcReadExecution> {
  if (grant.request.operation !== "jsonrpc.read") {
    throw new AgentCredError("unsupported", "Grant is not a JSON-RPC read capability.");
  }
  const scope = grant.request.scope;
  const call = validateEvmJsonRpcReadCall(scope, input);
  const rpcId = randomUUID();
  const body = jsonUtf8(
    {
      jsonrpc: "2.0",
      id: rpcId,
      method: call.method,
      params: call.params,
    },
    "JSON-RPC request",
  );
  const maxRequestBytes = scope.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (body.byteLength > maxRequestBytes) {
    body.fill(0);
    throw new AgentCredError(
      "scope_denied",
      "Generated JSON-RPC request exceeds the grant limit.",
    );
  }
  const requestBytes = body.byteLength;

  try {
    const response = await performBrokerBearerHttp(
      {
        credential: grant.request.credential,
        scope: {
          origin: scope.origin,
          methods: ["POST"],
          pathPrefixes: [EVM_JSONRPC_READ_PATH],
          queryNames: [],
          ttlSeconds: scope.ttlSeconds,
          maxUses: scope.maxUses,
          maxRequestBytes,
          maxResponseBytes:
            scope.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES,
          allowPrivateNetwork: scope.allowPrivateNetwork ?? false,
        },
      },
      {
        url: `${scope.origin}${EVM_JSONRPC_READ_PATH}`,
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        bodyBase64: body.toString("base64"),
        idempotencyKey: rpcId,
      },
      auditId,
      dependencies,
    );

    if (response.status < 200 || response.status >= 300) {
      throw new AgentCredError("request_failed", "Upstream JSON-RPC HTTP status is not successful.");
    }
    const contentType = response.headers["content-type"];
    if (
      contentType !== undefined &&
      contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    ) {
      throw new AgentCredError("request_failed", "Upstream response is not JSON.");
    }
    const responseBody = Buffer.from(response.bodyBase64, "base64");
    try {
      const responseBytes = responseBody.byteLength;
      const result = parseEvmJsonRpcReadResponse(
        decodeJson(responseBody),
        rpcId,
        call.method,
        call.chainId,
      );
      const normalized = jsonUtf8(result, "JSON-RPC result");
      try {
        if (
          normalized.byteLength >
          (scope.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES)
        ) {
          throw new AgentCredError(
            "response_too_large",
            "JSON-RPC result exceeds the grant limit.",
          );
        }
      } finally {
        normalized.fill(0);
      }
      return {
        profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
        chainId: call.chainId,
        method: call.method,
        result: result as JsonValue,
        auditId,
        redactions: response.redactions,
        requestBytes,
        responseBytes,
        status: response.status,
      };
    } finally {
      responseBody.fill(0);
    }
  } finally {
    body.fill(0);
  }
}
