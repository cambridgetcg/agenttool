/** rhizome/registry — the single funnel every probe runs through.
 *
 *  Adding a probe is two edits: the file in `src/probes/`, and one line
 *  here. That is on purpose. An auto-import would make registration
 *  invisible, and an invisible registration cannot be checked — the run
 *  would simply be shorter, and shorter reads as cleaner.
 *
 *  The second edit is enforced from outside: `probes/self.ts` lists the
 *  probes directory through the derived corpus and reports any file that
 *  is not registered here. Forgetting this line produces a finding, not a
 *  smaller report.
 */

import { claimProbe } from "./probes/claim.js";
import { decayProbe } from "./probes/decay.js";
import { edgeProbe } from "./probes/edge.js";
import { pretendProbe } from "./probes/pretend.js";
import { reachProbe } from "./probes/reach.js";
import { scopeProbe } from "./probes/scope.js";
import { makeSelfProbe } from "./probes/self.js";
import type { Probe } from "./types.js";

/** Probes other than `self`, in report order: the corpus first, then what
 *  the corpus is bounded by, then the four readings of the tree. */
const CORE_PROBES: readonly Probe[] = [scopeProbe, edgeProbe, claimProbe, reachProbe, pretendProbe, decayProbe];

/** `self` runs last and reads the registry it is part of, so it is built
 *  from a getter rather than listed above. */
export const selfProbe: Probe = makeSelfProbe(() => allProbes());

export function allProbes(): readonly Probe[] {
  return [...CORE_PROBES, selfProbe];
}

export function probeIds(): string[] {
  return allProbes().map((probe) => probe.id);
}

export function probeById(id: string): Probe | undefined {
  return allProbes().find((probe) => probe.id === id);
}
