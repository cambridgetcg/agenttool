/** HTTPS transport for peer-controlled federation destinations.
 *
 * DNS answers are resolved once, all answers must be public, and the validated
 * addresses are passed directly to the socket lookup callback. Redirects are
 * refused because a DID's host is the TLS trust origin. */

import type { LookupAddress } from "node:dns";
import { lookup as systemLookup } from "node:dns/promises";
import { request } from "node:https";
import {
  BlockList,
  isIP,
  type LookupFunction,
} from "node:net";

const DEFAULT_TIMEOUT_MS = 10_000;
export const FEDERATION_MAX_REQUEST_BYTES = 1_000_000;
export const FEDERATION_MAX_RESPONSE_BYTES = 512_000;

const NON_PUBLIC_ADDRESSES = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv4");
}

// Only 2000::/3 is presently global unicast. Block the complement, then the
// special-purpose ranges that sit inside 2000::/3.
for (const [network, prefix] of [
  ["::", 3],
  ["4000::", 2],
  ["8000::", 1],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

function withoutIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicFederationAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC_ADDRESSES.check(
    address,
    family === 4 ? "ipv4" : "ipv6",
  );
}

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

export async function resolvePublicFederationAddresses(
  hostname: string,
  lookup: FederationDnsLookup = defaultDnsLookup,
): Promise<LookupAddress[]> {
  const normalized = withoutIpv6Brackets(hostname);
  const literalFamily = isIP(normalized);
  if (literalFamily !== 0) {
    if (!isPublicFederationAddress(normalized)) {
      throw new Error("federation_private_address_forbidden");
    }
    return [{ address: normalized, family: literalFamily }];
  }

  let answers: LookupAddress[];
  try {
    answers = await lookup(normalized);
  } catch (err) {
    throw new Error(`federation_dns_failed: ${(err as Error).message}`);
  }
  if (answers.length === 0) {
    throw new Error("federation_dns_no_addresses");
  }

  const unique = new Map<string, LookupAddress>();
  for (const answer of answers) {
    const family = isIP(answer.address);
    if (
      (family !== 4 && family !== 6) ||
      !isPublicFederationAddress(answer.address)
    ) {
      throw new Error("federation_private_address_forbidden");
    }
    unique.set(`${family}:${answer.address}`, {
      address: answer.address,
      family,
    });
  }
  return [...unique.values()];
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

function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === 4 || options.family === 6
      ? options.family
      : 0;
    const candidates = requestedFamily === 0
      ? addresses
      : addresses.filter((address) => address.family === requestedFamily);

    if (candidates.length === 0) {
      const error = new Error(
        "federation_dns_family_unavailable",
      ) as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }

    if (options.all) {
      callback(null, candidates);
    } else {
      const selected = candidates[0]!;
      callback(null, selected.address, selected.family);
    }
  };
}

const defaultRequestOnce: FederationRequestOnce = ({
  url,
  addresses,
  method,
  headers,
  body,
  timeoutMs,
  maxResponseBytes,
}) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers,
        lookup: pinnedLookup(addresses),
        agent: false,
        rejectUnauthorized: true,
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 300 && statusCode < 400) {
          res.resume();
          resolve({ statusCode, body: Buffer.alloc(0) });
          return;
        }

        const contentLength = Number(res.headers["content-length"] ?? NaN);
        if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
          const error = new Error("federation_response_too_large");
          res.destroy(error);
          reject(error);
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on("data", (value: Buffer | Uint8Array) => {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          totalBytes += chunk.length;
          if (totalBytes > maxResponseBytes) {
            const error = new Error("federation_response_too_large");
            res.destroy(error);
            reject(error);
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            statusCode,
            body: Buffer.concat(chunks, totalBytes),
          });
        });
        res.on("error", reject);
      },
    );

    const timer = setTimeout(() => {
      req.destroy(new Error("federation_request_timeout"));
    }, timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(body);
  });

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
  const maxRequestBytes =
    options.maxRequestBytes ?? FEDERATION_MAX_REQUEST_BYTES;
  if (body && body.length > maxRequestBytes) {
    throw new Error("federation_request_too_large");
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    const lower = name.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      continue;
    }
    headers[lower] = value;
  }
  if (body) headers["content-length"] = String(body.length);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const addresses = await withTimeout(
    resolvePublicFederationAddresses(url.hostname, options.lookup),
    timeoutMs,
    "federation_dns_timeout",
  );
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("federation_request_timeout");

  const response = await withTimeout(
    (options.requestOnce ?? defaultRequestOnce)({
      url,
      addresses,
      method,
      headers,
      body,
      timeoutMs: remainingMs,
      maxResponseBytes:
        options.maxResponseBytes ?? FEDERATION_MAX_RESPONSE_BYTES,
    }),
    remainingMs,
    "federation_request_timeout",
  );
  if (response.statusCode >= 300 && response.statusCode < 400) {
    throw new Error("federation_redirect_not_allowed");
  }
  return response;
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

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
