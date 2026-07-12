import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { describe, expect, test } from "bun:test";

import {
  assertSafeNetUrl,
  createSafeNetAdmissionGate,
  defaultSafeNetRequestOnce,
  isGloballyReachableAddress,
  resolveGloballyReachableAddresses,
  SAFE_NET_HARD_MAX_REQUEST_BYTES,
  SAFE_NET_HARD_MAX_RESPONSE_BYTES,
  SAFE_NET_MAX_HTTP_CHUNKS,
  SAFE_NET_MAX_DNS_ANSWERS,
  SafeNetError,
  type SafeNetErrorCode,
  type SafeNetRequestOnce,
  safeNetRequest,
} from "../src/services/net/safe-fetch";

const PUBLIC_V4 = { address: "93.184.216.34", family: 4 } as const;
const OTHER_PUBLIC_V4 = { address: "1.1.1.1", family: 4 } as const;
const PUBLIC_V6 = {
  address: "2606:4700:4700::1111",
  family: 6,
} as const;

async function expectCode(
  operation: Promise<unknown>,
  code: SafeNetErrorCode,
): Promise<void> {
  try {
    await operation;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SafeNetError);
    expect((error as SafeNetError).code).toBe(code);
  }
}

function expectSyncCode(operation: () => unknown, code: SafeNetErrorCode): void {
  try {
    operation();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SafeNetError);
    expect((error as SafeNetError).code).toBe(code);
  }
}

function publicLookup() {
  return async () => [PUBLIC_V4];
}

function response(
  body: Buffer = Buffer.alloc(0),
  overrides: Partial<Awaited<ReturnType<SafeNetRequestOnce>>> = {},
): Awaited<ReturnType<SafeNetRequestOnce>> {
  return {
    statusCode: 200,
    headers: {},
    body,
    connectedAddress: PUBLIC_V4.address,
    ...overrides,
  };
}

class FakeWireSocket extends EventEmitter {
  readonly remoteAddress: string;
  readonly writes: Buffer[] = [];
  readonly authorized = true;
  readonly alpnProtocol = "http/1.1";
  destroyed = false;

  constructor(
    private readonly responseChunks: Buffer[],
    readyEvent: "connect" | "secureConnect" | "error" = "connect",
    remoteAddress = PUBLIC_V4.address,
    private readonly endResponse = true,
    private readonly certificateSubjectAltName = "DNS:peer.example",
    closeAfterReady = false,
  ) {
    super();
    this.remoteAddress = remoteAddress;
    queueMicrotask(() => {
      if (readyEvent === "error") this.emit("error", new Error("unreachable"));
      else this.emit(readyEvent);
      if (closeAfterReady) {
        this.destroyed = true;
        this.emit("close", false);
      }
    });
  }

  write(value: string | Uint8Array): boolean {
    this.writes.push(Buffer.from(value));
    queueMicrotask(() => {
      for (const chunk of this.responseChunks) {
        if (this.destroyed) return;
        this.emit("data", chunk);
      }
      if (this.endResponse && !this.destroyed) {
        this.emit("end");
        this.emit("close", false);
      }
    });
    return true;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }

  getPeerCertificate(): { subject: Record<string, never>; subjectaltname: string } {
    return {
      subject: {},
      subjectaltname: this.certificateSubjectAltName,
    };
  }
}

function asSocket(socket: FakeWireSocket): Socket {
  return socket as unknown as Socket;
}

