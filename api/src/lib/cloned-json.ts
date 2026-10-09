/**
 * Read a clone of a Request or Response body as JSON without leaking.
 *
 * Bun 1.3.x (production pins 1.3.5) retains native memory roughly equal to
 * the body size on every `.clone().json()` call whenever the body holds a
 * non-ASCII byte — and almost every AgentTool JSON body carries an em-dash.
 * The global welcome/play middleware made that call on ordinary responses,
 * so each API machine kept about one byte for every byte it served until
 * its 1 GB filled (measured on Fly 2026-10-08: memory decline ≈ egress,
 * ratio 0.91–1.00 on all three app machines).
 *
 * `.clone().text()` followed by `JSON.parse` stays flat on the same runtime
 * and keeps the same failure semantics: an empty or malformed body throws a
 * SyntaxError, and UTF-8 decoding (including BOM handling) is identical.
 * Bun 1.4.0+ no longer leaks on `.clone().json()`; keep this helper until the
 * runtime pin moves past 1.3.x. `tests/cloned-json-guard.test.ts` refuses new
 * `.clone().json()` call sites in api/src.
 */
export async function parseClonedJson(body: Request | Response): Promise<unknown> {
  return JSON.parse(await body.clone().text());
}

