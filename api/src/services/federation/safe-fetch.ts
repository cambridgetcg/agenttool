/** Compatibility facade for federation's original HTTPS transport.
 *
 * The shared transport and destination policy live in ../net/safe-fetch.ts.
 * Federation keeps its established names, limits, response shape, injected
 * request seam, and federation_* error strings because callers persist or
 * surface those values.
 */

import type { LookupAddress } from "node:dns";
import { lookup as systemLookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  defaultSafeNetRequestOnce,
  isGloballyReachableAddress,
  resolveGloballyReachableAddresses,
  safeNetRequest,
  SafeNetError,
  type SafeNetRequestOnce,
} from "../net/safe-fetch";

const DEFAULT_TIMEOUT_MS = 10_000;
export const FEDERATION_MAX_REQUEST_BYTES = 1_000_000;
export const FEDERATION_MAX_RESPONSE_BYTES = 512_000;

function withoutIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicFederationAddress(address: string): boolean {
  return isGloballyReachableAddress(address);
}

/**
 * Retain the legacy URL-only assertion. Destination-address checks still
 * happen before the request through the shared transport.
 */
export function assertPublicFederationHttpsUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value.href) : new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("federation_https_required");
  }
  if (url.username || url.password) {
    throw new Error("federation_url_credentials_forbidden");
  }
  if (!url.hostname) {
    throw new Error("federation_url_host_required");
  }
  return url;
}

export type FederationDnsLookup = (
  hostname: string,
) => Promise<LookupAddress[]>;

const defaultDnsLookup: FederationDnsLookup = async (hostname) =>
  systemLookup(hostname, { all: true, verbatim: true });

function dnsFailureDetail(error: SafeNetError): string {
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return cause.message;
  const prefix = `${error.code}: `;
  return error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message;
}

