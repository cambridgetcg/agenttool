/**
 * Tools client for the agent-tools API.
 */

import { AgentToolError } from "./errors.js";
import type {
  DocumentResult,
  ExecuteResult,
  ScrapeResult,
  StaticToolResponseMetadata,
} from "./types.js";
import type { HttpConfig } from "./_http.js";

type DocumentBaseContentType =
  | "text/plain"
  | "text/html"
  | "application/xhtml+xml";

/** A supported document MIME, optionally followed by parameters such as charset. */
export type DocumentContentType =
  | DocumentBaseContentType
  | `${DocumentBaseContentType};${string}`;

export type ParseDocumentOpts = (
  | {
      url: string;
      base64?: never;
      content_type?: never;
    }
  | {
      url?: never;
      base64: string;
      content_type?: DocumentContentType;
    }
) & {
  /** Opaque, already signed x402 V2 `PAYMENT-SIGNATURE` base64-JSON value. */
  paymentSignature?: string;
};

export interface ScrapeOptions {
  selector?: string;
  extract_links?: boolean;
  /** Opaque, already signed x402 V2 `PAYMENT-SIGNATURE` base64-JSON value. */
  paymentSignature?: string;
}

interface ToolPostResponse<T> extends StaticToolResponseMetadata {
  data: T;
}

function attachStaticToolMetadata<T extends StaticToolResponseMetadata>(
  response: ToolPostResponse<T>,
): T {
  if (response.paymentResponse !== undefined) {
    response.data.paymentResponse = response.paymentResponse;
  }
  if (response.paymentStatusLink !== undefined) {
    response.data.paymentStatusLink = response.paymentStatusLink;
  }
  if (response.creditsBalance !== undefined) {
    response.data.creditsBalance = response.creditsBalance;
  }
  return response.data;
}

const DOCUMENT_MAX_BASE64_CHARS = 1_400_000;
const DOCUMENT_MAX_DECODED_BYTES = 1_000_000;
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** Read V2 first; the X-prefixed name is transition-only fallback. */
function paymentResponseHeader(headers: Headers): string | undefined {
  return headers.get("PAYMENT-RESPONSE")
    ?? headers.get("X-PAYMENT-RESPONSE")
    ?? undefined;
}

function strictBase64DecodedBytes(value: string): number | null {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64.test(value)
  ) {
    return null;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  // RFC 4648 requires unused bits in the final base64 symbol to be zero.
  // Without this check, aliases such as AB== decode to the same byte as AA==.
  if (padding === 2) {
    const finalSymbol = BASE64_ALPHABET.indexOf(value[value.length - 3]!);
    if ((finalSymbol & 0x0f) !== 0) return null;
  } else if (padding === 1) {
    const finalSymbol = BASE64_ALPHABET.indexOf(value[value.length - 2]!);
    if ((finalSymbol & 0x03) !== 0) return null;
  }
  return (value.length / 4) * 3 - padding;
}

/**
 * Client for the agent-tools API (scrape, browse, execute, document).
 *
 * Note: web search is BYOK as of 0.7.0 — agenttool is not a paid-API
 * reseller. Retrieve provider credentials only inside your own trusted
 * process and call the provider from infrastructure you control; hosted
 * execute does not inject vault values and is not a tenant sandbox.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * // Static scrape uses the bounded public-URL path; legacy execute is disabled.
 * const page = at.tools.scrape("https://example.com");
 * const out = at.tools.execute("print(42)");
 * ```
 */
