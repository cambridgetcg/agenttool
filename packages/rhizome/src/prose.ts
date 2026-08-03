/** rhizome/prose — "is this file a document?", answered once.
 *
 *  This module exists because rhizome contained the exact thing rhizome
 *  exists to find. On its first run over this repository the tool reported
 *  the six-fold `encodePathSegment` duplication in the SDKs; at that moment
 *  its own source carried three copies of this list —
 *
 *    src/probes/edge.ts        [".md", ".mdx", ".txt"]
 *    src/probes/reach.ts       [".md", ".mdx", ".txt", ".rst"]
 *    src/probes/decay/reach.ts [".md", ".mdx", ".txt", ".rst"]
 *
 *  — one of them strictly narrower than the other two, for no stated
 *  reason. Nothing went red when they diverged, because nothing compared
 *  them: each looked complete from inside its own file. That is the
 *  pathology, reproduced inside the instrument.
 *
 *  So: one definition, imported by every probe that needs the concept.
 *
 *  The list itself is a literal and cannot be otherwise — "is this file
 *  prose?" has no derivation from a corpus that is not itself a guess, and
 *  a corpus-derived answer would call any extension nobody has used yet
 *  code. It therefore carries the four things this package demands of a
 *  literal boundary:
 *
 *    exported            here, and imported rather than copied;
 *    reasoned            below, per entry family;
 *    staleness-checked   `tests/prose.test.ts` fails if a probe declares a
 *                        private copy of this concept, and fails if a
 *                        document-shaped extension in the corpus is absent
 *                        from the list without being named;
 *    stated in output    published as a `ProbeLimit` by every probe that
 *                        uses it, so the exclusion appears in the report.
 */

/** Extensions read as documentation rather than as machine instruction.
 *
 *  `.md`/`.mdx` are the repository's documentation formats; `.txt` is how
 *  licence and notice text is carried; `.rst` is the Python-side spelling
 *  of the same thing. What they share is the property the probes rely on: a
 *  command quoted in one of them is being *described*, not run, and a list
 *  written in one of them is a sentence, not an enumeration a machine
 *  reads. */
export const PROSE_EXTENSIONS: readonly string[] = Object.freeze([".md", ".mdx", ".txt", ".rst"]);

/** Human phrasing of the boundary, for a probe's `ProbeLimit.statement`. */
export const PROSE_EXTENSION_LIST = PROSE_EXTENSIONS.join("/");

/** Does this repo-relative path name a prose document? */
export function isProse(file: string): boolean {
  return PROSE_EXTENSIONS.some((extension) => file.endsWith(extension));
}
