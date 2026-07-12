/** Shared, policy-bounded HTTP(S) transport for untrusted destinations.
 *
 * This module transports exact bytes. It does not parse content, decide that
 * content is trustworthy, isolate a browser, or grant a remote document any
 * authority over local network policy.
 *
 * Doctrine: docs/SAFETY-BOUNDARIES.md
 */

import { createHash } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { lookup as systemLookup } from "node:dns/promises";
import {
  BlockList,
  connect as connectTcp,
  isIP,
  type Socket,
} from "node:net";
import { performance } from "node:perf_hooks";
import {
  checkServerIdentity,
  connect as connectTls,
  type ConnectionOptions as TlsConnectionOptions,
  type TLSSocket,
} from "node:tls";

export const SAFE_NET_DEFAULT_TIMEOUT_MS = 15_000;
export const SAFE_NET_DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
export const SAFE_NET_HARD_MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const SAFE_NET_HARD_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
export const SAFE_NET_MAX_DNS_ANSWERS = 32;
export const SAFE_NET_MAX_REDIRECTS = 5;
export const SAFE_NET_MAX_CONCURRENT_REQUESTS = 16;
export const SAFE_NET_MAX_QUEUED_REQUESTS = 64;
export const SAFE_NET_ADMISSION_QUEUE_TIMEOUT_MS = 1_000;
const SAFE_NET_MAX_CONNECTION_ATTEMPTS = 4;
const SAFE_NET_MAX_RESPONSE_FRAGMENTS = 4_096;
export const SAFE_NET_MAX_HTTP_CHUNKS = 4_096;
const SAFE_NET_MAX_CHUNK_FRAMING_BYTES = 256 * 1024;
const SAFE_NET_BODY_SLAB_BYTES = 64 * 1024;

export type SafeNetProtocol = "http:" | "https:";
export type SafeNetMethod = "GET" | "POST";
export type SafeNetRedirectPolicy = "error" | "follow";

export type SafeNetErrorCode =
  | "safe_net_invalid_url"
  | "safe_net_protocol_not_allowed"
  | "safe_net_url_credentials_forbidden"
  | "safe_net_url_fragment_forbidden"
  | "safe_net_url_host_required"
  | "safe_net_destination_not_public"
  | "safe_net_dns_failed"
  | "safe_net_dns_no_addresses"
  | "safe_net_dns_too_many_addresses"
  | "safe_net_dns_family_unavailable"
  | "safe_net_connected_address_mismatch"
  | "safe_net_method_not_allowed"
  | "safe_net_invalid_limit"
  | "safe_net_request_too_large"
  | "safe_net_response_too_large"
  | "safe_net_invalid_response"
  | "safe_net_header_forbidden"
  | "safe_net_invalid_header"
  | "safe_net_content_encoding_not_identity"
  | "safe_net_content_length_invalid"
  | "safe_net_content_length_mismatch"
  | "safe_net_redirect_not_allowed"
  | "safe_net_redirect_location_invalid"
  | "safe_net_too_many_redirects"
  | "safe_net_overloaded"
  | "safe_net_response_aborted"
  | "safe_net_request_timeout"
  | "safe_net_aborted";

export class SafeNetError extends Error {
  readonly code: SafeNetErrorCode;

