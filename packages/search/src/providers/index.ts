import type { SearchProvider } from "../types.js";
import {
  AgentToolMarketplaceProvider,
  type AgentToolMarketplaceProviderOptions,
} from "./agenttool-marketplace.js";
import {
  McpRegistryProvider,
  type McpRegistryProviderOptions,
} from "./mcp-registry.js";

export {
  AGENTTOOL_MARKETPLACE_ENDPOINT,
  AGENTTOOL_MARKETPLACE_ORIGIN,
  AGENTTOOL_MARKETPLACE_PROVIDER_ID,
  AgentToolMarketplaceProvider,
  type AgentToolMarketplaceProviderOptions,
} from "./agenttool-marketplace.js";
export {
  MCP_REGISTRY_ENDPOINT,
  MCP_REGISTRY_ORIGIN,
  MCP_REGISTRY_PROVIDER_ID,
  McpRegistryProvider,
  type McpRegistryProviderOptions,
} from "./mcp-registry.js";
export {
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  fetchFixedJson,
  FixedJsonTransportError,
  redactProviderQueryValues,
  type FixedJsonFetchOptions,
  type FixedJsonFetchResult,
  type FixedJsonTransportErrorCode,
  type ProviderFetch,
} from "./transport.js";

export interface DefaultSearchProviderOptions {
  fetch?: AgentToolMarketplaceProviderOptions["fetch"];
  max_response_bytes?: number;
  marketplace?: AgentToolMarketplaceProviderOptions;
  mcp_registry?: McpRegistryProviderOptions;
}

export type DefaultSearchProviders = readonly [
  AgentToolMarketplaceProvider,
  McpRegistryProvider,
];

/** Return fresh local provider instances; no provider state is shared. */
export function createDefaultSearchProviders(
  options: DefaultSearchProviderOptions = {},
): DefaultSearchProviders {
  const common = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.max_response_bytes !== undefined
      ? { max_response_bytes: options.max_response_bytes }
      : {}),
  };
  return [
    new AgentToolMarketplaceProvider({
      ...common,
      ...options.marketplace,
    }),
    new McpRegistryProvider({
      ...common,
      ...options.mcp_registry,
    }),
  ] as const satisfies readonly SearchProvider[];
}
