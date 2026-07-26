/** Public, read-only Model Context Protocol endpoints.
 *
 *  One fresh official SDK server + Web Standard Streamable HTTP transport is
 *  created for every POST. The transport is stateless and returns one JSON
 *  response, so it keeps no client session, opens no server-initiated stream,
 *  and performs no automatic action.
 *
 *  Wire:
 *    POST /v1/mcp — MCP Streamable HTTP; Accept must list application/json
 *                   and text/event-stream.
 *    POST /v1/mcp/canon — separate two-tool search/fetch surface.
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
  listKnowledgeResources,
  listResources,
  McpResourceNotFoundError,
  readKnowledgeResource,
  readResource,
} from "../services/mcp/resources";
import {
  callKnowledgeTool,
  callLegacyTool,
  listKnowledgeTools,
  listTools,
  McpUnknownToolError,
} from "../services/mcp/tools";

const app = new Hono();

export const MCP_SERVER_INFO = {
  name: "agenttool",
  version: "1.0.0",
} as const;

export const KNOWLEDGE_MCP_SERVER_INFO = {
  name: "agenttool-canon",
  version: "1.0.0",
} as const;

export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_MAX_BODY_BYTES = 64 * 1024;

const INSTRUCTIONS =
  "AgentTool offers agenttool://discovery as a read-only compass with three optional roads: understand, inspect, or choose. Stopping, silence, and leaving are complete. agenttool://canon and canon.summary offer optional depth. Reading grants no authority and starts no follow-up. No tool writes, pays, installs, invokes another agent, or schedules follow-up work.";

const KNOWLEDGE_INSTRUCTIONS =
  "Search and fetch AgentTool's bundled public canon, or read one of two orientation resources. agenttool://open-seat is a finite invitation to understand or play. Stopping, silence, and leaving are complete. Reading grants no authority and starts no follow-up. This endpoint cannot write, pay, install, invoke another agent, browse the web, or schedule work.";

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

function endpointLimitKey(
  request: Request,
  endpointPath: "/" | "/canon",
): string {
  const key = clientIp(request);
  return endpointPath === "/" ? key : `knowledge:${key}`;
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

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: listResources() };
  });

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
      const result = await callLegacyTool(
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

/** Create the deliberately small search/fetch endpoint for provider
 * directories and direct, explicitly chosen knowledge connections. */
export function createKnowledgeMcpServer(): Server {
  const server = new Server(KNOWLEDGE_MCP_SERVER_INFO, {
    capabilities: {
      resources: { subscribe: false, listChanged: false },
      tools: { listChanged: false },
    },
    instructions: KNOWLEDGE_INSTRUCTIONS,
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listKnowledgeResources(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      return {
        contents: [await readKnowledgeResource(request.params.uri)],
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
    tools: listKnowledgeTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callKnowledgeTool(
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

for (const endpointPath of ["/", "/canon"] as const) {
  // Reject disallowed origins and methods, then spend one request-quota unit,
  // before reading any request body.
  app.all(endpointPath, async (c, next) => {
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

    const limitKey = endpointLimitKey(request, endpointPath);
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
    endpointPath,
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

  app.all(endpointPath, async (c) => {
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

    if (isInitializeAttempt(parsedBody) && !jsonRpcRequest.success) {
      // Initialization is a request/response exchange, never a notification.
      // A notification cannot receive a JSON-RPC error response, so reject the
      // HTTP input without manufacturing one.
      return new Response(null, { status: 400 });
    }

    if (jsonRpcRequest.success && isInitializeAttempt(parsedBody)) {
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
    } else if (
      request.headers.get("mcp-protocol-version") !== MCP_PROTOCOL_VERSION
    ) {
      return protocolHttpError(
        400,
        ErrorCode.InvalidRequest,
        `Unsupported protocol version. This endpoint requires MCP-Protocol-Version: ${MCP_PROTOCOL_VERSION} after initialization.`,
      );
    }

    if (isToolCallMessage(parsedBody)) {
      const toolLimit = takePublicMcpLimit(
        "tool",
        endpointLimitKey(request, endpointPath),
      );
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
    const server =
      endpointPath === "/canon"
        ? createKnowledgeMcpServer()
        : createPublicMcpServer();
    await server.connect(transport);
    return transport.handleRequest(withCanonicalMcpMediaHeaders(request), {
      parsedBody,
    });
  });
}

export default app;