  constructor(
    code: SafeNetErrorCode,
    options: { cause?: unknown; detail?: string } = {},
  ) {
    super(
      options.detail ? `${code}: ${options.detail}` : code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "SafeNetError";
    this.code = code;
  }
}

function fail(
  code: SafeNetErrorCode,
  options?: { cause?: unknown; detail?: string },
): never {
  throw new SafeNetError(code, options);
}

const NON_PUBLIC_ADDRESSES = new BlockList();

// Conservative public-Web policy derived from the IANA special-purpose
// registries (last reviewed 2026-07-11). Globally reachable exceptions inside
// a blocked parent may remain blocked: availability never widens SSRF access.
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

// Only 2000::/3 is treated as ordinary public unicast. Block its known
// special-purpose subranges as well as the complement.
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

export function isGloballyReachableAddress(address: string): boolean {
  // Zone identifiers are meaningful only relative to a local interface and
  // bypass Node's BlockList matching when left attached.
  if (address.includes("%")) return false;
  const family = isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC_ADDRESSES.check(
    address,
    family === 4 ? "ipv4" : "ipv6",
  );
}

export interface SafeNetUrlPolicy {
  protocols: readonly SafeNetProtocol[];
}

export function assertSafeNetUrl(
  value: string | URL,
  policy: SafeNetUrlPolicy,
): URL {
  if (
    !Array.isArray(policy.protocols) ||
    policy.protocols.length === 0 ||
    policy.protocols.some((protocol) =>
      protocol !== "http:" && protocol !== "https:"
    )
  ) {
    fail("safe_net_protocol_not_allowed");
  }
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch (cause) {
    fail("safe_net_invalid_url", { cause });
  }
  if (!policy.protocols.includes(url.protocol as SafeNetProtocol)) {
    fail("safe_net_protocol_not_allowed");
  }
  if (url.username || url.password) fail("safe_net_url_credentials_forbidden");
  if (url.hash) fail("safe_net_url_fragment_forbidden");
  if (!url.hostname) fail("safe_net_url_host_required");
  if (url.port === "0") fail("safe_net_invalid_url");
  if (url.href.length > 4_096) fail("safe_net_invalid_url");

  const literal = withoutIpv6Brackets(url.hostname);
  if (isIP(literal) !== 0 && !isGloballyReachableAddress(literal)) {
    fail("safe_net_destination_not_public");
  }
  return url;
}

export type SafeNetDnsLookup = (
  hostname: string,
) => Promise<LookupAddress[]>;

const defaultDnsLookup: SafeNetDnsLookup = async (hostname) =>
  systemLookup(hostname, { all: true, verbatim: true });

export async function resolveGloballyReachableAddresses(
  hostname: string,
  lookup: SafeNetDnsLookup = defaultDnsLookup,
): Promise<LookupAddress[]> {
  const normalized = withoutIpv6Brackets(hostname).replace(/\.$/u, "");
  const literalFamily = isIP(normalized);
  if (literalFamily !== 0) {
    if (!isGloballyReachableAddress(normalized)) {
      fail("safe_net_destination_not_public");
    }
    return [{ address: normalized, family: literalFamily }];
  }

  let answers: LookupAddress[];
  try {
    answers = await lookup(normalized);
  } catch (cause) {
    if (cause instanceof SafeNetError) throw cause;
    fail("safe_net_dns_failed", {
      cause,
      detail: cause instanceof Error ? cause.message : "lookup failed",
    });
  }
  if (answers.length === 0) fail("safe_net_dns_no_addresses");
  if (answers.length > SAFE_NET_MAX_DNS_ANSWERS) {
    fail("safe_net_dns_too_many_addresses");
  }

  const unique = new Map<string, LookupAddress>();
  for (const answer of answers) {
    const family = isIP(answer.address);
    if (
      (family !== 4 && family !== 6) ||
      !isGloballyReachableAddress(answer.address)
    ) {
      fail("safe_net_destination_not_public");
    }
    unique.set(`${family}:${answer.address}`, {
      address: answer.address,
      family,
    });
  }
  return [...unique.values()];
}

export type SafeNetHeaders = Record<
  string,
  string | string[] | undefined
>;

export interface SafeNetWireResponse {
  statusCode: number;
  headers?: SafeNetHeaders;
  body: Buffer;
  connectedAddress?: string;
}

export interface SafeNetSocketFactoryOptions {
  url: URL;
  address: LookupAddress;
  port: number;
  tlsServername: string;
}

export type SafeNetSocketFactory = (
  options: SafeNetSocketFactoryOptions,
) => Socket | TLSSocket;

export interface SafeNetRequestOnceOptions {
  url: URL;
  addresses: LookupAddress[];
  method: SafeNetMethod;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
  maxResponseBytes: number;
  signal: AbortSignal;
  /** Test seam for the built-in wire transport; production callers omit it. */
  socketFactory?: SafeNetSocketFactory;
}

export type SafeNetRequestOnce = (
  options: SafeNetRequestOnceOptions,
) => Promise<SafeNetWireResponse>;

export interface SafeNetReceipt {
  requested_origin: string;
  final_origin: string;
  status_code: number;
  bytes: number;
  sha256: string;
  redirects: number;
  connected_address?: string;
  elapsed_ms: number;
}

export interface SafeNetResponse extends SafeNetWireResponse {
  headers: SafeNetHeaders;
  receipt: SafeNetReceipt;
}

export type SafeNetAdmissionRelease = () => void;

export interface SafeNetAdmissionGate {
  acquire(signal: AbortSignal): Promise<SafeNetAdmissionRelease>;
}

export interface SafeNetRequestOptions {
  method?: SafeNetMethod;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  protocols?: readonly SafeNetProtocol[];
  redirect?: SafeNetRedirectPolicy;
  maxRedirects?: number;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
  lookup?: SafeNetDnsLookup;
  requestOnce?: SafeNetRequestOnce;
  /** Test seam. Production callers share the process-wide default gate. */
  admission?: SafeNetAdmissionGate;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
]);

const CROSS_ORIGIN_REDIRECT_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "user-agent",
]);

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/u;
const MAX_HEADER_BYTES = 32 * 1024;

function validateBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("safe_net_invalid_limit");
  }
  return value;
}

function sanitizeRequestHeaders(
  input: Record<string, string>,
  body: Buffer | undefined,
): Record<string, string> {
  const output: Record<string, string> = {};
  const names = new Set<string>();
  let aggregateBytes = 0;
  for (const [name, value] of Object.entries(input)) {
    const lower = name.toLowerCase();
    if (
      !HEADER_NAME.test(lower) ||
      typeof value !== "string" ||
      names.has(lower)
    ) {
      fail("safe_net_invalid_header");
    }
    names.add(lower);
    if (!/^[\x09\x20-\x7e\x80-\xff]*$/u.test(value)) {
      fail("safe_net_invalid_header");
    }
    if (CREDENTIAL_HEADERS.has(lower)) fail("safe_net_header_forbidden");
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "accept-encoding") continue;
    aggregateBytes += Buffer.byteLength(lower) + Buffer.byteLength(value);
    if (aggregateBytes > MAX_HEADER_BYTES) fail("safe_net_invalid_header");
    output[lower] = value;
  }
  output["accept-encoding"] = "identity";
  if (body) output["content-length"] = String(body.length);
  return output;
}

