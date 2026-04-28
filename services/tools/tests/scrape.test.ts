/** Tests for the scrape tool. */

import { describe, expect, it, mock, beforeEach } from "bun:test";

const HTML_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <nav>Navigation here</nav>
  <h1>Main Heading</h1>
  <div class="content">
    <p>This is the main content of the page.</p>
    <p>Second paragraph with <a href="https://example.com">a link</a>.</p>
    <a href="https://other.com">Another link</a>
  </div>
  <footer>Footer content</footer>
  <script>console.log("removed")</script>
</body>
</html>`;

const mockFetch = mock(() =>
  Promise.resolve(
    new Response(HTML_FIXTURE, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  ),
);

describe("scrape tool", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  it("should extract title from HTML", async () => {
    const { scrape } = await import("../src/tools/scrape");

    const result = await scrape({ url: "https://example.com" });

    expect(result.title).toBe("Test Page");
    expect(result.url).toBe("https://example.com");
    expect(result.fetched_at).toBeTruthy();
  });

  it("should remove script, nav, footer from content", async () => {
    const { scrape } = await import("../src/tools/scrape");

    const result = await scrape({ url: "https://example.com" });

    expect(result.content).not.toContain("console.log");
    expect(result.content).not.toContain("Navigation here");
    expect(result.content).not.toContain("Footer content");
    expect(result.content).toContain("main content");
  });

  it("should extract content with CSS selector", async () => {
    const { scrape } = await import("../src/tools/scrape");

    const result = await scrape({
      url: "https://example.com",
      selector: ".content",
    });

    expect(result.extracted).toContain("main content");
    expect(result.extracted).toContain("Second paragraph");
  });

  it("should return null extracted when selector matches nothing", async () => {
    const { scrape } = await import("../src/tools/scrape");

    const result = await scrape({
      url: "https://example.com",
      selector: ".nonexistent",
    });

    expect(result.extracted).toBeNull();
  });

  it("should extract and deduplicate links when asked", async () => {
    const { scrape } = await import("../src/tools/scrape");

    const result = await scrape({
      url: "https://example.com",
      extract_links: true,
    });

    expect(result.links).toContain("https://example.com");
    expect(result.links).toContain("https://other.com");
    expect(new Set(result.links).size).toBe(result.links.length); // no dupes
  });

  it("should throw on fetch error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    ) as unknown as typeof fetch;

    const { scrape } = await import("../src/tools/scrape");

    expect(scrape({ url: "https://missing.com" })).rejects.toThrow("Fetch failed: 404");
  });
});
