import { describe, expect, test } from "bun:test";

import { NetworkPolicyError, TargetInputError } from "../src/errors.js";
import {
  assertPublicHttpsUrl,
  isGloballyReachableAddress,
  normalizeTarget,
} from "../src/target.js";
import type { ResolveHostname } from "../src/types.js";

function expectTargetError(input: string, code: string): void {
  try {
    normalizeTarget(input);
    throw new Error(`Expected ${JSON.stringify(input)} to be rejected.`);
  } catch (error) {
    expect(error).toBeInstanceOf(TargetInputError);
    expect((error as TargetInputError).code).toBe(code);
  }
}

async function expectPolicyError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected network policy error ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(NetworkPolicyError);
    expect((error as NetworkPolicyError).code).toBe(code);
  }
}

describe("normalizeTarget", () => {
  test("normalizes a bare domain, case, an explicit default port, and a trailing dot", () => {
    expect(normalizeTarget("ExAmPlE.NET.")).toEqual({
      kind: "https_origin",
      input: "ExAmPlE.NET.",
      origin: "https://example.net",
      hostname: "example.net",
    });

    expect(normalizeTarget("https://EXAMPLE.net:443/")).toEqual({
      kind: "https_origin",
      input: "https://EXAMPLE.net:443/",
      origin: "https://example.net",
      hostname: "example.net",
    });
  });

  test("canonicalizes an internationalized domain to its ASCII form", () => {
    expect(normalizeTarget("https://BÜCHER.example.net./")).toEqual({
      kind: "https_origin",
      input: "https://BÜCHER.example.net./",
      origin: "https://xn--bcher-kva.example.net",
      hostname: "xn--bcher-kva.example.net",
    });
  });

  test("rejects malformed targets and target syntax outside an HTTPS origin", () => {
    for (const [input, code] of [
      ["", "invalid_target"],
      [" example.net", "invalid_target"],
      ["example.net ", "invalid_target"],
      ["https://", "invalid_target"],
      ["http://example.net", "https_required"],
      ["https://user:secret@example.net", "credentials_not_allowed"],
      ["https://example.net/a", "origin_required"],
      ["https://example.net/?q=1", "origin_required"],
      ["https://example.net/#section", "origin_required"],
      ["https://example.net:444", "unsafe_port"],
      [`https://${"a".repeat(64)}.net`, "hostname_too_long"],
      [
        `https://${Array.from({ length: 5 }, () => "a".repeat(63)).join(".")}`,
        "hostname_too_long",
      ],
      [`https://example.net/${"a".repeat(2_100)}`, "invalid_target"],
    ] as const) {
      expectTargetError(input, code);
    }
  });

  test("rejects IP literals, single-label names, and reserved DNS suffixes", () => {
    for (const [input, code] of [
      ["127.0.0.1", "ip_literal_not_allowed"],
      ["https://[::1]", "ip_literal_not_allowed"],
      ["https://[2606:4700:4700::1111]", "ip_literal_not_allowed"],
      ["intranet", "single_label_host_not_allowed"],
      ["localhost", "single_label_host_not_allowed"],
      ["service.local", "local_or_reserved_host_not_allowed"],
      ["name.example", "local_or_reserved_host_not_allowed"],
      ["sub.home.arpa", "local_or_reserved_host_not_allowed"],
      ["hidden.onion", "local_or_reserved_host_not_allowed"],
    ] as const) {
      expectTargetError(input, code);
    }
  });
});

describe("isGloballyReachableAddress", () => {
  test("accepts ordinary public IPv4 and IPv6 addresses", () => {
    expect(isGloballyReachableAddress("8.8.8.8")).toBe(true);
    expect(isGloballyReachableAddress("1.1.1.1")).toBe(true);
    expect(isGloballyReachableAddress("2606:4700:4700::1111")).toBe(true);
    expect(isGloballyReachableAddress("2620:fe::fe")).toBe(true);
  });

  test("rejects non-addresses and non-global IPv4 ranges", () => {
    for (const address of [
      "not-an-address",
      "0.1.2.3",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isGloballyReachableAddress(address)).toBe(false);
    }
  });

  test("rejects non-global, documentation, transition, and mapped IPv6 ranges", () => {
    for (const address of [
      "::",
      "::1",
      "::ffff:8.8.8.8",
      "fc00::1",
      "fe80::1",
      "2001::1",
      "2001:db8::1",
      "2002::1",
      "3fff::1",
    ]) {
      expect(isGloballyReachableAddress(address)).toBe(false);
    }
  });
});

describe("assertPublicHttpsUrl", () => {
  const publicAddress = { address: "93.184.216.34", family: 4 } as const;

  test("canonicalizes the host before DNS and preserves a discovered path and query", async () => {
    const requestedHosts: string[] = [];
    const resolveHostname: ResolveHostname = async (hostname) => {
      requestedHosts.push(hostname);
      return [publicAddress];
    };

    const result = await assertPublicHttpsUrl(
      "https://BÜCHER.example.net./discovery?q=1",
      resolveHostname,
    );

    expect(result.href).toBe("https://xn--bcher-kva.example.net/discovery?q=1");
    expect(requestedHosts).toEqual(["xn--bcher-kva.example.net"]);
  });

  test("requires every DNS answer to be globally reachable", async () => {
    const resolveHostname: ResolveHostname = async () => [
      publicAddress,
      { address: "10.0.0.7", family: 4 },
    ];

    await expectPolicyError(
      assertPublicHttpsUrl(
        "https://mixed.example.net/card.json",
        resolveHostname,
      ),
      "non_public_address",
    );
  });

  test("rejects empty and oversized DNS answer sets", async () => {
    await expectPolicyError(
      assertPublicHttpsUrl("https://empty.example.net/", async () => []),
      "dns_no_addresses",
    );
    await expectPolicyError(
      assertPublicHttpsUrl("https://many.example.net/", async () =>
        Array.from({ length: 33 }, () => publicAddress),
      ),
      "dns_answer_limit",
    );
  });

  test("bounds an in-flight DNS resolver with the caller signal", async () => {
    const controller = new AbortController();
    const operation = assertPublicHttpsUrl(
      "https://slow.example.net/card.json",
      async () => await new Promise<never>(() => undefined),
      controller.signal,
    );
    controller.abort();
    try {
      await operation;
      throw new Error("Expected the DNS wait to abort.");
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("AbortError");
    }
  });

  test("rejects URL features that leave the discovered-request boundary before DNS", async () => {
    let resolutions = 0;
    const resolveHostname: ResolveHostname = async () => {
      resolutions += 1;
      return [publicAddress];
    };

    for (const [url, code] of [
      ["http://example.net/card.json", "https_required"],
      ["https://u:p@example.net/card.json", "credentials_not_allowed"],
      ["https://example.net:8443/card.json", "unsafe_port"],
      ["https://example.net/card.json#fragment", "fragment_not_allowed"],
      ["https://127.0.0.1/card.json", "ip_literal_not_allowed"],
      ["https://service.local/card.json", "local_or_reserved_host_not_allowed"],
    ] as const) {
      await expectPolicyError(assertPublicHttpsUrl(url, resolveHostname), code);
    }
    expect(resolutions).toBe(0);
  });

  test("rejects a discovered URL whose canonical serialization is oversized", async () => {
    await expectPolicyError(
      assertPublicHttpsUrl(
        `https://example.net/${"é".repeat(800)}`,
        async () => [publicAddress],
      ),
      "url_too_long",
    );
  });
});
