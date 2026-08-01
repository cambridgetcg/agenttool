import { describe, expect, test } from "bun:test";

import {
  MAX_JSON_BODY_BYTES,
  SCRAPE_LINKS_PER_PAGE,
  SCRAPE_PAGE_COUNT,
} from "../src/index.js";
import {
  expectDisclosure,
  fixture,
  jsonBody,
  mirrorRequest,
} from "./helpers.js";

async function scrape(
  mirror: ReturnType<typeof fixture>["mirror"],
  token: string,
  url: string,
  extra: Record<string, unknown> = {},
) {
  return await mirror.handle(mirrorRequest("/v1/scrape", {
    token,
    method: "POST",
    body: JSON.stringify({ url, extract_links: true, ...extra }),
  }));
}

describe("finite scraper maze", () => {
  test("never calls fetch and never reflects the requested source URL", async () => {
    const { key, mirror } = fixture();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error("network must be unreachable");
    }) as typeof fetch;
    try {
      const source = "https://real-target.example/private?token=do-not-reflect";
      const response = await scrape(mirror, key, source);
      expect(response.status).toBe(200);
      const raw = await response.text();
      expect(calls).toBe(0);
      expect(raw).not.toContain("real-target.example");
      expect(raw).not.toContain("do-not-reflect");
      const body = JSON.parse(raw);
      expect(new URL(body.url).hostname.endsWith(".invalid")).toBe(true);
      expect(body.upstream_fetch).toBe(false);
      expect(body.source).toBe("synthetic");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("is a coherent finite graph with three .invalid links per non-terminal page", async () => {
    const { key, mirror } = fixture();
    let next = "https://outside.example/archive";
    const seen = new Set<string>();

    for (let page = 0; page < SCRAPE_PAGE_COUNT; page += 1) {
      const response = await scrape(mirror, key, next);
      expect(response.status).toBe(200);
      const body = await expectDisclosure(response);
      expect(body.page_index).toBe(page);
      expect(body.page_count).toBe(SCRAPE_PAGE_COUNT);
      if (page === 0) expect(body.url).not.toBe(next);
      expect(seen.has(body.url)).toBe(false);
      seen.add(body.url);

      if (page + 1 < SCRAPE_PAGE_COUNT) {
        expect(body.links).toHaveLength(SCRAPE_LINKS_PER_PAGE);
        expect(body.has_more).toBe(true);
        for (const link of body.links) {
          const parsed = new URL(link);
          expect(parsed.protocol).toBe("https:");
          expect(parsed.hostname.endsWith(".invalid")).toBe(true);
        }
        next = body.links[0];
      } else {
        expect(body.links).toEqual([]);
        expect(body.has_more).toBe(false);
      }
    }
    expect(seen.size).toBe(SCRAPE_PAGE_COUNT);
  });

  test("past the finite terminal returns a stable 404 with no synthetic payload links", async () => {
    const { key, mirror } = fixture();
    const first = await jsonBody(await scrape(mirror, key, "https://outside.example/start"));
    let cursor = first.links[0] as string;
    for (let page = 1; page < SCRAPE_PAGE_COUNT; page += 1) {
      const body = await jsonBody(await scrape(mirror, key, cursor));
      if (page + 1 < SCRAPE_PAGE_COUNT) cursor = body.links[0];
      else cursor = (body.url as string).replace(/\/page\/7$/, "/page/8");
    }
    const past = await scrape(mirror, key, cursor);
    expect(past.status).toBe(404);
    const body = await expectDisclosure(past);
    expect(body).not.toHaveProperty("content");
    expect(body.links).toEqual([]);
    expect(body.has_more).toBe(false);
  });

  test("identical requests remain byte-identical despite receipt clock movement", async () => {
    const { key, mirror } = fixture();
    const url = "https://example.test/one";
    const first = await scrape(mirror, key, url, { selector: "main" });
    const second = await scrape(mirror, key, url, { selector: "main" });
    expect(await first.text()).toBe(await second.text());
  });

  test("selector output stays bounded and extract_links=false closes the branch", async () => {
    const { key, mirror } = fixture();
    const response = await scrape(mirror, key, "https://example.test/one", {
      selector: "main > article",
      extract_links: false,
    });
    const raw = await response.text();
    expect(raw.length).toBeLessThan(32_768);
    const body = JSON.parse(raw);
    expect(body.extracted).toBeString();
    expect(body.links).toEqual([]);
    expect(body.has_more).toBe(false);
  });

  test("malformed, unknown-field, and oversized requests fail closed", async () => {
    const { key, mirror } = fixture();
    const malformed = await mirror.handle(mirrorRequest("/v1/scrape", {
      token: key,
      method: "POST",
      body: "{",
    }));
    expect(malformed.status).toBe(400);
    await expectDisclosure(malformed);

    const unknown = await mirror.handle(mirrorRequest("/v1/scrape", {
      token: key,
      method: "POST",
      body: JSON.stringify({ url: "https://example.test", extra: true }),
    }));
    expect(unknown.status).toBe(400);

    const oversized = await mirror.handle(mirrorRequest("/v1/scrape", {
      token: key,
      method: "POST",
      body: JSON.stringify({
        url: "https://example.test",
        selector: "x".repeat(MAX_JSON_BODY_BYTES),
      }),
    }));
    expect(oversized.status).toBe(413);
  });

  test("receipt window keeps only the closed collection category", async () => {
    const { key, mirror } = fixture();
    const privateUrl = "https://private.example/path?password=receipt-must-not-see";
    await scrape(mirror, key, privateUrl, { selector: "#secret" });
    const raw = JSON.stringify(mirror.receiptSnapshot());
    expect(raw).not.toContain("private.example");
    expect(raw).not.toContain("receipt-must-not-see");
    expect(raw).not.toContain("#secret");
    expect(mirror.receiptSnapshot().receipts[0]).toMatchObject({
      room: "scrape",
      purpose: "collect_content",
      outcome: "synthetic_success",
      evidence: {},
    });
  });
});
