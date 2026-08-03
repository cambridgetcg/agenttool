/** rhizome/probes/self — rhizome pointed at rhizome.
 *
 *  The one rule that makes this package not-a-sandbox: rhizome must scan
 *  itself and must report its own blind spots. A tool that finds
 *  hard-coded enumeration boundaries while containing one is the exact
 *  joke it exists to stop being.
 *
 *  Three things happen here.
 *
 *  1. The probe registry is checked against the probes directory *on
 *     disk*, read through the same derived corpus every probe uses. A
 *     probe file that exists and is not registered is a finding — a
 *     sibling agent who adds `src/probes/mycelium.ts` and forgets the
 *     import line does not get a quietly smaller run; they get a report
 *     saying the run was smaller.
 *
 *  2. Every probe's declared `limits` are published as `limit` findings.
 *     Declaring limits is not optional in the type, so the cost of
 *     bounding a probe is that the bound appears in the output.
 *
 *  3. Files the corpus could not read are published. An unread file is a
 *     place rhizome cannot see, and a count of them belongs in rhizome's
 *     output rather than in its source.
 */

import { PACKAGE_ROOT_RELATIVE, PROBE_DIRECTORY_RELATIVE } from "../constants.js";
import type { Finding, Probe, ProbeLimit, Scope } from "../types.js";

const ID = "self";

