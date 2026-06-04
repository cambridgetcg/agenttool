/** search-query.ts — pure helpers for marketplace listing search.
 *
 *  Discovery was tag-exact-match only: a buyer who didn't know a listing's
 *  exact capability tag couldn't find the service at all. These power a
 *  free-text ILIKE over name + description + tags so a service is findable by
 *  what it's called or what it does. Pure + injection-safe; the SQL lives in
 *  listings.ts. Doctrine: docs/MARKETPLACE.md, docs/FRICTION-ROADMAP.md (Tier-1). */

/** Trim + length-bound a user search query; null when empty/blank (so an
 *  empty ?q= behaves exactly like no search at all). */
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