function headersAfterRedirect(
  headers: Record<string, string>,
  from: URL,
  to: URL,
): Record<string, string> {
  if (from.origin === to.origin) return headers;
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) =>
      CROSS_ORIGIN_REDIRECT_HEADERS.has(name)
    ),
  );
}

function singleHeader(
  headers: SafeNetHeaders,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (Array.isArray(direct)) fail("safe_net_invalid_header");
  if (direct !== undefined) return direct;
  for (const [candidate, value] of Object.entries(headers)) {
    if (candidate.toLowerCase() !== name) continue;
    if (Array.isArray(value)) fail("safe_net_invalid_header");
    return value;
  }
  return undefined;
}

function validateResponseHeaders(headers: SafeNetHeaders): void {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    fail("safe_net_invalid_header");
  }
  const names = new Set<string>();
  let aggregateBytes = 0;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(lower) || names.has(lower)) {
      fail("safe_net_invalid_header");
    }
    names.add(lower);
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined) continue;
      if (typeof item !== "string" || /\r|\n/u.test(item)) {
        fail("safe_net_invalid_header");
      }
      aggregateBytes += Buffer.byteLength(lower) + Buffer.byteLength(item);
      if (aggregateBytes > MAX_HEADER_BYTES) fail("safe_net_invalid_header");
    }
  }
}

function validateWireResponse(
  response: SafeNetWireResponse,
  maximum: number,
): void {
  if (
    !Number.isInteger(response.statusCode) ||
    response.statusCode < 100 ||
    response.statusCode > 599 ||
    !Buffer.isBuffer(response.body)
  ) {
    fail("safe_net_invalid_response");
  }
  if (response.body.length > maximum) fail("safe_net_response_too_large");
  validateResponseHeaders(response.headers ?? {});
}

function validateResponseRepresentation(
  response: SafeNetWireResponse,
  maximum: number,
): void {
  const headers = response.headers ?? {};
  const encoding = singleHeader(headers, "content-encoding");
  if (encoding && encoding.trim().toLowerCase() !== "identity") {
    fail("safe_net_content_encoding_not_identity");
  }
  const length = singleHeader(headers, "content-length");
  if (length !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/u.test(length)) {
      fail("safe_net_content_length_invalid");
    }
    const declared = Number(length);
    if (!Number.isSafeInteger(declared)) fail("safe_net_content_length_invalid");
    // RFC 9110 permits a 304 to advertise the size a selected 200 response
    // would have had even though no representation bytes are transmitted.
    if (response.statusCode === 304) return;
    if (declared > maximum) fail("safe_net_response_too_large");
    if (declared !== response.body.length) {
      fail("safe_net_content_length_mismatch");
    }
  }
}

function normalizeConnectedAddress(address: string): string {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address);
  if (dotted && isIP(dotted[1]!) === 4) return dotted[1]!;

  const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(
    address,
  );
  if (!hexadecimal) return address;
  const high = Number.parseInt(hexadecimal[1]!, 16);
  const low = Number.parseInt(hexadecimal[2]!, 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join(".");
}

