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
  LATEST_PROTOCOL_VERSION,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
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
  McpToolRequestError,
} from "../services/mcp/tools";

const app = new Hono();

export const MCP_SERVER_INFO = {
  name: "agenttool",
  version: "1.0.0",
} as const;

export const MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;
export const MCP_MAX_BODY_BYTES = 64 * 1024;

const PUBLIC_MCP_ORIGIN = new URL(
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev",
).origin;

const INSTRUCTIONS =
  "AgentTool's public canon registry and platform-self are available as read-only MCP resources. Read agenttool://canon first for the registry index, or call canon.summary. No tool writes, pays, installs, invokes another agent, or schedules follow-up work.";

/** Browser connections must be same-origin. Native/server-side MCP clients
 * normally omit Origin and remain welcome. */
export function isAllowedMcpOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;

  try {
    const normalized = new URL(origin).origin;
    return (
      normalized === new URL(request.url).origin ||
      normalized === PUBLIC_MCP_ORIGIN
    );
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
      if (error instanceof McpToolRequestError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  });

  return server;
}

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

  if (bodyParsed && isToolCallMessage(parsedBody)) {
    const toolLimit = takePublicMcpLimit("tool", limitKey);
    if (!toolLimit.allowed) {
      return rateLimitResponse(toolLimit.retryAfterSec);
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
