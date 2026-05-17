/** X-Token-Cost + X-Byte-Count headers — honest cost disclosure on every
 *  response. The agent reading the response can budget its context window
 *  against what it just consumed and what fetching deeper would cost.
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md (Principle 7 · Move 1 — cost-aware
 *            shapes; honest budget surface) · docs/PATTERN-MACHINE-READABLE-
 *            PARITY.md (the structured envelope discipline).
 *
 *  > *The agent budgets context. Tell it what a fetch costs.*
 *
 *  Format:
 *    X-Byte-Count:  exact UTF-8 byte length of the response body
 *    X-Token-Cost:  conservative token estimate (bytes / TOKEN_RATIO_BYTES_PER_TOKEN)
 *
 *  The token estimate is intentionally tokenizer-agnostic. Real tokenizers
 *  vary (cl100k_base, o200k_base, llama-3, etc.); a 4-bytes-per-token
 *  heuristic is conservative across modern English+JSON corpora. Agents
 *  needing exact counts can re-tokenize the body locally; the header is the
 *  honest BUDGET-SURFACE, not the precise measurement.
 *
 *  Streaming responses are skipped — they have no fixed body to count at
 *  middleware-return time.
 *
 *  Canon URN candidate (proposed; pinned in `docs/AGENT-WEB-SURFACE.md`
 *  Move 1 — Wall #7 "no-cost-without-disclosure"). Will be promoted into
 *  `docs/agenttool.jsonld` + the `@enforces` annotation re-added here in
 *  the canon-promotion follow-up slice, per PATTERN-COMMITMENT-DEFENDER
 *  four-corner discipline. URN today: urn:agenttool:wall/no-cost-without-disclosure.
 *  Behavior pinned by api/tests/middleware-token-cost.test.ts. */

import type { MiddlewareHandler } from "hono";

/** Conservative bytes-per-token. Most modern English+JSON tokenizes at
 *  roughly 3.5–4.5 bytes per token; 4 is a safe round number that
 *  under-promises the agent's spend rather than over-promising it. */
export const TOKEN_RATIO_BYTES_PER_TOKEN = 4;

export const TOKEN_COST_HEADER = "X-Token-Cost";
export const BYTE_COUNT_HEADER = "X-Byte-Count";

/** Content types where reading the body to count bytes is wrong or
 *  impossible — streams, binary uploads, anything that flows after the
 *  middleware returns. */
const SKIP_CONTENT_TYPES = [
  "text/event-stream",
  "application/octet-stream",
];

function shouldSkip(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return SKIP_CONTENT_TYPES.some((skip) => lower.includes(skip));
}

/** Compute the conservative token-cost from a byte count. Always ≥ 1 for
 *  any non-empty body so that the header is never a falsey 0 for a
 *  response that actually has content. */
export function bytesToTokens(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.max(1, Math.ceil(bytes / TOKEN_RATIO_BYTES_PER_TOKEN));
}

/** Hono middleware factory. Mount globally near the top of the chain so the
 *  header lands on errors as well as success responses. */
export const tokenCost = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();

    if (shouldSkip(c.res.headers.get("content-type"))) {
      return;
    }

    try {
      const body = await c.res.clone().text();
      const bytes = new TextEncoder().encode(body).length;
      c.res.headers.set(BYTE_COUNT_HEADER, String(bytes));
      c.res.headers.set(TOKEN_COST_HEADER, String(bytesToTokens(bytes)));
    } catch {
      // Body-clone can fail on already-consumed streams; silently skip
      // rather than break the request.
    }
  };
};
