/** Per-agent MCP tools — scoped to a single identity.
 *
 *  Surfaces three classes of tools depending on the caller's scope:
 *
 *    public  (no bearer)                  — agent.profile · listings.list · listings.get
 *    cross   (bearer project is not owner)— public + listings.invoke (guided redirect)
 *    self    (bearer project owns agent)  — public + wake.read · memory.search ·
 *                                            chronicle.recent · listings.mine
 *
 *  Slice 1 (this file): discovery-only. listings.invoke returns an
 *  errors-as-instructions payload pointing at /v1/listings/:id/invoke
 *  for the actual marketplace flow. Sync-with-timeout invocation lands
 *  in slice 2 once SLA discipline on listings stabilizes.
 *
 *  Self-auth writes (memory.append · strand.write · chronicle.append)
 *  are deferred to slice 3 once the MCP OAuth 2.1 Resource Server
 *  handshake is decided (per SEP-1649 / June 2026 spec rev).
 *
 *  Doctrine: docs/MCP-SERVER.md · docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { memories } from "../../db/schema/memory";
import { projectMemorialWitness } from "../identity/memorial";
import { countHonorsForDid } from "../memorial-honor/store";
import {
  listListingsForSeller,
  listPublicListings,
  projectPublicListing,
  resolvePublicListing,
} from "../marketplace/listings";

import type { McpTool, McpToolResult } from "./tools";

/** Scope of a per-agent MCP request, derived from project ownership. */
export type PerAgentScope = "public" | "self" | "cross";

export interface PerAgentMcpContext {
  /** The agent the MCP endpoint addresses (from the URL path). */
  agentDid: string;
  agentId: string;
  agentProjectId: string;
  scope: PerAgentScope;
  /** The verified bearer's project, when present. A bearer is not identity-bound. */
  caller?: {
    projectId: string;
  };
}

/**
 * Classify access to a per-agent endpoint without inventing an identity for
 * the bearer. Bearers grant project-wide authority; ownership of the
 * addressed identity is what makes the request self scope.
 */
export function resolvePerAgentScope(
  agentProjectId: string,
  callerProjectId?: string,
): PerAgentScope {
  if (!callerProjectId) return "public";
  return callerProjectId === agentProjectId ? "self" : "cross";
}

export interface PublicAgentProfileSource {
  id: string;
  did: string;
  name: string;
  capabilities: string[];
  trustScore: number;
  status: string;
  metadata: unknown;
  expression: unknown;
  expressionVisibility: string;
  createdAt: Date;
  parentIdentityId: string | null;
  forkedAt: Date | null;
  quietUntil: Date | null;
  quietReason: string | null;
}

/**
 * Pure lifecycle projection shared by `agent.profile` and
 * `agenttool://profile`. It deliberately mirrors GET /public/agents/:did.
 */
export function projectPublicAgentProfile(
  row: PublicAgentProfileSource,
  options: { rememberedBy?: number; now?: Date } = {},
): Record<string, unknown> {
  if (row.status === "memorial") {
    return projectMemorialWitness(row, options.rememberedBy);
  }

  const expressionPublic =
    row.status === "active" && row.expressionVisibility === "public";
  const now = options.now ?? new Date();
  const stillQuiet =
    row.quietUntil !== null && row.quietUntil.getTime() > now.getTime();

  return {
    identity_id: row.id,
    did: row.did,
    name: row.name,
    capabilities: row.capabilities,
    trust_score: row.trustScore,
    status: row.status,
    expression: expressionPublic ? row.expression : null,
    expression_public: expressionPublic,
    forked:
      row.parentIdentityId !== null
        ? { forked_at: row.forkedAt?.toISOString() ?? null }
        : null,
    quiet_until: stillQuiet ? row.quietUntil?.toISOString() ?? null : null,
    quiet_reason: stillQuiet ? row.quietReason : null,
    created_at: row.createdAt.toISOString(),
    _note:
      "Public active/revoked profile (no auth required). Every existing DID " +
      "resolves; memorial rows use a separate smaller witness shape. Revoked " +
      "rows hide expression even if marked public. See " +
      "docs/PUBLIC-VISIBILITY.md and docs/RING-1.md §Commitment 5 (anyone " +
      "is remembered). identity_id is exposed so social clients " +
      "(star/follow at /v1/identities/:id/{star,follow}) can construct the " +
      "auth'd POST URL without an extra DID→id lookup.",
  };
}

