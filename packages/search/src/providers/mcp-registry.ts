import { DEFAULT_SEARCH_LIMITS } from "../constants.js";
import type {
  SearchProvider,
  ProviderBoundary,
  ProviderCandidate,
  ProviderClaim,
  ProviderContext,
  ProviderSearchBatch,
  ProviderSearchRequest,
} from "../types.js";
import {
  encodePathSegment,
  isObject,
  kindRequested,
  optionalText,
  optionalTimestamp,
  requiredText,
  safeHttpUrl,
  stringList,
  validateProviderRequest,
} from "./shared.js";
import {
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  fetchFixedJson,
  FixedJsonTransportError,
  type ProviderFetch,
} from "./transport.js";

export const MCP_REGISTRY_PROVIDER_ID = "mcp_registry" as const;
export const MCP_REGISTRY_ORIGIN =
  "https://registry.modelcontextprotocol.io" as const;
export const MCP_REGISTRY_ENDPOINT =
  `${MCP_REGISTRY_ORIGIN}/v0.1/servers` as const;

const OFFICIAL_META_KEY =
  "io.modelcontextprotocol.registry/official" as const;

const BOUNDARY_CODES = Object.freeze([
  "fixed_provider_origin",
  "public_https_json_get",
  "credentials_omitted",
  "manual_redirects",
  "identity_content_encoding",
  "response_bytes_bounded",
  "query_disclosed_to_provider",
  "provider_cursor_opaque",
  "preview_registry",
  "connected_address_not_pinned",
] as const);

const REGISTRY_BOUNDARY: ProviderBoundary = Object.freeze({
  mode: "fixed_public_https_json_get",
  credentials: "omitted",
  query_disclosed: true,
  connected_address_pinning: false,
  statement:
    "Search text and an optional provider-owned opaque cursor are disclosed to the fixed official MCP Registry preview endpoint. Registry publication is an advertisement, not a successful MCP handshake, authorization, safety review, or permission to install or invoke.",
});

export interface McpRegistryProviderOptions {
  fetch?: ProviderFetch;
  max_response_bytes?: number;
}

interface ParsedRegistryServer {
  name: string;
  version: string;
  title: string;
  description: string;
  targetUrl: string;
  entryUrl: string;
  targetIsEntry: boolean;
  packageTypes: string[];
  remoteTypes: string[];
  status?: string;
  publishedAt?: string;
  updatedAt?: string;
  isLatest?: boolean;
  websiteUrl?: string;
  repositoryUrl?: string;
}

export class McpRegistryProvider implements SearchProvider {
  readonly id = MCP_REGISTRY_PROVIDER_ID;
  readonly kinds = ["mcp_server"] as const;
  readonly boundary = REGISTRY_BOUNDARY;

  private readonly fetchImpl: ProviderFetch | undefined;
  private readonly maxResponseBytes: number;

  constructor(options: McpRegistryProviderOptions = {}) {
    this.fetchImpl = options.fetch;
    this.maxResponseBytes =
      options.max_response_bytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
  }

  async search(
    request: ProviderSearchRequest,
    context: ProviderContext,
  ): Promise<ProviderSearchBatch> {
    validateProviderRequest(request);
    const url = new URL(MCP_REGISTRY_ENDPOINT);
    url.searchParams.set("search", request.query);
    url.searchParams.set("limit", String(request.limit));
    url.searchParams.set("version", "latest");
    if (request.cursor !== undefined) {
      // Provider cursors remain opaque. Never decode, trim, split, or derive
      // meaning from this exact value.
      url.searchParams.set("cursor", request.cursor);
    }

    const fetched = await fetchFixedJson(url, {
      expected_origin: MCP_REGISTRY_ORIGIN,
      signal: context.signal,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      max_response_bytes: this.maxResponseBytes,
      boundary_codes: BOUNDARY_CODES,
    });
    if (!isObject(fetched.json) || !Array.isArray(fetched.json.servers)) {
      throw new FixedJsonTransportError("provider_response_invalid");
    }

    const wantsServers = kindRequested(request, "mcp_server");
    const results = wantsServers
      ? fetched.json.servers
        .slice(0, DEFAULT_SEARCH_LIMITS.max_provider_results)
        .map(parseRegistryServer)
        .filter(
          (server): server is ParsedRegistryServer => server !== null,
        )
        .slice(0, request.limit)
        .map(registryCandidate)
      : [];
    const nextCursor = parseNextCursor(fetched.json.metadata);

    return {
      results,
      ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
      observation: fetched.observation,
    };
  }
}

