import { spawnSync } from "node:child_process";

// Resolving the older builds the forward-compatibility harness runs against
// (spec 8.5). Kept apart from the harness so a test can hold the
// missing-revision path to its promise: it fails, naming fetch-depth: 0 and
// the revision, and never skips.

export interface Ships {
  mcp: boolean;
  host: boolean;
  host_wait: boolean;
  host_seat_ref: boolean;
}

export interface Revision {
  name: string;
  sha: string | null;
  missing: string | null;
  ships: Ships;
}

export type RevisionRole = "older build" | "golden";

export function gitIn(repositoryRoot: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  // From the repository root, so archive pathspecs name the same tree paths as `rev:path`.
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", timeout: 30_000 });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
}

export function missingMessage(name: string, detail: string, role: RevisionRole): string {
  // The golden scenario and the event-type union check always compare with
  // a8799aad (spec 8.5), so naming COLLAB_COMPAT_REVS as the way out there
  // would send a reader to a setting that changes nothing.
  const choice = role === "golden"
    ? `The golden scenario and the event-type union check always compare with ${name}; COLLAB_COMPAT_REVS does not change that.`
    : "COLLAB_COMPAT_REVS chooses the older builds.";
  return `Compatibility revision "${name}" is not in this clone (${detail.trim() || "git rev-parse failed"}). `
    + "The forward-compatibility harness needs full git history: set fetch-depth: 0 on the actions/checkout step, "
    + `or fetch ${name}. It does not skip a missing revision. ${choice}`;
}

/**
 * The public projection's explicit answer to missing history. Its commits are
 * one-way projections, so they hold none of the older revisions these checks
 * read. Its CI sets COLLAB_COMPAT_SKIP_MISSING, in the collab step only, to
 * the reason; then, and only then, a check whose revision is missing is
 * skipped and that reason printed. Unset or blank, a missing revision fails
 * as before. Reason: a skip must be a visible choice, never a detection
 * accident.
 */
export const SKIP_MISSING_VARIABLE = "COLLAB_COMPAT_SKIP_MISSING";

/** The reason given for skipping missing revisions, or null when none was given. */
export function skipMissingReason(environment: Record<string, string | undefined> = process.env): string | null {
  const value = (environment[SKIP_MISSING_VARIABLE] ?? "").trim();
  return value === "" ? null : value;
}

/** The line printed for each skipped revision, so the skip and its reason are in the log. */
export function skipNotice(name: string, reason: string): string {
  return `${SKIP_MISSING_VARIABLE}: skipping the checks that need revision "${name}", which this clone does not hold. `
    + `Reason given: ${reason}`;
}

export function resolveRevision(repositoryRoot: string, name: string, role: RevisionRole = "older build"): Revision {
  const none: Ships = { mcp: false, host: false, host_wait: false, host_seat_ref: false };
  const parsed = gitIn(repositoryRoot, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
  const sha = parsed.stdout.trim();
  if (!parsed.ok || !/^[0-9a-f]{40}$/.test(sha)) {
    return { name, sha: null, missing: missingMessage(name, parsed.stderr, role), ships: none };
  }
  const has = (path: string) => gitIn(repositoryRoot, ["cat-file", "-e", `${sha}:packages/collab/${path}`]).ok;
  const host = has("dist/agenttool-collab-host.js");
  const hostSource = host ? gitIn(repositoryRoot, ["show", `${sha}:packages/collab/src/host.ts`]).stdout : "";
  const usage = /COLLAB_HOST_USAGE =([\s\S]*?);\n/.exec(hostSource)?.[1] ?? "";
  return {
    name,
    sha,
    missing: null,
    ships: {
      mcp: has("dist/agenttool-collab-mcp.js"),
      host,
      host_wait: host && usage.includes("agenttool-collab-host wait"),
      host_seat_ref: host && usage.includes("--seat-ref"),
    },
  };
}
