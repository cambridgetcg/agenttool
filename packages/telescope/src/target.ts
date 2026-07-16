import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { NetworkPolicyError, TargetInputError } from "./errors.js";
import type {
  ResolveAddress,
  ResolveHostname,
  TelescopeSubject,
} from "./types.js";

const BLOCKED_V4 = new BlockList();
for (const [address, prefix] of [
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
  BLOCKED_V4.addSubnet(address, prefix, "ipv4");
}

const PUBLIC_V6 = new BlockList();
PUBLIC_V6.addSubnet("2000::", 3, "ipv6");

const BLOCKED_V6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  BLOCKED_V6.addSubnet(address, prefix, "ipv6");
}

const BLOCKED_HOST_SUFFIXES = [
  ".example",
  ".home.arpa",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
] as const;

export const defaultResolveHostname: ResolveHostname = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map(
    ({ address, family }): ResolveAddress => ({ address, family }),
  );
};

export function isGloballyReachableAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED_V4.check(address, "ipv4");
  if (family === 6) {
    return (
      PUBLIC_V6.check(address, "ipv6") && !BLOCKED_V6.check(address, "ipv6")
    );
  }
  return false;
}

function canonicalHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function assertHostnameAllowed(hostname: string): void {
  const addressCandidate =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (isIP(addressCandidate) !== 0) {
    throw new TargetInputError(
      "ip_literal_not_allowed",
      "Use a public DNS name; IP-literal targets are not accepted.",
    );
  }
  if (
    hostname.length > 253 ||
    hostname.split(".").some((label) => label.length === 0 || label.length > 63)
  ) {
    throw new TargetInputError(
      "hostname_too_long",
      "DNS names must fit the 253-character name and 63-character label limits.",
    );
  }
  if (!hostname.includes(".")) {
    throw new TargetInputError(
      "single_label_host_not_allowed",
      "Use a public, fully qualified DNS name.",
    );
  }
  if (
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    )
  ) {
    throw new TargetInputError(
      "local_or_reserved_host_not_allowed",
      "Local and reserved DNS names are outside Telescope's network boundary.",
    );
  }
}

export function normalizeTarget(input: string): TelescopeSubject {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 2_048 || trimmed !== input) {
    throw new TargetInputError(
      "invalid_target",
      "Target must be a non-empty domain or HTTPS origin without surrounding whitespace.",
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new TargetInputError(
      "invalid_target",
      "Target must be a valid domain or HTTPS origin.",
    );
  }

  if (url.protocol !== "https:") {
    throw new TargetInputError(
      "https_required",
      "Telescope scans public HTTPS origins only.",
    );
  }
  if (url.username || url.password) {
    throw new TargetInputError(
      "credentials_not_allowed",
      "Target URLs must not contain credentials.",
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new TargetInputError(
      "origin_required",
      "Pass a domain or HTTPS origin, not a path, query, or fragment.",
    );
  }
  if (url.port && url.port !== "443") {
    throw new TargetInputError(
      "unsafe_port",
      "Telescope accepts the standard HTTPS port only.",
    );
  }

  const hostname = canonicalHostname(url.hostname);
  assertHostnameAllowed(hostname);
  url.hostname = hostname;
  url.port = "";

  return {
    kind: "https_origin",
    input,
    origin: url.origin,
    hostname,
  };
}

export async function assertPublicHttpsUrl(
  input: string | URL,
  resolveHostname: ResolveHostname,
  signal?: AbortSignal,
): Promise<URL> {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new NetworkPolicyError("invalid_url", "A discovered URL is invalid.");
  }
  if (url.href.length > 2_048) {
    throw new NetworkPolicyError(
      "url_too_long",
      "A discovered URL exceeds Telescope's URL length limit.",
    );
  }

  if (url.protocol !== "https:") {
    throw new NetworkPolicyError(
      "https_required",
      "A discovered URL left the public HTTPS boundary.",
    );
  }
  if (url.username || url.password) {
    throw new NetworkPolicyError(
      "credentials_not_allowed",
      "A discovered URL contains credentials.",
    );
  }
  if (url.hash) {
    throw new NetworkPolicyError(
      "fragment_not_allowed",
      "A discovered request URL contains a fragment.",
    );
  }
  if (url.port && url.port !== "443") {
    throw new NetworkPolicyError(
      "unsafe_port",
      "A discovered URL uses a non-standard HTTPS port.",
    );
  }

  const hostname = canonicalHostname(url.hostname);
  try {
    assertHostnameAllowed(hostname);
  } catch (error) {
    if (error instanceof TargetInputError) {
      throw new NetworkPolicyError(error.code, error.message);
    }
    throw error;
  }
  url.hostname = hostname;
  url.port = "";

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const resolution = resolveHostname(hostname);
  const answers = signal
    ? await new Promise<readonly ResolveAddress[]>((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
        resolution.then(
          (value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
          },
          (error: unknown) => {
            signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      })
    : await resolution;
  if (answers.length === 0) {
    throw new NetworkPolicyError(
      "dns_no_addresses",
      "DNS returned no address records for a requested host.",
    );
  }
  if (answers.length > 32) {
    throw new NetworkPolicyError(
      "dns_answer_limit",
      "DNS returned more addresses than Telescope will evaluate.",
    );
  }
  for (const answer of answers) {
    if (!isGloballyReachableAddress(answer.address)) {
      throw new NetworkPolicyError(
        "non_public_address",
        "DNS included a private, local, documentation, or otherwise non-global address.",
      );
    }
  }
  return url;
}
