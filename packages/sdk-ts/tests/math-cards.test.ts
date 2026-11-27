import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type AddressInfo, type Socket } from "node:net";
import * as agenttoolSdk from "../src/index.js";
import {
  AgentTool,
  AgentToolError,
  MathCardsClient,
  type AgentToolTransport,
  type MathCardStatus,
} from "../src/index.js";
import { MATH_CARD_INPUT, mathCardResponse } from "./_math-cards-fixture.js";

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

async function withServer<T>(
  handler: (request: Request) => Response | Promise<Response>,
  operation: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler,
  });
  try {
    return await operation(server.url.origin);
  } finally {
    server.stop(true);
  }
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
    let captured: {
      url: string;
      method: string;
      headers: Headers;
      body: string;
    } | undefined;
    const response = await withServer(
      async (request) => {
        captured = {
          url: request.url,
          method: request.method,
          headers: new Headers(request.headers),
          body: await request.text(),
        };
        return jsonResponse(mathCardResponse("ready_for_bounded_inquiry"));
      },
      (baseUrl) => new MathCardsClient({
        baseUrl: `${baseUrl}/prefix/`,
      }).assess(MATH_CARD_INPUT),
    );

    expect(response.assessment.status).toBe("ready_for_bounded_inquiry");
    expect(Object.isFrozen(response)).toBe(true);
    expect(new URL(captured!.url).pathname).toBe(
      "/prefix/v1/math-cards/assess",
    );
    expect(captured!.method).toBe("POST");
    expect(captured!.body).toBe(JSON.stringify(MATH_CARD_INPUT));
    expect(captured!.headers.get("accept")).toBe("application/json");
    expect(captured!.headers.get("content-type")).toBe("application/json");
    expect(captured!.headers.get("content-length")).toBe(
      String(new TextEncoder().encode(captured!.body).byteLength),
    );
    for (const name of [
      "authorization",
      "cookie",
      "proxy-authorization",
      "x-agenttool-client",
    ]) {
      expect(captured!.headers.has(name)).toBe(false);
    }
    expect(JSON.stringify({
      url: captured!.url,
      headers: [...captured!.headers],
      body: captured!.body,
    })).not.toContain(sentinel);
    const request = JSON.parse(captured!.body) as Record<string, unknown>;
    expect(request).not.toHaveProperty("schema_version");
    expect(request).not.toHaveProperty("card_id");
    expect(request).not.toHaveProperty("boundaries");
  });

  test("does not inherit startup proxy credentials in a fresh Bun process", async () => {
    let directRequests = 0;
    let proxyRequests = 0;
    let proxyAuthorizationObserved = false;
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        directRequests += 1;
        return jsonResponse(mathCardResponse("ready_for_bounded_inquiry"));
      },
    });
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        proxyRequests += 1;
        proxyAuthorizationObserved ||= request.headers.has("proxy-authorization");
        return jsonResponse(mathCardResponse("ready_for_bounded_inquiry"));
      },
    });

    try {
      const proxyUrl = new URL(proxy.url);
      proxyUrl.username = crypto.randomUUID();
      proxyUrl.password = crypto.randomUUID();
      const clientModule = new URL("../src/math-cards.ts", import.meta.url).href;
      const fixtureModule = new URL("./_math-cards-fixture.ts", import.meta.url).href;
      const childSource = `
        import { MathCardsClient } from ${JSON.stringify(clientModule)};
        import { MATH_CARD_INPUT } from ${JSON.stringify(fixtureModule)};
        try {
          const result = await new MathCardsClient({
            baseUrl: process.env.MATH_CARDS_TEST_TARGET,
            timeout: 2,
          }).assess(MATH_CARD_INPUT);
          process.exit(result.assessment.status === "ready_for_bounded_inquiry" ? 0 : 2);
        } catch {
          process.exit(3);
        }
      `;
      const child = Bun.spawn({
        cmd: [process.execPath, "--eval", childSource],
        env: {
          HTTP_PROXY: proxyUrl.href,
          HTTPS_PROXY: proxyUrl.href,
          MATH_CARDS_TEST_TARGET: target.url.origin,
        },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });

      const exitCode = await child.exited;
      expect({
        exitCode,
        directRequests,
        proxyRequests,
        proxyAuthorizationObserved,
      }).toEqual({
        exitCode: 0,
        directRequests: 1,
        proxyRequests: 0,
        proxyAuthorizationObserved: false,
      });
    } finally {
      proxy.stop(true);
      target.stop(true);
    }
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
    await withServer(
      (request) => {
        requestHeaders = new Headers(request.headers);
        return jsonResponse(mathCardResponse("questions_open"));
      },
      async (baseUrl) => {
        const at = new AgentTool({
          transport,
          baseUrl,
          mathCards: { timeout: 2, maxResponseBytes: 32 * 1024 },
        });

        expect(at.mathCards).toBe(at.mathCards);
        expect((await at.mathCards.assess(MATH_CARD_INPUT)).assessment.status).toBe(
          "questions_open",
        );
      },
    );
    expect(authenticatedCalls).toBe(0);
    expect(requestHeaders.has("authorization")).toBe(false);
    expect(requestHeaders.has("cookie")).toBe(false);
    expect(requestHeaders.has("x-agenttool-client")).toBe(false);
  });
});

