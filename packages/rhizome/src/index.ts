/** @agenttool/rhizome — read-only soil probe for this repository.
 *
 *  The mycelium: the thing that crosses package boundaries, connects
 *  otherwise-isolated organs, and decomposes what is dead so it returns
 *  to the system. It answers one question the test suite cannot: what
 *  here is pretending?
 */

export { PACKAGE_NAME, PACKAGE_VERSION, PACKAGE_ROOT_RELATIVE, PROBE_DIRECTORY_RELATIVE, REPORT_SCHEMA_ID } from "./constants.js";
export { formatFinding, formatReport } from "./format.js";
export { compileIgnoreFile, isIgnored, type IgnoreRule } from "./gitignore.js";
export { allProbes, probeById, probeIds, selfProbe } from "./registry.js";
export { runProbes, UnknownProbeError, type RunOptions } from "./run.js";
export { deriveFromFilesystem, deriveFromGit, findRepoRoot, resolveScope, MAX_READ_BYTES, NEVER_WALKED } from "./scope.js";
export {
  clip,
  commentAbove,
  lineOf,
  literalCollections,
  literalUnions,
  stringLiterals,
  type LiteralCollection,
  type LiteralUnion,
} from "./source.js";
export { stableStringify } from "./stable-json.js";
export { claimProbe } from "./probes/claim.js";
export { decayProbe } from "./probes/decay.js";
export { edgeProbe } from "./probes/edge.js";
export { MUTATE_ENV, pretendProbe } from "./probes/pretend.js";
export { reachProbe } from "./probes/reach.js";
export { scopeProbe } from "./probes/scope.js";
export { makeSelfProbe } from "./probes/self.js";
export type {
  Finding,
  Probe,
  ProbeLimit,
  Scope,
  ScopeDerivation,
  ScopeDisagreement,
  SoilReport,
  Verdict,
} from "./types.js";
export { runCli, type CliIo } from "./cli.js";
