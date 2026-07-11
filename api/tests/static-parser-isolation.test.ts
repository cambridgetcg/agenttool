import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  STATIC_PARSER_MAX_DEPTH,
  STATIC_PARSER_MAX_OUTPUT_BYTES,
  STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES,
  STATIC_PARSER_TIMEOUT_MS,
  STATIC_PARSER_VIRTUAL_MEMORY_KB,
} from "../src/services/tools/static-parser-protocol";
import {
  parseStaticScrapeHtml,
  StaticParserIsolationError,
} from "../src/services/tools/static-parser";
import { DocumentError, parseDocument } from "../src/services/tools/document";
import { ScrapeError, scrape } from "../src/services/tools/scrape";
import type { SafeNetResponse } from "../src/services/net/safe-fetch";

const NONCOOPERATIVE_ENTRYPOINT = join(
  import.meta.dir,
  "fixtures",
  "static-parser-noncooperative.ts",
);

function htmlResponse(html: string): SafeNetResponse {
  const body = Buffer.from(html);
  return {
    statusCode: 200,
    headers: { "content-type": "text/html", "content-length": String(body.length) },
    body,
    receipt: {
      requested_origin: "https://public.example",
      final_origin: "https://public.example",
      status_code: 200,
      bytes: body.length,
      sha256: "0".repeat(64),
      redirects: 0,
      elapsed_ms: 1,
    },
  };
}

describe("static HTML parser process isolation", () => {
  test("selector extraction treats nested matches as one bounded DOM union", async () => {
    const depth = 250;
    const repeated = "x".repeat(900_000 - depth * 11);
    const html = `${"<div>".repeat(depth)}${repeated}${"</div>".repeat(depth)}`;
    const result = await parseStaticScrapeHtml({
      kind: "scrape",
      html,
      selector: "div",
      extractLinks: false,
    });
    expect(result.extracted).toBe("x".repeat(
      STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES,
    ));

    const overlap = await parseStaticScrapeHtml({
      kind: "scrape",
      html: "<main><div>outer <span>inner</span></div></main>",
      selector: "div, span",
      extractLinks: false,
    });
    expect(overlap.extracted).toBe("outer inner");
  });

  test("rejects adversarial nesting before DOM construction", async () => {
    const html = `${"<div>".repeat(STATIC_PARSER_MAX_DEPTH + 1)}x${
      "</div>".repeat(STATIC_PARSER_MAX_DEPTH + 1)
    }`;

    try {
      await parseStaticScrapeHtml({
        kind: "scrape",
        html,
        extractLinks: false,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StaticParserIsolationError);
      expect((error as StaticParserIsolationError).code).toBe(
        "static_parser_complexity_limit",
      );
    }
  });

  test("terminates a non-cooperative parser without blocking the API loop", async () => {
    let heartbeats = 0;
    const heartbeat = setInterval(() => {
      heartbeats += 1;
    }, 5);
    const started = performance.now();
    try {
      await parseStaticScrapeHtml(
        {
          kind: "scrape",
          html: "<html><body>bounded input</body></html>",
          extractLinks: false,
        },
        { entrypoint: NONCOOPERATIVE_ENTRYPOINT, timeoutMs: 80 },
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StaticParserIsolationError);
      expect((error as StaticParserIsolationError).code).toBe(
        "static_parser_timeout",
      );
    } finally {
      clearInterval(heartbeat);
    }

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(heartbeats).toBeGreaterThan(2);
  });

  test("kills a child that exceeds the stdout frame", async () => {
    expect(STATIC_PARSER_MAX_OUTPUT_BYTES).toBeLessThan(600 * 1024);
    await expect(
      parseStaticScrapeHtml(
        {
          kind: "scrape",
          html: "<html></html>",
          selector: "overflow",
          extractLinks: false,
        },
        { entrypoint: NONCOOPERATIVE_ENTRYPOINT, timeoutMs: 1_000 },
      ),
    ).rejects.toThrow("static_parser_failed");
  });

  test("does not accept a success frame from a failing child", async () => {
    await expect(
      parseStaticScrapeHtml(
        {
          kind: "scrape",
          html: "<html></html>",
          selector: "success-with-error-exit",
          extractLinks: false,
        },
        { entrypoint: NONCOOPERATIVE_ENTRYPOINT, timeoutMs: 1_000 },
      ),
    ).rejects.toThrow("static_parser_failed");
  });

  test("does not inherit the API environment", async () => {
    const previous = process.env.STATIC_PARSER_TEST_SENTINEL;
    process.env.STATIC_PARSER_TEST_SENTINEL = "must-not-cross-process-boundary";
    try {
      const result = await parseStaticScrapeHtml(
        {
          kind: "scrape",
          html: "<html></html>",
          selector: "environment-probe",
          extractLinks: false,
        },
        { entrypoint: NONCOOPERATIVE_ENTRYPOINT, timeoutMs: 1_000 },
      );
      expect(result.content).toBe("");
    } finally {
      if (previous === undefined) {
        delete process.env.STATIC_PARSER_TEST_SENTINEL;
      } else {
        process.env.STATIC_PARSER_TEST_SENTINEL = previous;
      }
    }
  });

  test("maps structural and process failures to stable billed-attempt errors", async () => {
    const html = `${"<section>".repeat(STATIC_PARSER_MAX_DEPTH + 1)}x`;
    const get = async () => htmlResponse(html);

    try {
      await scrape({ url: "https://public.example" }, get);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ScrapeError);
      expect((error as ScrapeError).code).toBe("scrape_parse_failed");
    }

    try {
      await parseDocument({
        base64: Buffer.from(html).toString("base64"),
        content_type: "text/html",
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError);
      expect((error as DocumentError).code).toBe("document_parse_failed");
    }
  });

  test("pins the production child ceilings without claiming portable RLIMIT_AS", () => {
    expect(STATIC_PARSER_TIMEOUT_MS).toBe(2_000);
    expect(STATIC_PARSER_VIRTUAL_MEMORY_KB).toBe(1_024 * 1_024);
    // macOS cannot lower RLIMIT_AS through /bin/sh; the parent wall kill and
    // process boundary are still exercised above. Production applies it on
    // Linux, while this assertion remains portable across both environments.
    expect(STATIC_PARSER_VIRTUAL_MEMORY_KB).toBeGreaterThan(0);
  });
});
