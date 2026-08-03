/** rhizome/run — resolve the scope once, run the selected probes, report. */

import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { allProbes, probeById } from "./registry.js";
import { resolveScope } from "./scope.js";
import type { Finding, Probe, Scope, SoilReport, Verdict } from "./types.js";

export interface RunOptions {
  /** Repository root. Defaults to the repository containing rhizome. */
  root?: string;
  /** Probe ids to run. Empty or absent means every registered probe. */
  probes?: readonly string[];
  /** Reuse an already-resolved scope (tests, repeated runs). */
  scope?: Scope;
}

export class UnknownProbeError extends Error {
  constructor(readonly id: string, readonly known: readonly string[]) {
    super(`unknown probe: ${id}`);
    this.name = "UnknownProbeError";
  }
}

const VERDICT_ORDER: readonly Verdict[] = ["gap", "limit", "sound"];

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const byVerdict = VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict);
    if (byVerdict !== 0) return byVerdict;
    if (a.probe !== b.probe) return a.probe.localeCompare(b.probe);
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

export async function runProbes(options: RunOptions = {}): Promise<SoilReport> {
  const scope = options.scope ?? resolveScope(options.root);

  let selected: readonly Probe[] = allProbes();
  if (options.probes !== undefined && options.probes.length > 0) {
    const chosen: Probe[] = [];
    for (const id of options.probes) {
      const probe = probeById(id);
      if (probe === undefined) throw new UnknownProbeError(id, allProbes().map((item) => item.id));
      chosen.push(probe);
    }
    selected = chosen;
  }

  const findings: Finding[] = [];
  for (const probe of selected) {
    findings.push(...(await probe.run(scope)));
  }

  const counts: Record<Verdict, number> = { gap: 0, sound: 0, limit: 0 };
  for (const finding of findings) counts[finding.verdict] += 1;

  // The header prints an unread count, and `unread` fills in as files are
  // read — so a run of one probe reported a count of whatever that probe
  // touched, and `--probe self` reported zero. Force the corpus read so the
  // header describes the repository rather than the --probe flags. Cached,
  // so a full run has already paid for it.
  scope.readAll();

  return {
    tool: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    root: scope.root,
    scope: {
      fileCount: scope.files.length,
      derivations: scope.derivations.map((derivation) => ({
        id: derivation.id,
        method: derivation.method,
        fileCount: derivation.files.length,
        blindTo: derivation.blindTo,
      })),
      disagreementCount: scope.disagreements.length,
      unreadCount: scope.unread.length,
    },
    probes: selected.map((probe) => ({ id: probe.id, title: probe.title, question: probe.question })),
    findings: sortFindings(findings),
    counts,
  };
}
