/**
 * Tools client for the agent-tools API.
 */

import { AgentToolError } from "./errors.js";
import type { ExecuteResult, ScrapeResult, SearchResponse, SearchResult } from "./types.js";
import type { HttpConfig } from "./memory.js";

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
   * Web search.
   *
   * @param query - Search query string.
   * @param options - Optional num_results.
   * @returns SearchResponse with results, cached flag, and duration.
   */
  async search(query: string, options?: { num_results?: number }): Promise<SearchResponse> {
    const body: Record<string, unknown> = {
      query,
      num_results: options?.num_results ?? 5,
    };
    const data = (await this.post("/v1/search", body)) as Record<string, unknown>;

    // Normalize: API may return results at top level or nested
    const results = Array.isArray(data)
      ? data
      : ((data.results as SearchResult[]) ?? []);

    return {
      results: results as SearchResult[],
      cached: (data.cached as boolean) ?? false,
      duration_ms: (data.duration_ms as number) ?? 0,
    };
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
