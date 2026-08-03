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
 *
 *  On (3): `Scope.unread` fills in as files are read, so for most of this
 *  probe's life `rhizome --probe self` printed no unread finding at all and
 *  a header reading `0 unread`. Not because rhizome could see everything —
 *  because nothing had looked. The one command a reader would use to ask
 *  "where can rhizome not see?" answered "nowhere" precisely when it was
 *  asked on its own; a full run of the same corpus reports 43. So this
 *  probe forces the read before publishing, and the number no longer
 *  depends on which probes the caller selected.
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
  {
    statement:
      "a probe is recognised by the extension in PROBE_EXTENSIONS (.ts), so a probe written in any other language, or generated, is not checked for registration",
    why:
      "the package is TypeScript-only by invariant and the compiled copy is excluded by the dist→src swap in src/constants.ts, so widening the set would only ever admit the build output of the files already checked. The boundary was undeclared until now and the narrowing is not free: any other direct child of the probes directory is published as a `limit` finding naming it, so a probe in another form is a stated miss rather than a silent one",
    file: "packages/rhizome/src/probes/self.ts",
    line: 0,
  },
];

/** Extensions a direct child of the probes directory must carry to be read
 *  as a probe. Asserted, and the miss is published: anything else directly
 *  under the probes directory becomes a `limit` finding below rather than
 *  being dropped, so the boundary appears in the output holding the names
 *  it excluded. */
export const PROBE_EXTENSIONS: readonly string[] = Object.freeze([".ts"]);

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
      const directChildren = scope.files.filter(
        (file) =>
          file.startsWith(`${PROBE_DIRECTORY_RELATIVE}/`) &&
          !file.slice(PROBE_DIRECTORY_RELATIVE.length + 1).includes("/"),
      );
      const onDisk = directChildren.filter(
        (file) => PROBE_EXTENSIONS.some((extension) => file.endsWith(extension)) && !file.endsWith(".test.ts"),
      );

      // The extension filter IS the enumeration boundary here, so the names
      // it drops are published rather than silently excluded. A probe added
      // in another form is then a stated miss with its filename attached,
      // instead of a run that is quietly one probe shorter.
      const otherForms = directChildren.filter((file) => !onDisk.includes(file));
      if (otherForms.length > 0) {
        findings.push({
          probe: ID,
          title: `${otherForms.length} file(s) directly under the probes directory are not read as probes`,
          file: otherForms[0] ?? PROBE_DIRECTORY_RELATIVE,
          line: 0,
          verdict: "limit",
          evidence: `${otherForms.join("\n")}\n\nread as a probe only when the name ends in: ${PROBE_EXTENSIONS.join(", ")}`,
          detail:
            "Registration is checked for these extensions and no others. Each file above is outside that check: if one of them is a probe, nothing here would notice it going unregistered.",
        });
      }

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

      // Before this line the unread set is whatever the probes that
      // happened to run already touched — which for `--probe self` is
      // nothing at all, and an empty unread set reads as "rhizome can see
      // everything". Force the corpus read so the number below is a fact
      // about the tree rather than about the caller's --probe flags.
      scope.readAll();
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
      } else {
        // Said out loud rather than left as an absent finding. "No unread
        // finding" is what a broken unread set looks like too, and those
        // two states were indistinguishable in the report for as long as
        // this probe existed.
        findings.push({
          probe: ID,
          title: `every file in the corpus was readable (${scope.files.length})`,
          file: "",
          line: 0,
          verdict: "sound",
          evidence: `${scope.files.length} files attempted, 0 unread`,
          detail:
            "Every path in the corpus was opened, so a finding phrased as 'nowhere in the repository' excludes nothing. Checked after forcing the read, not inferred from the probes that happened to run.",
        });
      }

      return findings;
    },
  };
}
