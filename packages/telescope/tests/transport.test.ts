import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { DEFAULT_LIMITS } from "../src/constants.js";
import { fetchDocument, ScanBudget } from "../src/transport.js";
import type {
  FetchLike,
  ResolveHostname,
  TelescopeLimits,
} from "../src/types.js";

const START_URL = "https://agent.example.net/.well-known/agent.txt";
const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 } as const;
const resolvePublic: ResolveHostname = async () => [PUBLIC_ADDRESS];

function limits(overrides: Partial<TelescopeLimits> = {}): TelescopeLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

function responseAt(
  url: string,
  body: BodyInit | null,
  init?: ResponseInit,
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

async function fetchAgentDocument(input: {
  fetch: FetchLike;
  resolve_hostname?: ResolveHostname;
  limits?: TelescopeLimits;
  budget?: ScanBudget;
  signal?: AbortSignal;
}) {
  const effectiveLimits = input.limits ?? limits();
  return fetchDocument({
    id: "agent_txt",
    url: START_URL,
    accept: "text/agent, text/plain;q=0.9",
    fetch: input.fetch,
    resolve_hostname: input.resolve_hostname ?? resolvePublic,
    budget: input.budget ?? new ScanBudget(effectiveLimits),
    limits: effectiveLimits,
    signal: input.signal ?? new AbortController().signal,
  });
}

describe("fetchDocument request boundary", () => {
  test("uses a credential-free manual GET with conservative headers", async () => {
    let capturedUrl: string | URL | Request | null = null;
    let capturedInit: RequestInit | undefined;
    const controller = new AbortController();
    const fetch: FetchLike = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response("hello", {
        status: 200,
        headers: { "content-type": "Text/Plain; Charset=UTF-8" },
      });
    };

    const result = await fetchAgentDocument({
      fetch,
      signal: controller.signal,
    });

    expect(capturedUrl).toBeInstanceOf(URL);
    expect((capturedUrl as URL).href).toBe(START_URL);
    expect(capturedInit?.method).toBe("GET");
    expect(capturedInit?.redirect).toBe("manual");
    expect(capturedInit?.credentials).toBe("omit");
    expect(capturedInit?.cache).toBe("no-store");
    expect(capturedInit?.referrerPolicy).toBe("no-referrer");
    expect(capturedInit?.signal).toBe(controller.signal);

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("accept")).toBe("text/agent, text/plain;q=0.9");
    expect(headers.get("accept-encoding")).toBe("identity");
    expect(headers.get("user-agent")).toBe(
      "@agenttool/telescope/0.0.0-development",
    );
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();

    expect(result.observation).toEqual({
      id: "agent_txt",
      url: START_URL,
      url_redacted: false,
      state: "present",
      status_code: 200,
      final_url: START_URL,
      final_url_redacted: false,
      redirect_chain: [],
      redirect_chain_redacted: false,
      media_type: "text/plain",
      bytes: 5,
      sha256: createHash("sha256").update("hello").digest("hex"),
      error_code: null,
    });
    expect(new TextDecoder().decode(result.body!)).toBe("hello");
  });

  test("revalidates each relative redirect and records the chain", async () => {
    const fetched: string[] = [];
    const resolved: string[] = [];
    const fetch: FetchLike = async (url) => {
      const href = (url as URL).href;
      fetched.push(href);
      if (fetched.length === 1) {
        return responseAt(href, null, {
          status: 302,
          headers: { location: "/cards/current?token=remote-secret" },
        });
      }
      return responseAt(href, "ok", { status: 200 });
    };
    const resolveHostname: ResolveHostname = async (hostname) => {
      resolved.push(hostname);
      return [PUBLIC_ADDRESS];
    };

    const result = await fetchAgentDocument({
      fetch,
      resolve_hostname: resolveHostname,
    });

    expect(fetched).toEqual([
      START_URL,
      "https://agent.example.net/cards/current?token=remote-secret",
    ]);
    expect(resolved).toEqual([
      "agent.example.net",
      "agent.example.net",
      "agent.example.net",
    ]);
    expect(result.observation.state).toBe("present");
    expect(result.observation.final_url).toBe(
      "https://agent.example.net/cards/current?redacted",
    );
    expect(result.observation.final_url_redacted).toBe(true);
    expect(result.observation.redirect_chain).toEqual([
      "https://agent.example.net/cards/current?redacted",
    ]);
    expect(result.observation.redirect_chain_redacted).toBe(true);
    expect(JSON.stringify(result.observation)).not.toContain("remote-secret");
  });

  test("blocks a redirect whose DNS set mixes public and private addresses", async () => {
    let fetchCalls = 0;
    const fetch: FetchLike = async (url) => {
      fetchCalls += 1;
      return responseAt((url as URL).href, null, {
        status: 307,
        headers: { location: "https://mixed.example.net/private" },
      });
    };
    const resolveHostname: ResolveHostname = async (hostname) =>
      hostname === "mixed.example.net"
        ? [PUBLIC_ADDRESS, { address: "192.168.1.20", family: 4 }]
        : [PUBLIC_ADDRESS];

    const result = await fetchAgentDocument({
      fetch,
      resolve_hostname: resolveHostname,
    });

    expect(fetchCalls).toBe(1);
    expect(result.body).toBeNull();
    expect(result.observation.state).toBe("blocked");
    expect(result.observation.error_code).toBe("non_public_address");
    expect(result.observation.redirect_chain).toEqual([]);
  });

  test("does not record credentials from a rejected redirect locator", async () => {
    const result = await fetchAgentDocument({
      fetch: async (url) =>
        responseAt((url as URL).href, null, {
          status: 302,
          headers: {
            location: "https://user:secret@redirect.example.net/card",
          },
        }),
    });

    expect(result.observation.state).toBe("blocked");
    expect(result.observation.error_code).toBe("credentials_not_allowed");
    expect(result.observation.redirect_chain).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("reports redirects without Location and exhausted redirect budgets", async () => {
    const missingLocation = await fetchAgentDocument({
      fetch: async (url) =>
        responseAt((url as URL).href, null, { status: 301 }),
    });
    expect(missingLocation.observation).toMatchObject({
      state: "unreachable",
      status_code: 301,
      final_url: START_URL,
      error_code: "redirect_without_location",
    });

    let redirects = 0;
    const exhausted = await fetchAgentDocument({
      limits: limits({ max_redirects: 1 }),
      fetch: async (url) => {
        redirects += 1;
        return responseAt((url as URL).href, null, {
          status: 308,
          headers: { location: `/hop-${redirects}` },
        });
      },
    });
    expect(redirects).toBe(2);
    expect(exhausted.observation.state).toBe("blocked");
    expect(exhausted.observation.error_code).toBe("redirect_limit_exhausted");
    expect(exhausted.observation.redirect_chain).toEqual([
      "https://agent.example.net/hop-1",
    ]);
  });

  test("rejects a transport that follows a redirect despite manual mode", async () => {
    const result = await fetchAgentDocument({
      fetch: async () =>
        responseAt("https://other.example.net/card", "followed", {
          status: 200,
        }),
    });

    expect(result.observation.state).toBe("blocked");
    expect(result.observation.error_code).toBe("unexpected_followed_redirect");
  });
});

describe("fetchDocument response classification", () => {
  for (const [status, state, errorCode] of [
    [404, "not_found", null],
    [410, "not_found", null],
    [401, "restricted", null],
    [403, "restricted", null],
    [429, "unreachable", "http_error"],
    [500, "unreachable", "http_error"],
  ] as const) {
    test(`classifies HTTP ${status} as ${state}`, async () => {
      const result = await fetchAgentDocument({
        fetch: async (url) =>
          responseAt((url as URL).href, "discard me", {
            status,
            headers: { "content-type": "application/json; charset=utf-8" },
          }),
      });

      expect(result.body).toBeNull();
      expect(result.observation).toMatchObject({
        state,
        status_code: status,
        final_url: START_URL,
        media_type: "application/json",
        bytes: null,
        sha256: null,
        error_code: errorCode,
      });
    });
  }

  test("classifies generic network failures without leaking their details", async () => {
    const result = await fetchAgentDocument({
      fetch: async () => {
        throw new Error("sensitive upstream detail");
      },
    });

    expect(result.observation.state).toBe("unreachable");
    expect(result.observation.error_code).toBe("network_failure");
  });

  test("normalizes a non-HTTP status zero to a schema-safe null", async () => {
    const result = await fetchAgentDocument({
      fetch: async () => Response.error(),
    });
    expect(result.observation.state).toBe("unreachable");
    expect(result.observation.status_code).toBeNull();
    expect(result.observation.error_code).toBe("http_error");
  });

  test("forwards and classifies caller aborts", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null = null;
    let signalFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    const fetch: FetchLike = async (_url, init) => {
      receivedSignal = init?.signal ?? null;
      signalFetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    };

    const pending = fetchAgentDocument({ fetch, signal: controller.signal });
    await fetchStarted;
    controller.abort();
    const result = await pending;

    expect(receivedSignal).toBe(controller.signal);
    expect(result.observation.state).toBe("unreachable");
    expect(result.observation.error_code).toBe("aborted_or_timed_out");
  });
});

