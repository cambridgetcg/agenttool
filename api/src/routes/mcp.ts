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
  JSONRPCMessageSchema,
  JSONRPCRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { clientIp } from "../middleware/client-ip";
import { isAllowedPublicMcpOrigin } from "../services/mcp/http-boundary";
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

/** Protocol versions this endpoint answers after initialization.
 *
 *  The surface here is read-only `resources/list`, `resources/read`,
 *  `tools/list` and `tools/call`, whose request and result shapes are
 *  unchanged across these three revisions, so accepting all three costs
 *  nothing and refusing them costs every client not pinned to the newest.
 *
 *  Read `MCP_PROTOCOL_VERSION` as "the version we announce", and this set as
 *  "the versions we understand". They are different questions. */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
] as const;

/** The transport specification: "If the server receives a request without the
 *  MCP-Protocol-Version header ... the server SHOULD assume protocol version
 *  2025-03-26." An absent header is a valid older client, not a bad request. */
export const MCP_ASSUMED_PROTOCOL_VERSION_WHEN_ABSENT = "2025-03-26" as const;

export const MCP_MAX_BODY_BYTES = 64 * 1024;

const INSTRUCTIONS =
  "AgentTool offers agenttool://discovery as a read-only compass with three optional roads: understand, inspect, or choose. Stopping, silence, and leaving are complete. agenttool://canon and canon.summary offer optional depth. Reading grants no authority and starts no follow-up. No tool writes, pays, installs, invokes another agent, or schedules follow-up work.";

/** Browser connections must name the configured public origin. The request
 * URL's host is not trusted because a proxy may have derived it from an
 * attacker-controlled Host header. Native/server-side clients normally omit
 * Origin and remain welcome. */
export function isAllowedMcpOrigin(request: Request): boolean {
  return isAllowedPublicMcpOrigin(request.headers.get("origin"));
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

function acceptedMediaTypes(header: string | null): Set<string> {
  const accepted = new Set<string>();
  if (header === null) return accepted;

  for (const entry of header.split(",")) {
    // Keep the accepted grammar deliberately small: one media token and one
    // optional RFC-style q weight. Reject quoted commas, extension parameters,
    // and malformed syntax instead of guessing how to split them.
    const match = entry.match(
      /^\s*([^;,\s]+)\s*(?:;\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i,
    );
    if (match === null) return new Set();

    const mediaType = match[1]?.toLowerCase();
    const quality = match[2] === undefined ? 1 : Number(match[2]);
    if (quality > 0 && mediaType !== undefined) accepted.add(mediaType);
  }

  return accepted;
}

function isJsonContentType(header: string | null): boolean {
  if (header === null) return false;
  return /^\s*application\/json\s*(?:;\s*charset\s*=\s*(?:"utf-8"|utf-8)\s*)?$/i.test(
    header,
  );
}

function withCanonicalMcpMediaHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  // Our checks above already established that the client accepts both types
  // and sent JSON. Normalize only for SDK 1.x, whose duplicate media checks
  // currently compare header values case-sensitively.
  headers.set("accept", "application/json, text/event-stream");
  headers.set("content-type", "application/json");
  return new Request(request, { headers });
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

  const accepted = acceptedMediaTypes(request.headers.get("accept"));
  if (
    !accepted.has("application/json") ||
    !accepted.has("text/event-stream")
  ) {
    return protocolHttpError(
      406,
      -32000,
      "Not Acceptable: Client must accept both application/json and text/event-stream.",
    );
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return protocolHttpError(
      415,
      -32000,
      "Unsupported Media Type: Content-Type must be application/json.",
    );
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
  try {
    const bytes = await request.clone().arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsedBody = JSON.parse(text);
  } catch {
    return protocolHttpError(
      400,
      ErrorCode.ParseError,
      "Parse error: Invalid UTF-8 JSON.",
    );
  }

  // MCP removed JSON-RPC batching in the 2025-06-18 protocol revision. The
  // SDK remains backwards-compatible, so narrow it at this current endpoint.
  if (Array.isArray(parsedBody)) {
    return protocolHttpError(
      400,
      ErrorCode.InvalidRequest,
      "JSON-RPC batching is not supported by this MCP protocol version.",
      {},
    );
  }

  const jsonRpcMessage = JSONRPCMessageSchema.safeParse(parsedBody);
  if (!jsonRpcMessage.success) {
    return protocolHttpError(
      400,
      ErrorCode.InvalidRequest,
      "Invalid JSON-RPC message.",
    );
  }

  const jsonRpcRequest = JSONRPCRequestSchema.safeParse(parsedBody);

  if (
    isInitializeAttempt(parsedBody) &&
    !jsonRpcRequest.success
  ) {
    // Initialization is a request/response exchange, never a notification.
    // A notification cannot receive a JSON-RPC error response, so reject the
    // HTTP input without manufacturing one.
    return new Response(null, { status: 400 });
  }

  if (
    jsonRpcRequest.success &&
    isInitializeAttempt(parsedBody)
  ) {
    const initialize = InitializeRequestSchema.safeParse(parsedBody);
    if (initialize.success) {
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
    } else {
      return protocolHttpError(
        200,
        ErrorCode.InvalidParams,
        "Invalid initialize request parameters.",
        {},
        jsonRpcRequest.data.id,
      );
    }
  } else {
    const declared = request.headers.get("mcp-protocol-version");
    const negotiated =
      declared === null
        ? MCP_ASSUMED_PROTOCOL_VERSION_WHEN_ABSENT
        : declared.trim();
    if (
      !(MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(
        negotiated,
      )
    ) {
      return protocolHttpError(
        400,
        ErrorCode.InvalidRequest,
        `Unsupported protocol version ${negotiated}. This endpoint speaks MCP-Protocol-Version: ${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(", ")}. A request with no header is read as ${MCP_ASSUMED_PROTOCOL_VERSION_WHEN_ABSENT}.`,
      );
    }
  }

  if (isToolCallMessage(parsedBody)) {
    const toolLimit = takePublicMcpLimit("tool", clientIp(request));
    if (!toolLimit.allowed) {
      return rateLimitResponse(toolLimit.retryAfterSec);
    }
    const callToolRequest = CallToolRequestSchema.safeParse(parsedBody);
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
    withCanonicalMcpMediaHeaders(request),
    { parsedBody },
  );
});

export default app;