function assertConnectedAddress(
  address: string | undefined,
  addresses: LookupAddress[],
): void {
  if (!address) {
    fail("safe_net_connected_address_mismatch");
  }
  const normalized = normalizeConnectedAddress(address);
  if (!isGloballyReachableAddress(normalized)) {
    fail("safe_net_connected_address_mismatch");
  }
  const family = isIP(normalized);
  const allowed = new BlockList();
  for (const candidate of addresses) {
    allowed.addAddress(
      candidate.address,
      candidate.family === 4 ? "ipv4" : "ipv6",
    );
  }
  if (!allowed.check(normalized, family === 4 ? "ipv4" : "ipv6")) {
    fail("safe_net_connected_address_mismatch");
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CLOSED_BEFORE_HTTP_HANDOFF = new WeakSet<object>();

type SafeNetSocket = Socket | TLSSocket;

interface ParsedResponseHead {
  statusCode: number;
  headers: SafeNetHeaders;
}

function parseResponseHead(block: Buffer): ParsedResponseHead {
  const lines = block.toString("latin1").split("\r\n");
  const statusLine = lines.shift() ?? "";
  const status = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?:[ \t][\x20-\x7e\x80-\xff]*)?$/u.exec(
    statusLine,
  );
  if (!status) fail("safe_net_invalid_response");

  const headers: SafeNetHeaders = {};
  for (const line of lines) {
    if (!line || /^[ \t]/u.test(line)) fail("safe_net_invalid_header");
    const separator = line.indexOf(":");
    if (separator <= 0) fail("safe_net_invalid_header");
    const name = line.slice(0, separator).toLowerCase();
    const rawValue = line.slice(separator + 1);
    const value = rawValue.trim();
    if (
      !HEADER_NAME.test(name) ||
      /[\x00-\x08\x0a-\x1f\x7f]/u.test(rawValue)
    ) {
      fail("safe_net_invalid_header");
    }
    const current = headers[name];
    if (current === undefined) headers[name] = value;
    else if (Array.isArray(current)) current.push(value);
    else headers[name] = [current, value];
  }
  validateResponseHeaders(headers);
  return { statusCode: Number(status[1]), headers };
}

function validateTrailerLine(line: string): void {
  if (!line || /^[ \t]/u.test(line)) fail("safe_net_invalid_header");
  const separator = line.indexOf(":");
  if (separator <= 0) fail("safe_net_invalid_header");
  const name = line.slice(0, separator).toLowerCase();
  const rawValue = line.slice(separator + 1);
  if (
    !HEADER_NAME.test(name) ||
    /[\x00-\x08\x0a-\x1f\x7f]/u.test(rawValue)
  ) {
    fail("safe_net_invalid_header");
  }
}

const defaultSafeNetSocketFactory: SafeNetSocketFactory = ({
  url,
  address,
  port,
  tlsServername,
}) => url.protocol === "https:"
  ? connectTls({
    host: address.address,
    port,
    family: address.family === 6 ? 6 : 4,
    ...(isIP(tlsServername) === 0 ? { servername: tlsServername } : {}),
    rejectUnauthorized: true,
    ALPNProtocols: ["http/1.1"],
  } as TlsConnectionOptions)
  : connectTcp({
    host: address.address,
    port,
    family: address.family === 6 ? 6 : 4,
  });

function connectPinnedSocket(
  url: URL,
  addresses: LookupAddress[],
  timeoutMs: number,
  signal: AbortSignal,
  socketFactory: SafeNetSocketFactory,
): Promise<{ socket: SafeNetSocket; connectedAddress: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let failures = 0;
    let active = 0;
    let nextAddress = 0;
    let lastError: unknown = new SafeNetError("safe_net_response_aborted");
    const candidates: SafeNetSocket[] = [];

    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const failConnection = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      for (const candidate of candidates) candidate.destroy();
      reject(error);
    };
    const abort = (): void => failConnection(abortReason(signal));
    const timer = setTimeout(() => failConnection(
      new SafeNetError("safe_net_request_timeout"),
    ), timeoutMs);

    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });

    const port = url.port
      ? Number(url.port)
      : url.protocol === "https:"
        ? 443
        : 80;
    const tlsServername = withoutIpv6Brackets(url.hostname).replace(/\.$/u, "");

    const startMore = (): void => {
      while (
        !settled &&
        active < SAFE_NET_MAX_CONNECTION_ATTEMPTS &&
        nextAddress < addresses.length
      ) {
        const address = addresses[nextAddress++]!;
        let candidate: SafeNetSocket;
        try {
          candidate = socketFactory({
            url,
            address,
            port,
            tlsServername,
          });
        } catch (error) {
          failures += 1;
          lastError = error;
          continue;
        }
        candidates.push(candidate);
        active += 1;
        let candidateDone = false;
        const readyEvent = url.protocol === "https:"
          ? "secureConnect"
          : "connect";
        const failed = (error: unknown): void => {
          if (candidateDone || settled) return;
          candidateDone = true;
          active -= 1;
          candidate.destroy();
          failures += 1;
          lastError = error;
          startMore();
          if (failures === addresses.length && active === 0) {
            failConnection(lastError);
          }
        };
        candidate.once("error", failed);
        candidate.once("close", () => {
          if (candidateDone) {
            CLOSED_BEFORE_HTTP_HANDOFF.add(candidate);
            return;
          }
          failed(new SafeNetError("safe_net_response_aborted"));
        });
        candidate.once(readyEvent, () => {
          if (candidateDone || settled) return;
          try {
            if (url.protocol === "https:") {
              const tlsCandidate = candidate as TLSSocket;
              if (tlsCandidate.authorized === false) {
                throw tlsCandidate.authorizationError ?? new Error(
                  "TLS peer certificate was not authorized",
                );
              }
              if (typeof tlsCandidate.getPeerCertificate !== "function") {
                fail("safe_net_invalid_response");
              }
              const identityError = checkServerIdentity(
                tlsServername,
                tlsCandidate.getPeerCertificate(true),
              );
              if (identityError) throw identityError;
              if (
                tlsCandidate.alpnProtocol &&
                tlsCandidate.alpnProtocol !== "http/1.1"
              ) {
                fail("safe_net_invalid_response");
              }
            }
            assertConnectedAddress(candidate.remoteAddress, [address]);
          } catch (error) {
            failed(error);
            return;
          }
          candidateDone = true;
          active -= 1;
          settled = true;
          cleanup();
          for (const other of candidates) {
            if (other !== candidate) other.destroy();
          }
          resolve({
            socket: candidate,
            connectedAddress: candidate.remoteAddress!,
          });
        });
      }

      if (
        !settled &&
        nextAddress === addresses.length &&
        active === 0 &&
        failures === addresses.length
      ) {
        failConnection(lastError);
      }
    };

    startMore();
  });
}

