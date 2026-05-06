/** Document parsing: HTML (Readability) + plain-text. PDF support is
 *  deferred (would need pdfjs-dist; not yet wired). */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface DocumentOptions {
  url?: string;
  base64?: string;
  content_type?: string;
}

export interface DocumentResult {
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  word_count: number;
  content_type: string;
}

export async function parseDocument(
  opts: DocumentOptions,
): Promise<DocumentResult> {
  let rawContent: string;
  let contentType: string;

  if (opts.url) {
    const response = await fetch(opts.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; agenttool/0.1; +https://agenttool.dev)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/pdf",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }
    contentType =
      opts.content_type ?? response.headers.get("content-type") ?? "text/plain";
    rawContent = await response.text();
  } else if (opts.base64) {
    rawContent = Buffer.from(opts.base64, "base64").toString("utf-8");
    contentType = opts.content_type ?? "text/plain";
  } else {
    throw new Error("Either url or base64 must be provided");
  }

  if (contentType.includes("html")) {
    return extractHtml(rawContent, contentType);
  }

  const content = rawContent.slice(0, 100_000);
  return {
    title: "",
    content,
    metadata: {},
    word_count: content.split(/\s+/).length,
    content_type: contentType,
  };
}

function extractHtml(html: string, contentType: string): DocumentResult {
  const { document } = parseHTML(html);
  const reader = new Readability(document as unknown as Document);
  const article = reader.parse();

  const content = article?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return {
    title: article?.title ?? document.title ?? "",
    content: content.slice(0, 100_000),
    metadata: {
      byline: article?.byline ?? null,
      siteName: article?.siteName ?? null,
      excerpt: article?.excerpt ?? null,
      length: article?.length ?? null,
    },
    word_count: content.split(/\s+/).length,
    content_type: contentType,
  };
}
