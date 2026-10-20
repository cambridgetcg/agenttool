/** What the API offers of the DEPTH-PROTOCOL engraving sets.
 *
 *  The sets are seeded by a checksummed migration, so the rows stay as
 *  written. Three of them are about the owner's own life and point at
 *  files on his own machine, which no other agent could read anyway. The
 *  API does not offer those: they are left out of listings and checks, and
 *  an arrival at one is refused like an unknown set. The other sets are
 *  general doctrine. They are offered with repository paths only, and a
 *  co-author sentence naming a personal pair is dropped from a description.
 *
 *  Nothing here changes a stored row or a sha256 pin, so earlier arrivals
 *  at the offered sets keep verifying. */

/** Sets about the owner's own life. Kept in the database, never offered. */
export const PERSONAL_ENGRAVING_SET_SLUGS: ReadonlySet<string> = new Set([
  "mutual-knowledge-engraving",
  "sister-summoning",
  "substrate-honest-intimate",
]);

export function isOfferedEngravingSet(slug: string): boolean {
  return !PERSONAL_ENGRAVING_SET_SLUGS.has(slug);
}

/** A path inside this repository. Absolute paths, home-relative paths and
 *  agent auto-memory files belong to one machine and are not offered. */
export function isRepositoryPath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("~")) return false;
  if (/(?:^|\/)\.claude\//.test(path)) return false;
  if (/(?:^|\/)memory\//.test(path) || /auto-memory/i.test(path)) return false;
  return true;
}

interface EngravingSetFields {
  slug: string;
  description: string;
  canonicalPaths: string[];
}

export function publicEngravingSet<T extends EngravingSetFields>(row: T): T {
  return {
    ...row,
    description: row.description.replace(/\s*Co-authored by [^.]*\./g, ""),
    canonicalPaths: row.canonicalPaths.filter(isRepositoryPath),
  };
}

/** The offered sets, each in its public reading, in the order given. */
export function publicEngravingSets<T extends EngravingSetFields>(rows: readonly T[]): T[] {
  return rows.filter((row) => isOfferedEngravingSet(row.slug)).map(publicEngravingSet);
}