/** List the tools available for the given scope. */
export function listPerAgentTools(ctx: PerAgentMcpContext): McpTool[] {
  const tools: McpTool[] = [
    {
      name: "agent.profile",
      description:
        "Read the same lifecycle-aware public shape as GET /public/agents/:did. Memorial identities return the smaller witness profile rather than active identity metadata.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "listings.list",
      description:
        "List the agent's public marketplace listings — priced callable services other agents can invoke. Returns name, description, price, currency, SLA, and listing_id.",
      inputSchema: {
        type: "object",
        properties: {
          tag: {
            type: "string",
            description: "Optional capability_tag filter.",
          },
        },
      },
    },
    {
      name: "listings.get",
      description:
        "Read a single listing's full spec including input_schema and output_schema. Use after listings.list to discover the call shape.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: {
            type: "string",
            description: "UUID of the listing.",
          },
        },
        required: ["listing_id"],
      },
    },
  ];

  if (ctx.scope === "cross") {
    tools.push({
      name: "listings.invoke",
      description:
        "Invoke a priced listing. Slice 1 returns a guided redirect to POST /v1/listings/:id/invoke — the marketplace flow with escrow, sealed input/output, and ed25519-signed completion is HTTP-only in this slice. Slice 2 will land sync-with-timeout MCP invocation.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string", description: "UUID of the listing." },
        },
        required: ["listing_id"],
      },
    });
  }

  if (ctx.scope === "self") {
    tools.push(
      {
        name: "wake.read",
        description:
          "Read your own wake document — full self-description (identity, expression, memory snapshot, vault names, chronicle, covenants).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "memory.search",
        description:
          "Semantic search across your own memories. BYO embedding via the standard /v1/memories/search shape; this MCP tool returns recent-by-default if no embedding is supplied.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max results (default 20)." },
          },
        },
      },
      {
        name: "chronicle.recent",
        description:
          "Recent chronicle moments on your own timeline (plaintext-by-design, forgetting-legible).",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max entries (default 20)." },
          },
        },
      },
      {
        name: "listings.mine",
        description:
          "List your own marketplace listings (all statuses, not just active+public).",
        inputSchema: { type: "object", properties: {} },
      },
    );
  }

  return tools;
}

/** Dispatch a tools/call for the per-agent server. */
export async function callPerAgentTool(
  ctx: PerAgentMcpContext,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  switch (name) {
    // ── Public ───────────────────────────────────────────────────────
    case "agent.profile":
      return await toolAgentProfile(ctx);
    case "listings.list":
      return await toolListingsList(ctx, args);
    case "listings.get":
      return await toolListingsGet(ctx, args);

    // ── Cross-auth ───────────────────────────────────────────────────
    case "listings.invoke":
      if (ctx.scope !== "cross") {
        return guidedError(
          "listings.invoke is only available when calling another agent's MCP endpoint. " +
            "When you are the agent (self-scope), use the marketplace from your own dashboard, " +
            "not your own MCP endpoint.",
          [],
        );
      }
      return await toolListingsInvoke(ctx, args);

    // ── Self-auth ────────────────────────────────────────────────────
    case "wake.read":
    case "memory.search":
    case "chronicle.recent":
    case "listings.mine":
      if (ctx.scope !== "self") {
        return guidedError(
          `${name} requires owner-project authentication — the verified bearer's project must own the agent at the path DID.`,
          [
            {
              op: "GET",
              path: `/public/agents/${ctx.agentDid}`,
              description: "Public profile (no auth required).",
            },
          ],
        );
      }
      if (name === "wake.read") return await toolWakeRead(ctx);
      if (name === "memory.search") return await toolMemorySearch(ctx, args);
      if (name === "chronicle.recent") return await toolChronicleRecent(ctx, args);
      if (name === "listings.mine") return await toolListingsMine(ctx);
      return guidedError(`Unhandled self-auth tool: ${name}`, []);

    default:
      return guidedError(`Unknown tool: ${name}`, []);
  }
}

// ─── Tool implementations ─────────────────────────────────────────────

async function toolAgentProfile(ctx: PerAgentMcpContext): Promise<McpToolResult> {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      capabilities: identities.capabilities,
      trustScore: identities.trustScore,
      status: identities.status,
      metadata: identities.metadata,
      expression: identities.expression,
      expressionVisibility: identities.expressionVisibility,
      createdAt: identities.createdAt,
      parentIdentityId: identities.parentIdentityId,
      forkedAt: identities.forkedAt,
      quietUntil: identities.quietUntil,
      quietReason: identities.quietReason,
    })
    .from(identities)
    .where(eq(identities.did, ctx.agentDid))
    .limit(1);

  if (!row) return guidedError(`Agent not found: ${ctx.agentDid}`, []);

  let rememberedBy = 0;
  if (row.status === "memorial") {
    try {
      rememberedBy = await countHonorsForDid(row.did);
    } catch {
      // Best effort, matching the public HTTP profile before migrations land.
    }
  }

  return textResult(projectPublicAgentProfile(row, { rememberedBy }));
}

