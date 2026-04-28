/**
 * Verify client for the verification API.
 */

import { AgentToolError } from "./errors.js";
import type { VerifyResult } from "./types.js";
import type { HttpConfig } from "./memory.js";

/**
 * Client for the verify API.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * const result = await at.verify.check("The Earth is round");
 * console.log(result.verdict, result.confidence);
 * ```
 */
export class VerifyClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Verify a claim.
   *
   * @param claim - The statement to verify.
   * @param options - Optional sources array.
   * @returns VerifyResult with verdict, confidence, sources, evidence, caveats.
   */
  async check(claim: string, options?: { sources?: string[] }): Promise<VerifyResult> {
    const body: Record<string, unknown> = { claim };
    if (options?.sources !== undefined) body.sources = options.sources;

    const url = `${this.http.baseUrl}/v1/verify`;
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
      throw new AgentToolError(`Verify API error (${resp.status}): ${detail}`, {
        hint: "Check your API key and request parameters.",
      });
    }

    return (await resp.json()) as VerifyResult;
  }
}
