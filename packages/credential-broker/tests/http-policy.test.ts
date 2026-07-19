import { afterEach, describe, expect, test } from "bun:test";
import { AgentCredError } from "../src/index.js";
import { isPublicAddress } from "../src/network.js";
import { grantRequest, makeBroker, TEST_SECRET, type BrokerFixture } from "./helpers.js";

const fixtures: BrokerFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("credentialed HTTP boundary", () => {
  test("origin, method, segment prefix and canonical URL are exact", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(grantRequest());
    for (const url of [
      "http://api.example.com/v1/x",
      "https://api.example.com.evil.test/v1/x",
      "https://user@api.example.com/v1/x",
      "https://api.example.com/v10/x",
      "https://api.example.com/v1/%2e%2e/admin",
      "https://api.example.com/v1/x#fragment",
    ]) {
      await expect(fixture.client.fetch(handle, { method: "GET", url })).rejects.toBeInstanceOf(
        AgentCredError,
      );
    }
    expect(fixture.credentials.calls).toBe(0);
  });

  test("query names are deny-by-default and explicitly scoped", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const denied = await fixture.client.requestGrant(grantRequest());
    await expect(
      fixture.client.fetch(denied, {
        method: "GET",
        url: "https://api.example.com/v1/search?limit=10",
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });

    const explicitEmpty = await fixture.client.requestGrant(
      grantRequest({ scope: { ...grantRequest().scope, queryNames: [] } }),
    );
    await expect(
      fixture.client.fetch(explicitEmpty, {
        method: "GET",
        url: "https://api.example.com/v1/search?limit=10",
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });

    const allowed = await fixture.client.requestGrant(
      grantRequest({
        scope: { ...grantRequest().scope, queryNames: ["limit"] },
      }),
    );
    await fixture.client.fetch(allowed, {
      method: "GET",
      url: "https://api.example.com/v1/search?limit=10",
    });
    await expect(
      fixture.client.fetch(allowed, {
        method: "GET",
        url: "https://api.example.com/v1/search?access_token=attacker",
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });
  });

  test("caller cannot inject auth, proxy, cookie, forwarding, or hop headers", async () => {
    const forbidden = [
      "Authorization",
      "Proxy-Authorization",
      "Cookie",
      "Host",
      "Connection",
      "Content-Length",
      "Transfer-Encoding",
      "X-Forwarded-For",
    ];
    for (const name of forbidden) {
      const fixture = await makeBroker();
      fixtures.push(fixture);
      const handle = await fixture.client.requestGrant(grantRequest());
      await expect(
        fixture.client.fetch(handle, {
          method: "GET",
          url: "https://api.example.com/v1/x",
          headers: { [name]: "attacker-controlled" },
        }),
      ).rejects.toBeInstanceOf(AgentCredError);
      expect(fixture.credentials.calls).toBe(0);
    }
  });

  test("derived idempotency and credential header values reject control characters", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(grantRequest());
    await expect(
      fixture.client.fetch(handle, {
        method: "POST",
        url: "https://api.example.com/v1/write",
        idempotencyKey: "safe-looking\r\ninjected: true",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fixture.credentials.calls).toBe(0);

    const badMapping = await makeBroker({
      credentials: {
        async withCredential(_alias, use) {
          return use({
            value: new TextEncoder().encode("test-credential-sentinel"),
            auth: { kind: "bearer", prefix: "Bearer\r\nInjected: true" },
          });
        },
      },
    });
    fixtures.push(badMapping);
    const badHandle = await badMapping.client.requestGrant(grantRequest());
    await expect(
      badMapping.client.fetch(badHandle, {
        method: "GET",
        url: "https://api.example.com/v1/read",
      }),
    ).rejects.toMatchObject({ code: "backend_unavailable" });
    expect(badMapping.transport.calls).toHaveLength(0);
  });

  test("credential mappings cannot overwrite scoped caller-control headers", async () => {
    for (const headerName of ["x-agent-id", "idempotency-key"]) {
      const fixture = await makeBroker({
        credentials: {
          async withCredential(_alias, use) {
            return use({
              value: new TextEncoder().encode("test-credential-sentinel"),
              auth: { kind: "header", headerName },
            });
          },
        },
      });
      fixtures.push(fixture);
      const handle = await fixture.client.requestGrant(grantRequest());
      await expect(
        fixture.client.fetch(handle, {
          method: "GET",
          url: "https://api.example.com/v1/read",
        }),
      ).rejects.toMatchObject({ code: "backend_unavailable" });
      expect(fixture.transport.calls).toHaveLength(0);
    }
  });

  test("DNS is resolved once, every answer is validated, and the chosen IP is pinned", async () => {
    const fixture = await makeBroker({
      http: {
        resolver: {
          async resolve() {
            return [
              { address: "8.8.8.8", family: 4 },
              { address: "10.0.0.1", family: 4 },
            ];
          },
        },
      },
    });
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(grantRequest());
    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/x",
      }),
    ).rejects.toMatchObject({ code: "network_denied" });
    expect(fixture.credentials.calls).toBe(0);

    const good = await makeBroker();
    fixtures.push(good);
    const goodHandle = await good.client.requestGrant(
      grantRequest({
        scope: {
          ...grantRequest().scope,
          headerValues: { "x-agent-id": ["acting-agent"] },
        },
      }),
    );
    await good.client.fetch(goodHandle, {
      method: "GET",
      url: "https://api.example.com/v1/x",
      headers: { "X-Agent-Id": "acting-agent" },
    });
    expect(good.resolverCalls).toEqual(["api.example.com"]);
    expect(good.transport.calls[0]?.pinnedAddress).toEqual({ address: "8.8.8.8", family: 4 });
    expect(good.transport.calls[0]?.headers.authorization).toBe(`Bearer ${TEST_SECRET}`);
    expect(good.transport.calls[0]?.headers["x-agent-id"]).toBe("acting-agent");

    await expect(
      good.client.fetch(goodHandle, {
        method: "GET",
        url: "https://api.example.com/v1/x",
        headers: { "X-Agent-Id": "other-agent" },
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });
  });

  test("redirect results are denied and never returned", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    fixture.transport.response = {
      status: 302,
      headers: { location: "https://evil.test/echo" },
      body: Buffer.alloc(0),
    };
    const handle = await fixture.client.requestGrant(grantRequest());
    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/redirect",
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });
  });

  test("event streams fail before reserving a use", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const request = grantRequest();
    request.scope.maxUses = 1;
    const handle = await fixture.client.requestGrant(request);

    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/voice",
        headers: { Accept: "text/event-stream; charset=utf-8" },
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fixture.credentials.calls).toBe(0);

    await fixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/wake",
    });
    expect(fixture.credentials.calls).toBe(1);
  });

  test("public-address classifier rejects local, metadata and transition ranges", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "64:ff9b::7f00:1",
      "2001:2::1",
      "2001:10::1",
      "2001:20::1",
      "2001:db8::1",
      "2002::1",
      "3ffe::1",
      "3fff::1",
      "fc00::1",
      "fe80::1",
      "ff00::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
});
