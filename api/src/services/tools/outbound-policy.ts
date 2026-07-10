export const UNSAFE_OUTBOUND_TOOLS_ENV =
  "AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS";

export function unsafeOutboundToolsEnabled(
  value = process.env.AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS,
): boolean {
  return value === "1";
}

export function unsafeOutboundDisabledBody(surface: string) {
  return {
    error: "unsafe_outbound_tool_disabled",
    message:
      `${surface} is disabled because outbound URL tools do not yet pin DNS ` +
      "or block private, loopback, link-local, and internal destinations.",
    hint:
      `Use ${surface === "document URL fetching" ? "base64 document input or " : ""}` +
      "infrastructure you control. An operator may explicitly accept the current " +
      `SSRF boundary with ${UNSAFE_OUTBOUND_TOOLS_ENV}=1.`,
    enabled_by_process_flag: false,
    safety: "/public/safety",
  } as const;
}

export function assertUnsafeOutboundToolsEnabled(): void {
  if (!unsafeOutboundToolsEnabled()) {
    throw new Error("unsafe_outbound_tool_disabled");
  }
}

export function isHttpOrHttpsUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function assertHttpOrHttpsUrl(value: string): void {
  if (!isHttpOrHttpsUrl(value)) {
    throw new Error(
      "outbound_url_protocol_not_allowed: use an http:// or https:// URL",
    );
  }
}