function parseRegistryServer(input: unknown): ParsedRegistryServer | null {
  if (!isObject(input) || !isObject(input.server)) return null;
  const server = input.server;
  const name = requiredText(server.name, 200);
  const version = requiredText(server.version, 255);
  const description = requiredText(
    server.description,
    DEFAULT_SEARCH_LIMITS.max_summary_chars,
  );
  if (
    name === null
    || version === null
    || description === null
    || !/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/u.test(name)
  ) {
    return null;
  }

  const entryUrl =
    `${MCP_REGISTRY_ENDPOINT}/${encodePathSegment(name)}/versions/${
      encodePathSegment(version)
    }`;
  const websiteUrl = safeHttpUrl(server.websiteUrl);
  const repositoryUrl = isObject(server.repository)
    ? safeHttpUrl(server.repository.url)
    : undefined;
  const targetUrl = websiteUrl ?? repositoryUrl ?? entryUrl;
  const officialMeta = isObject(input._meta)
    && isObject(input._meta[OFFICIAL_META_KEY])
    ? input._meta[OFFICIAL_META_KEY]
    : undefined;
  const status = officialMeta
    ? optionalText(officialMeta.status, 32)
    : undefined;
  if (status === "deleted") return null;

  const packageTypes = Array.isArray(server.packages)
    ? stringList(
        server.packages.map((item) =>
          isObject(item) ? item.registryType : undefined
        ),
        DEFAULT_SEARCH_LIMITS.max_capabilities,
        64,
      )
    : [];
  const remoteTypes = Array.isArray(server.remotes)
    ? stringList(
        server.remotes.map((item) => isObject(item) ? item.type : undefined),
        DEFAULT_SEARCH_LIMITS.max_capabilities,
        64,
      )
    : [];

  return {
    name,
    version,
    title:
      optionalText(server.title, DEFAULT_SEARCH_LIMITS.max_title_chars)
      ?? name,
    description,
    targetUrl,
    entryUrl,
    targetIsEntry: targetUrl === entryUrl,
    packageTypes,
    remoteTypes,
    ...(status !== undefined ? { status } : {}),
    ...(officialMeta && optionalTimestamp(officialMeta.publishedAt) !== undefined
      ? { publishedAt: optionalTimestamp(officialMeta.publishedAt)! }
      : {}),
    ...(officialMeta && optionalTimestamp(officialMeta.updatedAt) !== undefined
      ? { updatedAt: optionalTimestamp(officialMeta.updatedAt)! }
      : {}),
    ...(officialMeta && typeof officialMeta.isLatest === "boolean"
      ? { isLatest: officialMeta.isLatest }
      : {}),
    ...(websiteUrl !== undefined ? { websiteUrl } : {}),
    ...(repositoryUrl !== undefined ? { repositoryUrl } : {}),
  };
}

function registryCandidate(
  server: ParsedRegistryServer,
): ProviderCandidate {
  const claims: ProviderClaim[] = [
    publisherClaim("registry.name", server.name),
    publisherClaim("registry.version", server.version),
    localClaim("registry.entry_url", server.entryUrl),
  ];
  if (server.status !== undefined) {
    claims.push(providerClaim("registry.status", server.status));
  }
  if (server.isLatest !== undefined) {
    claims.push(providerClaim("registry.is_latest", server.isLatest));
  }
  if (server.websiteUrl !== undefined) {
    claims.push(publisherClaim("server.website_url", server.websiteUrl));
  }
  if (server.repositoryUrl !== undefined) {
    claims.push(
      publisherClaim("server.repository_url", server.repositoryUrl),
    );
  }
  if (server.packageTypes.length > 0) {
    claims.push(
      publisherClaim("server.package_registry_types", server.packageTypes),
    );
  }
  if (server.remoteTypes.length > 0) {
    claims.push(
      publisherClaim("server.remote_transport_types", server.remoteTypes),
    );
  }

  return {
    kind: "mcp_server",
    title: server.title,
    summary: server.description,
    target_url: server.targetUrl,
    inspect_url: server.targetUrl.startsWith("https:")
      ? server.targetUrl
      : server.entryUrl,
    ...(server.targetIsEntry ? { mime_type: "application/json" } : {}),
    ...(server.publishedAt ? { published_at: server.publishedAt } : {}),
    ...(server.updatedAt ? { modified_at: server.updatedAt } : {}),
    claims,
  };
}

function parseNextCursor(input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  const cursor = input.nextCursor;
  if (
    typeof cursor !== "string"
    || cursor.length === 0
    || cursor.length > DEFAULT_SEARCH_LIMITS.max_url_chars
  ) {
    return undefined;
  }
  return cursor;
}

function publisherClaim(
  key: string,
  value: string | boolean | readonly string[],
): ProviderClaim {
  return { key, value, basis: "publisher_assertion" };
}

function localClaim(
  key: string,
  value: string,
): ProviderClaim {
  return { key, value, basis: "local_derivation" };
}

function providerClaim(
  key: string,
  value: string | boolean,
): ProviderClaim {
  return { key, value, basis: "provider_assertion" };
}