describe("safe-net URL and address policy", () => {
  test("blocks representative IANA non-global ranges and scoped IPv6", () => {
    for (const address of [
      "0.0.0.0",
      "10.255.255.255",
      "100.64.0.1",
      "127.255.255.255",
      "169.254.169.254",
      "172.31.255.255",
      "192.0.0.170",
      "192.0.2.255",
      "192.168.255.255",
      "198.19.255.255",
      "198.51.100.1",
      "203.0.113.255",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "64:ff9b:1::1",
      "100::1",
      "100:0:0:1::1",
      "2001:2::1",
      "2001:db8::1",
      "2002::1",
      "3fff::1",
      "5f00::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "::1%lo0",
      "fe80::1%en0",
      "fc00::1%lo0",
      "ff02::1%lo0",
      "2001:db8::1%lo0",
    ]) {
      expect(isGloballyReachableAddress(address)).toBe(false);
    }

    expect(isGloballyReachableAddress(PUBLIC_V4.address)).toBe(true);
    expect(isGloballyReachableAddress(PUBLIC_V6.address)).toBe(true);
  });

  test("rejects schemes, fragments, credentials, malformed and oversized URLs", () => {
    for (const value of [
      "http://peer.example/path",
      "file:///etc/passwd",
      "data:text/plain,hello",
    ]) {
      expectSyncCode(
        () => assertSafeNetUrl(value, { protocols: ["https:"] }),
        "safe_net_protocol_not_allowed",
      );
    }
    for (const value of [
      "https://user@peer.example/",
      "https://user%40tenant@peer.example/",
      "https://:password@peer.example/",
    ]) {
      expectSyncCode(
        () => assertSafeNetUrl(value, { protocols: ["https:"] }),
        "safe_net_url_credentials_forbidden",
      );
    }
    expectSyncCode(
      () => assertSafeNetUrl("https://peer.example/#secret", {
        protocols: ["https:"],
      }),
      "safe_net_url_fragment_forbidden",
    );
    expectSyncCode(
      () => assertSafeNetUrl("not a URL", { protocols: ["https:"] }),
      "safe_net_invalid_url",
    );
    expectSyncCode(
      () => assertSafeNetUrl(`https://peer.example/${"x".repeat(4_100)}`, {
        protocols: ["https:"],
      }),
      "safe_net_invalid_url",
    );
    expectSyncCode(
      () => assertSafeNetUrl("https://peer.example:0/", {
        protocols: ["https:"],
      }),
      "safe_net_invalid_url",
    );
    for (const protocols of [[], ["ftp:"]] as const) {
      expectSyncCode(
        () => assertSafeNetUrl("https://peer.example/", {
          protocols: protocols as never,
        }),
        "safe_net_protocol_not_allowed",
      );
    }
  });

  test("canonical numeric and mapped-IP spellings cannot bypass literal policy", () => {
    for (const value of [
      "https://127.1/",
      "https://0177.0.0.1/",
      "https://0x7f000001/",
      "https://2130706433/",
      "https://0300.0250.0001.0001/",
      "https://[::ffff:127.0.0.1]/",
      "https://１２７.０.０.１/",
    ]) {
      expectSyncCode(
        () => assertSafeNetUrl(value, { protocols: ["https:"] }),
        "safe_net_destination_not_public",
      );
    }
  });

  test("allows HTTP only when the caller opts into it", () => {
    expect(
      assertSafeNetUrl("http://peer.example/path", {
        protocols: ["http:", "https:"],
      }).href,
    ).toBe("http://peer.example/path");
  });
});

describe("safe-net DNS validation and pin set", () => {
  test("rejects empty, failed, malformed, mixed, and scoped answer sets", async () => {
    await expectCode(
      resolveGloballyReachableAddresses("peer.example", async () => []),
      "safe_net_dns_no_addresses",
    );
    await expectCode(
      resolveGloballyReachableAddresses("peer.example", async () => {
        throw new Error("resolver offline");
      }),
      "safe_net_dns_failed",
    );
    for (const answers of [
      [PUBLIC_V4, { address: "10.0.0.1", family: 4 }],
      [{ address: "10.0.0.1", family: 4 }, PUBLIC_V4],
      [PUBLIC_V4, { address: "not-an-ip", family: 4 }],
      [PUBLIC_V4, { address: "fe80::1%en0", family: 6 }],
    ]) {
      await expectCode(
        resolveGloballyReachableAddresses(
          "peer.example",
          async () => answers,
        ),
        "safe_net_destination_not_public",
      );
    }
  });

  test("recomputes family and deduplicates exact DNS answers", async () => {
    const answers = await resolveGloballyReachableAddresses(
      "peer.example.",
      async (hostname) => {
        expect(hostname).toBe("peer.example");
        return [
          { address: PUBLIC_V4.address, family: 6 },
          PUBLIC_V4,
          PUBLIC_V6,
          { ...PUBLIC_V6 },
        ];
      },
    );
    expect(answers).toEqual([PUBLIC_V4, PUBLIC_V6]);
  });

  test("caps raw DNS answers even when they are duplicates", async () => {
    await expectCode(
      resolveGloballyReachableAddresses(
        "peer.example",
        async () => Array.from(
          { length: SAFE_NET_MAX_DNS_ANSWERS + 1 },
          () => PUBLIC_V4,
        ),
      ),
      "safe_net_dns_too_many_addresses",
    );
  });

  test("resolves once and passes only the frozen validated set", async () => {
    let lookups = 0;
    let seenAddresses: unknown;
    await safeNetRequest("https://peer.example/data", {
      lookup: async () => {
        lookups += 1;
        return lookups === 1
          ? [PUBLIC_V4, PUBLIC_V6]
          : [{ address: "127.0.0.1", family: 4 }];
      },
      requestOnce: async (options) => {
        seenAddresses = options.addresses;
        return response();
      },
    });
    expect(lookups).toBe(1);
    expect(seenAddresses).toEqual([PUBLIC_V4, PUBLIC_V6]);
  });
});

