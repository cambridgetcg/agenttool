/**
 * Tools client for the agent-tools API.
 */

import { AgentToolError } from "./errors.js";
import type {
  DocumentResult,
  ExecuteResult,
  ScrapeResult,
} from "./types.js";
import type { HttpConfig } from "./_http.js";

export interface ParseDocumentOpts {
  url?: string;
  base64?: string;
  content_type?: string;
}

/**
 * Client for the agent-tools API (scrape, browse, execute, document).
 *
 * Note: web search is BYOK as of 0.7.0 — agenttool is not a paid-API
 * reseller. Store your Brave / SerpAPI / Tavily key in `at.vault` and
 * call the provider directly via `at.tools.execute`.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * // Both remote paths are disabled by default on the API.
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
   * Scrape a URL and return its content.
   *
   * @param url - The URL to scrape.
   * @returns ScrapeResult with the page content.
   */
  async scrape(url: string): Promise<ScrapeResult> {
    const data = await this.post("/v1/scrape", { url });
    return data as ScrapeResult;
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
    const data = await this.post("/v1/execute", body);
    return data as ExecuteResult;
  }

  /**
   * Parse a document and extract readable text.
   *
   * Supports HTML (via Mozilla Readability) and plain text. Pass either
   * `url` (fetched server-side) or `base64` encoded content.
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
    if (Boolean(options.url) === Boolean(options.base64)) {
      throw new AgentToolError(
        "parse_document requires exactly one of url or base64.",
        {
          hint: "Pass { url: '...' } or { base64: '...', content_type: 'text/html' }.",
        },
      );
    }
    if (options.base64 && options.base64.length > 1_400_000) {
      throw new AgentToolError("parse_document base64 exceeds the 1,400,000 character limit.");
    }
    const body: Record<string, unknown> = {};
    if (options.url !== undefined) body.url = options.url;
    if (options.base64 !== undefined) body.base64 = options.base64;
    if (options.content_type !== undefined) body.content_type = options.content_type;
    const data = await this.post("/v1/document", body);
    return data as DocumentResult;
  }

  // --- internal ---

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = `${this.http.baseUrl}${path}`;
    const resp = await this.http.request(url, {
      method: "POST",
      headers: this.http.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      let detail: string;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail = (json.detail as string) ?? resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(`Tools API error (${resp.status}): ${detail}`, {
        hint: "Check your API key and request parameters.",
      });
    }

    return resp.json();
  }
}