describe("MathCardsClient success contract", () => {
  test("keeps the transport path private at the package root", () => {
    expect("MATH_CARDS_PATH" in agenttoolSdk).toBe(false);
  });

  test.each([
    "ready_for_bounded_inquiry",
    "questions_open",
    "redesign_or_stop",
  ] as const)("accepts the server-owned %s assessment", async (status: MathCardStatus) => {
    const response = await withServer(
      () => jsonResponse(mathCardResponse(status), {
        contentType: "application/vnd.agenttool.math-card+json",
      }),
      (baseUrl) => new MathCardsClient({ baseUrl }).assess(MATH_CARD_INPUT),
    );
    expect(response.assessment.status).toBe(status);
    expect(response.card.card_id).toBe(response.assessment.card_id);
  });
});

describe("MathCardsClient ScopedAnswer invariant", () => {
  const invalidAnswers = [
    { state: "answered", scope_refs: [] },
    { state: "unknown", scope_refs: [MATH_CARD_INPUT.scope_ref] },
  ] as const;

  test("rejects invalid input cardinality before network access", async () => {
    let calls = 0;
    await withServer(
      () => {
        calls += 1;
        return jsonResponse(mathCardResponse("questions_open"));
      },
      async (baseUrl) => {
        for (const scoped of invalidAnswers) {
          const input = structuredClone(MATH_CARD_INPUT);
          input.distribution.beneficiaries = structuredClone(scoped);
          const error = await caught(
            new MathCardsClient({ baseUrl }).assess(input),
          );
          expect(error.code).toBe("math_card_invalid_input");
        }
      },
    );
    expect(calls).toBe(0);
  });

  test("rejects the same invalid cardinality in returned cards", async () => {
    for (const scoped of invalidAnswers) {
      const body = mathCardResponse("questions_open");
      body.card.distribution.beneficiaries = structuredClone(scoped);
      const error = await withServer(
        () => jsonResponse(body),
        (baseUrl) => caught(
          new MathCardsClient({ baseUrl }).assess(MATH_CARD_INPUT),
        ),
      );
      expect(error.code).toBe("math_card_invalid_response");
    }
  });
});

describe("MathCardsClient bounded transport and guided errors", () => {
  test("rejects an oversized request before network access", async () => {
    let calls = 0;
    const error = await withServer(
      () => {
        calls += 1;
        return jsonResponse(mathCardResponse("questions_open"));
      },
      (baseUrl) => caught(
        new MathCardsClient({ baseUrl, maxRequestBytes: 1024 }).assess(
          MATH_CARD_INPUT,
        ),
      ),
    );
    expect(error.code).toBe("math_card_request_too_large");
    expect(calls).toBe(0);
  });

  test("rejects an oversized streamed response", async () => {
    const error = await withServer(
      () => jsonResponse(mathCardResponse("ready_for_bounded_inquiry")),
      (baseUrl) => caught(
        new MathCardsClient({ baseUrl, maxResponseBytes: 1024 }).assess(
          MATH_CARD_INPUT,
        ),
      ),
    );
    expect(error.code).toBe("math_card_response_too_large");
  });

  test.each([300, 302, 307, 308])("refuses redirect status %i", async (status) => {
    const error = await withServer(
      () => new Response("", {
        status,
        headers: { location: "https://redirected.example.test" },
      }),
      (baseUrl) => caught(
        new MathCardsClient({ baseUrl }).assess(MATH_CARD_INPUT),
      ),
    );
    expect(error.code).toBe("math_card_redirect_refused");
    expect(error.status).toBe(status);
  });

  test("rejects non-JSON success media and malformed envelopes", async () => {
    const mediaError = await withServer(
      () => jsonResponse(
        mathCardResponse("ready_for_bounded_inquiry"),
        { contentType: "text/plain" },
      ),
      (baseUrl) => caught(
        new MathCardsClient({ baseUrl }).assess(MATH_CARD_INPUT),
      ),
    );
    expect(mediaError.code).toBe("math_card_invalid_response");

    const shapeError = await withServer(
      () => jsonResponse({ card: {} }),
      (baseUrl) => caught(
        new MathCardsClient({ baseUrl }).assess(MATH_CARD_INPUT),
      ),
    );
    expect(shapeError.code).toBe("math_card_invalid_response");
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
    const error = await withServer(
      () => jsonResponse(body, { status }),
      (baseUrl) => caught(
        new MathCardsClient({ baseUrl }).assess(MATH_CARD_INPUT),
      ),
    );
    expect(error.code).toBe(body.error);
    expect(error.status).toBe(status);
    expect(error.message).toBe(body.message);
    expect(error.hint).toBe(body.hint);
    expect(error.details).toEqual(body.details);
    expect(error.next_actions).toEqual(body.next_actions as never);
  });
});