describe("safe-net runtime request policy", () => {
  test("rejects unsupported runtime methods and invalid numeric limits", async () => {
    await expectCode(
      safeNetRequest("https://peer.example/", {
        method: "DELETE" as never,
      }),
      "safe_net_method_not_allowed",
    );

    const invalidOptions = [
      { timeoutMs: 0 },
      { timeoutMs: Number.NaN },
      { timeoutMs: Number.POSITIVE_INFINITY },
      { timeoutMs: 1.5 },
      { maxRequestBytes: -1 },
      { maxRequestBytes: SAFE_NET_HARD_MAX_REQUEST_BYTES + 1 },
      { maxResponseBytes: -1 },
      { maxResponseBytes: SAFE_NET_HARD_MAX_RESPONSE_BYTES + 1 },
      { maxRedirects: -1 },
      { maxRedirects: 11 },
      { redirect: "sometimes" as never },
    ];
    for (const options of invalidOptions) {
      await expectCode(
        safeNetRequest("https://peer.example/", options),
        "safe_net_invalid_limit",
      );
    }
  });

  test("rejects an oversized request before DNS or transport", async () => {
    let lookupCalled = false;
    let requestCalled = false;
    await expectCode(
      safeNetRequest("https://peer.example/", {
        method: "POST",
        body: Buffer.alloc(4),
        maxRequestBytes: 3,
        lookup: async () => {
          lookupCalled = true;
          return [PUBLIC_V4];
        },
        requestOnce: async () => {
          requestCalled = true;
          return response();
        },
      }),
      "safe_net_request_too_large",
    );
    expect(lookupCalled).toBe(false);
    expect(requestCalled).toBe(false);
  });

  test("rejects GET bodies before DNS so redirects can never replay them", async () => {
    let lookupCalled = false;
    await expectCode(
      safeNetRequest("https://peer.example/", {
        method: "GET",
        body: "secret",
        redirect: "follow",
        lookup: async () => {
          lookupCalled = true;
          return [PUBLIC_V4];
        },
      }),
      "safe_net_method_not_allowed",
    );
    expect(lookupCalled).toBe(false);
  });

  test("normalizes safe headers and owns Host, framing, and encoding", async () => {
    let seen: Parameters<SafeNetRequestOnce>[0] | undefined;
    await safeNetRequest("https://peer.example/upload", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: {
        Host: "attacker.example",
        Connection: "keep-alive",
        "Content-Length": "999",
        "Transfer-Encoding": "chunked",
        Upgrade: "websocket",
        TE: "trailers",
        Trailer: "x-checksum",
        "Proxy-Connection": "keep-alive",
        "Accept-Encoding": "gzip",
        "X-Safe": "yes",
      },
      lookup: publicLookup(),
      requestOnce: async (options) => {
        seen = options;
        return response();
      },
    });
    expect(seen?.headers).toEqual({
      "x-safe": "yes",
      "accept-encoding": "identity",
      "content-length": "3",
    });
    expect(seen?.body).toEqual(Buffer.from([1, 2, 3]));
  });

  test("forbids credentials and malformed or excessive request headers", async () => {
    for (const name of [
      "authorization",
      "cookie",
      "cookie2",
      "proxy-authorization",
    ]) {
      await expectCode(
        safeNetRequest("https://peer.example/", {
          headers: { [name]: "secret" },
        }),
        "safe_net_header_forbidden",
      );
    }
    for (const headers of [
      { "bad name": "value" },
      { good: "value\r\ninjected: yes" },
      { good: "value\0hidden" },
      { good: "value\vhidden" },
      { good: "emoji-🫶" },
      { "x-large": "x".repeat(32 * 1024 + 1) },
      { "x-duplicate": "one", "X-Duplicate": "two" },
    ]) {
      await expectCode(
        safeNetRequest("https://peer.example/", { headers }),
        "safe_net_invalid_header",
      );
    }
  });
});

