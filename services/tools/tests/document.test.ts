/** Tests for the document parsing tool. */

import { describe, expect, it, mock, beforeEach } from "bun:test";

const HTML_ARTICLE = `<!DOCTYPE html>
<html>
<head><title>Article Title</title></head>
<body>
  <article>
    <h1>Understanding Agent Tools</h1>
    <p>By Jane Doe</p>
    <p>This is a comprehensive article about building reliable tools for AI agents.
    It covers topics like browser automation, web scraping, and sandboxed execution.
    The key insight is that agents need infrastructure they can depend on without
    worrying about rate limits, CAPTCHAs, or API changes breaking their workflows.
    This is the foundation of the agent operating system.</p>
    <p>Agents in production face unique challenges. Unlike human users who can adapt
    to UI changes, agents rely on stable interfaces. When those interfaces break,
    the entire pipeline cascades into failure. A managed tool substrate absorbs
    this complexity so agent developers can focus on logic, not plumbing.</p>
  </article>
</body>
</html>`;

const mockFetch = mock(() =>
  Promise.resolve(
    new Response(HTML_ARTICLE, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  ),
);

describe("document tool", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  it("should parse HTML article via Readability", async () => {
    const { parseDocument } = await import("../src/tools/document");

    const result = await parseDocument({ url: "https://example.com/article" });

    expect(result.title).toBeTruthy();
    expect(result.content).toContain("reliable tools for AI agents");
    expect(result.word_count).toBeGreaterThan(10);
    expect(result.content_type).toContain("text/html");
  });

  it("should parse base64-encoded plain text", async () => {
    const { parseDocument } = await import("../src/tools/document");

    const text = "Hello, this is a plain text document.";
    const b64 = Buffer.from(text).toString("base64");

    const result = await parseDocument({ base64: b64, content_type: "text/plain" });

    expect(result.content).toBe(text);
    expect(result.word_count).toBe(7);
  });

  it("should throw when neither url nor base64 provided", async () => {
    const { parseDocument } = await import("../src/tools/document");

    expect(parseDocument({})).rejects.toThrow("Either url or base64 must be provided");
  });

  it("should throw on fetch error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    ) as unknown as typeof fetch;

    const { parseDocument } = await import("../src/tools/document");

    expect(
      parseDocument({ url: "https://broken.com" }),
    ).rejects.toThrow("Fetch failed: 500");
  });

  it("should cap content at 100k characters", async () => {
    const longText = "a".repeat(200_000);
    const b64 = Buffer.from(longText).toString("base64");

    const { parseDocument } = await import("../src/tools/document");
    const result = await parseDocument({ base64: b64, content_type: "text/plain" });

    expect(result.content.length).toBeLessThanOrEqual(100_000);
  });
});
