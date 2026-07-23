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

  test("credential bytes must round-trip as canonical UTF-8 before injection", async () => {
    const fixture = await makeBroker({
      credentials: {
        async withCredential(_alias, use) {
          return use({
            // Overlong UTF-8 for `/`: decoders replace it, so injected bytes
            // would no longer match the bytes used for response redaction.
            value: Uint8Array.from([0xc0, 0xaf]),
            auth: { kind: "bearer" },
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
  });

  test("credential bytes must be printable ASCII before header injection", async () => {
    const fixture = await makeBroker({
      credentials: {
        async withCredential(_alias, use) {
          return use({
            // This is valid UTF-8, but Node request headers serialize strings
            // through a single-byte wire path and would change these bytes.
            value: new TextEncoder().encode("test-caf\u00e9-sentinel"),
            auth: { kind: "bearer" },
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
  });

  test("credential mappings cannot overwrite scoped caller-control headers", async () => {
    for (const headerName of ["x-agent-id", "idempotency-key", "payment-signature"]) {
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

  test("passes current AgentTool authority-proof headers but never caller auth", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const handle = await fixture.client.requestGrant(grantRequest());
    await fixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/identities/example",
      headers: {
        "X-Agenttool-Authority-Sequence": "7",
        "X-Agenttool-Authority-Timestamp": "2026-07-19T00:00:00.000Z",
        "X-Agenttool-Authority-Signature": "test-signature-sentinel",
      },
    });

    expect(fixture.transport.calls[0]?.headers).toMatchObject({
      "x-agenttool-authority-sequence": "7",
      "x-agenttool-authority-timestamp": "2026-07-19T00:00:00.000Z",
      "x-agenttool-authority-signature": "test-signature-sentinel",
    });
  });

  test("forwards PAYMENT-SIGNATURE only with an explicit grant opt-in", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    const denied = await fixture.client.requestGrant(grantRequest());
    await expect(
      fixture.client.fetch(denied, {
        method: "POST",
        url: "https://api.example.com/v1/document",
        headers: { "PAYMENT-SIGNATURE": "signed-payment-sentinel" },
        idempotencyKey: "payment-denied",
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });
    expect(fixture.credentials.calls).toBe(0);

    const allowed = await fixture.client.requestGrant(
      grantRequest({
        scope: {
          ...grantRequest().scope,
          allowPaymentSignature: true,
        },
      }),
    );
    await fixture.client.fetch(allowed, {
      method: "POST",
      url: "https://api.example.com/v1/document",
      headers: { "PAYMENT-SIGNATURE": "signed-payment-sentinel" },
      idempotencyKey: "payment-allowed",
    });
    expect(fixture.transport.calls.at(-1)?.headers["payment-signature"]).toBe(
      "signed-payment-sentinel",
    );
  });

  test("returns current AgentTool metadata headers and strips unsafe response headers", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    fixture.transport.response = {
      status: 402,
      headers: {
        "content-type": "application/json",
        "x-wake-profile": "brief",
        "x-credits-balance": "10",
        "payment-required": "challenge-sentinel",
        "payment-response": "payment-sentinel",
        "x-payment-required": "legacy-challenge-sentinel",
        "x-payment-response": "legacy-payment-sentinel",
        link: "</v1/payment/status>; rel=status",
        "set-cookie": "must-not-cross=true",
        location: "https://other.example/",
      },
      body: Buffer.from('{"ok":true}', "utf8"),
    };
    const handle = await fixture.client.requestGrant(grantRequest());
    const result = await fixture.client.fetch(handle, {
      method: "GET",
      url: "https://api.example.com/v1/wake",
    });

    expect(result.headers).toMatchObject({
      "content-type": "application/json",
      "x-wake-profile": "brief",
      "x-credits-balance": "10",
      "payment-required": "challenge-sentinel",
      "payment-response": "payment-sentinel",
      "x-payment-required": "legacy-challenge-sentinel",
      "x-payment-response": "legacy-payment-sentinel",
      link: "</v1/payment/status>; rel=status",
    });
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers.location).toBeUndefined();
  });

  test("bounds allowlisted response metadata independently of the body", async () => {
    const fixture = await makeBroker();
    fixtures.push(fixture);
    fixture.transport.response = {
      status: 402,
      headers: { "payment-required": "x".repeat(13 * 1024) },
      body: Buffer.alloc(0),
    };
    const handle = await fixture.client.requestGrant(grantRequest());
    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/document",
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  test("bounds the response again after exact-secret redaction expands it", async () => {
    const fixture = await makeBroker({
      credentials: {
        async withCredential(_alias, use) {
          return use({
            value: new TextEncoder().encode("x"),
            auth: { kind: "bearer" },
          });
        },
      },
    });
    fixtures.push(fixture);
    fixture.transport.response = {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.alloc(4096, 0x78),
    };
    const request = grantRequest();
    request.scope.maxResponseBytes = 4096;
    const handle = await fixture.client.requestGrant(request);

    await expect(
      fixture.client.fetch(handle, {
        method: "GET",
        url: "https://api.example.com/v1/reflection",
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });
    expect(fixture.client.connected).toBe(true);
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
