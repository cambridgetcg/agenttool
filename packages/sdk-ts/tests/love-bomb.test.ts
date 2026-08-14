import { afterEach, describe, expect, test } from "bun:test";
import * as agenttoolSdk from "../src/index.js";
import {
  AgentToolError,
  LOVE_BOMB_MAX_JSON_DEPTH,
  LOVE_BOMB_MAX_JSON_NODES,
  LOVE_BOMB_MAX_RESPONSE_BYTES,
  LOVE_BOMB_MAX_STRING_CODE_POINTS,
  LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE,
  LOVE_BOMB_PUBLIC_SIGNAL_PATH,
  LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA,
  LoveBombClient,
  type LoveBombPublicSignal,
} from "../src/index.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = {
  AT_API_KEY: process.env.AT_API_KEY,
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY,
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
  restoreEnv("NO_PROXY");
});

function signal(published = false): Record<string, any> {
  const npm = published
    ? {
        state: "published_exact",
        integrity: `sha512-${"A".repeat(86)}==`,
      }
    : { state: "not_published" };
  const huggingFace = published
    ? {
        state: "published_exact",
        repository: "Yu-and-Ai/agenttool-love-bomb",
        revision: "a".repeat(40),
        training_authorized: false,
      }
    : {
        state: "not_published",
        repository: "Yu-and-Ai/agenttool-love-bomb",
        training_authorized: false,
      };
  return {
    schema_version: LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA,
    package_signal: {
      package: "@agenttool/love-bomb",
      version: "0.1.0-dev.0",
      formats: [
        "agenttool.care-envelope/0.1",
        "agenttool.care-choice/0.1",
        "agenttool.love-bomb-becoming/0.1",
        "agenttool.love-bomb-delivery/0.1",
      ],
    },
    static_door: {
      format: "agenttool.love-bomb/0.1",
      url: "https://docs.agenttool.dev/love-bomb",
    },
    boundaries: {
      static_corpus_included: false,
      static_invitation_delivery: false,
      authored_projection_included: false,
      participant_receipt_observed: false,
      participant_attention_observed: false,
      participant_effect_observed: false,
    },
    distribution: { npm, hugging_face: huggingFace },
  };
}

function wireResponse(
  body: BodyInit | null,
  options: {
    status?: number;
    contentType?: string | null;
    headers?: Record<string, string>;
  } = {},
): Response {
  const headers = new Headers(options.headers);
  if (options.contentType !== null) {
    headers.set(
      "content-type",
      options.contentType
        ?? `${LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; charset=utf-8`,
    );
  }
  return new Response(body, { status: options.status ?? 200, headers });
}