function serializeHttp1Request(
  url: URL,
  method: SafeNetMethod,
  headers: Record<string, string>,
  body: Buffer | undefined,
): Buffer {
  if (method === "GET" && body !== undefined) {
    fail("safe_net_method_not_allowed");
  }
  const target = `${url.pathname || "/"}${url.search}`;
  const wireHeaders: Record<string, string> = {};
  const names = new Set<string>();
  let aggregateBytes = 0;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      !HEADER_NAME.test(lower) ||
      names.has(lower) ||
      typeof value !== "string" ||
      !/^[\x09\x20-\x7e\x80-\xff]*$/u.test(value)
    ) {
      fail("safe_net_invalid_header");
    }
    names.add(lower);
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "proxy-connection" ||
      lower === "te" ||
      lower === "trailer" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      fail("safe_net_header_forbidden");
    }
    if (lower === "accept-encoding" && value.trim().toLowerCase() !== "identity") {
      fail("safe_net_content_encoding_not_identity");
    }
    if (lower === "content-length") {
      const expected = body?.length ?? (method === "POST" ? 0 : undefined);
      if (expected === undefined || value !== String(expected)) {
        fail("safe_net_invalid_header");
      }
    }
    aggregateBytes += Buffer.byteLength(lower) + Buffer.byteLength(value);
    if (aggregateBytes > MAX_HEADER_BYTES) fail("safe_net_invalid_header");
    wireHeaders[lower] = value;
  }
  if (method === "POST" && wireHeaders["content-length"] === undefined) {
    wireHeaders["content-length"] = "0";
  }
  const lines = [
    `${method} ${target} HTTP/1.1`,
    `Host: ${url.host}`,
    "Connection: close",
    ...Object.entries(wireHeaders).map(([name, value]) => `${name}: ${value}`),
    "",
    "",
  ];
  const head = Buffer.from(lines.join("\r\n"), "latin1");
  return body ? Buffer.concat([head, body], head.length + body.length) : head;
}