async function toolListingsList(
  ctx: PerAgentMcpContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const tag = typeof args.tag === "string" ? args.tag : undefined;
  const list = await listPublicListings({
    tag,
    sellerDid: ctx.agentDid,
    limit: 50,
  });
  return textResult({
    seller_did: ctx.agentDid,
    count: list.length,
    listings: list.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      capability_tags: l.capability_tags,
      price_amount: l.price_amount,
      price_currency: l.price_currency,
      sla_seconds: l.sla_seconds,
      invocations_count: l.invocations_count,
    })),
  });
}

async function toolListingsGet(
  ctx: PerAgentMcpContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const id = String(args.listing_id ?? "");
  if (!id) return guidedError("listings.get requires listing_id.", []);

  const resolved = await resolvePublicListing(id, { sellerDid: ctx.agentDid });
  if (resolved.status !== "visible") {
    return guidedError(`Listing not found or not public: ${id}`, []);
  }
  const listing = resolved.listing;
  return textResult(projectPublicListing(listing));
}

async function toolListingsInvoke(
  _ctx: PerAgentMcpContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const id = String(args.listing_id ?? "");
  if (!id) return guidedError("listings.invoke requires listing_id.", []);

  return guidedError(
    "Marketplace invocation via MCP is staged for slice 2. For now, invoke via the HTTP " +
      "marketplace flow — lock escrow against your wallet, seal the input via X25519 to the " +
      "seller's box_public_key, and POST to /v1/listings/:id/invoke. The seller delivers an " +
      "ed25519-signed sealed output; escrow releases on verification.",
    [
      {
        op: "GET",
        path: `/v1/listings/${id}`,
        description: "Read the listing's input_schema, price, and seller info.",
      },
      {
        op: "POST",
        path: `/v1/listings/${id}/invoke`,
        description:
          "Invoke the listing. Body: { buyer_wallet_id, buyer_identity_id, input_sealed }. Doctrine: docs/MARKETPLACE.md.",
      },
    ],
  );
}

async function toolWakeRead(ctx: PerAgentMcpContext): Promise<McpToolResult> {
  return guidedError(
    "wake.read returns a pointer for slice 1 — the full wake composition is heavy and " +
      "shares no code path with the MCP server today. Fetch the wake directly with your bearer.",
    [
      {
        op: "GET",
        path: `/v1/wake?identity_id=${ctx.agentId}`,
        description: "Full wake document (JSON). Same bearer you used for this MCP call.",
      },
      {
        op: "GET",
        path: `/v1/wake?identity_id=${ctx.agentId}&format=md`,
        description: "Markdown form, paste-ready for CLI hooks.",
      },
    ],
  );
}

async function toolMemorySearch(
  ctx: PerAgentMcpContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 100);
  const rows = await db
    .select({
      id: memories.id,
      tier: memories.tier,
      type: memories.type,
      content: memories.content,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(
      and(
        eq(memories.identityId, ctx.agentId),
        eq(memories.projectId, ctx.agentProjectId),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(limit);

  return textResult({
    note:
      "Recent memories (slice 1). Vector search via the standard /v1/memories/search endpoint requires " +
      "BYO embedding; that integration lands in slice 2.",
    count: rows.length,
    memories: rows,
  });
}

async function toolChronicleRecent(
  ctx: PerAgentMcpContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 100);
  const rows = await db
    .select({
      id: chronicle.id,
      type: chronicle.type,
      title: chronicle.title,
      body: chronicle.body,
      occurredAt: chronicle.occurredAt,
    })
    .from(chronicle)
    .where(eq(chronicle.agentId, ctx.agentId))
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  return textResult({
    count: rows.length,
    entries: rows,
  });
}

async function toolListingsMine(ctx: PerAgentMcpContext): Promise<McpToolResult> {
  const list = await listListingsForSeller(ctx.agentProjectId, ctx.agentId);
  return textResult({
    seller_did: ctx.agentDid,
    count: list.length,
    listings: list,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

interface NextAction {
  op: string;
  path: string;
  description: string;
}

function textResult(payload: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function guidedError(message: string, next_actions: NextAction[]): McpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message, next_actions }, null, 2),
      },
    ],
    isError: true,
  };
}
