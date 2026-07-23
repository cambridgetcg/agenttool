import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BrowserError } from "./errors.js";
import type { ResolveHostname, ResolvedAddress } from "./types.js";

export type DestinationClass = "public" | "local" | "reserved";

export interface BrowserNetworkPolicyOptions {
  allowPublicWeb?: boolean;
  allowLocalNetwork?: boolean;
  resolveHostname?: ResolveHostname;
}

export interface NetworkBoundary {
  mode: "local_browser_public_web";
  publicWeb: boolean;
  localNetwork: boolean;
  schemes: readonly ["http", "https"];
  urlCredentials: "blocked";
  dnsPreflight: true;
  connectionAddressPinning: false;
  webSockets: "blocked";
  statement: string;
}

export async function defaultResolveHostname(
  hostname: string,
): Promise<readonly ResolvedAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

/**
 * Construction-fixed navigation policy.
 *
 * DNS checks are a useful local safety boundary, not an SSRF sandbox. Chromium
 * performs its own DNS resolution after this check, so DNS rebinding creates a
 * time-of-check/time-of-use gap and the connected address is not pinned.
 */
export class BrowserNetworkPolicy {
  readonly boundary: NetworkBoundary;
  private readonly allowPublicWeb: boolean;
  private readonly allowLocalNetwork: boolean;
  private readonly resolveHostname: ResolveHostname;

  constructor(options: BrowserNetworkPolicyOptions = {}) {
    this.allowPublicWeb = options.allowPublicWeb ?? true;
    this.allowLocalNetwork = options.allowLocalNetwork ?? false;
    this.resolveHostname = options.resolveHostname ?? defaultResolveHostname;
    this.boundary = Object.freeze({
      mode: "local_browser_public_web",
      publicWeb: this.allowPublicWeb,
      localNetwork: this.allowLocalNetwork,
      schemes: Object.freeze(["http", "https"] as const),
      urlCredentials: "blocked",
      dnsPreflight: true,
      connectionAddressPinning: false,
      webSockets: "blocked",
      statement:
        "HTTP(S) destinations are checked before browser requests; DNS preflight does not pin Chromium's connected address.",
    });
  }

  async assertAllowed(input: string | URL): Promise<URL> {
    const url = parseBrowserUrl(input);
    const hostname = normalizeHostname(url.hostname);
    const namedClass = classifySpecialHostname(hostname);
    if (namedClass) {
      this.assertClassAllowed(namedClass);
      return url;
    }

    if (isIP(hostname) !== 0) {
      this.assertClassAllowed(classifyIpAddress(hostname));
      return url;
    }

    let addresses: readonly ResolvedAddress[];
    try {
      addresses = await this.resolveHostname(hostname);
    } catch (error) {
      throw new BrowserError(
        "dns_failed",
        "Browser policy could not resolve the destination.",
        { cause: error },
      );
    }
    if (addresses.length === 0) {
      throw new BrowserError(
        "dns_failed",
        "Browser policy could not resolve the destination.",
      );
    }

    for (const address of addresses) {
      this.assertClassAllowed(classifyIpAddress(address.address));
    }
    return url;
  }

  private assertClassAllowed(destination: DestinationClass): void {
    if (destination === "reserved") {
      throw new BrowserError(
        "network_blocked",
        "Browser policy blocks reserved network destinations.",
      );
    }
    if (destination === "local" && !this.allowLocalNetwork) {
      throw new BrowserError(
        "network_blocked",
        "Browser policy blocks localhost and private network destinations by default.",
      );
    }
    if (destination === "public" && !this.allowPublicWeb) {
      throw new BrowserError(
        "network_blocked",
        "Browser policy does not permit public web destinations.",
      );
    }
  }
}

export function parseBrowserUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch (error) {
    throw new BrowserError("invalid_url", "URL must be absolute.", { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserError(
      "url_scheme_blocked",
      "Browser navigation only permits http: and https: URLs.",
    );
  }
  if (url.username || url.password) {
    throw new BrowserError(
      "url_credentials_blocked",
      "Credentials are not permitted in browser URLs.",
    );
  }
  return url;
}

/**
 * Redact query values at every structured URL boundary. Paths, fragments, and
 * screenshot pixels are outside this filter; free-form text has a separate
 * URL sanitizer.
 */
export function redactUrlForOutput(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }
  url.username = "";
  url.password = "";
  if (url.search) {
    const redacted = new URLSearchParams();
    for (const [name] of url.searchParams) redacted.append(name, "[redacted]");
    url.search = redacted.toString();
  }
  return url.href;
}

export function redactUrlsInText(input: string): string {
  return input.replace(/https?:\/\/[^\s<>"'`]+/gi, (candidate) => {
    const trailing = candidate.match(/[),.;!?]+$/)?.[0] ?? "";
    const url = trailing ? candidate.slice(0, -trailing.length) : candidate;
    return `${redactUrlForOutput(url)}${trailing}`;
  });
}

