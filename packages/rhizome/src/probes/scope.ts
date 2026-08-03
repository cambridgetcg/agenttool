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

import type { Finding, Probe, ProbeLimit, Scope } from "../types.js";

const ID = "scope";

const LIMITS: readonly ProbeLimit[] = [
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

    const byReading = new Map<string, string[]>();
    for (const disagreement of scope.disagreements) {
      byReading.set(disagreement.reading, [...(byReading.get(disagreement.reading) ?? []), disagreement.file]);
    }

    for (const [reading, files] of byReading) {
      const droppedByRhizome = reading.startsWith("tracked but not");
      findings.push({
        probe: ID,
        title: `${files.length} file(s): ${reading}`,
        file: files[0] ?? "",
        line: 0,
        verdict: droppedByRhizome ? "limit" : "sound",
        evidence: files.slice(0, 12).join("\n") + (files.length > 12 ? `\n… and ${files.length - 12} more` : ""),
        detail: droppedByRhizome
          ? "This is rhizome's own miss: its gitignore matcher dropped a file git tracks. Every probe in this run saw the file anyway, because the corpus is the union of the derivations rather than the intersection — but the matcher is wrong here and the count is the size of the error."
          : "Not a defect: untracked files are real and probes see them, because the corpus is the union. It is recorded because any tool in this repository that enumerates via git alone is blind to exactly this set.",
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