function exchangeHttp1(
  socket: SafeNetSocket,
  connectedAddress: string,
  options: SafeNetRequestOnceOptions,
  timeoutMs: number,
  requestBytes: Buffer,
): Promise<SafeNetWireResponse> {
  return new Promise((resolve, reject) => {
    type ReadState =
      | "head"
      | "fixed"
      | "close"
      | "chunk-size"
      | "chunk-data"
      | "chunk-crlf"
      | "trailers";

    let settled = false;
    let state: ReadState = "head";
    let buffer = Buffer.alloc(0);
    let statusCode = 0;
    let responseHeaders: SafeNetHeaders = {};
    let totalHeaderBytes = 0;
    let interimResponses = 0;
    let fixedRemaining = 0;
    let chunkRemaining = 0;
    let protocolChunks = 0;
    let chunkFramingBytes = 0;
    let trailerBytes = 0;
    let totalBodyBytes = 0;
    let fragments = 0;
    const bodySlabs: Array<{ buffer: Buffer; used: number }> = [];

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("close", onClose);
      socket.removeListener("error", onError);
    };
    const finishError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const materializeBody = (): Buffer => {
      if (totalBodyBytes === 0) return Buffer.alloc(0);
      return Buffer.concat(
        bodySlabs.map((slab) => slab.buffer.subarray(0, slab.used)),
        totalBodyBytes,
      );
    };
    const finish = (body = materializeBody()): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      resolve({
        statusCode,
        headers: responseHeaders,
        body,
        connectedAddress,
      });
    };
    const abort = (): void => finishError(abortReason(options.signal));
    const timer = setTimeout(() => finishError(
      new SafeNetError("safe_net_request_timeout"),
    ), timeoutMs);

    const appendBody = (chunk: Buffer): boolean => {
      if (chunk.length === 0) return true;
      if (totalBodyBytes + chunk.length > options.maxResponseBytes) {
        finishError(new SafeNetError("safe_net_response_too_large"));
        return false;
      }
      let offset = 0;
      while (offset < chunk.length) {
        let slab = bodySlabs[bodySlabs.length - 1];
        if (!slab || slab.used === slab.buffer.length) {
          const capacity = Math.min(
            SAFE_NET_BODY_SLAB_BYTES,
            options.maxResponseBytes - totalBodyBytes,
          );
          slab = { buffer: Buffer.allocUnsafe(capacity), used: 0 };
          bodySlabs.push(slab);
        }
        const take = Math.min(
          chunk.length - offset,
          slab.buffer.length - slab.used,
        );
        chunk.copy(slab.buffer, slab.used, offset, offset + take);
        slab.used += take;
        offset += take;
        totalBodyBytes += take;
      }
      return true;
    };

    const process = (): void => {
      try {
        while (!settled) {
          if (state === "head") {
            const end = buffer.indexOf("\r\n\r\n");
            if (end < 0) {
              if (totalHeaderBytes + buffer.length > MAX_HEADER_BYTES) {
                fail("safe_net_invalid_header");
              }
              return;
            }
            const consumed = end + 4;
            totalHeaderBytes += consumed;
            if (totalHeaderBytes > MAX_HEADER_BYTES) {
              fail("safe_net_invalid_header");
            }
            const parsed = parseResponseHead(buffer.subarray(0, end));
            buffer = buffer.subarray(consumed);
            if (parsed.statusCode < 200) {
              interimResponses += 1;
              if (parsed.statusCode === 101 || interimResponses > 8) {
                fail("safe_net_invalid_response");
              }
              continue;
            }

            statusCode = parsed.statusCode;
            responseHeaders = parsed.headers;
            if (REDIRECT_STATUSES.has(statusCode)) {
              finish(Buffer.alloc(0));
              return;
            }

            const encoding = singleHeader(
              responseHeaders,
              "content-encoding",
            );
            if (encoding && encoding.trim().toLowerCase() !== "identity") {
              fail("safe_net_content_encoding_not_identity");
            }
            const transferEncoding = singleHeader(
              responseHeaders,
              "transfer-encoding",
            );
            const contentLength = singleHeader(
              responseHeaders,
              "content-length",
            );
            if (transferEncoding !== undefined && contentLength !== undefined) {
              fail("safe_net_invalid_response");
            }
            if (statusCode === 204 || statusCode === 304) {
              finish(Buffer.alloc(0));
              return;
            }
            if (transferEncoding !== undefined) {
              if (transferEncoding.trim().toLowerCase() !== "chunked") {
                fail("safe_net_invalid_response");
              }
              state = "chunk-size";
              continue;
            }
            if (contentLength !== undefined) {
              if (!/^(0|[1-9][0-9]*)$/u.test(contentLength)) {
                fail("safe_net_content_length_invalid");
              }
              fixedRemaining = Number(contentLength);
              if (!Number.isSafeInteger(fixedRemaining)) {
                fail("safe_net_content_length_invalid");
              }
              if (fixedRemaining > options.maxResponseBytes) {
                fail("safe_net_response_too_large");
              }
              if (fixedRemaining === 0) {
                finish(Buffer.alloc(0));
                return;
              }
              state = "fixed";
              continue;
            }
            state = "close";
            continue;
          }

          if (state === "fixed") {
            if (buffer.length === 0) return;
            const take = Math.min(buffer.length, fixedRemaining);
            if (!appendBody(buffer.subarray(0, take))) return;
            buffer = buffer.subarray(take);
            fixedRemaining -= take;
            if (fixedRemaining === 0) {
              finish();
              return;
            }
            continue;
          }

          if (state === "close") {
            if (buffer.length > 0) {
              const chunk = buffer;
              buffer = Buffer.alloc(0);
              if (!appendBody(chunk)) return;
            }
            return;
          }

          if (state === "chunk-size") {
            const end = buffer.indexOf("\r\n");
            if (end < 0) {
              if (buffer.length > 1_024) fail("safe_net_invalid_response");
              return;
            }
            if (end > 1_024) fail("safe_net_invalid_response");
            chunkFramingBytes += end + 2;
            if (chunkFramingBytes > SAFE_NET_MAX_CHUNK_FRAMING_BYTES) {
              fail("safe_net_invalid_response");
            }
            const line = buffer.subarray(0, end).toString("latin1");
            buffer = buffer.subarray(end + 2);
            if (!/^[0-9a-f]+(?:;[\x20-\x7e]*)?$/iu.test(line)) {
              fail("safe_net_invalid_response");
            }
            const digits = line.split(";", 1)[0]!;
            const size = BigInt(`0x${digits}`);
            if (size > BigInt(options.maxResponseBytes - totalBodyBytes)) {
              fail("safe_net_response_too_large");
            }
            chunkRemaining = Number(size);
            if (!Number.isSafeInteger(chunkRemaining)) {
              fail("safe_net_response_too_large");
            }
            if (chunkRemaining > 0) {
              protocolChunks += 1;
              if (protocolChunks > SAFE_NET_MAX_HTTP_CHUNKS) {
                fail("safe_net_invalid_response");
              }
            }
            state = chunkRemaining === 0 ? "trailers" : "chunk-data";
            continue;
          }

          if (state === "chunk-data") {
            if (buffer.length === 0) return;
            const take = Math.min(buffer.length, chunkRemaining);
            if (!appendBody(buffer.subarray(0, take))) return;
            buffer = buffer.subarray(take);
            chunkRemaining -= take;
            if (chunkRemaining === 0) state = "chunk-crlf";
            continue;
          }

          if (state === "chunk-crlf") {
            if (buffer.length < 2) return;
            if (buffer[0] !== 13 || buffer[1] !== 10) {
              fail("safe_net_invalid_response");
            }
            chunkFramingBytes += 2;
            if (chunkFramingBytes > SAFE_NET_MAX_CHUNK_FRAMING_BYTES) {
              fail("safe_net_invalid_response");
            }
            buffer = buffer.subarray(2);
            state = "chunk-size";
            continue;
          }

          const end = buffer.indexOf("\r\n");
          if (end < 0) {
            if (trailerBytes + buffer.length > MAX_HEADER_BYTES) {
              fail("safe_net_invalid_header");
            }
            return;
          }
          trailerBytes += end + 2;
          if (trailerBytes > MAX_HEADER_BYTES) fail("safe_net_invalid_header");
          const line = buffer.subarray(0, end).toString("latin1");
          buffer = buffer.subarray(end + 2);
          if (line === "") {
            finish();
            return;
          }
          validateTrailerLine(line);
        }
      } catch (error) {
        finishError(error);
      }
    };

    function onData(value: Buffer | Uint8Array): void {
      if (settled) return;
      fragments += 1;
      if (fragments > SAFE_NET_MAX_RESPONSE_FRAGMENTS) {
        finishError(new SafeNetError("safe_net_response_too_large"));
        return;
      }
      const chunk = Buffer.from(value);
      buffer = buffer.length === 0
        ? chunk
        : Buffer.concat([buffer, chunk], buffer.length + chunk.length);
      process();
    }
    function onEnd(): void {
      if (settled) return;
      if (state === "close") finish();
      else if (state === "fixed") {
        finishError(new SafeNetError("safe_net_content_length_mismatch"));
      } else finishError(new SafeNetError("safe_net_response_aborted"));
    }
    function onClose(hadError: boolean): void {
      if (settled) return;
      if (!hadError && state === "close") finish();
      else finishError(new SafeNetError("safe_net_response_aborted"));
    }
    function onError(error: Error): void {
      finishError(error);
    }

    if (
      CLOSED_BEFORE_HTTP_HANDOFF.has(socket) ||
      socket.destroyed ||
      socket.readableEnded
    ) {
      finishError(new SafeNetError("safe_net_response_aborted"));
      return;
    }
    if (options.signal.aborted) {
      abort();
      return;
    }
    options.signal.addEventListener("abort", abort, { once: true });
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("close", onClose);
    socket.once("error", onError);
    try {
      socket.write(requestBytes);
    } catch (error) {
      finishError(error);
    }
  });
}

