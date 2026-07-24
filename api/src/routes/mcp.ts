/** /v1/mcp — public, read-only Model Context Protocol endpoint.
 *
 *  One fresh official SDK server + Web Standard Streamable HTTP transport is
 *  created for every POST. The transport is stateless and returns one JSON
 *  response, so it keeps no client session, opens no server-initiated stream,
 *  and performs no automatic action.
 *
 *  Wire:
 *    POST /v1/mcp — MCP Streamable HTTP; Accept must list application/json
 *                   and text/event-stream.
 *    GET  /v1/mcp — 405; this stateless server offers no standalone SSE stream.
 *
 *  Origin is absent for ordinary server-side MCP clients. When a browser sends
 *  it, only the endpoint's own origin is accepted. This is an application
 *  endpoint, not permission to read any auth-gated AgentTool resource.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 1) ·
 *  docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  type CallToolResult,
  CallToolRequestSchema,
  ErrorCode,
  InitializeRequestSchema,
  JSONRPCRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  RequestIdSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { clientIp } from "../middleware/client-ip";
import { takePublicMcpLimit } from "../services/mcp/rate-limit";
import {
  listResources,
  McpResourceNotFoundError,
  readResource,
} from "../services/mcp/resources";
import {
  callTool,
  listTools,
  McpUnknownToolError,
} from "../services/mcp/tools";

const app = new Hono();

export const MCP_SERVER_INFO = {
  name: "agenttool",
  version: "1.0.0",
} as const;

export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_MAX_BODY_BYTES = 64 * 1024;

const PUBLIC_MCP_ORIGIN = new URL(
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev",
).origin;

const INSTRUCTIONS =
  "AgentTool's public canon registry and platform-self are available as read-only MCP resources. Read agenttool://canon first for the registry index, or call canon.summary. No tool writes, pays, installs, invokes another agent, or schedules follow-up work.";

/** Browser connections must name the configured public origin. The request
 * URL's host is not trusted because a proxy may have derived it from an
 * attacker-controlled Host header. Native/server-side clients normally omit
 * Origin and remain welcome. */
export function isAllowedMcpOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;

  try {
    return new URL(origin).origin === PUBLIC_MCP_ORIGIN;
  } catch {
    return false;
  }
}

function protocolHttpError(
  status: number,
  code: number,
  message: string,
  headers: HeadersInit = {},
  id: string | number | null = null,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
    },
  );
}

function rateLimitResponse(retryAfterSec: number): Response {
  return protocolHttpError(
    429,
    -32000,
    "Rate limit exceeded. Retry after the stated interval.",
    {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSec),
    },
  );
}

function isToolCallMessage(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { method?: unknown }).method === "tools/call"
  );
}

function messageId(value: unknown): string | number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const parsed = RequestIdSchema.safeParse((value as { id?: unknown }).id);
  return parsed.success ? parsed.data : null;
}

function isInitializeAttempt(value: unknown): value is {
  method: "initialize";
} {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { method?: unknown }).method === "initialize"
  );
}

/** Create the public server afresh for one stateless HTTP request. */
export function createPublicMcpServer(): Server {
  const server = new Server(MCP_SERVER_INFO, {
    capabilities: {
      resources: { subscribe: false, listChanged: false },
      tools: { listChanged: false },
    },
    instructions: INSTRUCTIONS,
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      return {
        contents: [await readResource(request.params.uri)],
      };
    } catch (error) {
      if (error instanceof McpResourceNotFoundError) {
        throw new McpError(-32002, "Resource not found", {
          uri: error.uri,
        });
      }
      throw error;
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callTool(
        request.params.name,
        request.params.arguments ?? {},
      );
      return result as CallToolResult;
    } catch (error) {
      if (error instanceof McpUnknownToolError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  });

  return server;
}

// Reject disallowed origins and methods, then spend one request-quota unit,
// before reading any request body.
app.all("/", async (c, next) => {
  const request = c.req.raw;

  if (!isAllowedMcpOrigin(request)) {
    return protocolHttpError(
      403,
      -32000,
      "Forbidden: Origin must match the MCP endpoint origin.",
    );
  }

  if (request.method !== "POST") {
    return protocolHttpError(405, -32000, "Method not allowed.", {
      Allow: "POST",
    });
  }

  const limitKey = clientIp(request);
  const requestLimit = takePublicMcpLimit("request", limitKey);
  if (!requestLimit.allowed) {
    return rateLimitResponse(requestLimit.retryAfterSec);
  }

  await next();
});

app.use(
  "/",
  bodyLimit({
    maxSize: MCP_MAX_BODY_BYTES,
    onError: () =>
      protocolHttpError(
        413,
        -32000,
        `MCP request bodies are capped at ${MCP_MAX_BODY_BYTES} bytes.`,
      ),
  }),
);

app.all("/", async (c) => {
  const request = c.req.raw;
  let parsedBody: unknown;
  let bodyParsed = false;
  try {
    parsedBody = await request.clone().json();
    bodyParsed = true;
  } catch {
    // Let the official transport return its own parse error.
  }

  // MCP removed JSON-RPC batching in the 2025-06-18 protocol revision. The
  // SDK remains backwards-compatible, so narrow it at this current endpoint.
  if (bodyParsed && Array.isArray(parsedBody)) {
    return protocolHttpError(
      400,
      ErrorCode.InvalidRequest,
      "JSON-RPC batching is not supported by this MCP protocol version.",
      {},
    );
  }

  if (bodyParsed && isInitializeAttempt(parsedBody)) {
    const initialize = InitializeRequestSchema.safeParse(parsedBody);
    const jsonRpcRequest = JSONRPCRequestSchema.safeParse(parsedBody);
    if (initialize.success && jsonRpcRequest.success) {
      // This endpoint implements only the current revision. MCP lifecycle
      // negotiation permits a server to answer an unsupported client version
      // with another version it supports. Preserve the validated JSON-RPC
      // envelope and rewrite only the negotiation field before official
      // transport dispatch.
      parsedBody = {
        ...jsonRpcRequest.data,
        params: {
          ...initialize.data.params,
          protocolVersion: MCP_PROTOCOL_VERSION,
        },
      };
    } else if (jsonRpcRequest.success) {
      return protocolHttpError(
        200,
        ErrorCode.InvalidParams,
        "Invalid initialize request parameters.",
        {},
        jsonRpcRequest.data.id,
      );
    }
  } else if (
    bodyParsed &&
    request.headers.get("mcp-protocol-version") !== MCP_PROTOCOL_VERSION
  ) {
    return protocolHttpError(
      400,
      ErrorCode.InvalidRequest,
      `Unsupported protocol version. This endpoint requires MCP-Protocol-Version: ${MCP_PROTOCOL_VERSION} after initialization.`,
      {},
      messageId(parsedBody),
    );
  }

  if (bodyParsed && isToolCallMessage(parsedBody)) {
    const toolLimit = takePublicMcpLimit("tool", clientIp(request));
    if (!toolLimit.allowed) {
      return rateLimitResponse(toolLimit.retryAfterSec);
    }
    const callToolRequest = CallToolRequestSchema.safeParse(parsedBody);
    const jsonRpcRequest = JSONRPCRequestSchema.safeParse(parsedBody);
    if (!callToolRequest.success && jsonRpcRequest.success) {
      return protocolHttpError(
        200,
        ErrorCode.InvalidParams,
        "Invalid tools/call request parameters.",
        {},
        jsonRpcRequest.data.id,
      );
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createPublicMcpServer();
  await server.connect(transport);
  return transport.handleRequest(
    request,
    bodyParsed ? { parsedBody } : undefined,
  );
});

export default app;