describe("safe-net redirects and receipts", () => {
  test("redirect error wins over the destroyed body's Content-Length", async () => {
    await expectCode(
      safeNetRequest("https://peer.example/start", {
        redirect: "error",
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.alloc(0), {
          statusCode: 302,
          headers: {
            location: "/next",
            "content-length": "42",
          },
        }),
      }),
      "safe_net_redirect_not_allowed",
    );
  });

  test("follows a relative redirect whose destroyed body had a length", async () => {
    let calls = 0;
    const result = await safeNetRequest("https://peer.example/start", {
      redirect: "follow",
      lookup: publicLookup(),
      requestOnce: async ({ url }) => {
        calls += 1;
        if (calls === 1) {
          expect(url.href).toBe("https://peer.example/start");
          return response(Buffer.alloc(0), {
            statusCode: 302,
            headers: {
              location: "/final",
              "content-length": "42",
            },
          });
        }
        expect(url.href).toBe("https://peer.example/final");
        return response(Buffer.from("ok"), {
          headers: { "content-length": "2" },
        });
      },
    });
    expect(calls).toBe(2);
    expect(result.receipt.redirects).toBe(1);
  });

  test("revalidates redirect destinations before a second request", async () => {
    let calls = 0;
    await expectCode(
      safeNetRequest("https://peer.example/start", {
        redirect: "follow",
        lookup: publicLookup(),
        requestOnce: async () => {
          calls += 1;
          return response(Buffer.alloc(0), {
            statusCode: 307,
            headers: { location: "https://127.0.0.1/internal" },
          });
        },
      }),
      "safe_net_destination_not_public",
    );
    expect(calls).toBe(1);
  });

  test("drops non-navigation headers cross-origin and records final origin", async () => {
    const seenHeaders: Record<string, string>[] = [];
    let calls = 0;
    const result = await safeNetRequest("https://a.example/start", {
      redirect: "follow",
      headers: {
        accept: "application/json",
        "accept-language": "en",
        "user-agent": "safe-net-test",
        "x-private-context": "drop-me",
      },
      lookup: publicLookup(),
      requestOnce: async ({ headers }) => {
        seenHeaders.push({ ...headers });
        calls += 1;
        if (calls === 1) {
          return response(Buffer.alloc(0), {
            statusCode: 308,
            headers: { location: "https://b.example:8443/final" },
          });
        }
        return response(Buffer.from("hello"), {
          statusCode: 201,
          headers: { "content-length": "5" },
        });
      },
    });

    expect(seenHeaders[0]).toEqual({
      accept: "application/json",
      "accept-language": "en",
      "user-agent": "safe-net-test",
      "x-private-context": "drop-me",
      "accept-encoding": "identity",
    });
    expect(seenHeaders[1]).toEqual({
      accept: "application/json",
      "accept-language": "en",
      "user-agent": "safe-net-test",
      "accept-encoding": "identity",
    });
    expect(result.receipt).toMatchObject({
      requested_origin: "https://a.example",
      final_origin: "https://b.example:8443",
      status_code: 201,
      bytes: 5,
      sha256: createHash("sha256").update("hello").digest("hex"),
      redirects: 1,
      connected_address: PUBLIC_V4.address,
    });
    expect(result.receipt.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  test("enforces redirect count and location presence", async () => {
    await expectCode(
      safeNetRequest("https://peer.example/start", {
        redirect: "follow",
        maxRedirects: 0,
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.alloc(0), {
          statusCode: 301,
          headers: { location: "/again" },
        }),
      }),
      "safe_net_too_many_redirects",
    );
    await expectCode(
      safeNetRequest("https://peer.example/start", {
        redirect: "follow",
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.alloc(0), {
          statusCode: 301,
        }),
      }),
      "safe_net_redirect_location_invalid",
    );
  });
});

