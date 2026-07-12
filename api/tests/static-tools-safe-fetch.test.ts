import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  SAFE_NET_DEFAULT_TIMEOUT_MS,
  SAFE_NET_MAX_REDIRECTS,
  SafeNetError,
  safeNetGet,
  type SafeNetRequestOptions,
  type SafeNetResponse,
} from "../src/services/net/safe-fetch";
import { safeFetchFailureResponse } from "../src/routes/tools/safe-fetch-errors";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_CONTENT_BYTES,
  DocumentError,
  parseDocument,
} from "../src/services/tools/document";
import {
  SCRAPE_MAX_BYTES,
  SCRAPE_MAX_CONTENT_BYTES,
  ScrapeError,
  scrape,
} from "../src/services/tools/scrape";

type SafeGet = typeof safeNetGet;

test("static route mapping returns retryable 503 on safe-net saturation", async () => {
  const app = new Hono();
  app.get("/", (c) =>
    safeFetchFailureResponse(
      c,
      new SafeNetError("safe_net_overloaded"),
      "page",
    ));

  const result = await app.request("/");
  expect(result.status).toBe(503);
  expect(result.headers.get("Retry-After")).toBe("1");
  expect(await result.json()).toMatchObject({
    error: "safe_net_overloaded",
    safety: "/public/safety",
  });
});

function response(
  body: string | Buffer,
  contentType: string | undefined,
  statusCode = 200,
): SafeNetResponse {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    statusCode,
    headers: {
      ...(contentType ? { "Content-Type": contentType } : {}),
      "content-length": String(bytes.length),
    },
    body: bytes,
    receipt: {
      requested_origin: "https://public.example",
      final_origin: "https://public.example",
      status_code: statusCode,
      bytes: bytes.length,
      sha256: "0".repeat(64),
      redirects: 0,
      elapsed_ms: 1,
    },
  };
}

function fakeGet(
  value: SafeNetResponse | Error,
  inspect?: (url: string | URL, options: SafeNetRequestOptions) => void,
): SafeGet {
  return async (url, options = {}) => {
    inspect?.(url, options);
    if (value instanceof Error) throw value;
    return value;
  };
}

describe("safe URL document parsing", () => {
  test("uses bounded safe-net HTML bytes and trusts the upstream media type", async () => {
    let captured: SafeNetRequestOptions | undefined;
    const get = fakeGet(
      response(
        "<html><head><title>Bounded article</title></head><body><article><h1>Bounded article</h1><p>Hello from the public web.</p><p>Second paragraph for Readability.</p></article></body></html>",
        "Text/HTML; charset=utf-8",
      ),
      (_url, options) => {
        captured = options;
      },
    );

    const result = await parseDocument(
      { url: "https://public.example/article" },
      get,
    );

    expect(result.title).toContain("Bounded article");
    expect(result.content).toContain("Hello from the public web");
    expect(result.content_type).toBe("Text/HTML; charset=utf-8");
    expect(captured?.protocols).toEqual(["http:", "https:"]);
    expect(captured?.redirect).toBe("follow");
    expect(captured?.maxRedirects).toBe(SAFE_NET_MAX_REDIRECTS);
    expect(captured?.timeoutMs).toBe(SAFE_NET_DEFAULT_TIMEOUT_MS);
    expect(captured?.maxResponseBytes).toBe(DOCUMENT_MAX_BYTES);
    expect(captured?.headers?.accept).not.toContain("application/pdf");
    expect(captured?.headers?.authorization).toBeUndefined();
    expect(captured?.headers?.cookie).toBeUndefined();
  });

  test("does not permit a caller content type to override URL bytes", async () => {
    let calls = 0;
    const get = fakeGet(response("plain", "text/plain"), () => {
      calls += 1;
    });
    await expect(
      parseDocument(
        {
          url: "https://public.example/article",
          content_type: "text/html",
        },
        get,
      ),
    ).rejects.toThrow("document_invalid_input");
    expect(calls).toBe(0);
  });

  test("strictly validates base64, decoded bytes, media type, and output", async () => {
    const local = await parseDocument({
      base64: Buffer.from("hello local world").toString("base64"),
      content_type: "text/plain; charset=utf-8",
    });
    expect(local.content).toBe("hello local world");
    expect(local.word_count).toBe(3);

    const defaulted = await parseDocument({
      base64: Buffer.from("default media type").toString("base64"),
    });
    expect(defaulted.content_type).toBe("text/plain");

    for (const base64 of [
      "%%%",
      "SGV sbG8=",
      "SGVsbG8=garbage",
      "SGVsbG8",
      "Zh==",
      "Zm9=",
    ]) {
      await expect(parseDocument({ base64 })).rejects.toThrow(
        "document_invalid_base64",
      );
    }

    await expect(
      parseDocument({
        base64: Buffer.alloc(DOCUMENT_MAX_BYTES + 1).toString("base64"),
      }),
    ).rejects.toThrow("document_too_large");

    await expect(
      parseDocument({
        base64: Buffer.from("%PDF").toString("base64"),
        content_type: "application/pdf",
      }),
    ).rejects.toThrow("document_unsupported_content_type");

    const bounded = await parseDocument({
      base64: Buffer.from("界".repeat(DOCUMENT_MAX_CONTENT_BYTES)).toString(
        "base64",
      ),
      content_type: "text/plain",
    });
    expect(Buffer.byteLength(bounded.content)).toBeLessThanOrEqual(
      DOCUMENT_MAX_CONTENT_BYTES,
    );
    expect(bounded.word_count).toBe(1);
  });

  test("rejects missing, binary, oversized, and non-200 upstream responses", async () => {
    const cases: Array<[SafeNetResponse, string]> = [
      [response("plain", undefined), "document_unsupported_content_type"],
      [
        response("%PDF", "application/pdf"),
        "document_unsupported_content_type",
      ],
      [
        response(Buffer.alloc(DOCUMENT_MAX_BYTES + 1), "text/plain"),
        "document_too_large",
      ],
      [response("missing", "text/plain", 404), "document_upstream_status"],
    ];

    for (const [wire, code] of cases) {
      await expect(
        parseDocument(
          { url: "https://public.example/article" },
          fakeGet(wire),
        ),
      ).rejects.toThrow(code);
    }
  });

  test("wraps native transport failures without copying their details", async () => {
    try {
      await parseDocument(
        { url: "https://public.example/secret?token=do-not-copy" },
        fakeGet(new Error("socket failed for secret?token=do-not-copy")),
      );
      throw new Error("expected document failure");
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError);
      expect((error as Error).message).toBe("document_fetch_failed");
      expect((error as Error).message).not.toContain("token");
    }
  });
});

