import {
  AGENTTOOL_API_CATALOG_URL,
  AGENTTOOL_DISCOVERY_URL,
} from "./discovery.js";
import { parseFailure, type ParseResult } from "./common.js";

export interface ParsedRootLinks {
  relations: readonly string[];
  discovery_advertised: boolean;
  api_catalog_advertised: boolean;
}

function splitOutside(value: string, separator: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let angled = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === "<") angled = true;
    else if (!quoted && character === ">") angled = false;
    else if (!quoted && !angled && character === separator) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || angled || escaped) return null;
  parts.push(value.slice(start).trim());
  return parts;
}

function parameterValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) {
    return trimmed.length > 0 && trimmed.length <= 2_048 ? trimmed : null;
  }
  if (!trimmed.endsWith('"') || trimmed.length < 2) return null;
  let result = "";
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const character = trimmed[index]!;
    if (character === "\\") {
      index += 1;
      if (index >= trimmed.length - 1) return null;
      result += trimmed[index]!;
    } else {
      result += character;
    }
  }
  return result.length > 0 && result.length <= 2_048 ? result : null;
}

function canonicalHttpsTarget(value: string, origin: string): string | null {
  try {
    const url = new URL(value, `${origin}/`);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.href.length > 2_048
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function parseRootLinkHeader(
  header: string,
  origin: string,
): ParseResult<ParsedRootLinks> {
  if (
    header.length === 0 ||
    header.length > 16_384 ||
    /[\u0000-\u0008\u000a-\u001f\u007f]/u.test(header)
  ) {
    return parseFailure("root_links_invalid");
  }
  const values = splitOutside(header, ",");
  if (!values || values.length === 0 || values.length > 32) {
    return parseFailure("root_links_invalid");
  }

  const relations = new Set<string>();
  let discoveryAdvertised = false;
  let apiCatalogAdvertised = false;

  for (const value of values) {
    const close = value.indexOf(">");
    if (!value.startsWith("<") || close < 2) {
      return parseFailure("root_links_invalid");
    }
    const target = canonicalHttpsTarget(value.slice(1, close), origin);
    if (!target) return parseFailure("root_links_invalid");
    const parameters = splitOutside(value.slice(close + 1), ";");
    if (!parameters) return parseFailure("root_links_invalid");

    let relationValues: string[] | null = null;
    for (const rawParameter of parameters) {
      if (!rawParameter) continue;
      const equals = rawParameter.indexOf("=");
      if (equals <= 0) return parseFailure("root_links_invalid");
      const name = rawParameter.slice(0, equals).trim().toLowerCase();
      const parsedValue = parameterValue(rawParameter.slice(equals + 1));
      if (!parsedValue) return parseFailure("root_links_invalid");
      if (name === "rel") {
        if (relationValues) return parseFailure("root_links_invalid");
        relationValues = parsedValue.split(/\s+/u);
        if (
          relationValues.length === 0 ||
          relationValues.length > 16 ||
          relationValues.some(
            (relation) =>
              relation.length === 0 ||
              relation.length > 2_048 ||
              /[\u0000-\u0020\u007f]/u.test(relation),
          )
        ) {
          return parseFailure("root_links_invalid");
        }
      }
    }
    if (!relationValues) return parseFailure("root_links_invalid");
    for (const relation of relationValues) relations.add(relation);
    if (
      target === AGENTTOOL_DISCOVERY_URL &&
      relationValues.includes("service-meta")
    ) {
      discoveryAdvertised = true;
    }
    if (
      target === AGENTTOOL_API_CATALOG_URL &&
      relationValues.includes("api-catalog")
    ) {
      apiCatalogAdvertised = true;
    }
  }

  return {
    ok: true,
    value: {
      relations: [...relations].sort(),
      discovery_advertised: discoveryAdvertised,
      api_catalog_advertised: apiCatalogAdvertised,
    },
    warnings: discoveryAdvertised ? [] : ["root_links_missing_discovery"],
  };
}
