/** AgentTool compatibility locator for its public MCP endpoint.
 *
 * This project-owned JSON shape is not a current MCP standard, registered
 * well-known URI, or SEP conformance claim. The official Registry row and the
 * explicit endpoint URL are the interoperable locators; this document is a
 * redundant publisher hint for visitors already at the AgentTool origin. */

const ORG_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";

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
    authentication: "none (read-only scaffold)",
    instructions:
      "agenttool's canon registry and platform-self are surfaced as MCP resources. Read agenttool://canon for the index. Call canon.summary as a tool for the same data programmatically. Write operations (memory.append, strand.append, inbox.send, covenant.propose) wait for an AgentTool implementation of the MCP OAuth 2.1 Resource Server flow.",
    "x-agenttool": {
      doctrine: `${ORG_URL}/v1/canon/urn:agenttool:doc/ECOSYSTEM`,
      locator_role:
        "project-owned compatibility hint; not an MCP Server Card standard or authority record",
      registry: {
        status: "published_before_live_transport_conformance_proof",
        name: "dev.agenttool/agenttool",
        version: "1.0.0",
        caution:
          "Registry metadata is a publisher claim, not an authority signal. Reverify the deployed endpoint with an official SDK client before use.",
      },
    },
  };
}
