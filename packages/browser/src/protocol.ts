/**
 * One operation registry feeds capability discovery and JSONL dispatch; MCP
 * parity is locked to the same names by contract tests. These are stable
 * AgentTool terms, not Playwright, WebDriver BiDi, or CDP identifiers.
 */
export const BROWSER_OPERATIONS = Object.freeze([
  "browser_capabilities",
  "browser_plan",
  "browser_open",
  "browser_observe",
  "browser_act",
  "browser_extract",
  "browser_screenshot",
  "browser_tabs",
  "browser_close",
] as const);

export type BrowserOperation = (typeof BROWSER_OPERATIONS)[number];

export const JSONL_PROTOCOL_VERSION = "agenttool-browser-jsonl/0.1" as const;

/**
 * The exact MCP server dependency is configured to negotiate the modern
 * revision while continuing to serve clients from the preceding protocol
 * era on the same stdio entry point.
 */
export const MCP_MODERN_PROTOCOL_REVISION = "2026-07-28" as const;
export const MCP_LEGACY_COMPATIBILITY = "2025-era" as const;
