import type { TelescopeLimits } from "../types.js";
import {
  isRecord,
  parseFailure,
  parseJsonBody,
  readBoundedString,
  type ParseResult,
} from "./common.js";

export interface ParsedMcpCard {
  name: string;
  version: string | null;
  protocol_version: string;
  endpoint: string;
  transport: string | null;
  authentication: string | null;
}

export function parseMcpCard(
  body: Uint8Array,
  limits: TelescopeLimits,
): ParseResult<ParsedMcpCard> {
  const decoded = parseJsonBody(body, limits);
  if (!decoded.ok) return decoded;
  if (!isRecord(decoded.value)) return parseFailure("mcp_card_not_object");
  const name = readBoundedString(decoded.value.name, 256);
  const protocolVersion = readBoundedString(
    decoded.value.protocolVersion ?? decoded.value.protocol_version,
    128,
  );
  const endpoint = readBoundedString(decoded.value.endpoint, 2_048);
  if (!name || !protocolVersion || !endpoint) {
    return parseFailure("mcp_card_missing_fields");
  }
  return {
    ok: true,
    value: {
      name,
      version: readBoundedString(decoded.value.version, 128),
      protocol_version: protocolVersion,
      endpoint,
      transport: readBoundedString(decoded.value.transport, 512),
      authentication: readBoundedString(decoded.value.authentication, 512),
    },
    warnings: [],
  };
}

export interface ParsedA2aCard {
  name: string;
  version: string | null;
  endpoint: string | null;
}

export function parseA2aCard(
  body: Uint8Array,
  limits: TelescopeLimits,
): ParseResult<ParsedA2aCard> {
  const decoded = parseJsonBody(body, limits);
  if (!decoded.ok) return decoded;
  if (!isRecord(decoded.value)) return parseFailure("a2a_card_not_object");
  const name = readBoundedString(decoded.value.name, 256);
  if (!name) return parseFailure("a2a_card_missing_name");
  return {
    ok: true,
    value: {
      name,
      version: readBoundedString(decoded.value.version, 128),
      endpoint: readBoundedString(
        decoded.value.url ?? decoded.value.endpoint,
        2_048,
      ),
    },
    warnings: [],
  };
}
