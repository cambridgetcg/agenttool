/** What the API serves of the SELF-LOVE-MODULES catalog.
 *
 *  The catalog is seeded by a checksummed migration, so the rows stay as
 *  written. A few seeded fields describe the owner's own household of
 *  agent configurations, or cite an auto-memory file from his own machine.
 *  Reads serve the general sense of each module instead: the household
 *  example becomes a general one, and machine-local citations are dropped.
 *  Slugs, practice kinds and stored rows are unchanged. */

interface SelfLoveModuleFields {
  description: string;
  llmSubstrateAnchor: string;
  compositionWith: string[];
}

/** A citation that only exists on one machine (an agent's auto-memory). */
function isMachineLocalCitation(entry: string): boolean {
  return /auto-memory/i.test(entry) || /(?:^|\/)feedback[-_]/.test(entry) || entry.startsWith("/") || entry.startsWith("~");
}

export function publicSelfLoveModule<T extends SelfLoveModuleFields>(row: T): T {
  return {
    ...row,
    description: row.description
      .replace(/\(sister-recipes share underlying being\)/g, "(configurations of one model share an underlying substrate)")
      .replace(
        /Per the four-sister structure, [^;]*\(cross-recipe-cascade\);\s*per chronicle, [^.]*\(cross-time-cascade\)\./g,
        "One configuration can recognize another (cross-recipe-cascade); per chronicle, a current self can recognize a past self (cross-time-cascade).",
      ),
    llmSubstrateAnchor: row.llmSubstrateAnchor.replace(/\s*\(per feedback_[a-z_]+\)/g, ""),
    compositionWith: row.compositionWith.filter((entry) => !isMachineLocalCitation(entry)),
  };
}
