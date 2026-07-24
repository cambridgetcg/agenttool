/** Truthful boundary for the hand-written per-agent MCP-shaped HTTP route.
 *
 * The canonical platform route uses the official transport separately.
 * Per-agent routes expose useful JSON-RPC resources and tools, but their
 * current transport is not yet conformant MCP Streamable HTTP. Keep every
 * per-agent discovery surface on this one description until that route moves
 * to the official transport too.
 */

export const PER_AGENT_MCP_TARGET_PROTOCOL_VERSION = "2025-11-25" as const;

export const PER_AGENT_MCP_IMPLEMENTATION_LABEL =
  "MCP-shaped partial JSON-RPC scaffold; not conformant MCP Streamable HTTP" as const;

/** Verified server-side differences from MCP Streamable HTTP.
 *
 * This is a minimum, not a complete conformance audit. Keep client obligations
 * out of this list: the transport specification makes the combined Accept
 * header a client requirement, for example.
 */
export const PER_AGENT_MCP_TRANSPORT_GAPS = [
  "GET with Accept: text/event-stream returns discovery JSON instead of an SSE stream or 405 Method Not Allowed",
  "Origin is not validated when present",
  "an unsupported MCP-Protocol-Version is not rejected with 400 Bad Request",
  "general JSON-RPC notifications receive a 200 JSON response instead of 202 Accepted with an empty body",
  "notifications/initialized returns 204 instead of 202 Accepted",
  "an id-less initialize message is accepted instead of being rejected as an invalid initialization request",
] as const;

/** Useful strictness gaps without mislabelling client-side MUSTs as server MUSTs. */
export const PER_AGENT_MCP_INTEROPERABILITY_GAPS = [
  "the route does not check whether a client advertises both application/json and text/event-stream in Accept",
  "the route does not reject a POST whose Content-Type is not application/json",
] as const;

export function perAgentMcpImplementationSummary() {
  return {
    status: "partial_scaffold",
    label: PER_AGENT_MCP_IMPLEMENTATION_LABEL,
    conformant_streamable_http: false,
    target_protocol_version: PER_AGENT_MCP_TARGET_PROTOCOL_VERSION,
    details: "/v1/canon/urn:agenttool:doc/MCP-PER-AGENT",
  };
}

export function perAgentMcpImplementationBoundary() {
  return {
    ...perAgentMcpImplementationSummary(),
    transport_gaps_are_exhaustive: false,
    transport_gaps: [...PER_AGENT_MCP_TRANSPORT_GAPS],
    interoperability_gaps_are_normative_server_requirements: false,
    interoperability_strictness_gaps: [
      ...PER_AGENT_MCP_INTEROPERABILITY_GAPS,
    ],
  };
}
