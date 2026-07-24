import { describe, expect, test } from "bun:test";
import { resolveBrowserCapabilities } from "../src/capabilities.js";
import {
  BrowserNetworkPolicy,
  classifyIpAddress,
  redactHtmlUrlAttributes,
  redactUrlReferenceForOutput,
  redactUrlForOutput,
  redactUrlsInText,
} from "../src/policy.js";

describe("browser network policy", () => {
  test("accepts only absolute HTTP(S) URLs without URL credentials", async () => {
    const policy = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities(),
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    await expect(policy.assertAllowed("file:///etc/passwd")).rejects.toMatchObject({
      code: "url_scheme_blocked",
    });
    await expect(
      policy.assertAllowed("https://owner:secret@example.com/"),
    ).rejects.toMatchObject({ code: "url_credentials_blocked" });
    await expect(policy.assertAllowed("/relative")).rejects.toMatchObject({
      code: "invalid_url",
    });
    expect((await policy.assertAllowed("https://example.com/path")).href).toBe(
      "https://example.com/path",
    );
  });

  test("blocks loopback, private and mixed DNS answers by default", async () => {
    const answers: Record<string, Array<{ address: string; family: number }>> = {
      "public.example.net": [{ address: "93.184.216.34", family: 4 }],
      "private.example.net": [{ address: "10.2.3.4", family: 4 }],
      "mixed.example.net": [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    };
    const policy = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities(),
      resolveHostname: async (hostname) => answers[hostname] ?? [],
    });

    await expect(policy.assertAllowed("http://localhost/")).rejects.toMatchObject({
      code: "network_blocked",
    });
    await expect(policy.assertAllowed("http://192.168.1.10/")).rejects.toMatchObject({
      code: "network_blocked",
    });
    await expect(
      policy.assertAllowed("https://private.example.net/"),
    ).rejects.toMatchObject({ code: "network_blocked" });
    await expect(
      policy.assertAllowed("https://mixed.example.net/"),
    ).rejects.toMatchObject({ code: "network_blocked" });
    expect(
      (await policy.assertAllowed("https://public.example.net/")).hostname,
    ).toBe("public.example.net");
  });

  test("local authority permits public and local/private but never reserved destinations", async () => {
    const policy = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities({ authority: "local" }),
      resolveHostname: async () => [{ address: "10.0.0.4", family: 4 }],
    });

    expect((await policy.assertAllowed("http://127.0.0.1/")).hostname).toBe(
      "127.0.0.1",
    );
    expect((await policy.assertAllowed("http://dev.internal/")).hostname).toBe(
      "dev.internal",
    );
    await expect(policy.assertAllowed("http://192.0.2.1/")).rejects.toMatchObject({
      code: "network_blocked",
    });
    await expect(policy.assertAllowed("http://anything.test/")).rejects.toMatchObject({
      code: "network_blocked",
    });
  });

  test("public and local authority are independent and fixed at construction", async () => {
    const localOnly = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities({
        allowPublicWeb: false,
        allowLocalNetwork: true,
      }),
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect((await localOnly.assertAllowed("http://127.0.0.1/")).hostname).toBe(
      "127.0.0.1",
    );
    await expect(localOnly.assertAllowed("https://example.com/")).rejects.toMatchObject({
      code: "network_blocked",
    });
    expect(Object.isFrozen(localOnly.boundary)).toBe(true);
    expect(localOnly.boundary.connectionAddressPinning).toBe(false);
    expect(localOnly.boundary.webSockets).toBe("blocked");
  });

  test("sovereign authority allows every destination class without DNS preflight", async () => {
    let resolverCalls = 0;
    const policy = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities({ authority: "sovereign" }),
      resolveHostname: async () => {
        resolverCalls += 1;
        throw new Error("the browser, not preflight, owns sovereign resolution");
      },
    });

    expect((await policy.assertAllowed("https://example.com/")).hostname).toBe(
      "example.com",
    );
    expect((await policy.assertAllowed("http://127.0.0.1/")).hostname).toBe(
      "127.0.0.1",
    );
    expect((await policy.assertAllowed("http://anything.test/")).hostname).toBe(
      "anything.test",
    );
    expect(resolverCalls).toBe(0);
  });

  test("applies each authority's declared WebSocket boundary", async () => {
    const resolver = async (hostname: string) =>
      hostname === "private.example.net"
        ? [{ address: "10.0.0.4", family: 4 as const }]
        : [{ address: "93.184.216.34", family: 4 as const }];
    const publicPolicy = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities(),
      resolveHostname: resolver,
    });
    const localPolicy = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities({ authority: "local" }),
      resolveHostname: resolver,
    });
    let sovereignResolverCalls = 0;
    const sovereignPolicy = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities({ authority: "sovereign" }),
      resolveHostname: async () => {
        sovereignResolverCalls += 1;
        return [];
      },
    });

    await expect(
      publicPolicy.assertWebSocketAllowed("wss://example.com/socket"),
    ).rejects.toMatchObject({ code: "network_blocked" });
    expect(
      (await localPolicy.assertWebSocketAllowed("ws://127.0.0.1/socket")).hostname,
    ).toBe("127.0.0.1");
    expect(
      (
        await localPolicy.assertWebSocketAllowed(
          "wss://private.example.net/socket",
        )
      ).hostname,
    ).toBe("private.example.net");
    await expect(
      localPolicy.assertWebSocketAllowed("wss://anything.test/socket"),
    ).rejects.toMatchObject({ code: "network_blocked" });
    expect(
      (await sovereignPolicy.assertWebSocketAllowed("wss://anything.test/socket"))
        .hostname,
    ).toBe("anything.test");
    expect(sovereignResolverCalls).toBe(0);
  });

  test("classifies special IPv4 and IPv6 ranges conservatively", () => {
    expect(classifyIpAddress("192.88.99.1")).toBe("reserved");
    expect(classifyIpAddress("100.64.0.1")).toBe("local");
    expect(classifyIpAddress("100::1")).toBe("reserved");
    expect(classifyIpAddress("2001::1")).toBe("reserved");
    expect(classifyIpAddress("2001:db8::1")).toBe("reserved");
    expect(classifyIpAddress("3fff::1")).toBe("reserved");
    expect(classifyIpAddress("::ffff:127.0.0.1")).toBe("local");
    expect(classifyIpAddress("2002:7f00:1::")).toBe("local");
    expect(classifyIpAddress("2606:4700:4700::1111")).toBe("public");
  });

  test("fails closed on empty or failed DNS resolution", async () => {
    const empty = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities(),
      resolveHostname: async () => [],
    });
    await expect(empty.assertAllowed("https://example.com/")).rejects.toMatchObject({
      code: "dns_failed",
    });

    const failed = new BrowserNetworkPolicy({
      capabilities: resolveBrowserCapabilities(),
      resolveHostname: async () => {
        throw new Error("resolver internals");
      },
    });
    await expect(failed.assertAllowed("https://example.com/")).rejects.toMatchObject({
      code: "dns_failed",
    });
  });

  test("redacts query values in structured URLs and web text", () => {
    const redacted = redactUrlForOutput(
      "https://example.com/path?token=secret&token=again&empty=#fragment",
    );
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("again");
    expect(redacted).toContain("token=%5Bredacted%5D");
    expect(redacted).toContain("#fragment");
    expect(redactUrlForOutput("https://user:pass@example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(
      redactUrlReferenceForOutput(
        "ftp://user:pass@example.com/path?token=secret",
      ),
    ).toBe("ftp://example.com/path?token=%5Bredacted%5D");
    expect(
      redactUrlReferenceForOutput(
        "custom://user:pass@example.com/path?token=secret",
      ),
    ).toBe("custom://example.com/path?token=%5Bredacted%5D");

    const text = redactUrlsInText(
      "Visit https://example.com/a?key=hunter2, then continue.",
    );
    expect(text).not.toContain("hunter2");
    expect(text).toEndWith(", then continue.");

    const html = redactHtmlUrlAttributes(
      '<a href="/next?token=secret">next</a>'
      + '<img src="//user:pass@example.com/x?id=private">',
    );
    expect(html).not.toContain("secret");
    expect(html).not.toContain("private");
    expect(html).not.toContain("user:pass");
    expect(html).toContain("token=%5Bredacted%5D");
  });
});
