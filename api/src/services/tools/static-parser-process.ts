/** Dedicated static HTML parser process.
 *
 * The API sends one bounded JSON request over stdin. This process performs a
 * linear structural preflight, builds the DOM, emits one bounded JSON response,
 * and exits. It receives no application credentials from the parent.
 */

import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { parseHTML } from "linkedom";

import { truncateUtf8 } from "./static-content";
import {
  STATIC_PARSER_MAX_DEPTH,
  STATIC_PARSER_MAX_DOCUMENT_CONTENT_BYTES,
  STATIC_PARSER_MAX_HTML_CHARS,
  STATIC_PARSER_MAX_INPUT_BYTES,
  STATIC_PARSER_MAX_LINK_BYTES,
  STATIC_PARSER_MAX_LINKS,
  STATIC_PARSER_MAX_METADATA_TEXT_BYTES,
  STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES,
  STATIC_PARSER_MAX_SELECTOR_CHARS,
  STATIC_PARSER_MAX_TAG_SOURCE_CHARS,
  STATIC_PARSER_MAX_TAGS,
  STATIC_PARSER_MAX_TITLE_BYTES,
  type StaticDocumentParserRequest,
  type StaticDocumentParserResult,
  type StaticParserChildError,
  type StaticParserRequest,
  type StaticParserResponse,
  type StaticScrapeParserRequest,
  type StaticScrapeParserResult,
} from "./static-parser-protocol";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const OPTIONAL_CLOSE_ON_SAME_TAG = new Set([
  "dd",
  "dt",
  "li",
  "option",
  "p",
  "td",
  "th",
  "tr",
]);

class ComplexityLimitError extends Error {}

function tagNameAt(
  html: string,
  start: number,
): { name: string; end: number } | null {
  let end = start;
  while (end < html.length) {
    const code = html.charCodeAt(end);
    const alphaNumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    if (!alphaNumeric && code !== 45 && code !== 58) break;
    end += 1;
  }
  if (end === start) return null;
  return { name: html.slice(start, end).toLowerCase(), end };
}

/** A deliberately simple O(n) guard, not an HTML conformance parser. */
function assertHtmlComplexity(html: string): void {
  if (html.length > STATIC_PARSER_MAX_HTML_CHARS) {
    throw new ComplexityLimitError();
  }

  const stack: string[] = [];
  let tags = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open < 0) break;

    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      cursor = close < 0 ? html.length : close + 3;
      continue;
    }

    let index = open + 1;
    let closing = false;
    if (html[index] === "/") {
      closing = true;
      index += 1;
    }
    while (
      html[index] === " " ||
      html[index] === "\t" ||
      html[index] === "\n" ||
      html[index] === "\r"
    ) {
      index += 1;
    }
    const tag = tagNameAt(html, index);
    if (!tag) {
      cursor = open + 1;
      continue;
    }

    tags += 1;
    if (tags > STATIC_PARSER_MAX_TAGS) throw new ComplexityLimitError();

    let quote = "";
    let close = tag.end;
    for (; close < html.length; close += 1) {
      const char = html[close]!;
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      if (close - open > STATIC_PARSER_MAX_TAG_SOURCE_CHARS) {
        throw new ComplexityLimitError();
      }
    }
    if (close >= html.length) break;

    if (closing) {
      const matching = stack.lastIndexOf(tag.name);
      if (matching >= 0) stack.length = matching;
    } else {
      const beforeClose = html
        .slice(Math.max(tag.end, close - 2), close)
        .trimEnd();
      const selfClosing = beforeClose.endsWith("/");
      if (!selfClosing && !VOID_ELEMENTS.has(tag.name)) {
        if (
          OPTIONAL_CLOSE_ON_SAME_TAG.has(tag.name) &&
          stack[stack.length - 1] === tag.name
        ) {
          stack.pop();
        }
        stack.push(tag.name);
        if (stack.length > STATIC_PARSER_MAX_DEPTH) {
          throw new ComplexityLimitError();
        }
      }
    }
    cursor = close + 1;
  }
}

function canonicalHttpLink(href: string): string | null {
  if (Buffer.byteLength(href) > STATIC_PARSER_MAX_LINK_BYTES) return null;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const canonical = parsed.href;
    return Buffer.byteLength(canonical) <= STATIC_PARSER_MAX_LINK_BYTES
      ? canonical
      : null;
  } catch {
    return null;
  }
}