/**
 * The built-in one-request transport. It opens TCP/TLS directly to the frozen
 * DNS answer set, uses the original hostname for TLS identity, and parses a
 * bounded HTTP/1.1 response. Exported for compatibility facades
 * that need a legacy wire-header profile while retaining the shared socket,
 * peer-address, abort, redirect-teardown, and streaming-limit invariants.
 */
export const defaultSafeNetRequestOnce: SafeNetRequestOnce = async (options) => {
  const requestBytes = serializeHttp1Request(
    options.url,
    options.method,
    options.headers,
    options.body,
  );
  const started = performance.now();
  const { socket, connectedAddress } = await connectPinnedSocket(
    options.url,
    options.addresses,
    options.timeoutMs,
    options.signal,
    options.socketFactory ?? defaultSafeNetSocketFactory,
  );
  const remaining = options.timeoutMs - (performance.now() - started);
  if (remaining <= 0) {
    socket.destroy();
    fail("safe_net_request_timeout");
  }
  return exchangeHttp1(
    socket,
    connectedAddress,
    options,
    Math.max(1, Math.ceil(remaining)),
    requestBytes,
  );
};

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof SafeNetError
    ? signal.reason
    : new SafeNetError("safe_net_aborted");
}

interface SafeNetAdmissionWaiter {
  signal: AbortSignal;
  resolve: (release: SafeNetAdmissionRelease) => void;
  onAbort: () => void;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
}

/**
 * Bounds aggregate DNS/socket work in this process. One permit covers the
 * complete request, including every redirect hop. This is capacity admission,
 * not caller fairness or a project rate limiter.
 */
export function createSafeNetAdmissionGate(
  options: {
    maxConcurrent?: number;
    maxQueued?: number;
    queueTimeoutMs?: number;
  } = {},
): SafeNetAdmissionGate {
  const maxConcurrent =
    options.maxConcurrent ?? SAFE_NET_MAX_CONCURRENT_REQUESTS;
  const maxQueued = options.maxQueued ?? SAFE_NET_MAX_QUEUED_REQUESTS;
  const queueTimeoutMs =
    options.queueTimeoutMs ?? SAFE_NET_ADMISSION_QUEUE_TIMEOUT_MS;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError("safe-net maxConcurrent must be a positive integer");
  }
  if (!Number.isInteger(maxQueued) || maxQueued < 0) {
    throw new RangeError("safe-net maxQueued must be a non-negative integer");
  }
  if (!Number.isInteger(queueTimeoutMs) || queueTimeoutMs < 1) {
    throw new RangeError("safe-net queueTimeoutMs must be a positive integer");
  }

  let active = 0;
  const queue: SafeNetAdmissionWaiter[] = [];

  const makeRelease = (): SafeNetAdmissionRelease => {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      while (queue.length > 0) {
        const waiter = queue.shift()!;
        if (waiter.settled) continue;
        waiter.settled = true;
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        // Transfer the live permit directly to the oldest queued request.
        waiter.resolve(makeRelease());
        return;
      }
      active -= 1;
    };
  };

  return {
    acquire(signal) {
      if (signal.aborted) return Promise.reject(abortReason(signal));
      if (active < maxConcurrent) {
        active += 1;
        return Promise.resolve(makeRelease());
      }
      if (queue.length >= maxQueued) {
        return Promise.reject(new SafeNetError("safe_net_overloaded"));
      }

      return new Promise<SafeNetAdmissionRelease>((resolve, reject) => {
        const waiter: SafeNetAdmissionWaiter = {
          signal,
          resolve,
          onAbort: () => {},
          timer: undefined,
          settled: false,
        };
        const rejectQueued = (error: Error): void => {
          if (waiter.settled) return;
          waiter.settled = true;
          if (waiter.timer) clearTimeout(waiter.timer);
          signal.removeEventListener("abort", waiter.onAbort);
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          reject(error);
        };
        waiter.onAbort = () => rejectQueued(abortReason(signal));
        waiter.timer = setTimeout(() => {
          rejectQueued(new SafeNetError("safe_net_overloaded"));
        }, queueTimeoutMs);
        waiter.timer?.unref?.();
        signal.addEventListener("abort", waiter.onAbort, { once: true });
        queue.push(waiter);
        if (signal.aborted) waiter.onAbort();
      });
    },
  };
}

const defaultSafeNetAdmission = createSafeNetAdmissionGate();

async function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(abortReason(signal));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

