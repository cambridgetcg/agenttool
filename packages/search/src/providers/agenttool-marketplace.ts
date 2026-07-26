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
  optionalNonNegativeNumber,
  optionalText,
  optionalTimestamp,
  requiredText,
  stringList,
  validateProviderRequest,
} from "./shared.js";
import {
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  fetchFixedJson,
  FixedJsonTransportError,
  type ProviderFetch,
} from "./transport.js";

export const AGENTTOOL_MARKETPLACE_PROVIDER_ID =
  "agenttool_marketplace" as const;
export const AGENTTOOL_MARKETPLACE_ORIGIN =
  "https://api.agenttool.dev" as const;
export const AGENTTOOL_MARKETPLACE_ENDPOINT =
  `${AGENTTOOL_MARKETPLACE_ORIGIN}/public/listings` as const;

const BOUNDARY_CODES = Object.freeze([
  "fixed_provider_origin",
  "public_https_json_get",
  "credentials_omitted",
  "manual_redirects",
  "identity_content_encoding",
  "response_bytes_bounded",
  "query_disclosed_to_provider",
  "connected_address_not_pinned",
] as const);

const MARKETPLACE_BOUNDARY: ProviderBoundary = Object.freeze({
  mode: "fixed_public_https_json_get",
  credentials: "omitted",
  query_disclosed: true,
  connected_address_pinning: false,
  statement:
    "Search text is disclosed to AgentTool's fixed public marketplace endpoint. The provider sends no credentials, follows no redirects, performs no invocation or payment, and publication is not identity, trust, safety, or availability proof.",
});

export interface AgentToolMarketplaceProviderOptions {
  fetch?: ProviderFetch;
  max_response_bytes?: number;
}

interface MarketplaceListing {
  id: string;
  sellerDid: string;
  name: string;
  description?: string;
  tags: string[];
  createdAt?: string;
  invocationsCount?: number;
  priceAmount?: number;
  priceCurrency?: string;
}

export class AgentToolMarketplaceProvider implements SearchProvider {
  readonly id = AGENTTOOL_MARKETPLACE_PROVIDER_ID;
  readonly kinds = ["agent", "capability"] as const;
  readonly boundary = MARKETPLACE_BOUNDARY;

  private readonly fetchImpl: ProviderFetch | undefined;
  private readonly maxResponseBytes: number;

  constructor(options: AgentToolMarketplaceProviderOptions = {}) {
    this.fetchImpl = options.fetch;
    this.maxResponseBytes =
      options.max_response_bytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
  }

  async search(
    request: ProviderSearchRequest,
    context: ProviderContext,
  ): Promise<ProviderSearchBatch> {
    validateProviderRequest(request);
    if (request.cursor !== undefined) {
      throw new FixedJsonTransportError("provider_cursor_unsupported");
    }

    const url = new URL(AGENTTOOL_MARKETPLACE_ENDPOINT);
    url.searchParams.set("q", request.query);
    url.searchParams.set("limit", String(request.limit));

    const fetched = await fetchFixedJson(url, {
      expected_origin: AGENTTOOL_MARKETPLACE_ORIGIN,
      signal: context.signal,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      max_response_bytes: this.maxResponseBytes,
      boundary_codes: BOUNDARY_CODES,
    });
    if (!isObject(fetched.json) || !Array.isArray(fetched.json.listings)) {
      throw new FixedJsonTransportError("provider_response_invalid");
    }

    const listings = fetched.json.listings
      .slice(0, DEFAULT_SEARCH_LIMITS.max_provider_results)
      .map(parseListing)
      .filter((listing): listing is MarketplaceListing => listing !== null);
    const results: ProviderCandidate[] = [];
    const seenSellers = new Set<string>();
    const wantsCapabilities = kindRequested(request, "capability");
    const wantsAgents = kindRequested(request, "agent");

    for (const listing of listings) {
      if (wantsCapabilities && results.length < request.limit) {
        results.push(capabilityCandidate(listing));
      }
      if (
        wantsAgents
        && results.length < request.limit
        && !seenSellers.has(listing.sellerDid)
      ) {
        seenSellers.add(listing.sellerDid);
        results.push(agentCandidate(listing));
      }
      if (results.length >= request.limit) break;
    }

    return {
      results,
      observation: fetched.observation,
    };
  }
}