function parseScrape(
  request: StaticScrapeParserRequest,
): StaticScrapeParserResult {
  if (
    typeof request.extractLinks !== "boolean" ||
    (request.selector !== undefined &&
      (typeof request.selector !== "string" ||
        request.selector.length === 0 ||
        request.selector.length > STATIC_PARSER_MAX_SELECTOR_CHARS))
  ) {
    throw new TypeError("invalid request");
  }

  const $ = cheerio.load(request.html);
  $(
    "script, style, nav, footer, header, aside, .cookie-banner, #cookie-consent",
  ).remove();

  const title = truncateUtf8(
    $("title").text().trim() || $("h1").first().text().trim() || "",
    STATIC_PARSER_MAX_TITLE_BYTES,
  );
  const content = truncateUtf8(
    $("body").text().replace(/\s+/gu, " ").trim(),
    STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES,
  );

  let extracted: string | null = null;
  if (request.selector !== undefined) {
    const selected = $(request.selector);
    if (selected.length > 0) {
      // Cheerio's selection.text() concatenates textContent once per matched
      // node. Nested matches can therefore duplicate the same large descendant
      // hundreds of times before the final truncation. Treat the selector as a
      // DOM-subtree union instead: discard a match whose ancestor is already
      // matched, then traverse only disjoint roots. The preflight depth/tag
      // ceilings bound the ancestor walk and total selected roots.
      const matches = selected.toArray();
      const matchSet = new Set(matches);
      const disjointRoots = matches.filter((node) => {
        let parent = node.parent;
        while (parent) {
          if (matchSet.has(parent)) return false;
          parent = parent.parent;
        }
        return true;
      });
      const unionText = disjointRoots
        .map((node) => $(node).text())
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      extracted = truncateUtf8(
        unionText,
        STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES,
      );
    }
  }

  const links: string[] = [];
  if (request.extractLinks) {
    const seen = new Set<string>();
    $("a[href]").each((_index, element) => {
      if (links.length >= STATIC_PARSER_MAX_LINKS) return false;
      const href = $(element).attr("href");
      const canonical = href ? canonicalHttpLink(href) : null;
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical);
        links.push(canonical);
      }
    });
  }

  return { title, content, extracted, links };
}

function boundedMetadataText(value: string | null | undefined): string | null {
  return typeof value === "string"
    ? truncateUtf8(value, STATIC_PARSER_MAX_METADATA_TEXT_BYTES)
    : null;
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function parseDocument(
  request: StaticDocumentParserRequest,
): StaticDocumentParserResult {
  const { document } = parseHTML(request.html);
  const reader = new Readability(document as unknown as Document);
  const article = reader.parse();
  const fullContent = article?.textContent?.replace(/\s+/gu, " ").trim() ?? "";
  const content = truncateUtf8(
    fullContent,
    STATIC_PARSER_MAX_DOCUMENT_CONTENT_BYTES,
  );

  return {
    title: truncateUtf8(
      article?.title ?? document.title ?? "",
      STATIC_PARSER_MAX_TITLE_BYTES,
    ),
    content,
    metadata: {
      byline: boundedMetadataText(article?.byline),
      siteName: boundedMetadataText(article?.siteName),
      excerpt: boundedMetadataText(article?.excerpt),
      length: article?.length ?? null,
    },
    wordCount: countWords(content),
  };
}

function isRequest(value: unknown): value is StaticParserRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    (request.kind === "scrape" || request.kind === "document") &&
    typeof request.html === "string"
  );
}

async function main(): Promise<void> {
  const input = await Bun.stdin.text();
  if (Buffer.byteLength(input) > STATIC_PARSER_MAX_INPUT_BYTES) {
    await writeResponse({ ok: false, error: "invalid_request" }, 1);
    return;
  }

  let request: unknown;
  try {
    request = JSON.parse(input);
  } catch {
    await writeResponse({ ok: false, error: "invalid_request" }, 1);
    return;
  }
  if (!isRequest(request)) {
    await writeResponse({ ok: false, error: "invalid_request" }, 1);
    return;
  }

  try {
    assertHtmlComplexity(request.html);
    const response: StaticParserResponse = request.kind === "scrape"
      ? { ok: true, kind: "scrape", result: parseScrape(request) }
      : { ok: true, kind: "document", result: parseDocument(request) };
    await writeResponse(response, 0);
  } catch (error) {
    const childError: StaticParserChildError =
      error instanceof ComplexityLimitError
        ? "complexity_limit"
        : "parse_failed";
    await writeResponse({ ok: false, error: childError }, 1);
  }
}

async function writeResponse(
  response: StaticParserResponse,
  exitCode: number,
): Promise<void> {
  await Bun.write(Bun.stdout, JSON.stringify(response));
  process.exitCode = exitCode;
}

await main();