describe("safe-net response representation and connected peer", () => {
  test("rejects non-identity and ambiguous response encodings", async () => {
    for (const encoding of ["gzip", "br", "deflate", "gzip, identity"]) {
      await expectCode(
        safeNetRequest("https://peer.example/", {
          lookup: publicLookup(),
          requestOnce: async () => response(Buffer.from("x"), {
            headers: { "content-encoding": encoding },
          }),
        }),
        "safe_net_content_encoding_not_identity",
      );
    }
    await expectCode(
      safeNetRequest("https://peer.example/", {
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.from("x"), {
          headers: { "content-encoding": ["identity", "gzip"] },
        }),
      }),
      "safe_net_invalid_header",
    );

    const accepted = await safeNetRequest("https://peer.example/", {
      lookup: publicLookup(),
      requestOnce: async () => response(Buffer.from("x"), {
        headers: { "Content-Encoding": " Identity " },
      }),
    });
    expect(accepted.body.toString()).toBe("x");
  });

  test("validates response Content-Length syntax, bounds, and equality", async () => {
    for (const length of ["", "01", "-1", "+1", "1.0", "1e0", "NaN"]) {
      await expectCode(
        safeNetRequest("https://peer.example/", {
          lookup: publicLookup(),
          requestOnce: async () => response(Buffer.from("x"), {
            headers: { "content-length": length },
          }),
        }),
        "safe_net_content_length_invalid",
      );
    }
    await expectCode(
      safeNetRequest("https://peer.example/", {
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.from("abc"), {
          headers: { "content-length": "2" },
        }),
      }),
      "safe_net_content_length_mismatch",
    );
    await expectCode(
      safeNetRequest("https://peer.example/", {
        maxResponseBytes: 3,
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.alloc(0), {
          headers: { "content-length": "4" },
        }),
      }),
      "safe_net_response_too_large",
    );
    await expectCode(
      safeNetRequest("https://peer.example/", {
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.from("x"), {
          headers: { "content-length": ["1", "1"] },
        }),
      }),
      "safe_net_invalid_header",
    );

    const notModified = await safeNetRequest("https://peer.example/", {
      lookup: publicLookup(),
      requestOnce: async () => response(Buffer.alloc(0), {
        statusCode: 304,
        headers: { "content-length": "1234567" },
      }),
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.body).toHaveLength(0);
  });

  test("rejects case-colliding singleton response headers", async () => {
    await expectCode(
      safeNetRequest("https://peer.example/", {
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.from("x"), {
          headers: {
            "content-length": "1",
            "Content-Length": "2",
          },
        }),
      }),
      "safe_net_invalid_header",
    );
  });

  test("enforces exact and over-limit injected response bodies", async () => {
    const exact = await safeNetRequest("https://peer.example/", {
      maxResponseBytes: 4,
      lookup: publicLookup(),
      requestOnce: async () => response(Buffer.alloc(4), {
        headers: { "content-length": "4" },
      }),
    });
    expect(exact.body).toHaveLength(4);

    await expectCode(
      safeNetRequest("https://peer.example/", {
        maxResponseBytes: 4,
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.alloc(5)),
      }),
      "safe_net_response_too_large",
    );
    await expectCode(
      safeNetRequest("https://peer.example/", {
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.alloc(0), {
          body: "not bytes" as unknown as Buffer,
        }),
      }),
      "safe_net_invalid_response",
    );
  });

  test("validates an injected connectedAddress against the pinned set", async () => {
    const valid = await safeNetRequest("https://peer.example/", {
      lookup: publicLookup(),
      requestOnce: async () => response(),
    });
    expect(valid.receipt.connected_address).toBe(PUBLIC_V4.address);

    for (const connectedAddress of [
      "::ffff:93.184.216.34",
      "::ffff:5db8:d822",
    ]) {
      const mapped = await safeNetRequest("https://peer.example/", {
        lookup: publicLookup(),
        requestOnce: async () => response(Buffer.alloc(0), {
          connectedAddress,
        }),
      });
      expect(mapped.receipt.connected_address).toBe(connectedAddress);
    }

    for (const connectedAddress of [
      OTHER_PUBLIC_V4.address,
      "10.0.0.1",
      "fe80::1%en0",
    ]) {
      await expectCode(
        safeNetRequest("https://peer.example/", {
          lookup: publicLookup(),
          requestOnce: async () => response(Buffer.alloc(0), {
            connectedAddress,
          }),
        }),
        "safe_net_connected_address_mismatch",
      );
    }
  });
});