describe("fetchDocument byte limits", () => {
  test("rejects an oversized declared Content-Length before reading", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const result = await fetchAgentDocument({
      limits: limits({ max_response_bytes: 5 }),
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-length": "6" },
        }),
    });

    expect(result.body).toBeNull();
    expect(result.observation.state).toBe("too_large");
    expect(result.observation.error_code).toBe("response_too_large");
    expect(canceled).toBe(true);
  });

  test("rejects a streamed body that crosses the per-document cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.enqueue(new TextEncoder().encode("def"));
        controller.close();
      },
    });
    const result = await fetchAgentDocument({
      limits: limits({ max_response_bytes: 5 }),
      fetch: async () => new Response(stream, { status: 200 }),
    });

    expect(result.body).toBeNull();
    expect(result.observation.state).toBe("too_large");
    expect(result.observation.error_code).toBe("response_too_large");
  });

  test("enforces the aggregate byte cap across documents sharing a budget", async () => {
    const effectiveLimits = limits({
      max_response_bytes: 4,
      max_total_bytes: 5,
    });
    const budget = new ScanBudget(effectiveLimits);
    const first = await fetchAgentDocument({
      limits: effectiveLimits,
      budget,
      fetch: async () => new Response("abc", { status: 200 }),
    });
    const second = await fetchAgentDocument({
      limits: effectiveLimits,
      budget,
      fetch: async () => new Response("def", { status: 200 }),
    });

    expect(first.observation.state).toBe("present");
    expect(second.body).toBeNull();
    expect(second.observation.state).toBe("too_large");
    expect(second.observation.error_code).toBe("total_byte_budget_exhausted");
  });

  test("rejects invalid Content-Length and non-identity content encoding", async () => {
    const invalidLength = await fetchAgentDocument({
      fetch: async () =>
        new Response("body", {
          status: 200,
          headers: { "content-length": "unknown" },
        }),
    });
    expect(invalidLength.observation.state).toBe("blocked");
    expect(invalidLength.observation.error_code).toBe("invalid_content_length");

    const encoded = await fetchAgentDocument({
      fetch: async () =>
        new Response("compressed bytes", {
          status: 200,
          headers: { "content-encoding": "gzip" },
        }),
    });
    expect(encoded.observation.state).toBe("blocked");
    expect(encoded.observation.error_code).toBe("unexpected_content_encoding");
  });

  test("enforces the request budget before invoking fetch", async () => {
    const effectiveLimits = limits({ max_requests: 1 });
    const budget = new ScanBudget(effectiveLimits);
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return new Response("ok", { status: 200 });
    };

    const first = await fetchAgentDocument({
      fetch,
      limits: effectiveLimits,
      budget,
    });
    const second = await fetchAgentDocument({
      fetch,
      limits: effectiveLimits,
      budget,
    });

    expect(first.observation.state).toBe("present");
    expect(second.observation.state).toBe("blocked");
    expect(second.observation.error_code).toBe("request_budget_exhausted");
    expect(calls).toBe(1);
  });
});
