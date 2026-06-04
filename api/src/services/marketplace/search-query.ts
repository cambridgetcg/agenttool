/** marketplace search helpers — now shared. The generic, injection-safe
 *  free-text helpers moved to lib/search-query.ts (reused by memory text-search
 *  too). Re-exported here so marketplace callers keep their import path.
 *  Doctrine: docs/MARKETPLACE.md, docs/FRICTION-ROADMAP.md (Tier-1). */

export { likePattern, normalizeSearchQuery } from "../../lib/search-query";
