import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";

import documentRouter from "../src/routes/tools/document";
import {
  DOCUMENT_MAX_JSON_REQUEST_BYTES,
  SCRAPE_MAX_JSON_REQUEST_BYTES,
  readBoundedJson,
} from "../src/routes/tools/request-body";
import scrapeRouter from "../src/routes/tools/scrape";

type ToolRouter = Hono<any>;

const ROUTES: Array<{
  name: string;
  router: ToolRouter;
  maxBytes: number;
}> = [
  {
    name: "scrape",
    router: scrapeRouter,
    maxBytes: SCRAPE_MAX_JSON_REQUEST_BYTES,
  },
  {
    name: "document",
    router: documentRouter,
    maxBytes: DOCUMENT_MAX_JSON_REQUEST_BYTES,
  },
];

function streamedRequest(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
  cancelled?: () => void,
  close = false,
): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
    cancel() {
      cancelled?.();
    },
  });
  return new Request("http://local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function expectTooLarge(
  router: ToolRouter,
  request: Request | RequestInit,
  maxBytes: number,
): Promise<void> {
  const response = request instanceof Request
    ? await router.request(request)
    : await router.request("/", request);
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    error: "request_body_too_large",
    message:
      `The JSON request body exceeds this route's ${maxBytes}-byte limit.`,
    max_bytes: maxBytes,
    docs: "https://docs.agenttool.dev/tools",
  });
}

describe("static tool JSON request byte limits", () => {
  for (const { name, router, maxBytes } of ROUTES) {
    test(`${name} rejects an oversized Content-Length before JSON parsing`, async () => {
      await expectTooLarge(
        router,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(maxBytes + 1),
          },
          body: "{}",
        },
        maxBytes,
      );
    });

    test(`${name} counts streamed bodies without Content-Length`, async () => {
      let cancelled = false;
      const request = streamedRequest(
        [new Uint8Array(maxBytes), new Uint8Array([0x20])],
        { "transfer-encoding": "chunked" },
        () => {
          cancelled = true;
        },
      );
      expect(request.headers.has("content-length")).toBe(false);
      expect(request.headers.get("transfer-encoding")).toBe("chunked");
      await expectTooLarge(router, request, maxBytes);
      expect(cancelled).toBe(true);
    });

    test(`${name} does not trust a smaller declared length over streamed bytes`, async () => {
      const request = streamedRequest(
        [new Uint8Array(maxBytes), new Uint8Array([0x20])],
        { "content-length": String(maxBytes) },
      );
      await expectTooLarge(router, request, maxBytes);
    });
  }

  test("the streaming reader accepts an exact-byte JSON body", async () => {
    const request = streamedRequest([
      new TextEncoder().encode("null "),
    ], {}, undefined, true);
    expect(await readBoundedJson(request, 5)).toBeNull();
  });
});
