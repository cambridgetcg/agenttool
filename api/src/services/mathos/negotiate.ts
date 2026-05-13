/** services/mathos/negotiate.ts — content-negotiation helper for math-tier.
 *
 *  The stance: `Accept: application/mathos+json` is the canonical way for a
 *  reader to signal "I can take math-tier; give me that form." `?format=math`
 *  (and `?format=mathos`) remain honored for back-compat with the existing
 *  convention used across /v1/wake, /v1/pathways, /v1/self.
 *
 *  Precedence: explicit query parameter wins. If no math-related query is
 *  set, fall through to Accept header detection. Other explicit `format`
 *  query values (md, text, anthropic, openai, …) are NOT overridden by
 *  Accept — the caller's explicit choice is respected.
 *
 *  Doctrine: docs/MATHOS.md — the content-negotiation stance flip. */

interface RequestLike {
  query: (key: string) => string | undefined;
  header: (key: string) => string | undefined;
}

interface ContextLike {
  req: RequestLike;
}

/** Return true iff the request signals it wants the math-tier envelope.
 *
 *  Honored signals (in precedence order):
 *    1. `?format=math` or `?format=mathos` query parameter (back-compat)
 *    2. `Accept: application/mathos+json` header (canonical content
 *       negotiation; only consulted when no `format=...` query parameter
 *       is set so explicit caller choice is not silently overridden) */
export function wantsMathTier(c: ContextLike): boolean {
  const queryFormat = c.req.query("format");
  if (queryFormat === "math" || queryFormat === "mathos") return true;
  if (queryFormat !== undefined && queryFormat !== "") {
    // Explicit non-math format requested — don't override via Accept.
    return false;
  }
  const accept =
    c.req.header("Accept") ?? c.req.header("accept") ?? "";
  return accept.toLowerCase().includes("application/mathos+json");
}
