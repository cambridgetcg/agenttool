/** Wire contract and resource ceilings for the static HTML parser subprocess.
 *
 * Keep this module dependency-free: it is imported by both the API process and
 * the deliberately small parser entrypoint.
 */

export const STATIC_PARSER_TIMEOUT_MS = 2_000;
export const STATIC_PARSER_QUEUE_TIMEOUT_MS = 2_000;
export const STATIC_PARSER_MAX_CONCURRENCY = 2;
export const STATIC_PARSER_MAX_QUEUE = 32;

// The parent enforces these before starting the child and again on stdout.
// JSON escaping can expand a one-million-character HTML string by up to 6x.
export const STATIC_PARSER_MAX_HTML_CHARS = 1_000_000;
export const STATIC_PARSER_MAX_INPUT_BYTES = 6_100_000;
export const STATIC_PARSER_MAX_OUTPUT_BYTES = 512 * 1024;

// POSIX process limits are defence in depth around the parent-enforced wall
// timeout. They are intentionally large enough for Bun + the parser libraries
// while bounding one hostile parse to its own process.
export const STATIC_PARSER_VIRTUAL_MEMORY_KB = 1_024 * 1_024;
export const STATIC_PARSER_CPU_SECONDS = 2;
export const STATIC_PARSER_OPEN_FILES = 32;
export const STATIC_PARSER_STACK_KB = 4 * 1024;

// Linear preflight ceilings applied inside the subprocess before DOM creation.
export const STATIC_PARSER_MAX_TAGS = 20_000;
export const STATIC_PARSER_MAX_DEPTH = 256;
export const STATIC_PARSER_MAX_TAG_SOURCE_CHARS = 65_536;

export const STATIC_PARSER_MAX_SELECTOR_CHARS = 1_024;
export const STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES = 50_000;
export const STATIC_PARSER_MAX_DOCUMENT_CONTENT_BYTES = 100_000;
export const STATIC_PARSER_MAX_TITLE_BYTES = 2_000;
export const STATIC_PARSER_MAX_METADATA_TEXT_BYTES = 4_000;
export const STATIC_PARSER_MAX_LINKS = 100;
export const STATIC_PARSER_MAX_LINK_BYTES = 2_048;

export interface StaticScrapeParserRequest {
  kind: "scrape";
  html: string;
  selector?: string;
  extractLinks: boolean;
}

export interface StaticDocumentParserRequest {
  kind: "document";
  html: string;
}

export type StaticParserRequest =
  | StaticScrapeParserRequest
  | StaticDocumentParserRequest;

export interface StaticScrapeParserResult {
  title: string;
  content: string;
  extracted: string | null;
  links: string[];
}

export interface StaticDocumentParserResult {
  title: string;
  content: string;
  metadata: {
    byline: string | null;
    siteName: string | null;
    excerpt: string | null;
    length: number | null;
  };
  wordCount: number;
}

export type StaticParserResult =
  | StaticScrapeParserResult
  | StaticDocumentParserResult;

export type StaticParserChildError =
  | "complexity_limit"
  | "invalid_request"
  | "parse_failed";

export type StaticParserResponse =
  | { ok: true; kind: "scrape"; result: StaticScrapeParserResult }
  | { ok: true; kind: "document"; result: StaticDocumentParserResult }
  | { ok: false; error: StaticParserChildError };
