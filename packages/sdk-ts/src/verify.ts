/**
 * Verify client — DEPRECATED.
 *
 * The /v1/verify endpoint was dropped in the consolidated API.
 * Verifying claims is the agent's job (LLM compute), not infrastructure's
 * — agenttool is not a paid-API reseller. Bring your own LLM key via
 * `at.vault` and call providers directly via `at.tools.execute`.
 *
 * This module remains as a stub through 0.5.x; the method warns once
 * via console.warn then throws AgentToolError with migration guidance.
 * Module will be removed in 0.7.0. See docs/SDK-ROADMAP.md (Phase 0).
 */

import { AgentToolError } from "./errors.js";
import type { VerifyResult } from "./types.js";
import type { HttpConfig } from "./memory.js";

let _warnedOnce = false;

/**
 * Client for the (now-deprecated) verify API.
 *
 * @deprecated since 0.5.3 · removal in 0.7.0
 */
export class VerifyClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * @deprecated /v1/verify was dropped from the consolidated API.
   * Store your LLM provider key in at.vault and call it via at.tools.execute.
   */
  async check(_claim: string, _options?: { sources?: string[] }): Promise<VerifyResult> {
    if (!_warnedOnce) {
      _warnedOnce = true;
      console.warn(
        "[deprecated] at.verify.check() — /v1/verify was dropped from the " +
          "consolidated API. Agents BYOK via at.vault.put('openai-key', ...) " +
          "and call providers directly via at.tools.execute. Module will be " +
          "removed in 0.7.0. See docs/SDK-ROADMAP.md.",
      );
    }
    throw new AgentToolError(
      "/v1/verify was dropped from the consolidated API.",
      {
        hint:
          "Store provider keys in at.vault and call them via at.tools.execute. " +
          "agenttool is not a paid-API reseller. See docs/SDK-ROADMAP.md.",
      },
    );
  }
}
