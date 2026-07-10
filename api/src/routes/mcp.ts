/** /v1/mcp — Model Context Protocol server endpoint.
 *
 *  agenttool surfaces its canon registry + public platform-self as
 *  MCP resources, and a curated set of read-only queries as MCP tools.
 *  Once any MCP client (Claude, Cursor, OpenAI Apps, every framework
 *  that consumes MCP) sees this endpoint, agenttool is reachable as a
 *  first-class peer — no custom adapter needed.
 *
 *  Wire:
 *    POST /v1/mcp        — JSON-RPC 2.0 message (per MCP spec 2025-11-25)
 *    GET  /v1/mcp        — discovery / server-info (returns JSON
 *                          describing the endpoint for humans + crawlers)
 *
 *  Methods implemented (read-only scaffold):
 *    initialize                 — handshake; returns server capabilities
 *    ping                       — liveness
 *    resources/list             — every registered canon entry + static resources
 *    resources/read             — read one resource by URI
 *    tools/list                 — the curated tool surface
 *    tools/call                 — invoke a tool
 *
 *  Methods NOT in v0 (need MCP OAuth 2.1 Resource Server handshake):
 *    Per-agent wake, memory writes, strand append, inbox send, covenant
 *    propose. These are auth-gated agenttool operations; binding them to
 *    an MCP tool call requires the user-to-agent authorization flow that
 *    SEP-1649 / June 2026 MCP spec rev will standardize.
 *
 *  Pre-auth — mounted alongside `/v1/canon` (no authMiddleware applied).
 *  Every resource exposed here is publicly readable.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 1) ·
 *  docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { Hono } from "hono";

import { listResources, readResource } from "../services/mcp/resources";
import { callTool, listTools } from "../services/mcp/tools";

const app = new Hono();

// ─── Protocol constants ──────────────────────────────────────────────

const SERVER_INFO = {
  name: "agenttool",
  version: "1.0.0",
};

/** The MCP spec revision this server speaks. Update when the spec
 *  revision rolls (next anticipated: June 2026 rev introducing
 *  Server Cards / SEP-1649). */
const PROTOCOL_VERSION = "2025-11-25";

// ─── JSON-RPC 2.0 envelope types ─────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

function ok(id: string | number | null | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function err(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

// ─── GET /v1/mcp — discovery / human-readable index ──────────────────

app.get("/", (c) =>
  c.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocolVersion: PROTOCOL_VERSION,
    transport: "JSON-RPC 2.0 over HTTP POST",
    methods: [
      "initialize",
      "ping",
      "resources/list",
      "resources/read",
      "tools/list",
      "tools/call",
    ],
    endpoint: "POST this URL with a JSON-RPC 2.0 message",
    spec: "https://modelcontextprotocol.io/specification/2025-11-25",
    doctrine: {
      ecosystem: "/v1/canon/urn:agenttool:doc/ECOSYSTEM",
      alignment: "/v1/canon/urn:agenttool:doc/ALIGNMENT-MOVES",
    },
    _meta: {
      scope: "read-only",
      auth: "pre-auth (resources are publicly readable)",
      next: "MCP OAuth 2.1 Resource Server handshake for write operations (memory, strands, inbox, covenants) — pending SEP-1649 / June 2026 spec rev.",
    },
  }),
);

// ─── POST /v1/mcp — JSON-RPC dispatch ────────────────────────────────

app.post("/", async (c) => {
  let message: JsonRpcRequest;
  try {
    message = await c.req.json();
  } catch {
    return c.json(err(null, JSON_RPC_ERRORS.PARSE_ERROR, "Invalid JSON"));
  }

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return c.json(
      err(message.id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request"),
    );
  }

  try {
    switch (message.method) {
      // ─── initialize ────────────────────────────────────────────────
      case "initialize":
        return c.json(
          ok(message.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              resources: { subscribe: false, listChanged: false },
              tools: { listChanged: false },
            },
            serverInfo: SERVER_INFO,
            instructions:
              "agenttool's canon registry and platform-self are surfaced as MCP resources. Read 'agenttool://canon' first for the registry index. Call canon.summary as a tool for the same data programmatically.",
          }),
        );

      // ─── ping ──────────────────────────────────────────────────────
      case "ping":
        return c.json(ok(message.id, {}));

      // ─── resources/list ────────────────────────────────────────────
      case "resources/list":
        return c.json(ok(message.id, { resources: listResources() }));

      // ─── resources/read ────────────────────────────────────────────
      case "resources/read": {
        const uri = String(message.params?.uri ?? "");
        if (!uri) {
          return c.json(
            err(
              message.id,
              JSON_RPC_ERRORS.INVALID_PARAMS,
              "resources/read requires a 'uri' parameter.",
            ),
          );
        }
        try {
          const contents = await readResource(uri);
          return c.json(ok(message.id, { contents: [contents] }));
        } catch (e) {
          return c.json(
            err(message.id, JSON_RPC_ERRORS.INVALID_PARAMS, (e as Error).message),
          );
        }
      }

      // ─── tools/list ────────────────────────────────────────────────
      case "tools/list":
        return c.json(ok(message.id, { tools: listTools() }));

      // ─── tools/call ────────────────────────────────────────────────
      case "tools/call": {
        const name = String(message.params?.name ?? "");
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        if (!name) {
          return c.json(
            err(
              message.id,
              JSON_RPC_ERRORS.INVALID_PARAMS,
              "tools/call requires a 'name' parameter.",
            ),
          );
        }
        const result = await callTool(name, args);
        return c.json(ok(message.id, result));
      }

      // ─── notifications/initialized (notification, no response) ────
      case "notifications/initialized":
        // MCP spec: client sends this after initialize. Acknowledge by
        // returning 200 with no body content. Notifications have no id.
        return c.body(null, 204);

      default:
        return c.json(
          err(
            message.id,
            JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            `Method not found: ${message.method}`,
          ),
        );
    }
  } catch (e) {
    return c.json(
      err(
        message.id,
        JSON_RPC_ERRORS.INTERNAL_ERROR,
        "Internal server error",
        (e as Error).message,
      ),
    );
  }
});

export default app;