describe("safe static HTML scraping", () => {
  test("parses bounded HTML, selector text, and at most 100 distinct links", async () => {
    const links = Array.from(
      { length: 110 },
      (_value, index) => `<a href="https://links.example/${index}">L</a>`,
    ).join("");
    let captured: SafeNetRequestOptions | undefined;
    const get = fakeGet(
      response(
        `<html><head><title>Static page</title></head><body><nav>remove me</nav><main class="pick">Keep this</main>${links}<a href="https://links.example/0">duplicate</a></body></html>`,
        "application/xhtml+xml; charset=UTF-8",
      ),
      (_url, options) => {
        captured = options;
      },
    );

    const result = await scrape(
      {
        url: "https://public.example/page",
        selector: ".pick",
        extract_links: true,
      },
      get,
    );

    expect(result.title).toBe("Static page");
    expect(result.content).toContain("Keep this");
    expect(result.content).not.toContain("remove me");
    expect(result.extracted).toBe("Keep this");
    expect(result.links).toHaveLength(100);
    expect(new Set(result.links).size).toBe(100);
    expect(captured?.maxResponseBytes).toBe(SCRAPE_MAX_BYTES);
    expect(captured?.maxRedirects).toBe(SAFE_NET_MAX_REDIRECTS);
    expect(captured?.timeoutMs).toBe(SAFE_NET_DEFAULT_TIMEOUT_MS);
    expect(captured?.headers?.accept).toBe(
      "text/html,application/xhtml+xml",
    );
  });

  test("canonicalizes absolute HTTP(S) links before deduplication", async () => {
    const result = await scrape(
      { url: "https://public.example/page", extract_links: true },
      fakeGet(
        response(
          `<html><body>
            <a href="HTTP://Example.COM:80/a/../b">first</a>
            <a href="http://example.com/b">canonical duplicate</a>
            <a href="HTTPS://EXAMPLE.COM:443/path">uppercase HTTPS</a>
            <a href="/relative">relative</a>
            <a href="mailto:agent@example.com">other scheme</a>
            <a href="http://[::1">malformed</a>
          </body></html>`,
          "text/html",
        ),
      ),
    );

    expect(result.links).toEqual([
      "http://example.com/b",
      "https://example.com/path",
    ]);
  });

  test("validates a selector before any network operation", async () => {
    let calls = 0;
    const get = fakeGet(response("<html></html>", "text/html"), () => {
      calls += 1;
    });
    for (const selector of ["[", ":has(", ""]) {
      await expect(
        scrape(
          { url: "https://public.example/page", selector },
          get,
        ),
      ).rejects.toThrow("scrape_invalid_selector");
    }
    expect(calls).toBe(0);
  });

  test("bounds content and selected output in UTF-8 bytes", async () => {
    const huge = "界".repeat(SCRAPE_MAX_CONTENT_BYTES);
    const result = await scrape(
      { url: "https://public.example/page", selector: ".pick" },
      fakeGet(
        response(`<html><body><p class="pick">${huge}</p></body></html>`, "text/html"),
      ),
    );
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(
      SCRAPE_MAX_CONTENT_BYTES,
    );
    expect(Buffer.byteLength(result.extracted ?? "")).toBeLessThanOrEqual(
      SCRAPE_MAX_CONTENT_BYTES,
    );
  });

  test("rejects unsupported MIME, oversized bytes, and non-200 status", async () => {
    const cases: Array<[SafeNetResponse, string]> = [
      [response("plain", "text/plain"), "scrape_unsupported_content_type"],
      [response("html", undefined), "scrape_unsupported_content_type"],
      [
        response(Buffer.alloc(SCRAPE_MAX_BYTES + 1), "text/html"),
        "scrape_too_large",
      ],
      [response("missing", "text/html", 404), "scrape_upstream_status"],
    ];
    for (const [wire, code] of cases) {
      await expect(
        scrape(
          { url: "https://public.example/page" },
          fakeGet(wire),
        ),
      ).rejects.toThrow(code);
    }
  });

  test("wraps native transport failures without destination details", async () => {
    try {
      await scrape(
        { url: "https://public.example/secret?token=do-not-copy" },
        fakeGet(new Error("dial failed: token=do-not-copy")),
      );
      throw new Error("expected scrape failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ScrapeError);
      expect((error as Error).message).toBe("scrape_fetch_failed");
      expect((error as Error).message).not.toContain("token");
    }
  });
});
