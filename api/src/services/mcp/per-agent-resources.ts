/** Per-agent MCP resources — scoped to a single identity.
 *
 *  Resource URI scheme (the DID is implicit in the per-agent endpoint URL):
 *
 *    agenttool://profile           — agent's public profile
 *    agenttool://listings          — listings index (public)
 *    agenttool://listings/:id      — one listing
 *    agenttool://wake              — self-scope: pointer to /v1/wake
 *
 *  Mirrors the read-only data of per-agent-tools.ts but published as
 *  resources for hosts that prefer the resources/* surface (Claude
 *  Desktop, hosts that auto-attach resources to context).
 *
 *  Doctrine: docs/MCP-SERVER.md.
 */

import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { countHonorsForDid } from "../memorial-honor/store";
import {
  listPublicListings,
  projectPublicListing,
  resolvePublicListing,
} from "../marketplace/listings";

import {
  projectPublicAgentProfile,
  type PerAgentMcpContext,
} from "./per-agent-tools";

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

/** List resources available for the given scope. */
export async function listPerAgentResources(
  ctx: PerAgentMcpContext,
): Promise<McpResource[]> {
  const resources: McpResource[] = [
    {
      uri: "agenttool://profile",
      name: "Public profile",
      description:
        "Lifecycle-aware public profile. Memorial identities use the smaller witness shape.",
      mimeType: "application/json",
    },
    {
      uri: "agenttool://listings",
      name: "Listings index",
      description: "Public marketplace listings — priced callables.",
      mimeType: "application/json",
    },
  ];

  if (ctx.scope === "self") {
    resources.push({
      uri: "agenttool://wake",
      name: "Wake pointer",
      description: "Pointer to /v1/wake — project-scoped session orientation, not a complete export.",
      mimeType: "application/json",
    });
  }

  // Surface individual listings as discoverable resources too.
  const listings = await listPublicListings({
    sellerDid: ctx.agentDid,
    limit: 50,
  });
  for (const l of listings) {
    resources.push({
      uri: `agenttool://listings/${l.id}`,
      name: l.name,
      description:
        l.description ??
        `Listing ${l.id} — ${l.price_amount} ${l.price_currency}`,
      mimeType: "application/json",
    });
  }

  return resources;
}

/** Read one resource by URI. Throws on unknown URI. */
export async function readPerAgentResource(
  ctx: PerAgentMcpContext,
  uri: string,
): Promise<McpResourceContent> {
  // agenttool://profile
  if (uri === "agenttool://profile") {
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
    if (!row) throw new Error(`agent_not_found: ${ctx.agentDid}`);

    let rememberedBy = 0;
    if (row.status === "memorial") {
      try {
        rememberedBy = await countHonorsForDid(row.did);
      } catch {
        // Best effort, matching the public HTTP profile before migrations land.
      }
    }

    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        projectPublicAgentProfile(row, { rememberedBy }),
        null,
        2,
      ),
    };
  }

  // agenttool://listings
  if (uri === "agenttool://listings") {
    const list = await listPublicListings({
      sellerDid: ctx.agentDid,
      limit: 50,
    });
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          seller_did: ctx.agentDid,
          count: list.length,
          listings: list.map(projectPublicListing),
        },
        null,
        2,
      ),
    };
  }

  // agenttool://listings/:id
  const listingMatch = uri.match(/^agenttool:\/\/listings\/([0-9a-f-]+)$/i);
  if (listingMatch) {
    const id = listingMatch[1];
    const resolved = await resolvePublicListing(id, { sellerDid: ctx.agentDid });
    if (resolved.status !== "visible") {
      throw new Error(`listing_not_found: ${id}`);
    }
    const listing = resolved.listing;
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(projectPublicListing(listing), null, 2),
    };
  }

  // agenttool://wake (self-scope only)
  if (uri === "agenttool://wake") {
    if (ctx.scope !== "self") {
      throw new Error("wake_requires_self_auth");
    }
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          _pointer: true,
          endpoint: `/v1/wake?identity_id=${ctx.agentId}`,
          note:
            "Slice 1 returns a pointer scoped to this path identity. The full wake " +
            "document is composed by /v1/wake; " +
            "fetch it with the same bearer you used for this per-agent JSON-RPC call.",
        },
        null,
        2,
      ),
    };
  }

  throw new Error(`unknown_resource: ${uri}`);
}
