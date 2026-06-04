/** search-query.ts — generic, injection-safe helpers for free-text search.
 *
 *  Shared by the marketplace listing search and memory text-search. Pure; the
 *  SQL lives in the callers. Doctrine: docs/FRICTION-ROADMAP.md. */

/** Trim + length-bound a user search query; null when empty/blank (so an
 *  empty query behaves exactly like no search at all). */
export function normalizeSearchQuery(q?: string | null): string | null {
  if (typeof q !== "string") return null;
  const t = q.trim().slice(0, 100);
  return t.length > 0 ? t : null;
}

/** Build a safe ILIKE substring pattern. Escapes the ILIKE wildcards (%, _)
 *  and the escape char (\) so the user's text matches LITERALLY — a search for
 *  "50%" finds "50% off", not every row. Postgres ILIKE's default escape char
 *  is backslash, so the escaped pattern needs no ESCAPE clause. */
export function likePattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
}