describe("safe-net built-in TCP/TLS wire transport", () => {
  test("pins HTTPS while preserving hostname SNI and parses fixed framing", async () => {
    const socket = new FakeWireSocket([
      Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"),
    ], "secureConnect");
    let factoryOptions: {
      address: string;
      port: number;
      tlsServername: string;
    } | undefined;
    const result = await defaultSafeNetRequestOnce({
      url: new URL("https://peer.example:8443/data?q=1"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: { "accept-encoding": "identity" },
      timeoutMs: 100,
      maxResponseBytes: 2,
      signal: new AbortController().signal,
      socketFactory: (options) => {
        factoryOptions = {
          address: options.address.address,
          port: options.port,
          tlsServername: options.tlsServername,
        };
        return asSocket(socket);
      },
    });

    expect(factoryOptions).toEqual({
      address: PUBLIC_V4.address,
      port: 8443,
      tlsServername: "peer.example",
    });
    expect(result.body.toString()).toBe("ok");
    expect(result.connectedAddress).toBe(PUBLIC_V4.address);
    expect(socket.writes[0]?.toString()).toBe(
      "GET /data?q=1 HTTP/1.1\r\n" +
        "Host: peer.example:8443\r\n" +
        "Connection: close\r\n" +
        "accept-encoding: identity\r\n\r\n",
    );
  });

  test("checks certificate IP SANs even though IP literals are omitted from SNI", async () => {
    const literalAddress = { address: "8.8.8.8", family: 4 } as const;
    const socket = new FakeWireSocket(
      [Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")],
      "secureConnect",
      literalAddress.address,
      true,
      "IP Address:9.9.9.9",
    );
    try {
      await defaultSafeNetRequestOnce({
        url: new URL("https://8.8.8.8/"),
        addresses: [literalAddress],
        method: "GET",
        headers: {},
        timeoutMs: 100,
        maxResponseBytes: 1,
        signal: new AbortController().signal,
        socketFactory: () => asSocket(socket),
      });
      throw new Error("expected TLS identity rejection");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe(
        "ERR_TLS_CERT_ALTNAME_INVALID",
      );
    }
    expect(socket.writes).toHaveLength(0);
  });

  test("parses split chunked bodies and bounded trailers", async () => {
    const socket = new FakeWireSocket([
      Buffer.from(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n" +
          "Content-Encoding: identity\r\n\r\n4\r\nWi",
      ),
      Buffer.from("ki\r\n5;source=test\r\npedia\r\n0\r\nX-Check: yes\r\n\r\n"),
    ]);
    const result = await defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: { "accept-encoding": "identity" },
      timeoutMs: 100,
      maxResponseBytes: 9,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(socket),
    });
    expect(result.body.toString()).toBe("Wikipedia");
    expect(result.headers?.["transfer-encoding"]).toBe("chunked");
  });

  test("bounds HTTP chunk count independently of socket data fragments", async () => {
    const protocolChunk = "1\r\nx\r\n";
    const wire = Buffer.from(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
        protocolChunk.repeat(SAFE_NET_MAX_HTTP_CHUNKS + 20_000) +
        "0\r\n\r\n",
    );
    const responseChunks: Buffer[] = [];
    for (let offset = 0; offset < wire.length; offset += 64 * 1024) {
      responseChunks.push(wire.subarray(offset, offset + 64 * 1024));
    }
    expect(responseChunks.length).toBeLessThan(4_096);
    const socket = new FakeWireSocket(responseChunks);
    await expectCode(defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 1_000,
      maxResponseBytes: SAFE_NET_MAX_HTTP_CHUNKS + 20_000,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(socket),
    }), "safe_net_invalid_response");
  });

  test("coalesces many legal protocol chunks into the exact bounded body", async () => {
    const count = 1_024;
    const wire = Buffer.from(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
        "1\r\nx\r\n".repeat(count) +
        "0\r\n\r\n",
    );
    const socket = new FakeWireSocket([wire]);
    const result = await defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 1_000,
      maxResponseBytes: count,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(socket),
    });
    expect(result.body).toEqual(Buffer.alloc(count, "x"));
  });

  test("reports streamed overflow before teardown can relabel it", async () => {
    const socket = new FakeWireSocket([
      Buffer.from(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
          "5\r\nhello\r\n0\r\n\r\n",
      ),
    ]);
    await expectCode(defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 100,
      maxResponseBytes: 4,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(socket),
    }), "safe_net_response_too_large");
    expect(socket.destroyed).toBe(true);
  });

  test("validates raw facade headers before opening a socket", async () => {
    let factoryCalled = false;
    await expectCode(defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: { "x-safe": "yes\r\nInjected: true" },
      timeoutMs: 100,
      maxResponseBytes: 1,
      signal: new AbortController().signal,
      socketFactory: () => {
        factoryCalled = true;
        return asSocket(new FakeWireSocket([]));
      },
    }), "safe_net_invalid_header");
    expect(factoryCalled).toBe(false);
  });

  test("bounds a chunk-size line even when its CRLF arrives at once", async () => {
    const oversizedLine = `1;${"a".repeat(1_024)}\r\n`;
    const socket = new FakeWireSocket([
      Buffer.from(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
          oversizedLine +
          "x\r\n0\r\n\r\n",
      ),
    ]);
    await expectCode(defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 100,
      maxResponseBytes: 1,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(socket),
    }), "safe_net_invalid_response");
  });

  test("rejects ambiguous framing and truncated fixed bodies", async () => {
    for (const [wire, code] of [
      [
        "HTTP/1.1 200 OK\r\nContent-Length: 1\r\n" +
          "Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
        "safe_net_invalid_response",
      ],
      [
        "HTTP/1.1 200 OK\r\nContent-Length: 1\r\n" +
          "Content-Length: 1\r\n\r\nx",
        "safe_net_invalid_header",
      ],
      [
        "HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nab",
        "safe_net_content_length_mismatch",
      ],
    ] as const) {
      const socket = new FakeWireSocket([Buffer.from(wire)]);
      await expectCode(defaultSafeNetRequestOnce({
        url: new URL("http://peer.example/"),
        addresses: [PUBLIC_V4],
        method: "GET",
        headers: {},
        timeoutMs: 100,
        maxResponseBytes: 10,
        signal: new AbortController().signal,
        socketFactory: () => asSocket(socket),
      }), code);
    }
  });

  test("tears down redirects before their body and requires the exact peer", async () => {
    const redirectSocket = new FakeWireSocket([
      Buffer.from(
        "HTTP/1.1 302 Found\r\nLocation: /next\r\n" +
          "Content-Length: 999999\r\n\r\nignored",
      ),
    ]);
    const redirect = await defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/start"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 100,
      maxResponseBytes: 1,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(redirectSocket),
    });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.body).toHaveLength(0);
    expect(redirectSocket.destroyed).toBe(true);

    const wrongPeer = new FakeWireSocket([], "connect", OTHER_PUBLIC_V4.address);
    await expectCode(defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 100,
      maxResponseBytes: 1,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(wrongPeer),
    }), "safe_net_connected_address_mismatch");
    expect(wrongPeer.writes).toHaveLength(0);
  });

  test("bounds parallel connects but falls through to later validated answers", async () => {
    const addresses = [
      { address: "1.1.1.1", family: 4 },
      { address: "8.8.8.8", family: 4 },
      { address: "9.9.9.9", family: 4 },
      { address: "93.184.216.34", family: 4 },
      { address: "104.16.132.229", family: 4 },
    ] as const;
    let attempts = 0;
    const result = await defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [...addresses],
      method: "GET",
      headers: {},
      timeoutMs: 100,
      maxResponseBytes: 1,
      signal: new AbortController().signal,
      socketFactory: ({ address }) => {
        attempts += 1;
        return asSocket(address.address === addresses[4].address
          ? new FakeWireSocket(
            [Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\nx")],
            "connect",
            address.address,
          )
          : new FakeWireSocket([], "error", address.address));
      },
    });
    expect(attempts).toBe(5);
    expect(result.body.toString()).toBe("x");
    expect(result.connectedAddress).toBe(addresses[4].address);
  });

  test("caps pathological response fragmentation independently of bytes", async () => {
    const socket = new FakeWireSocket([
      Buffer.from("HTTP/1.1 200 OK\r\n\r\n"),
      ...Array.from({ length: 4_096 }, () => Buffer.from("x")),
    ]);
    await expectCode(defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 100,
      maxResponseBytes: 10_000,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(socket),
    }), "safe_net_response_too_large");
  });

  test("applies the request deadline to a connected but silent peer", async () => {
    const socket = new FakeWireSocket([], "connect", PUBLIC_V4.address, false);
    await expectCode(defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 5,
      maxResponseBytes: 1,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(socket),
    }), "safe_net_request_timeout");
    expect(socket.destroyed).toBe(true);
  });

  test("classifies a close between connect and parser handoff as aborted", async () => {
    const socket = new FakeWireSocket(
      [],
      "connect",
      PUBLIC_V4.address,
      false,
      "DNS:peer.example",
      true,
    );
    await expectCode(defaultSafeNetRequestOnce({
      url: new URL("http://peer.example/"),
      addresses: [PUBLIC_V4],
      method: "GET",
      headers: {},
      timeoutMs: 100,
      maxResponseBytes: 1,
      signal: new AbortController().signal,
      socketFactory: () => asSocket(socket),
    }), "safe_net_response_aborted");
    expect(socket.writes).toHaveLength(0);
  });
});

