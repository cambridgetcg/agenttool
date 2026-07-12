/** Bounded document parsing for caller-supplied bytes or a safe public-Web
 * fetch. HTML/XHTML use Readability in a terminable child process; other
 * supported text media types are returned as text. Parsing does not make
 * remote prose trustworthy. */

import {
  SAFE_NET_DEFAULT_MAX_RESPONSE_BYTES,
  SAFE_NET_DEFAULT_TIMEOUT_MS,
  SAFE_NET_MAX_REDIRECTS,
  SafeNetError,
  safeNetGet,
} from "../net/safe-fetch";
import {
  decodeTextBytes,
  type ParsedTextContentType,
  parseTextContentType,
  singleResponseHeader,
  truncateUtf8,
} from "./static-content";
import {
  STATIC_PARSER_MAX_DOCUMENT_CONTENT_BYTES,
} from "./static-parser-protocol";
import { parseStaticDocumentHtml } from "./static-parser";

export const DOCUMENT_MAX_BYTES = SAFE_NET_DEFAULT_MAX_RESPONSE_BYTES;
// Retain the public SDK/schema envelope while enforcing the stricter decoded
// byte limit below. The encoded-length check prevents direct service calls
// from allocating an arbitrarily large Buffer.
export const DOCUMENT_MAX_BASE64_CHARS = 1_400_000;
export const DOCUMENT_MAX_CONTENT_BYTES =
  STATIC_PARSER_MAX_DOCUMENT_CONTENT_BYTES;
const DOCUMENT_MEDIA_TYPES = new Set([
  "text/plain",
  "text/html",
  "application/xhtml+xml",
]);

export interface DocumentOptions {
  url?: string;
  base64?: string;
  /** Base64 input defaults to text/plain; URL input uses its response header. */
  content_type?: string;
}

export interface DocumentResult {
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  word_count: number;
  content_type: string;
}

export type DocumentErrorCode =
  | "document_invalid_input"
  | "document_invalid_base64"
  | "document_too_large"
  | "document_unsupported_content_type"
  | "document_unsupported_charset"
  | "document_upstream_status"
  | "document_fetch_failed"
  | "document_parse_failed";

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;

  constructor(code: DocumentErrorCode) {
    super(code);
    this.name = "DocumentError";
    this.code = code;
  }
}

type SafeGet = typeof safeNetGet;

function isDocumentMediaType(mime: string): boolean {
  return DOCUMENT_MEDIA_TYPES.has(mime);
}

function decodeStrictBase64(value: string): Buffer {
  if (value.length > DOCUMENT_MAX_BASE64_CHARS) {
    throw new DocumentError("document_too_large");
  }
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    throw new DocumentError("document_invalid_base64");
  }

  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new DocumentError("document_invalid_base64");
  }
  if (bytes.length > DOCUMENT_MAX_BYTES) {
    throw new DocumentError("document_too_large");
  }
  return bytes;
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

async function fetchDocumentBytes(
  url: string,
  get: SafeGet,
): Promise<{ bytes: Buffer; contentType: ParsedTextContentType }> {
  let response: Awaited<ReturnType<SafeGet>>;
  try {
    response = await get(url, {
      protocols: ["http:", "https:"],
      redirect: "follow",
      maxRedirects: SAFE_NET_MAX_REDIRECTS,
      timeoutMs: SAFE_NET_DEFAULT_TIMEOUT_MS,
      maxResponseBytes: DOCUMENT_MAX_BYTES,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; agenttool/0.1; +https://agenttool.dev)",
        accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
  } catch (error) {
    if (error instanceof SafeNetError) throw error;
    throw new DocumentError("document_fetch_failed");
  }

  if (response.statusCode !== 200) {
    throw new DocumentError("document_upstream_status");
  }
  if (response.body.length > DOCUMENT_MAX_BYTES) {
    throw new DocumentError("document_too_large");
  }
  const value = singleResponseHeader(response.headers, "content-type");
  if (!value) {
    throw new DocumentError("document_unsupported_content_type");
  }
  return {
    bytes: response.body,
    contentType: parseTextContentType(
      value,
      isDocumentMediaType,
      () => new DocumentError("document_unsupported_content_type"),
    ),
  };
}

export async function parseDocument(
  opts: DocumentOptions,
  get: SafeGet = safeNetGet,
): Promise<DocumentResult> {
  const hasUrl = opts.url !== undefined;
  const hasBase64 = opts.base64 !== undefined;
  if (hasUrl === hasBase64 || (hasUrl && opts.content_type !== undefined)) {
    throw new DocumentError("document_invalid_input");
  }

  let rawContent: string;
  let contentType: ParsedTextContentType;
  if (opts.url !== undefined) {
    const fetched = await fetchDocumentBytes(opts.url, get);
    contentType = fetched.contentType;
    rawContent = decodeTextBytes(
      fetched.bytes,
      contentType.charset,
      () => new DocumentError("document_unsupported_charset"),
    );
  } else {
    const bytes = decodeStrictBase64(opts.base64!);
    contentType = parseTextContentType(
      opts.content_type ?? "text/plain",
      isDocumentMediaType,
      () => new DocumentError("document_unsupported_content_type"),
    );
    rawContent = decodeTextBytes(
      bytes,
      contentType.charset,
      () => new DocumentError("document_unsupported_charset"),
    );
  }

  if (
    contentType.mime === "text/html" ||
    contentType.mime === "application/xhtml+xml"
  ) {
    return extractHtml(rawContent, contentType.value);
  }

  const content = truncateUtf8(rawContent, DOCUMENT_MAX_CONTENT_BYTES);
  return {
    title: "",
    content,
    metadata: {},
    word_count: countWords(content),
    content_type: contentType.value,
  };
}

async function extractHtml(
  html: string,
  contentType: string,
): Promise<DocumentResult> {
  try {
    const parsed = await parseStaticDocumentHtml({ kind: "document", html });
    return {
      title: parsed.title,
      content: parsed.content,
      metadata: parsed.metadata,
      word_count: parsed.wordCount,
      content_type: contentType,
    };
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError("document_parse_failed");
  }
}
