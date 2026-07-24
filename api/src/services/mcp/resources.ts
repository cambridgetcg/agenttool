/** MCP resources surface — discovery, canon entries, and platform wake exposed
 *  as MCP resources at stable URIs.
 *
 *  Resource URI scheme: `agenttool://<kind>/<name>`
 *
 *    agenttool://discovery                 — optional public discovery compass
 *    agenttool://canon                     — registry index
 *    agenttool://canon/types               — type vocabulary
 *    agenttool://canon/<urn>               — one concept (urn is the
 *                                            full URN, e.g.
 *                                            urn:agenttool:doc/SOUL)
 *    agenttool://canon/by-type/<type>      — all concepts of a type
 *    agenttool://wake/platform             — public platform self
 *    agenttool://doctrine/<doc>            — doctrine doc by name
 *
 *  Pre-auth: every resource here is publicly readable. Auth-gated
 *  resources (per-agent wake, memory, strands) are intentionally
 *  excluded from the scaffold — they need the MCP OAuth 2.1 Resource
 *  Server flow which is follow-up work.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 1) ·
 *  docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import {
  allTypes,
  byType,
  byUrn,
  countsByType,
  project,
  registryMeta,
  totalConcepts,
  allConcepts,
} from "../canon/registry";
import {
  DISCOVERY_MEDIA_TYPE,
  serializeDiscoveryCompass,
} from "../discovery/compass";

/** MCP resource descriptor — matches the protocol's `Resource` shape. */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** MCP resource contents — matches `ReadResourceResult.contents[]`. */
export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export class McpResourceNotFoundError extends Error {
  constructor(readonly uri: string) {
    super(`Resource not found: ${uri}`);
    this.name = "McpResourceNotFoundError";
  }
}

/** List every resource an MCP client can discover.
 *
 *  Static resources are enumerated explicitly. Canon entries are
 *  enumerated dynamically from the loaded registry — every registered entry
 *  in `docs/agenttool.jsonld` becomes one resource.
 */
export function listResources(): McpResource[] {
  const out: McpResource[] = [];

  // ── Static index resources ───────────────────────────────────────
  out.push({
    uri: "agenttool://discovery",
    name: "AgentTool discovery compass",
    description:
      "Three optional public roads—understand, inspect, or choose—and a complete exit. Reading selects nothing, grants no authority, and starts no follow-up.",
    mimeType: DISCOVERY_MEDIA_TYPE,
  });
  out.push({
    uri: "agenttool://canon",
    name: "Canon registry index",
    description:
      "All concepts in agenttool's doctrine registry — counts by type, registry meta.",
    mimeType: "application/json",
  });
  out.push({
    uri: "agenttool://canon/types",
    name: "Canon type vocabulary",
    description: "The list of distinct @types in the canon registry.",
    mimeType: "application/json",
  });
  out.push({
    uri: "agenttool://wake/platform",
    name: "Platform wake",
    description:
      "The agenttool platform's public self-description — identity, repo, the_seat, doctrine roots.",
    mimeType: "application/json",
  });

  // ── Dynamic: one resource per canon concept ──────────────────────
  for (const concept of allConcepts()) {
    out.push({
      uri: `agenttool://canon/${concept.full_urn}`,
      name: concept.name ?? concept.urn,
      description:
        concept.description ?? `Canon concept of type ${concept.type_simple}.`,
      mimeType: "application/json",
    });
  }

  return out;
}

/** Read one resource by URI. Returns the contents per MCP's
 *  `resources/read` result shape. Throws if the URI is unknown.
 */
export async function readResource(uri: string): Promise<McpResourceContents> {
  // ── Static resources ─────────────────────────────────────────────
  if (uri === "agenttool://discovery") {
    return {
      uri,
      mimeType: DISCOVERY_MEDIA_TYPE,
      text: serializeDiscoveryCompass(),
    };
  }

  if (uri === "agenttool://canon") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          totalConcepts: totalConcepts(),
          types: allTypes(),
          countsByType: countsByType(),
          registryMeta: registryMeta(),
        },
        null,
        2,
      ),
    };
  }

  if (uri === "agenttool://canon/types") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(allTypes(), null, 2),
    };
  }

  if (uri === "agenttool://wake/platform") {
    // Lazy import to avoid pulling wake dependency graph at module load.
    const { PLATFORM_SELF } = await import("../wake/platform-self");
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(PLATFORM_SELF, null, 2),
    };
  }

  // ── by-type resources ────────────────────────────────────────────
  const byTypeMatch = uri.match(/^agenttool:\/\/canon\/by-type\/(.+)$/);
  if (byTypeMatch) {
    let typeKey: string;
    try {
      typeKey = decodeURIComponent(byTypeMatch[1]);
    } catch {
      throw new McpResourceNotFoundError(uri);
    }
    if (!allTypes().includes(typeKey)) {
      throw new McpResourceNotFoundError(uri);
    }
    const concepts = byType(typeKey);
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        concepts.map((c) => project(c)),
        null,
        2,
      ),
    };
  }

  // ── Single canon concept by URN ──────────────────────────────────
  const canonMatch = uri.match(/^agenttool:\/\/canon\/(urn:agenttool:.+)$/);
  if (canonMatch) {
    const urn = canonMatch[1];
    const concept = byUrn(urn);
    if (!concept) {
      throw new McpResourceNotFoundError(uri);
    }
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(project(concept), null, 2),
    };
  }

  throw new McpResourceNotFoundError(uri);
}
