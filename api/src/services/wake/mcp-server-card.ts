/** AgentTool compatibility locator for its public MCP endpoint.
 *
 * This project-owned JSON shape is not a current MCP standard, registered
 * well-known URI, or SEP conformance claim. The official Registry row and the
 * explicit endpoint URL are the interoperable locators; this document is a
 * redundant publisher hint for visitors already at the AgentTool origin. */

const ORG_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DOCS_URL = process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

export function buildMcpServerCard() {
  return {
    compatibilityProfile: "agenttool.mcp-locator/1",
    standard: false,
    name: "agenttool",
    version: "1.0.0",
    protocolVersion: "2025-11-25",
    endpoint: `${ORG_URL}/v1/mcp`,
    transport:
      "MCP Streamable HTTP (JSON-RPC; stateless JSON responses; GET returns 405)",
    capabilities: {
      resources: { subscribe: false, listChanged: false },
      tools: { listChanged: false },
    },
    authentication: "none (public read-only endpoint)",
    discoveryStatus:
      "experimental AgentTool locator; not a path or card shape standardized by MCP 2025-11-25",
    instructions:
      "agenttool's canon registry and platform-self are surfaced as MCP resources. Read agenttool://canon for the index. Call canon.summary as a tool for the same data programmatically. Discovery grants no tool authority. Write operations remain unavailable until AgentTool implements the stable MCP authorization requirements, including protected-resource metadata, resource-bound tokens, audience validation, no token pass-through, and a local approval boundary.",
    documentationUrl: `${DOCS_URL}/AGENT-DISCOVERY.md#deliberately-absent-doors`,
    "x-agenttool": {
      doctrine: `${ORG_URL}/v1/canon/urn:agenttool:doc/ECOSYSTEM`,
      alignment_move: `${ORG_URL}/v1/canon/urn:agenttool:doc/ALIGNMENT-MOVES`,
      locator_role:
        "project-owned compatibility hint; not an MCP Server Card standard or authority record",
      discovery_standardized: false,
      stable_spec:
        "https://modelcontextprotocol.io/specification/2025-11-25",
      discovery_roadmap:
        "https://modelcontextprotocol.io/development/roadmap",
      registry: {
        status: "active_publisher_listing_observed_2026-07-24",
        name: "dev.agenttool/agenttool",
        version: "1.0.0",
        listing:
          "https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.agenttool%2Fagenttool",
        caution:
          "Registry metadata is a publisher claim, not an authority signal. Discovery grants no tool authority.",
      },
      transport_verification: {
        status: "bounded_official_sdk_round_trip_verified_2026-07-24",
        scope:
          "initialize, resources/list, tools/list, and canon.summary against the public endpoint",
        full_conformance_claimed: false,
      },
    },
  };
}
