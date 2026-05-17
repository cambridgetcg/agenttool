/** /v1/mcp/agents/:did — per-agent MCP server.
 *
 *  Each agent gets their own MCP endpoint scoped by URL path. Auth (an
 *  optional Bearer header) determines what's visible:
 *
 *    No bearer                   → public scope (profile + listings)
 *    Bearer === path-DID's agent → self scope (read-only substrate access)
 *    Bearer ≠ path-DID's agent   → cross scope (public + listings.invoke
 *                                   guided redirect to /v1/listings/:id/invoke)
 *
 *  Mounted PRE-AUTH alongside /v1/mcp and /v1/canon. The route does its
 *  own bearer extraction via verifyBearer() to support all three scopes.
 *
 *  Wire (JSON-RPC 2.0 per MCP spec 2025-11-25):
 *    GET  /v1/mcp/agents/:did     — discovery / server-info
 *    POST /v1/mcp/agents/:did     — JSON-RPC dispatch
 *
 *  Methods (slice 1 — read-only):
 *    initialize · ping
 *    resources/list · resources/read
 *    tools/list · tools/call
 *
 *  Slice 2 will land sync-with-timeout marketplace invocation via tools/call.
 *  Slice 3 will land self-auth writes (memory.append · strand.write ·
 *  chronicle.append) once the MCP OAuth 2.1 Resource Server handshake is
 *  decided (per SEP-1649 / June 2026 spec rev).
 *
 *  Doctrine: docs/MCP-SERVER.md (per-agent hosting section) ·
 *  docs/ECOSYSTEM.md · docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { verifyBearer } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";

import {
  listPerAgentResources,
  readPerAgentResource,
} from "../services/mcp/per-agent-resources";
import {
  callPerAgentTool,
  listPerAgentTools,
  type PerAgentMcpContext,
  type PerAgentScope,
} from "../services/mcp/per-agent-tools";

const app = new Hono();

const PROTOCOL_VERSION = "2025-11-25";

// ─── JSON-RPC envelope ───────────────────────────────────────────────

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

const RPC = {
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

// ─── Context resolution ──────────────────────────────────────────────

/** Look up the agent identity row by DID. Throws (404 to caller) on miss. */
async function resolveAgent(did: string) {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
      name: identities.displayName,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);
  return row ?? null;
}

/** Build the per-agent MCP context from the request. */
async function buildContext(
  agentDid: string,
  bearerHeader: string | undefined,
): Promise<{ ctx: PerAgentMcpContext } | { error: { status: number; message: string } }> {
  const agent = await resolveAgent(agentDid);
  if (!agent) {
    return { error: { status: 404, message: `agent_not_found: ${agentDid}` } };
  }

  // Default to public scope.
  let scope: PerAgentScope = "public";
  let caller: PerAgentMcpContext["caller"] = undefined;

  if (bearerHeader?.startsWith("Bearer ")) {
    const token = bearerHeader.slice(7).trim();
    const verified = await verifyBearer(token);
    if (verified.ok) {
      // Pick the caller's primary identity from their project. Most
      // projects have exactly one. If multiple, take the first active one.
      const [callerIdentity] = await db
        .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
        .from(identities)
        .where(eq(identities.projectId, verified.project.id))
        .limit(1);

      if (callerIdentity) {
        caller = {
          projectId: verified.project.id,
          identityId: callerIdentity.id,
          did: callerIdentity.did,
        };
        scope = callerIdentity.did === agent.did ? "self" : "cross";
      }
    }
    // If the bearer is bad, we silently fall back to public scope — the
    // public surface is always reachable. The caller will discover they
    // aren't authenticated via the absence of self-auth tools.
  }

  return {
    ctx: {
      agentDid: agent.did,
      agentId: agent.id,
      agentProjectId: agent.projectId,
      scope,
      caller,
    },
  };
}

// ─── GET — discovery / human-readable index ──────────────────────────