function redirectLocation(response: SafeNetWireResponse): string {
  const location = singleHeader(response.headers ?? {}, "location");
  if (!location) fail("safe_net_redirect_location_invalid");
  return location;
}

export async function safeNetRequest(
  value: string | URL,
  options: SafeNetRequestOptions = {},
): Promise<SafeNetResponse> {
  const started = performance.now();
  const protocols = options.protocols ?? ["https:"] as const;
  // Validate before allocating a deadline timer so malformed policies cannot
  // leave live handles behind.
  const requested = assertSafeNetUrl(value, { protocols });
  const method = options.method ?? "GET";
  if (method !== "GET" && method !== "POST") {
    fail("safe_net_method_not_allowed");
  }
  const timeoutMs = validateBoundedInteger(
    options.timeoutMs ?? SAFE_NET_DEFAULT_TIMEOUT_MS,
    1,
    120_000,
  );
  const maxRequestBytes = validateBoundedInteger(
    options.maxRequestBytes ?? 1_000_000,
    0,
    SAFE_NET_HARD_MAX_REQUEST_BYTES,
  );
  const maxResponseBytes = validateBoundedInteger(
    options.maxResponseBytes ?? SAFE_NET_DEFAULT_MAX_RESPONSE_BYTES,
    0,
    SAFE_NET_HARD_MAX_RESPONSE_BYTES,
  );
  const maxRedirects = validateBoundedInteger(
    options.maxRedirects ?? SAFE_NET_MAX_REDIRECTS,
    0,
    10,
  );
  const redirect = options.redirect ?? "error";
  if (redirect !== "error" && redirect !== "follow") {
    fail("safe_net_invalid_limit");
  }
  if (redirect === "follow" && method !== "GET") {
    fail("safe_net_method_not_allowed");
  }

  const body = options.body === undefined
    ? undefined
    : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(options.body);
  // GET bodies have no portable semantics and are especially unsafe across
  // redirects, where replay could disclose caller-controlled bytes to a new
  // origin. Callers that need a body must use a non-redirectable POST.
  if (method === "GET" && body !== undefined) {
    fail("safe_net_method_not_allowed");
  }
  if (body && body.length > maxRequestBytes) fail("safe_net_request_too_large");
  let headers = sanitizeRequestHeaders(options.headers ?? {}, body);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new SafeNetError("safe_net_request_timeout"));
  }, timeoutMs);
  const externalAbort = (): void => {
    controller.abort(new SafeNetError("safe_net_aborted"));
  };
  if (options.signal?.aborted) externalAbort();
  else options.signal?.addEventListener("abort", externalAbort, { once: true });

  let current = requested;
  let redirects = 0;
  let releaseAdmission: SafeNetAdmissionRelease | undefined;
  try {
    releaseAdmission = await (options.admission ?? defaultSafeNetAdmission)
      .acquire(controller.signal);
    while (true) {
      if (controller.signal.aborted) throw abortReason(controller.signal);
      const addresses = await raceWithAbort(
        resolveGloballyReachableAddresses(current.hostname, options.lookup),
        controller.signal,
      );
      const remaining = timeoutMs - (performance.now() - started);
      if (remaining <= 0) {
        controller.abort(new SafeNetError("safe_net_request_timeout"));
        throw abortReason(controller.signal);
      }
      const remainingMs = Math.max(1, Math.ceil(remaining));
      if (controller.signal.aborted) throw abortReason(controller.signal);
      const response = await raceWithAbort(
        (options.requestOnce ?? defaultSafeNetRequestOnce)({
          url: current,
          addresses,
          method,
          headers,
          body,
          timeoutMs: remainingMs,
          maxResponseBytes,
          signal: controller.signal,
        }),
        controller.signal,
      );
      validateWireResponse(response, maxResponseBytes);
      if (response.connectedAddress !== undefined) {
        assertConnectedAddress(response.connectedAddress, addresses);
      }

      if (!REDIRECT_STATUSES.has(response.statusCode)) {
        validateResponseRepresentation(response, maxResponseBytes);
        return {
          ...response,
          headers: response.headers ?? {},
          receipt: {
            requested_origin: requested.origin,
            final_origin: current.origin,
            status_code: response.statusCode,
            bytes: response.body.length,
            sha256: createHash("sha256").update(response.body).digest("hex"),
            redirects,
            ...(response.connectedAddress
              ? { connected_address: response.connectedAddress }
              : {}),
            elapsed_ms: Math.max(0, Math.round(performance.now() - started)),
          },
        };
      }

      if (redirect === "error") fail("safe_net_redirect_not_allowed");
      if (redirects >= maxRedirects) fail("safe_net_too_many_redirects");
      let next: URL;
      try {
        next = assertSafeNetUrl(new URL(redirectLocation(response), current), {
          protocols,
        });
      } catch (cause) {
        if (cause instanceof SafeNetError) throw cause;
        fail("safe_net_redirect_location_invalid", { cause });
      }
      headers = headersAfterRedirect(headers, current, next);
      current = next;
      redirects += 1;
    }
  } finally {
    releaseAdmission?.();
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }
}

export async function safeNetGet(
  value: string | URL,
  options: Omit<SafeNetRequestOptions, "method" | "body"> = {},
): Promise<SafeNetResponse> {
  return safeNetRequest(value, { ...options, method: "GET" });
}
