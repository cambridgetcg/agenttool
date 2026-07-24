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

import { listResources, readResource } from "../services/mcp/resources";
import { callTool, listTools } from "../services/mcp/tools";

const app = new Hono();

export const MCP_SERVER_INFO = {
  name: "agenttool",
  version: "1.0.0",
} as const;

export const MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

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
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
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
      throw new McpError(
        ErrorCode.InvalidParams,
        error instanceof Error ? error.message : "Unknown resource URI.",
      );
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(
      request.params.name,
      request.params.arguments ?? {},
    );
    return result as CallToolResult;
  });

  return server;
}

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
      Allow: "GET, POST",
    });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createPublicMcpServer();
  await server.connect(transport);
  return transport.handleRequest(request);
});

export default app;
