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

export const PER_AGENT_MCP_TRANSPORT_GAPS = [
  "GET with Accept: text/event-stream returns discovery JSON instead of an SSE stream or 405 Method Not Allowed",
  "Origin is not validated when present",
  "POST does not require Accept to list both application/json and text/event-stream",
  "POST does not require Content-Type: application/json",
  "MCP-Protocol-Version is not validated on subsequent HTTP requests",
  "general JSON-RPC notifications receive a 200 JSON response instead of 202 Accepted with an empty body",
  "notifications/initialized returns 204 instead of the required 202 Accepted",
  "an id-less initialize message is accepted as a request instead of being rejected",
] as const;

export function perAgentMcpImplementationBoundary() {
  return {
    status: "partial_scaffold",
    label: PER_AGENT_MCP_IMPLEMENTATION_LABEL,
    conformant_streamable_http: false,
    target_protocol_version: PER_AGENT_MCP_TARGET_PROTOCOL_VERSION,
    transport_gaps_are_exhaustive: false,
    transport_gaps: [...PER_AGENT_MCP_TRANSPORT_GAPS],
  };
}