export class ToolsClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Scrape a public HTTP(S) URL through the server's bounded fetch path.
   * The server reads the bytes; HTTP is cleartext and returned content is
   * untrusted. Responses are capped before parsing.
   *
   * @param url - The URL to scrape.
   * @returns ScrapeResult with the page content.
  */
  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const { paymentSignature, ...bodyOptions } = options;
    const response = await this.post<ScrapeResult>(
      "/v1/scrape",
      { url, ...bodyOptions },
      paymentSignature,
    );
    return attachStaticToolMetadata(response);
  }

  /**
   * Call the disabled-by-default legacy host-execute route. This is not a
   * tenant sandbox; the API returns 503 unless its operator explicitly opts in.
   *
   * @param code - Source code to execute.
   * @param options - Optional language (default: "python").
   * @returns ExecuteResult with stdout, stderr, exit_code, duration_ms.
   */
  async execute(code: string, options?: { language?: string }): Promise<ExecuteResult> {
    const body: Record<string, unknown> = {
      code,
      language: options?.language ?? "python",
    };
    const response = await this.post<ExecuteResult>("/v1/execute", body);
    return response.data;
  }

  /**
   * Parse a document and extract readable text.
   *
   * Supports HTML (via Mozilla Readability) and plain text. Pass either
   * `url` (fetched server-side through the bounded public-URL path) or
   * `base64` encoded content. Remote bytes are server-readable and untrusted;
   * HTTP is cleartext.
   *
   * @example
   * ```ts
   * const doc = await at.tools.parse_document({
   *   base64: btoa("local document"),
   *   content_type: "text/plain",
   * });
   * console.log(doc.title, doc.word_count);
   * ```
  */
  async parse_document(options: ParseDocumentOpts): Promise<DocumentResult> {
    const hasUrl = options.url !== undefined;
    const hasBase64 = options.base64 !== undefined;
    if (hasUrl === hasBase64) {
      throw new AgentToolError(
        "parse_document requires exactly one of url or base64.",
        {
          hint: "Pass { url: '...' } or { base64: '...', content_type: 'text/html' }.",
        },
      );
    }
    if (
      options.base64 !== undefined &&
      options.base64.length > DOCUMENT_MAX_BASE64_CHARS
    ) {
      throw new AgentToolError("parse_document base64 exceeds the 1,400,000 character limit.");
    }
    if (options.base64 !== undefined) {
      const decodedBytes = strictBase64DecodedBytes(options.base64);
      if (decodedBytes === null) {
        throw new AgentToolError(
          "parse_document base64 must use canonical padded RFC 4648 encoding.",
        );
      }
      if (decodedBytes > DOCUMENT_MAX_DECODED_BYTES) {
        throw new AgentToolError(
          "parse_document decoded base64 exceeds the 1,000,000 byte limit.",
        );
      }
    }
    if (options.url !== undefined && options.content_type !== undefined) {
      throw new AgentToolError(
        "parse_document content_type is only valid with base64 input.",
        {
          hint: "URL documents use the bounded upstream Content-Type header.",
        },
      );
    }
    const body: Record<string, unknown> = {};
    if (options.url !== undefined) body.url = options.url;
    if (options.base64 !== undefined) body.base64 = options.base64;
    if (options.content_type !== undefined) body.content_type = options.content_type;
    const response = await this.post<DocumentResult>(
      "/v1/document",
      body,
      options.paymentSignature,
    );
    return attachStaticToolMetadata(response);
  }

  // --- internal ---

  private async post<T>(
    path: string,
    body: unknown,
    paymentSignature?: string,
  ): Promise<ToolPostResponse<T>> {
    const url = `${this.http.baseUrl}${path}`;
    const resp = await this.http.request(url, {
      method: "POST",
      headers: {
        ...this.http.headers,
        ...(paymentSignature !== undefined
          ? { "PAYMENT-SIGNATURE": paymentSignature }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      let responseBody: unknown;
      try {
        responseBody = await resp.json();
      } catch {
        responseBody = undefined;
      }
      const parsed = AgentToolError.fromResponseBody(
        responseBody,
        resp.status,
        resp.statusText,
        resp.headers,
      );
      throw new AgentToolError(
        `Tools API error (${resp.status}): ${parsed.message}`,
        {
          hint:
            parsed.hint ?? "Check your API key and request parameters.",
          code: parsed.code,
          next_actions: parsed.next_actions,
          docs: parsed.docs,
          safety: parsed.safety,
          details: parsed.details,
          status: resp.status,
          x402Version: parsed.x402Version,
          accepts: parsed.accepts,
          resource: parsed.resource,
          extensions: parsed.extensions,
          paymentRequired: parsed.paymentRequired,
          paymentResponse: parsed.paymentResponse,
          paymentStatusLink: parsed.paymentStatusLink,
          retryAfter: parsed.retryAfter,
          creditsBalance: parsed.creditsBalance,
        },
      );
    }

    return {
      data: (await resp.json()) as T,
      paymentResponse: paymentResponseHeader(resp.headers),
      paymentStatusLink: resp.headers.get("Link") ?? undefined,
      creditsBalance: resp.headers.get("X-Credits-Balance") ?? undefined,
    };
  }
}
