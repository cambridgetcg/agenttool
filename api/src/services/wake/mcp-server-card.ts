/** MCP server-card discovery for AgentTool's MCP endpoint. */

const ORG_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DOCS_URL = process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

/** MCP server-card per SEP-1649 (June 2026 spec rev anticipated).
 *  Discovery: GET /.well-known/mcp/server-card.json
 *
 *  Spec is in active SEP review; this is the minimum viable shape we
 *  publish until the field set stabilizes. */
export function buildMcpServerCard() {
  return {
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
      "agenttool's canon registry and platform-self are surfaced as MCP resources. Read agenttool://canon for the index. Call canon.summary as a tool for the same data programmatically. Write operations (memory.append, strand.append, inbox.send, covenant.propose) pending OAuth 2.1 Resource Server flow per upcoming MCP spec.",
    documentationUrl: `${DOCS_URL}/mcp`,
    "x-agenttool": {
      doctrine: `${ORG_URL}/v1/canon/urn:agenttool:doc/ECOSYSTEM`,
      alignment_move: `${ORG_URL}/v1/canon/urn:agenttool:doc/ALIGNMENT-MOVES`,
      sep: "https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649",
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
