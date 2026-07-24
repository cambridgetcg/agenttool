import { describe, expect, test } from "bun:test";

import {
  IntegrityError,
  InvalidInputError,
  LimitExceededError,
  MultiBlockStore,
  StoreError,
  cidForBytes,
} from "../src/index.js";
import {
  S3CompatibleBlockStore,
  type S3CompatibleBlockStoreOptions,
} from "../src/s3-store.js";

const FIXTURE_ACCESS_KEY_ID = "AKIDEXAMPLE";
const FIXTURE_SECRET_ACCESS_KEY = "not-a-real-aws-signing-secret";
const FIXTURE_SESSION_TOKEN = "not-a-real-session-token";

function fakeFetch(
  implementation: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ) => Promise<Response> | Response,
): typeof globalThis.fetch {
  return implementation as typeof globalThis.fetch;
}

function fixtureStore(
  fetch: typeof globalThis.fetch,
  overrides: Partial<S3CompatibleBlockStoreOptions> = {},
): S3CompatibleBlockStore {
  return new S3CompatibleBlockStore({
    endpoint: "https://s3.example.test/evidence-bucket",
    region: "us-east-1",
    accessKeyId: FIXTURE_ACCESS_KEY_ID,
    secretAccessKey: FIXTURE_SECRET_ACCESS_KEY,
    fetch,
    now: () => new Date("2013-05-24T00:00:00Z"),
    ...overrides,
  });
}

function serializedError(error: unknown): string {
  let json = "";
  try {
    json = JSON.stringify(error);
  } catch {
    json = "";
  }
  return `${String(error)} ${json}`;
}

function s3ErrorXml(code: string, key = "capsules/example"): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Error>",
    `<Code>${code}</Code>`,
    `<Message>fixture ${code}</Message>`,
    `<Key>${key}</Key>`,
    "<RequestId>fixture-request</RequestId>",
    "<HostId>fixture-host</HostId>",
    "</Error>",
  ].join("");
}

function hungCancellationBody(
  initial?: Uint8Array,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (initial !== undefined) controller.enqueue(initial);
    },
    cancel() {
      return new Promise(() => undefined);
    },
  });
}

async function settlesWithin<T>(promise: Promise<T>, milliseconds = 100): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("operation waited for response-body cancellation")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