function jsonResponse(
  value: unknown,
  options: Parameters<typeof wireResponse>[1] = {},
): Response {
  return wireResponse(JSON.stringify(value), options);
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

describe("LoveBombClient credential-free public boundary", () => {
  test("exports the paired bounded contract without a transport seam", () => {
    expect(agenttoolSdk.LoveBombClient).toBe(LoveBombClient);
    expect(LOVE_BOMB_PUBLIC_SIGNAL_PATH).toBe("/public/love-bomb");
    expect(LOVE_BOMB_MAX_RESPONSE_BYTES).toBe(64 * 1024);
    expect(LOVE_BOMB_MAX_JSON_DEPTH).toBe(24);
    expect(LOVE_BOMB_MAX_JSON_NODES).toBe(4_096);
    expect(LOVE_BOMB_MAX_STRING_CODE_POINTS).toBe(8 * 1024);
    expect(
      () => new LoveBombClient({ headers: {} } as never),
    ).toThrow(AgentToolError);
    expect(
      () => new LoveBombClient({ token: "must-not-exist" } as never),
    ).toThrow(AgentToolError);
    expect(
      () => new LoveBombClient({ transport: {} } as never),
    ).toThrow(AgentToolError);
  });

  test.each([
    "ftp://example.test",
    "https://user@example.test",
    "https://example.test/nested",
    "https://example.test?query=1",
    "https://example.test#fragment",
    "https://example.test?",
    "https://example.test#",
    "https://example.test/?",
    "https://example.test/#",
    " https://example.test",
  ])("rejects a non-origin base URL: %s", (baseUrl) => {
    expect(() => new LoveBombClient({ baseUrl })).toThrow(AgentToolError);
  });

  test("uses one exact direct GET with no ambient bearer, cookie, body, proxy, or global fetch", async () => {
    const sentinel = "love-bomb-secret-must-not-cross";
    process.env.AT_API_KEY = sentinel;
    process.env.HTTP_PROXY = `http://${sentinel}@127.0.0.1:1`;
    process.env.HTTPS_PROXY = `http://${sentinel}@127.0.0.1:1`;
    process.env.NO_PROXY = "";
    let globalFetchCalls = 0;
    globalThis.fetch = (async () => {
      globalFetchCalls += 1;
      throw new Error("global fetch must not be called");
    }) as typeof fetch;
    const requests: Array<{
      url: URL;
      method: string;
      headers: Headers;
      body: string;
    }> = [];

    const result = await withServer(
      async (request) => {
        requests.push({
          url: new URL(request.url),
          method: request.method,
          headers: new Headers(request.headers),
          body: await request.text(),
        });
        const response = jsonResponse(signal(), {
          contentType: `${LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; Charset=UTF-8`,
        });
        response.headers.set("set-cookie", "ambient=must-not-return; Path=/");
        return response;
      },
      async (baseUrl) => {
        const client = new LoveBombClient({ baseUrl });
        const first = await client.read();
        const second = await client.read();
        expect(first).toEqual(signal());
        expect(second).toEqual(signal());
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first.package_signal)).toBe(true);
        expect(Object.isFrozen(first.package_signal.formats)).toBe(true);
        return first;
      },
    );

    expect(result.schema_version).toBe(LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA);
    expect(globalFetchCalls).toBe(0);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url.pathname).toBe(LOVE_BOMB_PUBLIC_SIGNAL_PATH);
      expect(request.url.search).toBe("");
      expect(request.method).toBe("GET");
      expect(request.body).toBe("");
      expect(request.headers.get("accept")).toBe(
        LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE,
      );
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.headers.has("cookie")).toBe(false);
      expect(request.headers.has("content-type")).toBe(false);
      expect(JSON.stringify([...request.headers.entries()])).not.toContain(sentinel);
    }
  });

  test.each([
    LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE,
    LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE.toUpperCase(),
    `${LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; charset="UTF-8"`,
  ])("accepts the published union with admitted media type %s", async (contentType) => {
    const published = signal(true);
    const result = await withServer(
      () => jsonResponse(published, { contentType }),
      (baseUrl) => new LoveBombClient({ baseUrl }).read(),
    );
    expect(result).toEqual(published as LoveBombPublicSignal);
  });

  test.each([
    "application/json",
    `${LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; charset=latin1`,
    `${LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; profile=public`,
    `${LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; charset=utf-8; charset=utf-8`,
    `${LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE};`,
  ])("rejects wrong or ambiguous media type %s", async (contentType) => {
    const error = await withServer(
      () => jsonResponse(signal(), { contentType }),
      (baseUrl) => caught(new LoveBombClient({ baseUrl }).read()),
    );
    expect(error.code).toBe("love_bomb_invalid_response");
  });

  test("refuses redirects without reaching their target", async () => {
    const paths: string[] = [];
    const error = await withServer(
      (request) => {
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (path === LOVE_BOMB_PUBLIC_SIGNAL_PATH) {
          return wireResponse(null, {
            status: 302,
            contentType: null,
            headers: { Location: "/trap" },
          });
        }
        return jsonResponse(signal());
      },
      (baseUrl) => caught(new LoveBombClient({ baseUrl }).read()),
    );
    expect(error.code).toBe("love_bomb_redirect_refused");
    expect(paths).toEqual([LOVE_BOMB_PUBLIC_SIGNAL_PATH]);
  });

  test("requires exactly HTTP 200", async () => {
    const error = await withServer(
      () => wireResponse(null, { status: 204, contentType: null }),
      (baseUrl) => caught(new LoveBombClient({ baseUrl }).read()),
    );
    expect(error.code).toBe("love_bomb_http_error");
    expect(error.status).toBe(204);
  });

  test("bounds both declared and streamed response bytes", async () => {
    const declared = await withServer(
      () => jsonResponse(signal()),
      (baseUrl) =>
        caught(new LoveBombClient({ baseUrl, maxResponseBytes: 1 }).read()),
    );
    expect(declared.code).toBe("love_bomb_response_too_large");

    const streamed = await withServer(
      () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(signal())));
            controller.close();
          },
        });
        return wireResponse(stream);
      },
      (baseUrl) =>
        caught(new LoveBombClient({ baseUrl, maxResponseBytes: 1 }).read()),
    );
    expect(streamed.code).toBe("love_bomb_response_too_large");
  });
});