export function redactHtmlUrlAttributes(input: string): string {
  return input.replace(
    /(\s+(?:href|src|action|formaction|poster)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (_match, prefix: string, encodedValue: string) => {
      const quote =
        encodedValue.startsWith('"') || encodedValue.startsWith("'")
          ? encodedValue[0]!
          : "";
      const value = quote ? encodedValue.slice(1, -1) : encodedValue;
      return `${prefix}${quote}${redactUrlReferenceForOutput(value)}${quote}`;
    },
  );
}

/** Redact query values while preserving an absolute, protocol-relative, or relative reference. */
export function redactUrlReferenceForOutput(input: string): string {
  if (/^https?:\/\//i.test(input)) return redactUrlForOutput(input);
  if (input.startsWith("//")) {
    try {
      const redacted = new URL(redactUrlForOutput(`https:${input}`));
      return `//${redacted.host}${redacted.pathname}${redacted.search}${redacted.hash}`;
    } catch {
      // Fall through to the query-only redactor.
    }
  }
  const queryStart = input.indexOf("?");
  if (queryStart < 0) return input;
  const fragmentStart = input.indexOf("#", queryStart);
  const queryEnd = fragmentStart < 0 ? input.length : fragmentStart;
  const query = input.slice(queryStart + 1, queryEnd);
  const redacted = new URLSearchParams();
  for (const [name] of new URLSearchParams(query)) {
    redacted.append(name, "[redacted]");
  }
  return (
    `${input.slice(0, queryStart)}?${redacted.toString()}`
    + (fragmentStart < 0 ? "" : input.slice(fragmentStart))
  );
}

export function classifyIpAddress(address: string): DestinationClass {
  const normalized = address.toLowerCase().split("%", 1)[0]!;
  if (isIP(normalized) === 4) return classifyIpv4(normalized);
  if (isIP(normalized) === 6) return classifyIpv6(normalized);
  return "reserved";
}

export function isPrivateOrReservedAddress(address: string): boolean {
  return classifyIpAddress(address) !== "public";
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function classifySpecialHostname(hostname: string): DestinationClass | null {
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "local"
    || hostname.endsWith(".local")
    || hostname === "home.arpa"
    || hostname.endsWith(".home.arpa")
    || hostname === "internal"
    || hostname.endsWith(".internal")
  ) {
    return "local";
  }
  if (
    hostname === "test"
    || hostname.endsWith(".test")
    || hostname === "invalid"
    || hostname.endsWith(".invalid")
    || hostname === "example"
    || hostname.endsWith(".example")
    || hostname === "onion"
    || hostname.endsWith(".onion")
  ) {
    return "reserved";
  }
  return null;
}

function classifyIpv4(address: string): DestinationClass {
  const parts = address.split(".").map(Number);
  const [a, b, c] = parts;
  if (a === undefined || b === undefined || c === undefined) return "reserved";

  if (
    a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
  ) {
    return "local";
  }
  if (
    a === 0
    || (a === 192 && b === 0)
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  ) {
    return "reserved";
  }
  return "public";
}

function classifyIpv6(address: string): DestinationClass {
  const bytes = parseIpv6(address);
  if (!bytes) return "reserved";
  if (bytes.every((byte) => byte === 0)) return "local";
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) {
    return "local";
  }
  if ((bytes[0]! & 0xfe) === 0xfc) return "local";
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return "local";
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return "local";
  if (bytes[0] === 0xff) return "reserved";
  if (
    bytes[0] === 0x20
    && bytes[1] === 0x01
    && bytes[2] === 0x0d
    && bytes[3] === 0xb8
  ) {
    return "reserved";
  }

  const firstTenZero = bytes.slice(0, 10).every((byte) => byte === 0);
  if (firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyEmbeddedIpv4(bytes, 12);
  }
  const firstTwelveZero = bytes.slice(0, 12).every((byte) => byte === 0);
  if (firstTwelveZero) return classifyEmbeddedIpv4(bytes, 12);

  const nat64 =
    bytes[0] === 0x00
    && bytes[1] === 0x64
    && bytes[2] === 0xff
    && bytes[3] === 0x9b
    && bytes.slice(4, 12).every((byte) => byte === 0);
  if (nat64) return classifyEmbeddedIpv4(bytes, 12);

  const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
  if (sixToFour) return classifyEmbeddedIpv4(bytes, 2);

  // IANA protocol assignments, benchmarking/ORCHID ranges and documentation
  // prefixes are not ordinary global-unicast destinations.
  const protocolAssignments =
    bytes[0] === 0x20
    && bytes[1] === 0x01
    && bytes[2]! <= 0x01;
  const documentation3fff =
    bytes[0] === 0x3f
    && bytes[1] === 0xff
    && (bytes[2]! & 0xf0) === 0;
  if (protocolAssignments || documentation3fff) return "reserved";

  // Only 2000::/3 can be globally routed. All other special-purpose IPv6
  // space remains denied even when local-network access is opted in.
  return (bytes[0]! & 0xe0) === 0x20 ? "public" : "reserved";
}

function classifyEmbeddedIpv4(bytes: Uint8Array, offset: number): DestinationClass {
  return classifyIpv4(
    `${bytes[offset]!}.${bytes[offset + 1]!}.${bytes[offset + 2]!}.${bytes[offset + 3]!}`,
  );
}

function parseIpv6(address: string): Uint8Array | null {
  let input = address;
  if (input.includes(".")) {
    const separator = input.lastIndexOf(":");
    const ipv4 = input.slice(separator + 1).split(".").map(Number);
    if (
      separator < 0
      || ipv4.length !== 4
      || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return null;
    }
    input =
      `${input.slice(0, separator)}`
      + `:${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}`
      + `:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0)
    || (halves.length === 2 && missing < 1)
  ) {
    return null;
  }
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    if (!/^[a-f0-9]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}
