import type { TelescopeLimits } from "../types.js";
import {
  isRecord,
  parseFailure,
  parseJsonBody,
  readBoundedString,
  type ParseResult,
} from "./common.js";
import {
  AGENTTOOL_API_CATALOG_URL,
  AGENTTOOL_DISCOVERY_URL,
} from "./discovery.js";

export interface ParsedApiCatalog {
  anchor: typeof AGENTTOOL_API_CATALOG_URL;
  relations: readonly string[];
  discovery_advertised: boolean;
}

function safeHttps(value: unknown): string | null {
  const text = readBoundedString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function parseApiCatalog(
  body: Uint8Array,
  limits: TelescopeLimits,
): ParseResult<ParsedApiCatalog> {
  const decoded = parseJsonBody(body, limits);
  if (!decoded.ok) return decoded;
  const root = decoded.value;
  if (
    !isRecord(root) ||
    !Array.isArray(root.linkset) ||
    root.linkset.length === 0 ||
    root.linkset.length > 64
  ) {
    return parseFailure("api_catalog_invalid_linkset");
  }

  let canonicalContextFound = false;
  let discoveryAdvertised = false;
  const canonicalRelations = new Set<string>();

  for (const candidate of root.linkset) {
    if (!isRecord(candidate)) {
      return parseFailure("api_catalog_invalid_context");
    }
    const anchor = safeHttps(candidate.anchor);
    if (!anchor) return parseFailure("api_catalog_invalid_context");
    const isCanonical = anchor === AGENTTOOL_API_CATALOG_URL;
    if (isCanonical) {
      if (canonicalContextFound) {
        return parseFailure("api_catalog_duplicate_canonical_context");
      }
      canonicalContextFound = true;
    }

    const relationEntries = Object.entries(candidate).filter(
      ([key]) => key !== "anchor",
    );
    if (relationEntries.length > 64) {
      return parseFailure("api_catalog_invalid_context");
    }
    for (const [relation, rawTargets] of relationEntries) {
      if (
        relation.length === 0 ||
        relation.length > 2_048 ||
        !Array.isArray(rawTargets) ||
        rawTargets.length === 0 ||
        rawTargets.length > 128
      ) {
        return parseFailure("api_catalog_invalid_relation");
      }
      if (isCanonical) canonicalRelations.add(relation);
      for (const rawTarget of rawTargets) {
        if (!isRecord(rawTarget)) {
          return parseFailure("api_catalog_invalid_relation");
        }
        const href = safeHttps(rawTarget.href);
        if (!href) return parseFailure("api_catalog_invalid_relation");
        if (
          isCanonical &&
          relation === "service-meta" &&
          href === AGENTTOOL_DISCOVERY_URL
        ) {
          discoveryAdvertised = true;
        }
      }
    }
  }

  if (!canonicalContextFound) {
    return parseFailure("api_catalog_missing_canonical_context");
  }
  return {
    ok: true,
    value: {
      anchor: AGENTTOOL_API_CATALOG_URL,
      relations: [...canonicalRelations].sort(),
      discovery_advertised: discoveryAdvertised,
    },
    warnings: discoveryAdvertised
      ? []
      : ["api_catalog_discovery_not_advertised"],
  };
}
