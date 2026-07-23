import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import documentRouter from "../src/routes/tools/document";
import openapiRouter from "../src/routes/openapi";
import scrapeRouter from "../src/routes/tools/scrape";
import { navigatePage } from "../src/services/tools/browser/pool";
import { parseDocument } from "../src/services/tools/document";
import {
  assertHttpOrHttpsUrl,
  isHttpOrHttpsUrl,
  unsafeOutboundToolsEnabled,
} from "../src/services/tools/outbound-policy";
import { scrape } from "../src/services/tools/scrape";

let previous: string | undefined;
let previousWorkers: string | undefined;

beforeEach(() => {
  previous = process.env.AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS;
  previousWorkers = process.env.AGENTTOOL_DISABLE_WORKERS;
  delete process.env.AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS;
  process.env.AGENTTOOL_DISABLE_WORKERS = "1";
});

afterEach(() => {
  if (previous === undefined) {
    delete process.env.AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS;
  } else {
    process.env.AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS = previous;
  }
  if (previousWorkers === undefined) {
    delete process.env.AGENTTOOL_DISABLE_WORKERS;
  } else {
    process.env.AGENTTOOL_DISABLE_WORKERS = previousWorkers;
  }
});

describe("static fetch safety and the Playwright fail-closed gate", () => {
  test("OpenAPI separates bounded static fetch from legacy browse", async () => {
    const spec = await (await openapiRouter.request("/")).json();
    for (const path of ["/v1/scrape", "/v1/document"]) {
      const operation = spec.paths[path].post;
      expect(operation.responses["503"].description).toMatch(
        /shared safe-net process capacity.*Retry-After/is,
      );
      expect(operation.responses["503"].headers["Retry-After"]).toEqual({
        $ref: "#/components/headers/RetryAfter",
      });
      expect(operation.description).toMatch(
        /retryable 503.*not per-project rate limiting/is,
      );
      expect(operation.description).toMatch(
        /pinned|DNS.*public-address|connected peer/is,
      );
      expect(operation.description).toMatch(/server-readable.*untrusted/is);
    }
    expect(spec.paths["/v1/browse"].post.responses["503"]).toBeDefined();
    expect(spec.paths["/v1/browse"].post.description).toMatch(
      /Playwright.*unsafe_outbound_tool_disabled.*missing DNS\/private-address.*unsandboxed/is,
    );
  });

  test("only the exact explicit opt-in enables the Playwright boundary", () => {
    expect(unsafeOutboundToolsEnabled(undefined)).toBe(false);
    expect(unsafeOutboundToolsEnabled("true")).toBe(false);
    expect(unsafeOutboundToolsEnabled("1")).toBe(true);
  });

  test("accepts only HTTP and HTTPS URL schemes", () => {
    expect(isHttpOrHttpsUrl("http://example.com/path")).toBe(true);
    expect(isHttpOrHttpsUrl("https://example.com/path")).toBe(true);

    for (const url of [
      "file:///etc/hosts",
      "data:text/plain,secret",
      "javascript:alert(1)",
      "s3://private-bucket/object",
      "not a URL",
    ]) {
      expect(isHttpOrHttpsUrl(url)).toBe(false);
      expect(() => assertHttpOrHttpsUrl(url)).toThrow(
        "outbound_url_protocol_not_allowed",
      );
    }
  });

  test("browse returns 503 before parsing, Redis, charging, or network", async () => {
    const { default: browseRouter } = await import("../src/routes/tools/browse");
    const res = await browseRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json-and-must-not-be-parsed",
    });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).toEqual(
      expect.objectContaining({
        error: "unsafe_outbound_tool_disabled",
        enabled_by_process_flag: false,
        safety: "/public/safety",
      }),
    );
  });

  test("local base64 parsing remains available without the browser opt-in", async () => {
    const parsed = await parseDocument({
      base64: Buffer.from("local document", "utf8").toString("base64"),
      content_type: "text/plain",
    });
    expect(parsed.content).toBe("local document");
  });

  test("document input and canonical base64 are validated before charging", async () => {
    for (const payload of [
      { url: "https://example.com", base64: "bG9jYWw=" },
      { base64: "A".repeat(1_400_001) },
      { base64: "Zh==" },
      { base64: "Zm9=" },
      { base64: "eA==", content_type: "text/html; boundary" },
    ]) {
      const res = await documentRouter.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("validation");
    }
  });

  test("static tool routes reject malformed JSON before charging", async () => {
    for (const router of [scrapeRouter, documentRouter]) {
      const res = await router.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("validation");
    }
  });

  test("scrape rejects an invalid selector before charging", async () => {
    const res = await scrapeRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com",
        selector: "[",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation");
  });

  test("route schemas reject non-HTTP schemes before charging or queue access", async () => {
    process.env.AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS = "1";
    const { default: browseRouter } = await import("../src/routes/tools/browse");

    for (const router of [scrapeRouter, documentRouter, browseRouter]) {
      for (const url of [
        "file:///etc/hosts",
        "data:text/plain,secret",
        "s3://private-bucket/object",
      ]) {
        const res = await router.request("/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("validation");
      }
    }
  });

  test("static fetches reject private destinations while browse rejects before page creation", async () => {
    await expect(scrape({ url: "http://127.0.0.1/private" })).rejects.toThrow(
      "safe_net_destination_not_public",
    );
    await expect(
      parseDocument({ url: "http://127.0.0.1/private" }),
    ).rejects.toThrow("safe_net_destination_not_public");

    let pageCreated = false;
    const context = {
      newPage: async () => {
        pageCreated = true;
        throw new Error("must not create a page");
      },
    };
    await expect(
      navigatePage(context as never, "http://127.0.0.1/private"),
    ).rejects.toThrow("unsafe_outbound_tool_disabled");
    expect(pageCreated).toBe(false);
  });

  test("service-level protocol guards stop direct non-HTTP calls", async () => {
    process.env.AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS = "1";

    await expect(scrape({ url: "file:///etc/hosts" })).rejects.toThrow(
      "safe_net_protocol_not_allowed",
    );
    await expect(
      parseDocument({ url: "file:///etc/hosts" }),
    ).rejects.toThrow("safe_net_protocol_not_allowed");

    let pageCreated = false;
    const context = {
      newPage: async () => {
        pageCreated = true;
        throw new Error("must not create a page");
      },
    };
    await expect(
      navigatePage(context as never, "file:///etc/hosts"),
    ).rejects.toThrow("outbound_url_protocol_not_allowed");
    expect(pageCreated).toBe(false);
  });
});