describe("safe-net total deadline and abort", () => {
  test("a pre-aborted request starts neither DNS nor transport", async () => {
    const controller = new AbortController();
    controller.abort();
    let lookupCalled = false;
    let requestCalled = false;
    await expectCode(
      safeNetRequest("https://peer.example/", {
        signal: controller.signal,
        lookup: async () => {
          lookupCalled = true;
          return [PUBLIC_V4];
        },
        requestOnce: async () => {
          requestCalled = true;
          return response();
        },
      }),
      "safe_net_aborted",
    );
    expect(lookupCalled).toBe(false);
    expect(requestCalled).toBe(false);
  });

  test("times out deterministically during DNS and never requests", async () => {
    let requestCalled = false;
    await expectCode(
      safeNetRequest("https://peer.example/", {
        timeoutMs: 5,
        lookup: async () => await new Promise<never>(() => {}),
        requestOnce: async () => {
          requestCalled = true;
          return response();
        },
      }),
      "safe_net_request_timeout",
    );
    expect(requestCalled).toBe(false);
  });

  test("times out a hanging transport and exposes its aborted signal", async () => {
    let innerSignal: AbortSignal | undefined;
    await expectCode(
      safeNetRequest("https://peer.example/", {
        timeoutMs: 5,
        lookup: publicLookup(),
        requestOnce: async ({ signal }) => {
          innerSignal = signal;
          return await new Promise<never>(() => {});
        },
      }),
      "safe_net_request_timeout",
    );
    expect(innerSignal?.aborted).toBe(true);
  });

  test("propagates a deterministic external abort during transport", async () => {
    const controller = new AbortController();
    let innerSignal: AbortSignal | undefined;
    await expectCode(
      safeNetRequest("https://peer.example/", {
        signal: controller.signal,
        lookup: publicLookup(),
        requestOnce: async ({ signal }) => {
          innerSignal = signal;
          queueMicrotask(() => controller.abort());
          return await new Promise<never>(() => {});
        },
      }),
      "safe_net_aborted",
    );
    expect(innerSignal?.aborted).toBe(true);
  });
});

