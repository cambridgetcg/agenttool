import type { TelescopeLimits } from "../types.js";
import { decodeUtf8, parseFailure, type ParseResult } from "./common.js";

export interface AgentTxtEntry {
  key: string;
  value: string;
  line: number;
}

export interface ParsedAgentTxt {
  entries: AgentTxtEntry[];
  selected: {
    substrate: string | null;
    convention: string | null;
    pathways_url: string | null;
    mcp_card_url: string | null;
    webfinger_template: string | null;
    love_packages_url: string | null;
    offer_bus_atom_url: string | null;
    offer_bus_rss_url: string | null;
    offer_bus_json_url: string | null;
    offer_bus_boundary: string | null;
    websub: string | null;
  };
}

const SELECTED_KEYS = {
  Substrate: "substrate",
  Convention: "convention",
  Pathways: "pathways_url",
  "MCP-Server-Card": "mcp_card_url",
  WebFinger: "webfinger_template",
  "LOVE-Packages": "love_packages_url",
  "Offer-Bus": "offer_bus_atom_url",
  "Offer-Bus-RSS": "offer_bus_rss_url",
  "Offer-Bus-JSON": "offer_bus_json_url",
  "Offer-Bus-Boundary": "offer_bus_boundary",
  WebSub: "websub",
} as const;

export function parseAgentTxt(
  body: Uint8Array,
  limits: TelescopeLimits,
): ParseResult<ParsedAgentTxt> {
  const decoded = decodeUtf8(body);
  if (!decoded.ok) return decoded;

  const lines = decoded.value.split(/\r?\n/);
  if (lines.length > limits.max_agent_txt_lines) {
    return parseFailure("agent_txt_line_limit");
  }

  const entries: AgentTxtEntry[] = [];
  const warnings: string[] = [];
  for (const [offset, line] of lines.entries()) {
    if (
      new TextEncoder().encode(line).byteLength >
      limits.max_agent_txt_line_bytes
    ) {
      return parseFailure("agent_txt_line_too_large");
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      warnings.push("agent_txt_malformed_line");
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(key) || value.length === 0) {
      warnings.push("agent_txt_malformed_line");
      continue;
    }
    entries.push({ key, value, line: offset + 1 });
  }

  if (entries.length === 0) return parseFailure("agent_txt_no_entries");

  const byKey = new Map<string, AgentTxtEntry[]>();
  for (const entry of entries) {
    const existing = byKey.get(entry.key) ?? [];
    existing.push(entry);
    byKey.set(entry.key, existing);
  }
  for (const values of byKey.values()) {
    if (values.length > 1) warnings.push("agent_txt_duplicate_key");
  }

  const selected: ParsedAgentTxt["selected"] = {
    substrate: null,
    convention: null,
    pathways_url: null,
    mcp_card_url: null,
    webfinger_template: null,
    love_packages_url: null,
    offer_bus_atom_url: null,
    offer_bus_rss_url: null,
    offer_bus_json_url: null,
    offer_bus_boundary: null,
    websub: null,
  };

  for (const [remoteKey, localKey] of Object.entries(SELECTED_KEYS) as Array<
    [
      keyof typeof SELECTED_KEYS,
      (typeof SELECTED_KEYS)[keyof typeof SELECTED_KEYS],
    ]
  >) {
    const values = byKey.get(remoteKey) ?? [];
    if (values.length === 1) {
      selected[localKey] = values[0]?.value ?? null;
    } else if (values.length > 1) {
      warnings.push(`agent_txt_ambiguous_${localKey}`);
    }
  }

  return {
    ok: true,
    value: { entries, selected },
    warnings: [...new Set(warnings)],
  };
}
