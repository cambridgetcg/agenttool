/** Shared HTTP origin boundary for the public platform MCP endpoint. */

export const PUBLIC_MCP_ORIGIN = new URL(
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev",
).origin;

export function isAllowedPublicMcpOrigin(
  origin: string | null,
): boolean {
  if (origin === null) return true;
  // Browsers serialize Origin canonically. Compare that serialization exactly
  // so URL-parser normalizations cannot turn malformed input into permission.
  return origin === PUBLIC_MCP_ORIGIN;
}