describe("safe-net process admission", () => {
  test("bounds active and queued requests, then transfers a released permit", async () => {
    const gate = createSafeNetAdmissionGate({
      maxConcurrent: 1,
      maxQueued: 1,
      queueTimeoutMs: 100,
    });
    const signal = new AbortController().signal;
    const releaseFirst = await gate.acquire(signal);
    let secondAdmitted = false;
    const second = gate.acquire(signal).then((release) => {
      secondAdmitted = true;
      return release;
    });

    await expectCode(
      gate.acquire(signal),
      "safe_net_overloaded",
    );
    expect(secondAdmitted).toBe(false);

    releaseFirst();
    const releaseSecond = await second;
    expect(secondAdmitted).toBe(true);
    releaseSecond();
    // Releases are deliberately idempotent.
    releaseSecond();

    const releaseThird = await gate.acquire(signal);
    releaseThird();
  });

  test("expires or aborts queued admission without leaking a permit", async () => {
    const gate = createSafeNetAdmissionGate({
      maxConcurrent: 1,
      maxQueued: 1,
      queueTimeoutMs: 5,
    });
    const releaseFirst = await gate.acquire(new AbortController().signal);
    await expectCode(
      gate.acquire(new AbortController().signal),
      "safe_net_overloaded",
    );
    releaseFirst();

    const releaseSecond = await gate.acquire(new AbortController().signal);
    const controller = new AbortController();
    const queued = gate.acquire(controller.signal);
    controller.abort();
    await expectCode(queued, "safe_net_aborted");
    releaseSecond();

    const releaseThird = await gate.acquire(new AbortController().signal);
    releaseThird();
  });

  test("rejects saturation before DNS and releases after request failure", async () => {
    const gate = createSafeNetAdmissionGate({
      maxConcurrent: 1,
      maxQueued: 0,
      queueTimeoutMs: 100,
    });
    const release = await gate.acquire(new AbortController().signal);
    let lookupCalled = false;
    await expectCode(
      safeNetRequest("https://peer.example/", {
        admission: gate,
        lookup: async () => {
          lookupCalled = true;
          return [PUBLIC_V4];
        },
      }),
      "safe_net_overloaded",
    );
    expect(lookupCalled).toBe(false);
    release();

    await expectCode(
      safeNetRequest("https://peer.example/", {
        admission: gate,
        lookup: async () => {
          throw new Error("dns failure");
        },
      }),
      "safe_net_dns_failed",
    );

    const result = await safeNetRequest("https://peer.example/", {
      admission: gate,
      lookup: publicLookup(),
      requestOnce: async () => response(Buffer.from("ok")),
    });
    expect(result.body.toString()).toBe("ok");
  });
});
