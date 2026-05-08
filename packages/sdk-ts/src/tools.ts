/**
 * Tools client for the agent-tools API.
 */

import { AgentToolError } from "./errors.js";
import type {
  DocumentResult,
  ExecuteResult,
  ScrapeResult,
  SearchResponse,
} from "./types.js";
import type { HttpConfig } from "./memory.js";

export interface ParseDocumentOpts {
  url?: string;
  base64?: string;
  content_type?: string;
}

/**
 * Client for the agent-tools API (search, scrape, execute).
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * const results = at.tools.search("latest AI news");
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
   * @deprecated /v1/search was dropped — agents BYOK now.
   *
   * agenttool is not a paid-API reseller. Store your Brave / SerpAPI /
   * Google CSE / Tavily key in `at.vault` and call the provider
   * directly via `at.tools.execute`. Method will be removed in 0.7.0.
   * See docs/SDK-ROADMAP.md (Phase 0).
   */
  async search(_query: string, _options?: { num_results?: number }): Promise<SearchResponse> {
    console.warn(
      "[deprecated] at.tools.search() — /v1/search was dropped from the " +
        "consolidated API. Store your search-provider key in at.vault and " +
        "call it via at.tools.execute. Method will be removed in 0.7.0. " +
        "See docs/SDK-ROADMAP.md.",
    );
    throw new AgentToolError(
      "/v1/search was dropped from the consolidated API.",
      {
        hint:
          "Store your provider key in at.vault.put('search-key', ...) " +
          "and call it from at.tools.execute. agenttool is not a paid-API " +
          "reseller. See docs/SDK-ROADMAP.md.",
      },
    );
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
   * Execute code in a sandbox.
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
   * const doc = await at.tools.parse_document({ url: "https://example.com/paper.html" });
   * console.log(doc.title, doc.word_count);
   * ```
   */
  async parse_document(options: ParseDocumentOpts): Promise<DocumentResult> {
    if (!options.url && !options.base64) {
      throw new AgentToolError(
        "parse_document requires either url or base64.",
        {
          hint: "Pass { url: '...' } or { base64: '...', content_type: 'text/html' }.",
        },
      );
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
    const resp = await globalThis.fetch(url, {
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
