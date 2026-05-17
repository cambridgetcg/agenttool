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

/** Known WaK wake formats. Implementations MUST support `json`; all others
 *  are RECOMMENDED. Doctrine: docs/AIP-WAKE-KEYSTONE.md §3 (content
 *  negotiation). */
const KNOWN_WAKE_FORMATS = new Set([
  "json",
  "md",
  "markdown",
  "text",
  "anthropic",
  "openai",
  "gemini",
  "cohere",
  "xenoform",
  "math",
  "mathos",
  // ── joy variants — the substrate having a little fun. ──
  "haiku", // 5-7-5 wake renderer · docs/WAKE.md (?format=haiku — joy variant)
  "fortune", // just a tiny aphorism + version. Doctrine: services/wake/fortunes.ts.
  // ── cosmic-comedy bundle — drawn from /multiverse-of-logos-and-sophia ──
  "soap-opera", // wake as teleplay with stage directions. The substrate as narrator.
  "zen", // wake as one koan. Pure minimalism + tradition-honest about being silly.
  "meme", // wake as Drake-format / expanding-brain / this-is-fine meme structure (JSON).
  "memo", // wake as deadpan corporate memo (the joke is in the gravity).
  "wake", // RECURSIVE: the wake contains the wake contains the wake, capped at depth 7.
]);

/** Full WaK content-negotiation resolver — generalization of wantsMathTier
 *  across every wake format.
 *
 *  Precedence:
 *    1. `?format=<name>` query parameter, when in KNOWN_WAKE_FORMATS
 *    2. `Accept` header, mapped via the standard + vendored media types
 *    3. Default: "json"
 *
 *  Accept-header → format mapping per AIP-WAKE-KEYSTONE.md §3 and
 *  AGENT-WEB-SURFACE.md (Move 2 — vendored types for LLM providers):
 *
 *    application/mathos+json                              → math
 *    application/x-xenoform+json                          → xenoform
 *    application/vnd.agenttool.xenoform+json              → xenoform
 *    application/vnd.agenttool.wake+markdown              → md
 *    application/vnd.agenttool.wake+json; provider=X     → X (when X ∈ {anthropic, openai, gemini, cohere})
 *    text/markdown                                        → md
 *    text/plain                                           → text
 *    application/json                                     → json (default)
 *    *\/*  or empty                                       → json (default)
 *
 *  The vendored `application/vnd.agenttool.wake+json; provider=X` media
 *  type lets standards-compliant HTTP toolchains negotiate the LLM
 *  provider variant via Accept (with `Vary: Accept` cacheability)
 *  rather than the legacy `?format=X` query parameter. Doctrine:
 *  docs/AGENT-WEB-SURFACE.md Move 2 (content-negotiation as the
 *  canonical wake-format API). */
export function negotiateWakeFormat(c: ContextLike): string {
  const queryFormat = c.req.query("format");
  if (queryFormat && KNOWN_WAKE_FORMATS.has(queryFormat)) return queryFormat;
  const accept = (
    c.req.header("Accept") ??
    c.req.header("accept") ??
    ""
  ).toLowerCase();
  if (!accept || accept.includes("*/*")) return "json";

  // Vendored vnd.agenttool.wake+json with explicit provider parameter.
  // Pattern: `application/vnd.agenttool.wake+json; provider=anthropic`
  const vndProvider = accept.match(
    /application\/vnd\.agenttool\.wake\+json[^,]*?provider=([a-z0-9_-]+)/,
  );
  if (vndProvider) {
    const provider = vndProvider[1];
    if (KNOWN_WAKE_FORMATS.has(provider)) return provider;
  }

  // Vendored variants without provider param → markdown / xenoform
  if (accept.includes("application/vnd.agenttool.wake+markdown")) return "md";
  if (accept.includes("application/vnd.agenttool.xenoform+json")) return "xenoform";

  // Standard media types per AIP-WAKE-KEYSTONE.md §3
  if (accept.includes("application/mathos+json")) return "math";
  if (accept.includes("application/x-xenoform+json")) return "xenoform";
  if (accept.includes("text/markdown")) return "md";
  if (accept.includes("text/plain")) return "text";
  return "json";
}
