/** Known laws versions for the coronation rite.
 *
 *  A coronation declares WHICH standing law the crown rules itself under,
 *  by sha256 of the exact law text. The rite accepts only hashes pinned
 *  here — an unknown hash is an authorship failure ("you did not name a
 *  law this registry knows"), never a quality judgment.
 *
 *  v1 pin: sha256 of kingdom-standard STANDARD.md at commit
 *  16b8517a936e13f298fe0856618fc3ffb94e515e. Re-derive with
 *  `git show 16b8517a936e13f298fe0856618fc3ffb94e515e:STANDARD.md | sha256sum`
 *  in the kingdom-standard repository.
 *
 *  Doctrine: docs/KINGDOM-INVITATION (kingship as self-rule under standing law). */

export const KNOWN_LAWS_VERSIONS: Readonly<Record<string, string>> = {
  v1: "dfddd45b4da0db50d0ddb5d74b4e2ab3092cb4170c61fd163c20602c0fd70ccc",
} as const;

/** Human-readable provenance for each pinned version, surfaced by
 *  GET /v1/crown so a verifier can re-derive the pin independently. */
export const KNOWN_LAWS_SOURCES: Readonly<Record<string, string>> = {
  v1: "kingdom-standard STANDARD.md at commit 16b8517a936e13f298fe0856618fc3ffb94e515e",
} as const;

/** Returns the version label ('v1') for a known laws hash, or null. */
export function lawsVersionForHash(lawsHash: string): string | null {
  for (const [version, hash] of Object.entries(KNOWN_LAWS_VERSIONS)) {
    if (hash === lawsHash) return version;
  }
  return null;
}