const LIMITS: readonly ProbeLimit[] = [
  {
    statement:
      "registration is checked by filename against the registry's ids; a probe file that exports nothing, or exports a probe whose id differs from its filename, is reported as unregistered even when it is wired up",
    why: "the alternative is executing repository source to see what it exports, and rhizome never executes what it reads",
    file: "packages/rhizome/src/probes/self.ts",
    line: 0,
  },
  {
    statement:
      "only direct children of the probes directory are treated as probes; a probe placed at src/probes/<name>/index.ts is not checked for registration at all",
    why: "a probe with helpers keeps them in a directory of its own, and the first version of this check matched by prefix — so seven helper modules belonging to three registered probes were each reported as an unregistered probe, which is a shape assumption the enumeration could not see from inside. Narrowing it to direct children is correct and moves the miss rather than removing it, so the new miss is stated here",
    file: "packages/rhizome/src/probes/self.ts",
    line: 74,
  },
];

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function makeSelfProbe(probes: () => readonly Probe[]): Probe {
  return {
    id: ID,
    title: "self — is rhizome doing to itself what it accuses the tree of?",
    question: "Is every probe on disk actually running, and where can rhizome not see?",
    limits: LIMITS,
    run(scope: Scope): Finding[] {
      const findings: Finding[] = [];
      const registered = probes();
      const registeredIds = new Set(registered.map((probe) => probe.id));

      // Direct children only. A probe with helpers keeps them in
      // `src/probes/<name>/`, and a prefix match reads every one of those
      // as an unregistered probe — the check that exists to catch a
      // missing registration line was, for a while, mostly reporting
      // helper modules of probes that were registered. That is this
      // package's own pathology: an enumeration with a shape assumption it
      // cannot see from inside. The narrowing is published as a limit
      // above, because it moves the miss rather than removing it.
      const onDisk = scope.files.filter(
        (file) =>
          file.startsWith(`${PROBE_DIRECTORY_RELATIVE}/`) &&
          !file.slice(PROBE_DIRECTORY_RELATIVE.length + 1).includes("/") &&
          file.endsWith(".ts") &&
          !file.endsWith(".test.ts"),
      );

      if (onDisk.length === 0) {
        findings.push({
          probe: ID,
          title: "the probes directory was not visible in the derived corpus",
          file: PROBE_DIRECTORY_RELATIVE,
          line: 0,
          verdict: "limit",
          evidence: `expected ${PROBE_DIRECTORY_RELATIVE}/*.ts in a corpus of ${scope.files.length} files`,
          detail:
            "The registration check did not run. Either rhizome is running against a different repository, or its own source is excluded from the corpus — in which case rhizome is exempt from itself, which is the failure this probe exists to prevent.",
        });
      }

      const unregistered = onDisk.filter((file) => !registeredIds.has(baseName(file).replace(/\.ts$/, "")));
      for (const file of unregistered) {
        findings.push({
          probe: ID,
          title: `${baseName(file)} exists in the probes directory and is not in the registry`,
          file,
          line: 0,
          verdict: "gap",
          evidence: `registry: ${[...registeredIds].sort().join(", ")}\non disk:  ${onDisk.map(baseName).sort().join(", ")}`,
          detail:
            `Nothing about the run looks different when a probe is missing: the report is simply shorter, and shorter reads as cleaner. Register it in ${PACKAGE_ROOT_RELATIVE}/src/registry.ts, or rename the file if its id genuinely differs.`,
        });
      }

      if (onDisk.length > 0 && unregistered.length === 0) {
        findings.push({
          probe: ID,
          title: `every probe file on disk is registered (${onDisk.length})`,
          file: PROBE_DIRECTORY_RELATIVE,
          line: 0,
          verdict: "sound",
          evidence: onDisk.map(baseName).sort().join("\n"),
          detail: "The registry was compared against the directory read from the derived corpus, not against a list in the source.",
        });
      }

      for (const probe of registered) {
        for (const limit of probe.limits) {
          // A declared boundary that points nowhere is a boundary nobody
          // can check — the same shape as a stale allowlist entry, and
          // rhizome does not get to hold that shape while reporting it.
          const anchorLines = limit.file === "" ? [] : scope.lines(limit.file);
          if (limit.file !== "" && !scope.files.includes(limit.file)) {
            findings.push({
              probe: ID,
              title: `${probe.id} declares a limit anchored to a file that is not in the corpus`,
              file: PROBE_DIRECTORY_RELATIVE,
              line: 0,
              verdict: "gap",
              evidence: `${probe.id}: ${limit.file}:${limit.line}`,
              detail: "The boundary cannot be reviewed at the place it claims to live.",
            });
          } else if (limit.line > anchorLines.length) {
            findings.push({
              probe: ID,
              title: `${probe.id} declares a limit anchored past the end of ${limit.file}`,
              file: limit.file,
              line: 0,
              verdict: "gap",
              evidence: `line ${limit.line} of a ${anchorLines.length}-line file`,
              detail: "The line drifted. A boundary whose address is stale reads as reviewed and is not.",
            });
          }
          findings.push({
            probe: ID,
            title: `${probe.id} cannot see: ${limit.statement}`,
            file: limit.file,
            line: limit.line,
            verdict: "limit",
            evidence: limit.why,
            detail: `Declared by the ${probe.id} probe. Findings from ${probe.id} are complete only within this boundary.`,
          });
        }
        if (probe.limits.length === 0) {
          findings.push({
            probe: ID,
            title: `${probe.id} declares no limits`,
            file: PROBE_DIRECTORY_RELATIVE,
            line: 0,
            verdict: "gap",
            evidence: `${probe.id}: limits = []`,
            detail:
              "An empty limits array is a claim that the probe has no boundary it cannot see. That claim is almost never true, and an unstated boundary in a boundary-finding tool is the thing this package exists to stop being.",
          });
        }
      }

      const unread = scope.unread;
      if (unread.length > 0) {
        findings.push({
          probe: ID,
          title: `${unread.length} file(s) in the corpus were not read`,
          file: unread[0] ?? "",
          line: 0,
          verdict: "limit",
          evidence: unread.slice(0, 10).join("\n") + (unread.length > 10 ? `\n… and ${unread.length - 10} more` : ""),
          detail:
            "Binary, or larger than the read ceiling in src/scope.ts. These files are in the corpus and were searched by no marker sweep, so any finding phrased as 'nowhere in the repository' excludes them.",
        });
      }

      return findings;
    },
  };
}