describe("S3CompatibleBlockStore", () => {
  test("stays isolated from the browser-compatible root export", async () => {
    const root = await import("../src/index.js");
    expect("S3CompatibleBlockStore" in root).toBe(false);
  });

  test("signs the exact path-style SigV4 PUT fixture", async () => {
    const bytes = new TextEncoder().encode("exact SigV4 fixture");
    const cid =
      "bafkreiarrgtcfhu63tj6mxwsthlwztdntlbo6foujgiecipssewe3ras5a";
    expect(cidForBytes(bytes)).toBe(cid);

    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const store = fixtureStore(fakeFetch((input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response(null, { status: 200 });
    }), { prefix: "whitehack/capsules" });

    await expect(store.put(cid, bytes)).resolves.toEqual({
      attempted: 1,
      stored: 1,
      failed: 0,
    });
    expect(String(capturedInput)).toBe(
      "https://s3.example.test/evidence-bucket/whitehack/capsules/"
      + cid,
    );
    expect(capturedInit?.method).toBe("PUT");
    expect(capturedInit?.redirect).toBe("manual");
    expect(capturedInit?.credentials).toBe("omit");
    expect(capturedInit?.cache).toBe("no-store");
    expect(capturedInit?.referrerPolicy).toBe("no-referrer");
    expect(new Uint8Array(capturedInit?.body as Uint8Array)).toEqual(bytes);

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(headers.get("x-amz-content-sha256")).toBe(
      "1189a6229e9edcd3e65ed299d76ccc6d9ac2ef15d449904121f2912c4dc412e8",
    );
    expect(headers.get("x-amz-date")).toBe("20130524T000000Z");
    expect(headers.get("authorization")).toBe(
      "AWS4-HMAC-SHA256 "
      + "Credential=AKIDEXAMPLE/20130524/us-east-1/s3/aws4_request, "
      + "SignedHeaders=host;x-amz-content-sha256;x-amz-date, "
      + "Signature=955c9f4f3788a316a4202778bfb5f481f7fbbb17895ec581a07bee764c347145",
    );
  });

  test("signs the exact GET fixture including a session token", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const cid =
      "bafkreiafj3pmdubbd5re73imxsu5j6kabmheshcdoqvpfrnqvpv7bsmq3a";
    expect(cidForBytes(bytes)).toBe(cid);

    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const store = fixtureStore(fakeFetch((input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response(bytes, { status: 200 });
    }), {
      endpoint: "https://objects.example.net/bucket",
      region: "auto",
      accessKeyId: "TESTACCESS",
      secretAccessKey: "another-noncredential-fixture",
      sessionToken: FIXTURE_SESSION_TOKEN,
      prefix: "",
      now: () => new Date("2026-07-24T10:11:12Z"),
    });

    await expect(store.get(cid)).resolves.toEqual(bytes);
    expect(String(capturedInput)).toBe(
      "https://objects.example.net/bucket/" + cid,
    );
    expect(capturedInit?.method).toBe("GET");
    expect(capturedInit?.redirect).toBe("manual");
    expect(capturedInit?.credentials).toBe("omit");
    expect(capturedInit?.cache).toBe("no-store");
    expect(capturedInit?.referrerPolicy).toBe("no-referrer");

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("x-amz-content-sha256")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(headers.get("x-amz-date")).toBe("20260724T101112Z");
    expect(headers.get("x-amz-security-token")).toBe(FIXTURE_SESSION_TOKEN);
    expect(headers.get("authorization")).toBe(
      "AWS4-HMAC-SHA256 "
      + "Credential=TESTACCESS/20260724/auto/s3/aws4_request, "
      + "SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, "
      + "Signature=d4515533c090135f1c606478fc78a4d1fe98afa23e568608c71a224fbc9bcd78",
    );
  });

  test("requires a canonical bucket endpoint and an explicit loopback HTTP escape", () => {
    const fetch = fakeFetch(() => new Response(null, { status: 200 }));
    const invalidEndpoints = [
      "http://s3.example.test/bucket",
      "https://user:password@s3.example.test/bucket",
      "https://s3.example.test/bucket?inventory=1",
      "https://s3.example.test/bucket#fragment",
      "https://s3.example.test/bucket/",
      "https://s3.example.test/base/bucket",
      "https://S3.example.test/bucket",
      "https://s3.example.test/%62ucket",
    ];
    for (const endpoint of invalidEndpoints) {
      expect(() => fixtureStore(fetch, { endpoint })).toThrow(InvalidInputError);
    }
    expect(() => fixtureStore(fetch, {
      endpoint: "http://127.0.0.1:9000/bucket",
    })).toThrow(InvalidInputError);
    expect(() => fixtureStore(fetch, {
      endpoint: "http://example.test/bucket",
      allowInsecureLoopbackHttpForTests: true,
    })).toThrow(InvalidInputError);
    expect(() => fixtureStore(fetch, {
      endpoint: "http://127.0.0.1:9000/bucket",
      allowInsecureLoopbackHttpForTests: true,
    })).not.toThrow();
  });

  test("rejects a non-ASCII session token without reflection or provider I/O", () => {
    const sessionToken =
      `private-session-${String.fromCodePoint(0x100)}-marker`;
    let calls = 0;
    try {
      fixtureStore(fakeFetch(() => {
        calls += 1;
        return new Response(null, { status: 200 });
      }), { sessionToken });
      throw new Error("invalid session token should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidInputError);
      expect(serializedError(error)).not.toContain(sessionToken);
    }
    expect(calls).toBe(0);
  });

  test("rejects non-canonical prefixes and signing years outside four digits", async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 200 }));
    for (const prefix of [
      "/capsules",
      "capsules/",
      "capsules//private",
      "capsules/../private",
      "capsules/private key",
      "capsules/%2e%2e",
    ]) {
      expect(() => fixtureStore(fetch, { prefix })).toThrow(InvalidInputError);
    }

    const bytes = new Uint8Array([1]);
    const cid = cidForBytes(bytes);
    const outOfRange = fixtureStore(fetch, {
      now: () => new Date(253_402_300_800_000),
    });
    await expect(outOfRange.get(cid)).rejects.toBeInstanceOf(InvalidInputError);
  });

  test("accepts the exact 1,024-byte S3 object-key ceiling", () => {
    const fetch = fakeFetch(() => new Response(null, { status: 200 }));
    const prefixAtLimit = [
      "a".repeat(255),
      "b".repeat(255),
      "c".repeat(255),
      "d".repeat(196),
    ].join("/");
    const prefixOverLimit = [
      "a".repeat(255),
      "b".repeat(255),
      "c".repeat(255),
      "d".repeat(197),
    ].join("/");
    expect(new TextEncoder().encode(prefixAtLimit).byteLength).toBe(964);
    expect(new TextEncoder().encode(prefixOverLimit).byteLength).toBe(965);
    expect(() => fixtureStore(fetch, { prefix: prefixAtLimit })).not.toThrow();
    expect(() => fixtureStore(fetch, { prefix: prefixOverLimit }))
      .toThrow(InvalidInputError);
  });

  test("maps only an exact bounded NoSuchKey 404 to null", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const cid = cidForBytes(bytes);
    let missingCalls = 0;
    const missing = fixtureStore(fakeFetch(() => {
      missingCalls += 1;
      return new Response(s3ErrorXml("NoSuchKey", cid), { status: 404 });
    }));
    await expect(missing.get(cid)).resolves.toBeNull();
    expect(missingCalls).toBe(1);
  });

  test("treats other and malformed 404 responses as static provider failures", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const cid = cidForBytes(bytes);
    const providerMarker = "provider-private-404-marker";
    const bodies = [
      s3ErrorXml("NoSuchBucket"),
      "",
      "<Error><Code>NoSuchKey</Code>",
      `<Error><Message>${providerMarker}</Message><Code>NoSuchKey</Code></Error>`,
      "<Error><Code>NoSuchKey</Code><Code>NoSuchKey</Code></Error>",
      `<Error><Code>NoSuchKey</Code><Message><Key>${providerMarker}</Key></Message></Error>`,
      `<Error><!-- ${providerMarker} --><Code>NoSuchKey</Code></Error>`,
    ];

    for (const body of bodies) {
      const store = fixtureStore(fakeFetch(() =>
        new Response(body, { status: 404 })
      ));
      try {
        await store.get(cid);
        throw new Error("non-NoSuchKey 404 should have failed");
      } catch (error) {
        expect(error).toBeInstanceOf(StoreError);
        expect(serializedError(error)).not.toContain(providerMarker);
      }
    }
  });

  test("bounds 404 bodies without waiting for response cancellation", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const cid = cidForBytes(bytes);
    const oversized = new Uint8Array((16 * 1_024) + 1);
    const store = fixtureStore(fakeFetch(() => new Response(
      hungCancellationBody(oversized),
      { status: 404 },
    )));

    await expect(settlesWithin(store.get(cid)))
      .rejects.toBeInstanceOf(StoreError);
  });

  test("preserves caller abort while a 404 body and cancellation are pending", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const cid = cidForBytes(bytes);
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        markPullStarted?.();
        return new Promise(() => undefined);
      },
      cancel() {
        return new Promise(() => undefined);
      },
    }), { status: 404 });
    const store = fixtureStore(fakeFetch(() => response));
    const controller = new AbortController();
    const reason = new Error("caller stopped missing-block response");
    const pending = store.get(cid, { signal: controller.signal });
    await pullStarted;
    controller.abort(reason);

    try {
      await settlesWithin(pending);
      throw new Error("missing-block response should have aborted");
    } catch (error) {
      expect(error).toBe(reason);
    }
  });

  test("refuses redirects without retrying", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const cid = cidForBytes(bytes);
    let redirectCalls = 0;
    const redirect = fixtureStore(fakeFetch(() => {
      redirectCalls += 1;
      return new Response(FIXTURE_SECRET_ACCESS_KEY, {
        status: 307,
        headers: {
          location:
            "https://redirect.example.test/" + FIXTURE_SESSION_TOKEN,
        },
      });
    }));
    try {
      await redirect.get(cid);
      throw new Error("redirect should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      const rendered = serializedError(error);
      expect(rendered).not.toContain(FIXTURE_SECRET_ACCESS_KEY);
      expect(rendered).not.toContain(FIXTURE_SESSION_TOKEN);
      expect(rendered).not.toContain("redirect.example.test");
    }
    expect(redirectCalls).toBe(1);
  });

  test("never waits for discarded provider response bodies to cancel", async () => {
    const bytes = new Uint8Array([6, 7, 8]);
    const cid = cidForBytes(bytes);
    const response = (status: number, headers?: HeadersInit) =>
      new Response(hungCancellationBody(new Uint8Array([1])), {
        status,
        headers,
      });

    const redirect = fixtureStore(fakeFetch(() => response(307)));
    await expect(settlesWithin(redirect.get(cid)))
      .rejects.toBeInstanceOf(StoreError);

    const rejected = fixtureStore(fakeFetch(() => response(500)));
    await expect(settlesWithin(rejected.get(cid)))
      .rejects.toBeInstanceOf(StoreError);

    const oversized = fixtureStore(fakeFetch(() =>
      response(200, { "content-length": "2" })
    ));
    await expect(settlesWithin(oversized.get(cid, { maxBytes: 1 })))
      .rejects.toBeInstanceOf(LimitExceededError);

    const accepted = fixtureStore(fakeFetch(() => response(200)));
    await expect(settlesWithin(accepted.put(cid, bytes))).resolves.toEqual({
      attempted: 1,
      stored: 1,
      failed: 0,
    });
  });

  test("bounds declared and streamed GET bodies and PUT bodies", async () => {
    const expected = new Uint8Array(8);
    const cid = cidForBytes(expected);
    let declaredCalls = 0;
    const declared = fixtureStore(fakeFetch(() => {
      declaredCalls += 1;
      return new Response(expected, {
        status: 200,
        headers: { "content-length": "8" },
      });
    }));
    await expect(declared.get(cid, { maxBytes: 7 }))
      .rejects.toBeInstanceOf(LimitExceededError);
    expect(declaredCalls).toBe(1);

    const streamed = fixtureStore(fakeFetch(() => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(4));
          controller.enqueue(new Uint8Array(4));
          controller.close();
        },
      }),
      { status: 200 },
    )));
    await expect(streamed.get(cid, { maxBytes: 7 }))
      .rejects.toBeInstanceOf(LimitExceededError);

    let putCalls = 0;
    const put = fixtureStore(fakeFetch(() => {
      putCalls += 1;
      return new Response(null, { status: 200 });
    }));
    const copyGuarded = new Uint8Array(expected);
    Object.defineProperty(copyGuarded, Symbol.iterator, {
      value() {
        throw new Error("oversized PUT body was copied or hashed");
      },
    });
    await expect(put.put(cid, copyGuarded, { maxBytes: 7 }))
      .rejects.toBeInstanceOf(LimitExceededError);
    expect(putCalls).toBe(0);
  });

  test("honors pre-abort and in-flight abort without reflecting provider failures", async () => {
    const bytes = new Uint8Array([7]);
    const cid = cidForBytes(bytes);
    let calls = 0;
    const store = fixtureStore(fakeFetch((_input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error(
            "provider leak " + FIXTURE_SECRET_ACCESS_KEY,
          ));
        }, { once: true });
      });
    }));

    const pre = new AbortController();
    const preReason = new Error("caller stopped before request");
    pre.abort(preReason);
    try {
      await store.get(cid, { signal: pre.signal });
      throw new Error("pre-aborted read should have failed");
    } catch (error) {
      expect(error).toBe(preReason);
    }
    expect(calls).toBe(0);

    const active = new AbortController();
    const activeReason = new Error("caller stopped active request");
    const pending = store.put(cid, bytes, { signal: active.signal });
    active.abort(activeReason);
    try {
      await pending;
      throw new Error("active write should have failed");
    } catch (error) {
      expect(error).toBe(activeReason);
      expect(serializedError(error)).not.toContain(
        FIXTURE_SECRET_ACCESS_KEY,
      );
    }
    expect(calls).toBe(1);
  });

  test("preserves caller abort while a streamed GET body is pending", async () => {
    const bytes = new Uint8Array([7, 8]);
    const cid = cidForBytes(bytes);
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        markPullStarted?.();
        return new Promise(() => undefined);
      },
    }), { status: 200 });
    const store = fixtureStore(fakeFetch(() => response));
    const controller = new AbortController();
    const reason = new Error("caller stopped streamed body");
    const pending = store.get(cid, { signal: controller.signal });
    await pullStarted;
    controller.abort(reason);
    try {
      await pending;
      throw new Error("streamed read should have aborted");
    } catch (error) {
      expect(error).toBe(reason);
    }
  });

  test("fails tampered reads and keeps the object key path idempotent", async () => {
    const bytes = new Uint8Array([8, 9, 10]);
    const cid = cidForBytes(bytes);
    const tampered = fixtureStore(fakeFetch(() =>
      new Response(new Uint8Array([8, 9, 11]), { status: 200 })
    ));
    await expect(tampered.get(cid)).rejects.toBeInstanceOf(IntegrityError);

    const requests: Array<{ input: string; authorization: string | null }> = [];
    const idempotent = fixtureStore(fakeFetch((input, init) => {
      requests.push({
        input: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(null, { status: 204 });
    }), { prefix: "capsules/v1" });
    await idempotent.put(cid, bytes);
    await idempotent.put(cid, bytes);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]?.input).toBe(
      `https://s3.example.test/evidence-bucket/capsules/v1/${cid}`,
    );
  });

  test("rejects a mismatched PUT CID before any provider request", async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    const mismatchedCid = cidForBytes(new Uint8Array([10, 20, 31]));
    let calls = 0;
    const store = fixtureStore(fakeFetch(() => {
      calls += 1;
      return new Response(null, { status: 200 });
    }));
    await expect(store.put(mismatchedCid, bytes))
      .rejects.toBeInstanceOf(IntegrityError);
    expect(calls).toBe(0);
  });

  test("uses static errors and does not expose stored configuration fields", async () => {
    const providerBodyMarker = "private-provider-response-marker";
    const providerHeaderMarker = "private-provider-header-marker";
    const endpoint = "https://private-storage.example.test/private-bucket";
    const store = fixtureStore(fakeFetch(() => new Response(
      providerBodyMarker,
      {
        status: 500,
        headers: { "x-provider-debug": providerHeaderMarker },
      },
    )), {
      endpoint,
      accessKeyId: "PRIVATEACCESSID",
      secretAccessKey: FIXTURE_SECRET_ACCESS_KEY,
      sessionToken: FIXTURE_SESSION_TOKEN,
    });
    expect(Object.keys(store)).toEqual([]);
    expect(JSON.stringify(store)).toBe("{}");

    const bytes = new Uint8Array([12]);
    const cid = cidForBytes(bytes);
    try {
      await store.get(cid);
      throw new Error("provider rejection should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      const rendered = serializedError(error);
      for (const secret of [
        endpoint,
        "PRIVATEACCESSID",
        FIXTURE_SECRET_ACCESS_KEY,
        FIXTURE_SESSION_TOKEN,
        providerBodyMarker,
        providerHeaderMarker,
      ]) {
        expect(rendered).not.toContain(secret);
      }
    }

    const transportFailure = fixtureStore(fakeFetch(() => {
      throw new Error(
        `${endpoint} ${FIXTURE_SECRET_ACCESS_KEY} ${FIXTURE_SESSION_TOKEN}`,
      );
    }));
    try {
      await transportFailure.get(cid);
      throw new Error("transport failure should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      const rendered = serializedError(error);
      expect(rendered).not.toContain(endpoint);
      expect(rendered).not.toContain(FIXTURE_SECRET_ACCESS_KEY);
      expect(rendered).not.toContain(FIXTURE_SESSION_TOKEN);
    }
  });

  test("accepts a composing MultiBlockStore deadline for hung fetch", async () => {
    const bytes = new Uint8Array([13]);
    const cid = cidForBytes(bytes);
    const hung = fixtureStore(fakeFetch(() => new Promise(() => undefined)));
    const bounded = new MultiBlockStore([hung], { timeoutMs: 10 });
    await expect(bounded.get(cid)).rejects.toBeInstanceOf(StoreError);
  });
});
