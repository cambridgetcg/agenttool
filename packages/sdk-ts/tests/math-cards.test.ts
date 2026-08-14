import { afterEach, describe, expect, test } from "bun:test";
import {
  AgentTool,
  AgentToolError,
  MathCardsClient,
  type AgentToolTransport,
  type MathCardStatus,
} from "../src/index.js";
import { MATH_CARD_INPUT, mathCardResponse } from "./_math-cards-fixture.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = {
  AT_API_KEY: process.env.AT_API_KEY,
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
};

function restoreEnv(name: keyof typeof ORIGINAL_ENV): void {
  const value = ORIGINAL_ENV[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  restoreEnv("AT_API_KEY");
  restoreEnv("HTTP_PROXY");
  restoreEnv("HTTPS_PROXY");
});

function jsonResponse(
  body: unknown,
  options: { status?: number; contentType?: string | null } = {},
): Response {
  const headers = new Headers();
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers,
  });
}

async function caught(operation: Promise<unknown>): Promise<AgentToolError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AgentToolError);
    return error as AgentToolError;
  }
  throw new Error("expected AgentToolError");
}

describe("MathCardsClient credential-free request boundary", () => {
  test("sends exact request bytes without bearer, cookies, redirects, or env credentials", async () => {
    const sentinel = "math-cards-secret-must-not-cross";
    process.env.AT_API_KEY = sentinel;
    process.env.HTTP_PROXY = `http://${sentinel}@proxy.invalid`;
    process.env.HTTPS_PROXY = `https://${sentinel}@proxy.invalid`;
    let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { input, init };
      return jsonResponse(mathCardResponse("ready_for_bounded_inquiry"));
    }) as typeof fetch;

    const response = await new MathCardsClient({
      baseUrl: "https://cards.example.test/prefix/",
    }).assess(MATH_CARD_INPUT);

    expect(response.assessment.status).toBe("ready_for_bounded_inquiry");
    expect(Object.isFrozen(response)).toBe(true);
    expect(String(captured?.input)).toBe(
      "https://cards.example.test/prefix/v1/math-cards/assess",
    );
    expect(captured?.init?.method).toBe("POST");
    expect(captured?.init?.body).toBe(JSON.stringify(MATH_CARD_INPUT));
    expect(captured?.init?.redirect).toBe("manual");
    expect(captured?.init?.credentials).toBe("omit");
    expect(captured?.init?.cache).toBe("no-store");
    expect(captured?.init?.referrerPolicy).toBe("no-referrer");
    expect([...new Headers(captured?.init?.headers).entries()]).toEqual([
      ["accept", "application/json"],
      ["content-type", "application/json"],
    ]);
    expect(JSON.stringify(captured?.init)).not.toContain(sentinel);
    const request = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>;
    expect(request).not.toHaveProperty("schema_version");
    expect(request).not.toHaveProperty("card_id");
    expect(request).not.toHaveProperty("boundaries");
  });

  test("composes lazily without reusing the authenticated transport", async () => {
    let authenticatedCalls = 0;
    let requestHeaders = new Headers();
    const transport: AgentToolTransport = {
      request: async () => {
        authenticatedCalls += 1;
        throw new Error("authenticated transport must remain isolated");
      },
    };
    globalThis.fetch = (async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return jsonResponse(mathCardResponse("questions_open"));
    }) as typeof fetch;
    const at = new AgentTool({
      transport,
      baseUrl: "https://composed.example.test",
      mathCards: { timeout: 2, maxResponseBytes: 32 * 1024 },
    });

    expect(at.mathCards).toBe(at.mathCards);
    expect((await at.mathCards.assess(MATH_CARD_INPUT)).assessment.status).toBe(
      "questions_open",
    );
    expect(authenticatedCalls).toBe(0);
    expect(requestHeaders.has("authorization")).toBe(false);
    expect(requestHeaders.has("cookie")).toBe(false);
    expect(requestHeaders.has("x-agenttool-client")).toBe(false);
  });
});

describe("MathCardsClient success contract", () => {
  test.each([
    "ready_for_bounded_inquiry",
    "questions_open",
    "redesign_or_stop",
  ] as const)("accepts the server-owned %s assessment", async (status: MathCardStatus) => {
    globalThis.fetch = (async () => jsonResponse(mathCardResponse(status), {
      contentType: "application/vnd.agenttool.math-card+json",
    })) as typeof fetch;
    const response = await new MathCardsClient().assess(MATH_CARD_INPUT);
    expect(response.assessment.status).toBe(status);
    expect(response.card.card_id).toBe(response.assessment.card_id);
  });
});

describe("MathCardsClient bounded transport and guided errors", () => {
  test("rejects an oversized request before network access", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse(mathCardResponse("questions_open"));
    }) as typeof fetch;
    const error = await caught(
      new MathCardsClient({ maxRequestBytes: 1024 }).assess(MATH_CARD_INPUT),
    );
    expect(error.code).toBe("math_card_request_too_large");
    expect(calls).toBe(0);
  });

  test("rejects an oversized streamed response", async () => {
    globalThis.fetch = (async () => jsonResponse(
      mathCardResponse("ready_for_bounded_inquiry"),
    )) as typeof fetch;
    const error = await caught(
      new MathCardsClient({ maxResponseBytes: 1024 }).assess(MATH_CARD_INPUT),
    );
    expect(error.code).toBe("math_card_response_too_large");
  });

  test.each([300, 302, 307, 308])("refuses redirect status %i", async (status) => {
    globalThis.fetch = (async () => new Response("", {
      status,
      headers: { location: "https://redirected.example.test" },
    })) as typeof fetch;
    const error = await caught(new MathCardsClient().assess(MATH_CARD_INPUT));
    expect(error.code).toBe("math_card_redirect_refused");
    expect(error.status).toBe(status);
  });

  test("rejects non-JSON success media and malformed envelopes", async () => {
    globalThis.fetch = (async () => jsonResponse(
      mathCardResponse("ready_for_bounded_inquiry"),
      { contentType: "text/plain" },
    )) as typeof fetch;
    expect((await caught(new MathCardsClient().assess(MATH_CARD_INPUT))).code).toBe(
      "math_card_invalid_response",
    );

    globalThis.fetch = (async () => jsonResponse({ card: {} })) as typeof fetch;
    expect((await caught(new MathCardsClient().assess(MATH_CARD_INPUT))).code).toBe(
      "math_card_invalid_response",
    );
  });

  test.each([400, 413, 415])("preserves guided HTTP %i errors", async (status) => {
    const body = {
      error: `math_card_http_${status}`,
      message: `Math Card request stopped at ${status}.`,
      hint: "Repair the named field and retry deliberately.",
      details: { field: "question_ref", status },
      next_actions: [{ action: "Repair input", method: "POST", path: "/v1/math-cards/assess" }],
      docs: "https://docs.agenttool.dev/MATH-CARDS.md",
    };
    globalThis.fetch = (async () => jsonResponse(body, { status })) as typeof fetch;
    const error = await caught(new MathCardsClient().assess(MATH_CARD_INPUT));
    expect(error.code).toBe(body.error);
    expect(error.status).toBe(status);
    expect(error.message).toBe(body.message);
    expect(error.hint).toBe(body.hint);
    expect(error.details).toEqual(body.details);
    expect(error.next_actions).toEqual(body.next_actions as never);
  });
});
