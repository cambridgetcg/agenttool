/** Bounded static web scraping over the shared public-Web transport.
 * A terminable child process parses exact fetched bytes; it does not execute
 * scripts or make the resulting remote prose trustworthy. */

import * as cheerio from "cheerio";

import {
  SAFE_NET_DEFAULT_MAX_RESPONSE_BYTES,
  SAFE_NET_DEFAULT_TIMEOUT_MS,
  SAFE_NET_MAX_REDIRECTS,
  SafeNetError,
  safeNetGet,
} from "../net/safe-fetch";
import {
  decodeTextBytes,
  parseTextContentType,
  singleResponseHeader,
} from "./static-content";
import {
  STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES,
  STATIC_PARSER_MAX_SELECTOR_CHARS,
} from "./static-parser-protocol";
import { parseStaticScrapeHtml } from "./static-parser";

export const SCRAPE_MAX_BYTES = SAFE_NET_DEFAULT_MAX_RESPONSE_BYTES;
export const SCRAPE_MAX_CONTENT_BYTES =
  STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES;
export const SCRAPE_MAX_SELECTOR_CHARS = STATIC_PARSER_MAX_SELECTOR_CHARS;

const SCRAPE_MEDIA_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
]);

export interface ScrapeOptions {
  url: string;
  selector?: string;
  extract_links?: boolean;
}

export interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  extracted: string | null;
  links: string[];
  fetched_at: string;
}

export type ScrapeErrorCode =
  | "scrape_invalid_selector"
  | "scrape_too_large"
  | "scrape_unsupported_content_type"
  | "scrape_unsupported_charset"
  | "scrape_upstream_status"
  | "scrape_fetch_failed"
  | "scrape_parse_failed";

export class ScrapeError extends Error {
  readonly code: ScrapeErrorCode;

  constructor(code: ScrapeErrorCode) {
    super(code);
    this.name = "ScrapeError";
    this.code = code;
  }
}

type SafeGet = typeof safeNetGet;

export function isValidScrapeSelector(selector: string): boolean {
  if (selector.length === 0 || selector.length > SCRAPE_MAX_SELECTOR_CHARS) {
    return false;
  }
  try {
    cheerio.load("<html><body></body></html>")(selector);
    return true;
  } catch {
    return false;
  }
}

function assertSelector(selector: string | undefined): void {
  if (selector !== undefined && !isValidScrapeSelector(selector)) {
    throw new ScrapeError("scrape_invalid_selector");
  }
}

async function fetchHtml(url: string, get: SafeGet): Promise<string> {
  let response: Awaited<ReturnType<SafeGet>>;
  try {
    response = await get(url, {
      protocols: ["http:", "https:"],
      redirect: "follow",
      maxRedirects: SAFE_NET_MAX_REDIRECTS,
      timeoutMs: SAFE_NET_DEFAULT_TIMEOUT_MS,
      maxResponseBytes: SCRAPE_MAX_BYTES,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.5",
      },
    });
  } catch (error) {
    if (error instanceof SafeNetError) throw error;
    throw new ScrapeError("scrape_fetch_failed");
  }

  if (response.statusCode !== 200) {
    throw new ScrapeError("scrape_upstream_status");
  }
  if (response.body.length > SCRAPE_MAX_BYTES) {
    throw new ScrapeError("scrape_too_large");
  }
  const contentTypeValue = singleResponseHeader(
    response.headers,
    "content-type",
  );
  if (!contentTypeValue) {
    throw new ScrapeError("scrape_unsupported_content_type");
  }
  const contentType = parseTextContentType(
    contentTypeValue,
    (mime) => SCRAPE_MEDIA_TYPES.has(mime),
    () => new ScrapeError("scrape_unsupported_content_type"),
  );
  return decodeTextBytes(
    response.body,
    contentType.charset,
    () => new ScrapeError("scrape_unsupported_charset"),
  );
}

export async function scrape(
  opts: ScrapeOptions,
  get: SafeGet = safeNetGet,
): Promise<ScrapeResult> {
  const { url, selector, extract_links = false } = opts;
  assertSelector(selector);
  const html = await fetchHtml(url, get);

  try {
    const parsed = await parseStaticScrapeHtml({
      kind: "scrape",
      html,
      ...(selector === undefined ? {} : { selector }),
      extractLinks: extract_links,
    });

    return {
      url,
      ...parsed,
      fetched_at: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof ScrapeError) throw error;
    throw new ScrapeError("scrape_parse_failed");
  }
}