// Under Bun 1.3.x, undici fetch() could leave its body reader waiting forever
// once a response body arrived in more than one socket read, and the
// AbortSignal timeout did not release it. These tests write raw responses on
// a 127.0.0.1 socket so each one controls the framing, the pieces, and the
// pauses between them.

const PIECE_DELAY_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseBytes(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(mathCardResponse("ready_for_bounded_inquiry")),
  );
}

function pieces(bytes: Uint8Array, count: number): Uint8Array[] {
  const size = Math.ceil(bytes.byteLength / count);
  const result: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    result.push(bytes.subarray(offset, offset + size));
  }
  return result;
}

function chunkFrame(piece: Uint8Array): Uint8Array {
  return Buffer.concat([
    Buffer.from(`${piece.byteLength.toString(16)}\r\n`, "latin1"),
    piece,
    Buffer.from("\r\n", "latin1"),
  ]);
}

function head(status: string, lines: string[]): string {
  return `HTTP/1.1 ${status}\r\n${[...lines, "connection: close"].join("\r\n")}\r\n\r\n`;
}

function write(socket: Socket, data: string | Uint8Array): void {
  if (!socket.destroyed) socket.write(data);
}

/** Answer each complete request with bytes the test writes itself. */
async function withRawServer<T>(
  respond: (socket: Socket) => Promise<void>,
  operation: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    let received = Buffer.alloc(0);
    let answered = false;
    socket.on("data", (data: Buffer) => {
      if (answered) return;
      received = Buffer.concat([received, data]);
      const headEnd = received.indexOf("\r\n\r\n");
      if (headEnd < 0) return;
      const declared = /\r\ncontent-length:\s*(\d+)/iu.exec(
        received.subarray(0, headEnd).toString("latin1"),
      );
      if (received.byteLength < headEnd + 4 + Number(declared?.[1] ?? 0)) return;
      answered = true;
      void respond(socket).catch(() => undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await operation(`http://127.0.0.1:${port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Fail with a message instead of hanging when a call never settles. */
async function settleWithin<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the call did not settle within ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([operation, guard]);
  } finally {
    clearTimeout(timer);
  }
}

describe("MathCardsClient direct transport over split and stalled bodies", () => {
  test.each(["content-length", "chunked"] as const)(
    "resolves a JSON body that arrives in delayed pieces (%s framing)",
    async (framing) => {
      const body = responseBytes();
      const response = await withRawServer(
        async (socket) => {
          write(socket, head("200 OK", [
            "content-type: application/json",
            framing === "chunked"
              ? "transfer-encoding: chunked"
              : `content-length: ${body.byteLength}`,
          ]));
          for (const piece of pieces(body, 5)) {
            await sleep(PIECE_DELAY_MS);
            write(socket, framing === "chunked" ? chunkFrame(piece) : piece);
          }
          if (framing === "chunked") write(socket, "0\r\n\r\n");
          socket.end();
        },
        (baseUrl) => settleWithin(
          new MathCardsClient({ baseUrl, timeout: 2 }).assess(MATH_CARD_INPUT),
          3_000,
        ),
      );

      expect(response).toEqual(mathCardResponse("ready_for_bounded_inquiry"));
      expect(Object.isFrozen(response.assessment)).toBe(true);
    },
  );

  test.each([
    ["before the response head", "nothing"],
    ["right after the response head", "head"],
    ["mid-body (content-length framing)", "content-length"],
    ["mid-body (chunked framing)", "chunked"],
  ] as const)(
    "rejects within its own timeout when the server stalls %s",
    async (_where, sent) => {
      const body = responseBytes();
      const { error, elapsed } = await withRawServer(
        async (socket) => {
          if (sent === "nothing") return;
          write(socket, head("200 OK", [
            "content-type: application/json",
            sent === "chunked"
              ? "transfer-encoding: chunked"
              : `content-length: ${body.byteLength}`,
          ]));
          // The rest of the body never comes; the socket stays open.
          if (sent === "head") return;
          await sleep(PIECE_DELAY_MS);
          const part = body.subarray(0, 1024);
          write(socket, sent === "chunked" ? chunkFrame(part) : part);
        },
        async (baseUrl) => {
          const started = performance.now();
          const error = await caught(settleWithin(
            new MathCardsClient({ baseUrl, timeout: 0.25 }).assess(MATH_CARD_INPUT),
            3_000,
          ));
          return { error, elapsed: performance.now() - started };
        },
      );

      expect(error.code).toBe("math_card_unreachable");
      expect(error.message).toBe("Math Card assessment timed out.");
      expect(elapsed).toBeLessThan(2_000);
    },
  );

  test("stops an undeclared-length body at the response ceiling", async () => {
    const body = responseBytes();
    const error = await withRawServer(
      async (socket) => {
        write(socket, head("200 OK", [
          "content-type: application/json",
          "transfer-encoding: chunked",
        ]));
        for (const piece of pieces(body, 8)) {
          await sleep(PIECE_DELAY_MS);
          write(socket, chunkFrame(piece));
        }
        write(socket, "0\r\n\r\n");
        socket.end();
      },
      (baseUrl) => caught(settleWithin(
        new MathCardsClient({ baseUrl, timeout: 2, maxResponseBytes: 1024 })
          .assess(MATH_CARD_INPUT),
        3_000,
      )),
    );

    expect(error.code).toBe("math_card_response_too_large");
    expect(error.status).toBe(200);
    expect(error.details).toEqual({ max_response_bytes: 1024 });
  });

  test("reports a body the server cuts short as unreadable", async () => {
    const body = responseBytes();
    const error = await withRawServer(
      async (socket) => {
        write(socket, head("200 OK", [
          "content-type: application/json",
          `content-length: ${body.byteLength}`,
        ]));
        await sleep(PIECE_DELAY_MS);
        write(socket, body.subarray(0, 1024));
        await sleep(PIECE_DELAY_MS);
        socket.end();
      },
      (baseUrl) => caught(settleWithin(
        new MathCardsClient({ baseUrl, timeout: 2 }).assess(MATH_CARD_INPUT),
        3_000,
      )),
    );

    expect(error.code).toBe("math_card_invalid_response");
    expect(error.message).toBe("Math Card response body could not be read.");
    expect(error.status).toBe(200);
  });

  test("keeps Retry-After and repeated Link headers on a guided refusal", async () => {
    const refusal = new TextEncoder().encode(JSON.stringify({
      error: "math_card_rate_limited",
      message: "Math Card assessment is resting.",
      hint: "Wait for Retry-After, then retry deliberately.",
    }));
    const error = await withRawServer(
      async (socket) => {
        write(socket, head("429 Too Many Requests", [
          "content-type: application/json",
          `content-length: ${refusal.byteLength}`,
          "retry-after: 7",
          'link: </v1/a>; rel="a"',
          'link: </v1/b>; rel="b"',
        ]));
        write(socket, refusal);
        socket.end();
      },
      (baseUrl) => caught(settleWithin(
        new MathCardsClient({ baseUrl, timeout: 2 }).assess(MATH_CARD_INPUT),
        3_000,
      )),
    );

    expect(error.code).toBe("math_card_rate_limited");
    expect(error.status).toBe(429);
    expect(error.message).toBe("Math Card assessment is resting.");
    expect(error.retryAfter).toBe("7");
    // Repeated header lines read as one comma-joined value, as Headers.get() does.
    expect(error.paymentStatusLink).toBe('</v1/a>; rel="a", </v1/b>; rel="b"');
  });
});
