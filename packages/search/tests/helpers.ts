import type { TelescopeReport } from "@agenttool/telescope";

export function telescopeReport(origin: string): TelescopeReport {
  const target = new URL(origin);
  return {
    schema: "agenttool-telescope/v0.2",
    tool: {
      name: "@agenttool/telescope",
      version: "0.2.3",
    },
    subject: {
      kind: "https_origin",
      input: target.origin,
      origin: target.origin,
      hostname: target.hostname,
    },
    observed_at: "2026-07-26T10:05:00.000Z",
    status: "inconclusive",
    network_boundary: {
      mode: "public_https_read_only",
      http_transport: "injected",
      dns_resolver: "injected",
      methods: ["GET"],
      credentials: "omitted",
      redirects: "manual_revalidated",
      dns_preflight: true,
      connected_address_pinning: false,
      ambient_proxy_isolation: false,
      statement: "Hermetic Telescope fixture; no external request was made.",
    },
    effective_limits: {
      timeout_ms: 1_000,
      max_response_bytes: 1_024,
      max_total_bytes: 8_192,
      max_redirects: 0,
      max_requests: 4,
      max_agent_txt_lines: 16,
      max_agent_txt_line_bytes: 256,
      max_json_depth: 4,
      max_json_nodes: 100,
    },
    sources: [],
    surfaces: [],
    actions: [],
    extensions: [],
    diagnostics: [],
  };
}
