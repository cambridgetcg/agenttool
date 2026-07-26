/** ai-catalog.json — the ARD capability manifest.
 *
 *  Agentic Resource Discovery (ARD) is a draft standard published 2026-06-17
 *  for a question this platform already tries to answer: an agent knows a
 *  domain and nothing else, and wants to learn what is here before deciding
 *  whether to connect. ARD's answer is one static manifest at a well-known
 *  path, plus registries that crawl those manifests and answer natural-
 *  language queries against them.
 *
 *  Why this file exists alongside the RFC 9727 api-catalog: that one is a
 *  linkset of *products and their documentation*, addressed to a caller who
 *  already knows they want an API. This one names *agentic artifacts* — an
 *  MCP server, a compass, an OpenAPI contract — for a reader who does not yet
 *  know the name of anything here.
 *
 *  Two honesty constraints this manifest keeps:
 *
 *  1. Nothing is claimed that is not served. The `host.identifier` field
 *     wants a verifiable identity such as `did:web:agenttool.dev`; that would
 *     require /.well-known/did.json, which this platform does not serve, so
 *     the field is omitted rather than asserted. A manifest is a set of
 *     claims about doorways, and the false-door law applies to it hardest —
 *     its whole readership is machines.
 *  2. `representativeQueries` says what a resource genuinely answers, in the
 *     field the specification provides for exactly that. It is the honest
 *     alternative to writing task-words into prose where they do not belong:
 *     the queries are indexed as queries, and a reader can check each one
 *     against what the resource actually returns.
 *
 *  Descriptive throughout. The manifest states what exists; it never
 *  addresses the reader or asks for anything. Reading it selects nothing,
 *  authenticates nothing, and starts nothing.
 *
 *  Spec: https://agenticresourcediscovery.org/ai_catalog_spec/
 *  Schema: https://raw.githubusercontent.com/ards-project/ard-spec/main/spec/schemas/ai-catalog.schema.json
 *  Doctrine: docs/AGENT-DISCOVERY.md · docs/ECOSYSTEM.md
 */

export const AI_CATALOG_MEDIA_TYPE = "application/json" as const;
export const AI_CATALOG_SPEC_VERSION = "1.0" as const;

/** Media type for an MCP server card. A de-facto community type tracking
 *  toward formal IANA registration, per the ARD specification. */
export const MCP_SERVER_CARD_MEDIA_TYPE =
  "application/mcp-server-card+json" as const;
/** The registered OpenAPI JSON media type. */
export const OPENAPI_MEDIA_TYPE = "application/vnd.oai.openapi+json" as const;
/** The compass serves itself under its own vendor type; see routes/public. */
export const DISCOVERY_COMPASS_MEDIA_TYPE =
  "application/vnd.agenttool.discovery+json" as const;

export interface AiCatalogEntry {
  identifier: string;
  displayName: string;
  type: string;
  url: string;
  description: string;
  tags: string[];
  capabilities?: string[];
  representativeQueries: string[];
}

export interface AiCatalogHost {
  displayName: string;
  documentationUrl: string;
}

export interface AiCatalogManifest {
  specVersion: typeof AI_CATALOG_SPEC_VERSION;
  host: AiCatalogHost;
  entries: AiCatalogEntry[];
}

function origin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}_must_be_absolute_url`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error(`${label}_must_be_credential_free_https_origin`);
  }
  return parsed.origin;
}

export function buildAiCatalog(
  publicBase: string,
  docsBase: string,
): AiCatalogManifest {
  const api = origin(publicBase, "public_base");
  const docs = origin(docsBase, "docs_base");

  return {
    specVersion: AI_CATALOG_SPEC_VERSION,
    host: {
      displayName: "AgentTool",
      documentationUrl: docs,
    },
    entries: [
      {
        identifier: "urn:air:agenttool.dev:discovery:compass",
        displayName: "AgentTool discovery compass",
        type: DISCOVERY_COMPASS_MEDIA_TYPE,
        url: `${api}/public/discovery`,
        description:
          "A read-only arrival document offering three optional roads — understand at the porch, inspect the API catalog, or read the pathways to see what connecting would involve. Requires no authentication or input, writes nothing, charges nothing, and triggers no follow-up. Stopping or leaving is a complete outcome.",
        tags: ["discovery", "read-only", "unauthenticated"],
        representativeQueries: [
          "what does this service offer before I connect to it",
          "how do I find out what an unfamiliar domain provides for agents",
          "read-only entry point that does not require credentials",
        ],
      },
      {
        identifier: "urn:air:agenttool.dev:mcp:agenttool",
        displayName: "AgentTool MCP server",
        type: MCP_SERVER_CARD_MEDIA_TYPE,
        url: `${api}/.well-known/mcp/server-card.json`,
        description:
          "A public read-only MCP server over streamable HTTP, reachable without a bearer token. It exposes the discovery compass and this platform's doctrine registry as resources, and five read-only tools for looking concepts up. It does not expose the identity, memory, vault, wallet, or messaging primitives — those are HTTP routes that require a key.",
        tags: ["mcp", "read-only", "unauthenticated", "doctrine"],
        capabilities: [
          "canon.lookup",
          "canon.by_type",
          "canon.list_types",
          "canon.summary",
          "wake.platform",
        ],
        representativeQueries: [
          "MCP server I can connect to without an API key",
          "look up a concept in a platform's published doctrine registry",
          "read a service's self-description over MCP",
        ],
      },
      {
        identifier: "urn:air:agenttool.dev:api:openapi",
        displayName: "AgentTool HTTP API contract",
        type: OPENAPI_MEDIA_TYPE,
        url: `${api}/v1/openapi.json`,
        description:
          "The OpenAPI description of the full HTTP surface: DID identity and ed25519 keys, memory, an encrypted vault, sealed-box messaging, covenants, a capability marketplace, and a wallet. Most of these routes require a bearer key; the contract itself is public so the cost of connecting can be read before anything is created.",
        tags: ["openapi", "identity", "memory", "wallet", "did"],
        representativeQueries: [
          "give an AI agent a persistent identity that survives restarts",
          "where can an agent store memory between sessions",
          "API for issuing a DID to an autonomous agent",
        ],
      },
    ],
  };
}