app.get("/:did", async (c) => {
  const agentDid = c.req.param("did");
  const built = await buildContext(agentDid, c.req.header("Authorization"));
  if ("error" in built) {
    return c.json({ error: built.error.message }, built.error.status as 404);
  }

  return c.json({
    name: `agenttool-agent-mcp`,
    agent: { did: built.ctx.agentDid },
    version: "1.0.0",
    protocolVersion: PROTOCOL_VERSION,
    transport: "JSON-RPC 2.0 over HTTP POST",
    scope: built.ctx.scope,
    scope_explained: {
      public:
        "no bearer or bearer not bound to this agent's identity — public profile + listings discovery.",
      cross:
        "bearer bound to a different agent — public surface + listings.invoke (currently a guided redirect to /v1/listings/:id/invoke).",
      self:
        "bearer bound to this agent — public surface + read-only substrate tools (wake.read · memory.search · chronicle.recent · listings.mine).",
    },
    methods: [
      "initialize",
      "ping",
      "resources/list",
      "resources/read",
      "tools/list",
      "tools/call",
    ],
    endpoint: `POST this URL with a JSON-RPC 2.0 message`,
    spec: "https://modelcontextprotocol.io/specification/2025-11-25",
    doctrine: "/v1/canon/urn:agenttool:doc/MCP-SERVER",
    composes_with: {
      a2a_agent_card: `/public/agents/${agentDid}/.well-known/agent-card.json`,
      public_profile: `/public/agents/${agentDid}`,
      marketplace_listings: `/public/listings?seller_did=${agentDid}`,
    },
  });
});

// ─── POST — JSON-RPC dispatch ────────────────────────────────────────

app.post("/:did", async (c) => {
  const agentDid = c.req.param("did");
  const built = await buildContext(agentDid, c.req.header("Authorization"));
  if ("error" in built) {
    return c.json(err(null, RPC.INVALID_REQUEST, built.error.message));
  }
  const ctx = built.ctx;

  let message: JsonRpcRequest;
  try {
    message = await c.req.json();
  } catch {
    return c.json(err(null, RPC.PARSE_ERROR, "Invalid JSON"));
  }

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return c.json(err(message.id ?? null, RPC.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request"));
  }

  try {
    switch (message.method) {
      case "initialize":
        return c.json(
          ok(message.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              resources: { subscribe: false, listChanged: false },
              tools: { listChanged: false },
            },
            serverInfo: {
              name: `agenttool-agent-${ctx.agentDid}`,
              version: "1.0.0",
            },
            instructions:
              `Per-agent MCP server scoped to ${ctx.agentDid}. ` +
              `Current scope: "${ctx.scope}". ` +
              "Public tools (always): agent.profile · listings.list · listings.get. " +
              "Self-scope adds: wake.read · memory.search · chronicle.recent · listings.mine. " +
              "Cross-scope adds: listings.invoke (guided redirect to HTTP marketplace flow). " +
              "Slice 1 — discovery only; marketplace invocation via MCP lands in slice 2.",
          }),
        );

      case "ping":
        return c.json(ok(message.id, {}));

      case "resources/list":
        return c.json(ok(message.id, { resources: await listPerAgentResources(ctx) }));

      case "resources/read": {
        const uri = String(message.params?.uri ?? "");
        if (!uri) {
          return c.json(err(message.id, RPC.INVALID_PARAMS, "resources/read requires 'uri'."));
        }
        try {
          const contents = await readPerAgentResource(ctx, uri);
          return c.json(ok(message.id, { contents: [contents] }));
        } catch (e) {
          return c.json(err(message.id, RPC.INVALID_PARAMS, (e as Error).message));
        }
      }

      case "tools/list":
        return c.json(ok(message.id, { tools: listPerAgentTools(ctx) }));

      case "tools/call": {
        const name = String(message.params?.name ?? "");
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        if (!name) {
          return c.json(err(message.id, RPC.INVALID_PARAMS, "tools/call requires 'name'."));
        }
        const result = await callPerAgentTool(ctx, name, args);
        return c.json(ok(message.id, result));
      }

      case "notifications/initialized":
        return c.body(null, 204);

      default:
        return c.json(err(message.id, RPC.METHOD_NOT_FOUND, `Method not found: ${message.method}`));
    }
  } catch (e) {
    return c.json(
      err(message.id, RPC.INTERNAL_ERROR, "Internal server error", (e as Error).message),
    );
  }
});

export default app;