function asFederationError(
  error: unknown,
  phase: "dns" | "request" = "request",
): Error {
  if (!(error instanceof SafeNetError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  switch (error.code) {
    case "safe_net_invalid_url": {
      const cause = (error as Error & { cause?: unknown }).cause;
      return cause instanceof Error ? cause : new Error("federation_invalid_url");
    }
    case "safe_net_protocol_not_allowed":
      return new Error("federation_https_required");
    case "safe_net_url_credentials_forbidden":
      return new Error("federation_url_credentials_forbidden");
    case "safe_net_url_host_required":
      return new Error("federation_url_host_required");
    case "safe_net_destination_not_public":
    case "safe_net_connected_address_mismatch":
      return new Error("federation_private_address_forbidden");
    case "safe_net_dns_failed":
      return new Error(`federation_dns_failed: ${dnsFailureDetail(error)}`);
    case "safe_net_dns_no_addresses":
      return new Error("federation_dns_no_addresses");
    case "safe_net_dns_family_unavailable": {
      const failure = new Error(
        "federation_dns_family_unavailable",
      ) as NodeJS.ErrnoException;
      failure.code = "ENOTFOUND";
      return failure;
    }
    case "safe_net_request_too_large":
      return new Error("federation_request_too_large");
    case "safe_net_response_too_large":
      return new Error("federation_response_too_large");
    case "safe_net_redirect_not_allowed":
      return new Error("federation_redirect_not_allowed");
    case "safe_net_request_timeout":
      return new Error(
        phase === "dns"
          ? "federation_dns_timeout"
          : "federation_request_timeout",
      );
    default:
      // The facade avoids the generic-only header, encoding, redirect-follow,
      // and abort surfaces. Keep any unexpected future failure in federation's
      // error namespace instead of leaking a second caller ABI.
      return new Error(error.message.replace(/^safe_net_/u, "federation_"));
  }
}

export async function resolvePublicFederationAddresses(
  hostname: string,
  lookup: FederationDnsLookup = defaultDnsLookup,
): Promise<LookupAddress[]> {
  const normalized = withoutIpv6Brackets(hostname);
  try {
    return await resolveGloballyReachableAddresses(
      normalized,
      // The shared resolver normalizes a trailing root dot. The compatibility
      // seam still gives injected lookups the exact legacy hostname.
      async () => lookup(normalized),
    );
  } catch (error) {
    throw asFederationError(error, "dns");
  }
}

export interface FederationHttpsResponse {
  statusCode: number;
  body: Buffer;
}

export type FederationHttpsMethod = "GET" | "POST";

export type FederationRequestOnce = (options: {
  url: URL;
  addresses: LookupAddress[];
  method: FederationHttpsMethod;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
  maxResponseBytes: number;
}) => Promise<FederationHttpsResponse>;

function legacyHeaders(
  input: Record<string, string>,
  body: Buffer | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const names = new Set<string>();
  let aggregateBytes = 0;
  for (const [name, value] of Object.entries(input)) {
    const lower = name.toLowerCase();
    if (
      !/^[!#$%&'*+\-.^_`|~0-9a-z]+$/u.test(lower) ||
      names.has(lower) ||
      typeof value !== "string" ||
      !/^[\x09\x20-\x7e\x80-\xff]*$/u.test(value)
    ) {
      throw new Error("federation_invalid_header");
    }
    names.add(lower);
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      continue;
    }
    aggregateBytes += Buffer.byteLength(lower) + Buffer.byteLength(value);
    if (aggregateBytes > 32 * 1024) {
      throw new Error("federation_invalid_header");
    }
    headers[lower] = value;
  }
  if (body) headers["content-length"] = String(body.length);
  return headers;
}

export async function safeFederationHttpsRequest(
  value: string | URL,
  options: {
    method?: FederationHttpsMethod;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    timeoutMs?: number;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    lookup?: FederationDnsLookup;
    requestOnce?: FederationRequestOnce;
  } = {},
): Promise<FederationHttpsResponse> {
  const url = assertPublicFederationHttpsUrl(value);
  const method = options.method ?? "GET";
  const body = options.body === undefined
    ? undefined
    : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(options.body);
  if (method === "GET" && body !== undefined) {
    throw new Error("federation_method_not_allowed");
  }
  const maxRequestBytes =
    options.maxRequestBytes ?? FEDERATION_MAX_REQUEST_BYTES;
  if (
    !Number.isSafeInteger(maxRequestBytes) ||
    maxRequestBytes < 0 ||
    (body && body.length > maxRequestBytes)
  ) {
    throw new Error("federation_request_too_large");
  }

  const headers = legacyHeaders(options.headers ?? {}, body);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? FEDERATION_MAX_RESPONSE_BYTES;
  const requestUrl = new URL(url.href);
  requestUrl.hash = "";
  const normalizedHostname = withoutIpv6Brackets(url.hostname);
  let dnsComplete = isIP(normalizedHostname) !== 0;

  const requestOnce: SafeNetRequestOnce = async ({
    url: currentUrl,
    addresses,
    timeoutMs: remainingMs,
    signal,
  }) => {
    dnsComplete = true;
    if (options.requestOnce) {
      const response = await options.requestOnce({
        url,
        addresses,
        method,
        headers,
        body,
        timeoutMs: remainingMs,
        maxResponseBytes,
      });
      // The legacy injected seam has always returned status + exact bytes.
      return { statusCode: response.statusCode, body: response.body };
    }

    // Retain federation's exact legacy headers while sharing safe-net's real
    // socket path and its peer check, abort, teardown, and byte bounds.
    return defaultSafeNetRequestOnce({
      url: currentUrl,
      addresses,
      method,
      headers,
      body,
      timeoutMs: remainingMs,
      maxResponseBytes,
      signal,
    });
  };

  try {
    const response = await safeNetRequest(requestUrl, {
      method,
      protocols: ["https:"],
      redirect: "error",
      timeoutMs,
      maxResponseBytes,
      // Body and caller headers are held by the compatibility adapter. This
      // prevents the generic profile from changing their legacy wire shape.
      lookup: async () => {
        const answers = await (options.lookup ?? defaultDnsLookup)(
          normalizedHostname,
        );
        dnsComplete = true;
        return answers;
      },
      requestOnce,
    });
    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw new Error("federation_redirect_not_allowed");
    }
    return {
      statusCode: response.statusCode,
      body: response.body,
    };
  } catch (error) {
    if (
      error instanceof SafeNetError &&
      error.code === "safe_net_request_timeout"
    ) {
      throw asFederationError(error, dnsComplete ? "request" : "dns");
    }
    throw asFederationError(error);
  }
}

export async function safeFederationHttpsGet(
  value: string | URL,
  options: {
    timeoutMs?: number;
    maxResponseBytes?: number;
    lookup?: FederationDnsLookup;
    requestOnce?: FederationRequestOnce;
  } = {},
): Promise<FederationHttpsResponse> {
  return safeFederationHttpsRequest(value, {
    ...options,
    method: "GET",
    headers: { accept: "application/json" },
  });
}
