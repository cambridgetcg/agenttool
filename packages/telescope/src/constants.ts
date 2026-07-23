import type { TelescopeLimits } from "./types.js";

export const REPORT_SCHEMA = "agenttool-telescope/v0.1" as const;
export const TOOL_NAME = "@agenttool/telescope" as const;
export const TOOL_VERSION = "0.2.0" as const;

export const DEFAULT_LIMITS: Readonly<TelescopeLimits> = Object.freeze({
  timeout_ms: 15_000,
  max_response_bytes: 256 * 1024,
  max_total_bytes: 1_500 * 1024,
  max_redirects: 3,
  max_requests: 12,
  max_agent_txt_lines: 512,
  max_agent_txt_line_bytes: 4_096,
  max_json_depth: 20,
  max_json_nodes: 10_000,
});
