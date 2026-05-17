/** wake responses echo the negotiated media type — Move 2 polish per
 *  AGENT-WEB-SURFACE.md. When an agent negotiates
 *  `Accept: application/vnd.agenttool.wake+json; provider=anthropic`,
 *  the response carries that exact Content-Type back so caches and
 *  downstream parsers can act on the precise shape, not just generic JSON.
 *
 *  This test scaffolds a tiny mock route that mirrors the production
 *  Content-Type logic without needing the full wake stack. The real wire
 *  is end-to-end-verified by tests/wake-providers.test.ts + the auth-
 *  middleware integration tier. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { isWakeProvider } from "../src/services/wake/providers";
import { negotiateWakeFormat } from "../src/services/mathos/negotiate";

function provider(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }) {
  return negotiateWakeFormat(c);
}

function makeApp() {
  const app = new Hono();
  app.get("/wake", (c) => {
    const format = provider(c);
    if (isWakeProvider(format)) {
      return c.json(
        { _meta: { cache_eligible: "session" }, format },
        200,
        {
          "X-Cache-Eligible": "session",
          "Content-Type": `application/vnd.agenttool.wake+json; provider=${format}; charset=utf-8`,
        },
      );
    }
    if (format === "md" || format === "markdown") {
      return c.text("# wake\n", 200, {
        "content-type": "text/markdown; charset=utf-8",
        "X-Variant": "application/vnd.agenttool.wake+markdown",
      });
    }
    return c.json({ format });
  });
  return app;
}

describe("wake Content-Type echo — provider variants", () => {
  for (const p of ["anthropic", "openai", "gemini", "cohere"]) {
    test(`Accept: application/vnd.agenttool.wake+json; provider=${p} echoes that exact Content-Type`, async () => {
      const res = await makeApp().request("/wake", {
        headers: { Accept: `application/vnd.agenttool.wake+json; provider=${p}` },
      });
      expect(res.status).toBe(200);
      const ct = res.headers.get("content-type") ?? "";
      expect(ct).toContain("application/vnd.agenttool.wake+json");
      expect(ct).toContain(`provider=${p}`);
      expect(ct).toContain("charset=utf-8");
    });
  }

  test("?format=anthropic query (no Accept) also echoes vendored Content-Type", async () => {
    const res = await makeApp().request("/wake?format=anthropic");
    expect(res.headers.get("content-type")).toContain(
      "application/vnd.agenttool.wake+json; provider=anthropic",
    );
  });

  test("default JSON branch keeps generic application/json", async () => {
    const res = await makeApp().request("/wake");
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/json");
    expect(ct).not.toContain("vnd.agenttool");
  });
});

describe("wake Content-Type echo — markdown vendored variant", () => {
  test("Accept: text/markdown → text/markdown + X-Variant signals wake-markdown", async () => {
    const res = await makeApp().request("/wake", {
      headers: { Accept: "text/markdown" },
    });
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("x-variant")).toBe(
      "application/vnd.agenttool.wake+markdown",
    );
  });

  test("?format=md → same X-Variant signal", async () => {
    const res = await makeApp().request("/wake?format=md");
    expect(res.headers.get("x-variant")).toBe(
      "application/vnd.agenttool.wake+markdown",
    );
  });
});