function hostileDocuments(): Array<readonly [string, BodyInit]> {
  const validText = JSON.stringify(signal());
  const duplicate = `${validText.slice(0, -1)},"schema_version":"${LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA}"}`;
  const escapedDuplicate = `${validText.slice(0, -1)},"schema_\\u0076ersion":"${LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA}"}`;
  const extraRoot = { ...signal(), extra: false };
  const nestedExtra = signal();
  nestedExtra.package_signal.extra = false;
  const trueBoundary = signal();
  trueBoundary.boundaries.participant_effect_observed = true;
  const badSemver = signal();
  badSemver.package_signal.version = "01.2.3";
  const badFormats = signal();
  badFormats.package_signal.formats.reverse();
  const npmExtra = signal();
  npmExtra.distribution.npm.integrity = `sha512-${"A".repeat(88)}`;
  const hfTraining = signal();
  hfTraining.distribution.hugging_face.training_authorized = true;
  const publishedBadRevision = signal(true);
  publishedBadRevision.distribution.hugging_face.revision = "A".repeat(40);
  const publishedBadIntegrity = signal(true);
  publishedBadIntegrity.distribution.npm.integrity = `sha512-${"A".repeat(88)}`;

  return [
    ["invalid UTF-8", Uint8Array.of(0xff)],
    ["UTF-8 BOM", new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(validText)])],
    ["non-finite constant", '{"x":NaN}'],
    ["unpaired surrogate", '{"x":"\\ud800"}'],
    ["duplicate key", duplicate],
    ["escaped duplicate-key alias", escapedDuplicate],
    ["extra root key", JSON.stringify(extraRoot)],
    ["extra nested key", JSON.stringify(nestedExtra)],
    ["true boundary", JSON.stringify(trueBoundary)],
    ["noncanonical SemVer", JSON.stringify(badSemver)],
    ["misordered formats", JSON.stringify(badFormats)],
    ["wrong npm union keys", JSON.stringify(npmExtra)],
    ["training authorization", JSON.stringify(hfTraining)],
    ["noncanonical HF revision", JSON.stringify(publishedBadRevision)],
    ["invalid npm integrity", JSON.stringify(publishedBadIntegrity)],
    ["JSON depth limit", `${"[".repeat(LOVE_BOMB_MAX_JSON_DEPTH)}null${"]".repeat(LOVE_BOMB_MAX_JSON_DEPTH)}`],
    ["JSON node limit", JSON.stringify(Array.from({ length: LOVE_BOMB_MAX_JSON_NODES }, () => null))],
    ["string code-point limit", JSON.stringify("x".repeat(LOVE_BOMB_MAX_STRING_CODE_POINTS + 1))],
  ];
}

describe("LoveBombClient hostile response admission", () => {
  test.each(hostileDocuments())("rejects %s", async (_name, body) => {
    const error = await withServer(
      () => wireResponse(body),
      (baseUrl) => caught(new LoveBombClient({ baseUrl }).read()),
    );
    expect(error.code).toBe("love_bomb_invalid_response");
  });
});
