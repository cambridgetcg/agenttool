/** rhizome/probes/scope — the corpus disagreeing with itself.
 *
 *  `src/scope.ts` answers "what source files exist here?" twice, by
 *  mechanisms that fail differently. This probe reports where the two
 *  answers differ, because that difference is the blind-spot signature in
 *  its purest form: a file one enumeration can see and the other cannot.
 *
 *  A scanner built on `git ls-files` and a scanner built on a directory
 *  walk both look complete from inside. The only way to see the edge is
 *  from outside, holding both.
 */

import { NEVER_WALKED_LIMIT } from "../scope.js";
import type { DisagreementKind, Finding, Probe, ProbeLimit, Scope } from "../types.js";

const ID = "scope";

const LIMITS: readonly ProbeLimit[] = [
  NEVER_WALKED_LIMIT,
  {
    statement: "two derivations agreeing does not make them right; both share the assumption that a file on disk under the repository root is the unit",
    why: "a third mechanism (the build graph, say) would be a real third opinion, and there is not one to read in this repository",
    file: "packages/rhizome/src/scope.ts",
    line: 0,
  },
  {
    statement: "`git ls-files` reflects the index, so a file staged-and-deleted or assume-unchanged reads differently from the working tree",
    why: "reading the index directly would mean reimplementing it; the disagreement it causes is reported rather than resolved",
    file: "packages/rhizome/src/scope.ts",
    line: 0,
  },
];

/** One detail per kind of disagreement.
 *
 *  These used to be two: "rhizome's own miss" for the unexplained group,
 *  and a sentence about untracked files for everything else. Everything
 *  else is three groups, two of which are *tracked* — so a reader looking
 *  at eleven force-added files was told they were untracked and that
 *  git-based scanners could not see them, both of which are the opposite
 *  of true. Keyed by kind, and exhaustive by type: a new kind does not
 *  compile until it has its own sentence. */
const DISAGREEMENT_DETAIL: Readonly<Record<DisagreementKind, string>> = Object.freeze({
  untracked:
    "Not a defect: untracked files are real and probes see them, because the corpus is the union. It is recorded because any tool in this repository that enumerates via git alone is blind to exactly this set.",
  symlink:
    "Not a defect, and not an untracked file: git records the link, and the walk refuses to follow it so one file is not counted twice under two paths. Probes see it, because the corpus is the union. It is recorded because a tool that walks the tree without following links reaches this content only through the path git knows.",
  "ignored-yet-tracked":
    "Not a defect, and not an untracked file: git tracks each of these, and an ignore rule covers it — a force-add at some point in its history. Probes see them, because the corpus is the union. It is recorded because a tool that honours .gitignore while claiming to sweep the repository is blind to exactly this set, and because a checked-in build artefact usually lands here.",
  unexplained:
    "This is rhizome's own miss: its gitignore matcher dropped a file git tracks, and no symlink or ignore rule explains the absence. Every probe in this run saw the file anyway, because the corpus is the union of the derivations rather than the intersection — but the matcher is wrong here and the count is the size of the error.",
});

/** Whose defect each kind is. Only the unexplained group is rhizome's. */
const DISAGREEMENT_VERDICT: Readonly<Record<DisagreementKind, "sound" | "limit">> = Object.freeze({
  untracked: "sound",
  symlink: "sound",
  "ignored-yet-tracked": "sound",
  unexplained: "limit",
});

export const scopeProbe: Probe = {
  id: ID,
  title: "scope — do the two derivations of this repository agree?",
  question: "Which files can one enumeration of this repository see that the other cannot?",
  limits: LIMITS,
  run(scope: Scope): Finding[] {
    const findings: Finding[] = [];

    if (scope.derivations.length < 2) {
      return [
        {
          probe: ID,
          title: "only one derivation of the repository was available; nothing was cross-checked",
          file: "packages/rhizome/src/scope.ts",
          line: 0,
          verdict: "limit",
          evidence: scope.derivations.map((derivation) => `${derivation.id}: ${derivation.files.length} files`).join("\n"),
          detail: "Every finding in this run rests on a single unverified enumeration. Treat completeness claims accordingly.",
        },
      ];
    }

    for (const derivation of scope.derivations) {
      if (derivation.files.length !== 0) continue;
      findings.push({
        probe: ID,
        title: `derivation ${derivation.id} returned nothing`,
        file: "packages/rhizome/src/scope.ts",
        line: 0,
        verdict: "limit",
        evidence: `${derivation.method} → 0 files`,
        detail: "The cross-check degenerated to a single opinion for this run.",
      });
    }

    const byKind = new Map<DisagreementKind, { reading: string; files: string[] }>();
    for (const disagreement of scope.disagreements) {
      const bucket = byKind.get(disagreement.kind) ?? { reading: disagreement.reading, files: [] };
      bucket.files.push(disagreement.file);
      byKind.set(disagreement.kind, bucket);
    }

    for (const [kind, bucket] of byKind) {
      findings.push({
        probe: ID,
        title: `${bucket.files.length} file(s): ${bucket.reading}`,
        file: bucket.files[0] ?? "",
        line: 0,
        verdict: DISAGREEMENT_VERDICT[kind],
        evidence:
          bucket.files.slice(0, 12).join("\n") + (bucket.files.length > 12 ? `\n… and ${bucket.files.length - 12} more` : ""),
        detail: DISAGREEMENT_DETAIL[kind],
      });
    }

    if (scope.disagreements.length === 0) {
      findings.push({
        probe: ID,
        title: "both derivations of the repository returned the same file set",
        file: "",
        line: 0,
        verdict: "sound",
        evidence: scope.derivations.map((derivation) => `${derivation.id}: ${derivation.files.length} files (${derivation.method})`).join("\n"),
        detail: "No file is visible to one enumeration and invisible to the other.",
      });
    }

    return findings;
  },
};