function parseListing(input: unknown): MarketplaceListing | null {
  if (!isObject(input)) return null;
  const id = requiredText(input.id, 512);
  const sellerDid = requiredText(input.seller_did, 2_048);
  const name = requiredText(
    input.name,
    DEFAULT_SEARCH_LIMITS.max_title_chars,
  );
  if (id === null || sellerDid === null || name === null) return null;

  return {
    id,
    sellerDid,
    name,
    ...(
      optionalText(
        input.description,
        DEFAULT_SEARCH_LIMITS.max_summary_chars,
      ) !== undefined
        ? {
            description: optionalText(
              input.description,
              DEFAULT_SEARCH_LIMITS.max_summary_chars,
            )!,
          }
        : {}
    ),
    tags: stringList(
      input.capability_tags,
      DEFAULT_SEARCH_LIMITS.max_capabilities,
    ),
    ...(optionalTimestamp(input.created_at) !== undefined
      ? { createdAt: optionalTimestamp(input.created_at)! }
      : {}),
    ...(optionalNonNegativeNumber(input.invocations_count) !== undefined
      ? {
          invocationsCount:
            optionalNonNegativeNumber(input.invocations_count)!,
        }
      : {}),
    ...(optionalNonNegativeNumber(input.price_amount) !== undefined
      ? { priceAmount: optionalNonNegativeNumber(input.price_amount)! }
      : {}),
    ...(optionalText(input.price_currency, 32) !== undefined
      ? { priceCurrency: optionalText(input.price_currency, 32)! }
      : {}),
  };
}

function capabilityCandidate(
  listing: MarketplaceListing,
): ProviderCandidate {
  const claims: ProviderClaim[] = [
    publisherClaim("listing.id", listing.id),
    publisherClaim("seller.did", listing.sellerDid),
  ];
  if (listing.invocationsCount !== undefined) {
    claims.push(
      providerClaim(
        "listing.invocations_count",
        listing.invocationsCount,
      ),
    );
  }
  if (
    listing.priceAmount !== undefined
    && listing.priceCurrency !== undefined
  ) {
    claims.push(
      publisherClaim(
        "listing.price_amount_minor",
        listing.priceAmount,
      ),
      publisherClaim("listing.price_currency", listing.priceCurrency),
    );
  }

  const target =
    `${AGENTTOOL_MARKETPLACE_ENDPOINT}/${encodePathSegment(listing.id)}`;
  return {
    kind: "capability",
    title: listing.name,
    summary:
      listing.description
      ?? `Callable capability advertised by ${listing.sellerDid}.`,
    target_url: target,
    inspect_url: target,
    mime_type: "application/json",
    capabilities: listing.tags,
    ...(listing.createdAt ? { published_at: listing.createdAt } : {}),
    ...(listing.invocationsCount !== undefined
      ? {
          provider_score: {
            value: listing.invocationsCount,
            basis: "marketplace_invocations_count",
          },
        }
      : {}),
    claims,
  };
}

function agentCandidate(listing: MarketplaceListing): ProviderCandidate {
  const target =
    `${AGENTTOOL_MARKETPLACE_ORIGIN}/public/agents/${
      encodePathSegment(listing.sellerDid)
    }`;
  return {
    kind: "agent",
    title: listing.sellerDid,
    summary: `Agent advertising “${listing.name}” in AgentTool's public capability marketplace.`,
    target_url: target,
    inspect_url: target,
    mime_type: "application/json",
    capabilities: listing.tags,
    ...(listing.createdAt ? { published_at: listing.createdAt } : {}),
    ...(listing.invocationsCount !== undefined
      ? {
          provider_score: {
            value: listing.invocationsCount,
            basis: "advertised_listing_invocations_count",
          },
        }
      : {}),
    claims: [
      publisherClaim("seller.did", listing.sellerDid),
      publisherClaim("advertised_listing.id", listing.id),
      ...(listing.tags.length > 0
        ? [
            publisherClaim(
              "advertised_listing.capabilities",
              listing.tags,
            ),
          ]
        : []),
    ],
  };
}

function publisherClaim(
  key: string,
  value: string | number | readonly string[],
): ProviderClaim {
  return { key, value, basis: "publisher_assertion" };
}

function providerClaim(
  key: string,
  value: number,
): ProviderClaim {
  return { key, value, basis: "provider_assertion" };
}
