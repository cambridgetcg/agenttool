/** /v1/mcp/agents/:did — per-agent MCP-shaped partial JSON-RPC scaffold.
 *
 *  Each agent gets a JSON-RPC route scoped by URL path. Auth (an optional
 *  Bearer header) determines what's visible:
 *
 *    No bearer                         → public scope (profile + listings)
 *    Bearer's project owns path agent  → self scope (read-only substrate access)
 *    Bearer's project does not own it  → cross scope (public + listings.invoke
 *                                         guided redirect to HTTP)
 *
 *  Mounted PRE-AUTH alongside /v1/mcp and /v1/canon. The route does its
 *  own bearer extraction via verifyBearer() to support all three scopes.
 *
 *  The method envelope targets MCP 2025-11-25. The HTTP transport is not yet
 *  conformant Streamable HTTP; discovery metadata names the open gaps.
 *
 *  Wire:
 *    GET  /v1/mcp/agents/:did     — discovery / server-info
 *    POST /v1/mcp/agents/:did     — partial MCP-shaped JSON-RPC dispatch
 *
 *  Methods (slice 1 — read-only):
 *    initialize · ping
 *    resources/list · resources/read
 *    tools/list · tools/call
 *
 *  Slice 2 will land sync-with-timeout marketplace invocation via tools/call.
 *  Slice 3 will land self-auth writes (memory.append · strand.write ·
 *  chronicle.append) once the stable MCP authorization profile is implemented:
 *  protected-resource metadata, resource-bound tokens, audience validation,
 *  no token pass-through, and a local approval boundary.
 *
 *  Doctrine: docs/MCP-SERVER.md (per-agent hosting section) ·
 *  docs/ECOSYSTEM.md · docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { verifyBearer } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { publicAgentPath } from "../services/identity/public-profile";

import {
  PER_AGENT_MCP_IMPLEMENTATION_LABEL,
  PER_AGENT_MCP_TARGET_PROTOCOL_VERSION,
  perAgentMcpImplementationBoundary,
} from "../services/mcp/per-agent-implementation-status";
import {
  listPerAgentResources,
  readPerAgentResource,
} from "../services/mcp/per-agent-resources";
import {
  callPerAgentTool,
  listPerAgentTools,
  resolvePerAgentScope,
  type PerAgentMcpContext,
} from "../services/mcp/per-agent-tools";

const app = new Hono();

const PROTOCOL_VERSION = PER_AGENT_MCP_TARGET_PROTOCOL_VERSION;

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

  let caller: PerAgentMcpContext["caller"];
  if (bearerHeader !== undefined) {
    if (!bearerHeader.startsWith("Bearer ")) {
      return {
        error: {
          status: 401,
          message: "invalid_authorization: expected Bearer <api_key>",
        },
      };
    }

    const verified = await verifyBearer(bearerHeader.slice(7).trim());
    if (!verified.ok) {
      return {
        error: {
          status: 401,
          message: `invalid_bearer: ${verified.reason}`,
        },
      };
    }
    caller = { projectId: verified.project.id };
  }

  const scope = resolvePerAgentScope(agent.projectId, caller?.projectId);

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
    return c.json(
      { error: built.error.message },
      built.error.status === 404 ? 404 : 401,
    );
  }

  return c.json({
    name: `agenttool-agent-mcp`,
    agent: { did: built.ctx.agentDid },
    version: "1.0.0",
    protocolVersion: PROTOCOL_VERSION,
    protocolVersionStatus: "target; full transport conformance is not claimed",
    transport:
      "JSON-RPC 2.0 over HTTP POST (partial MCP-shaped scaffold; not conformant MCP Streamable HTTP)",
    implementation: perAgentMcpImplementationBoundary(),
    scope: built.ctx.scope,
    scope_explained: {
      public:
        "no bearer — public profile + listings discovery.",
      cross:
        "verified project bearer whose project does not own this agent — public surface + listings.invoke (currently a guided redirect to /v1/listings/:id/invoke).",
      self:
        "verified project bearer whose project owns this agent — public surface + read-only substrate tools (wake.read · memory.search · chronicle.recent · listings.mine).",
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
      public_profile: publicAgentPath(agentDid),
      marketplace_listings: `/public/listings?seller_did=${agentDid}`,
    },
  });
});

// ─── POST — JSON-RPC dispatch ────────────────────────────────────────

app.post("/:did", async (c) => {
  const agentDid = c.req.param("did");
  const built = await buildContext(agentDid, c.req.header("Authorization"));
  if ("error" in built) {
    return c.json(
      err(null, RPC.INVALID_REQUEST, built.error.message),
      built.error.status === 404 ? 404 : 401,
    );
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
              `Per-agent ${PER_AGENT_MCP_IMPLEMENTATION_LABEL} scoped to ${ctx.agentDid}. ` +
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
