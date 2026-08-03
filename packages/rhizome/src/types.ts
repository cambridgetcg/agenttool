/** rhizome/types — the shapes every probe shares.
 *
 *  Rhizome asks one question the test suite cannot: what here is
 *  pretending? A test asserts a property and goes red when the property
 *  breaks. It cannot notice that the property it asserts is narrower than
 *  the property its name claims — that the enumeration it walks has an
 *  edge it cannot see from inside.
 *
 *  Everything below exists to make that noticing reportable rather than
 *  re-derivable: a finding you cannot point at is not a finding.
 */

/** What a finding says about the thing it points at.
 *
 *  - `gap`   — the shape of a guarantee without the substance of one.
 *              Something is enumerated, bounded or asserted, and the
 *              boundary is neither derived nor reviewed.
 *  - `sound` — it looks like a gap and is legitimately fine. This is not
 *              noise. It is how a reader learns to stop re-investigating
 *              the same construct every quarter. A bounded scope that is
 *              explicit, reasoned and staleness-checked is *correct*, and
 *              rhizome says so by name.
 *  - `limit` — rhizome's own edge. Something rhizome cannot see past,
 *              stated in rhizome's own output rather than left for the
 *              next reviewer to discover. A tool that finds hard-coded
 *              enumeration boundaries while containing an unstated one is
 *              the exact joke it exists to stop being.
 */
export type Verdict = "gap" | "sound" | "limit";

/** One reportable observation, anchored to a place in the tree.
 *
 *  `evidence` must be verbatim: source text, a path list, a command and
 *  its output. Not a summary. The reader must be able to judge the
 *  finding without re-running the probe. */
export interface Finding {
  /** Probe id that produced this. Matches `Probe.id`. */
  probe: string;
  /** One line, specific. "SCAN_DIRS is a private copy", not "scope issue". */
  title: string;
  /** Repo-relative POSIX path. Empty string only for repo-wide facts. */
  file: string;
  /** 1-indexed. `0` when the finding is about the file as a whole. */
  line: number;
  verdict: Verdict;
  /** Verbatim supporting text. Multi-line is fine and usually right. */
  evidence: string;
  /** Why this is what it is, and what it would take to change the verdict. */
  detail?: string;
}

/** A boundary a probe genuinely has, declared by the probe itself.
 *
 *  Every probe must declare its limits, and the `self` probe turns each
 *  one into a `limit` finding in the report. This is the mechanism that
 *  keeps rhizome from becoming the thing it detects: a probe author who
 *  hard-codes a scope has to either derive it or write down that they
 *  did not, and the write-down is published. */
export interface ProbeLimit {
  /** What the probe cannot see. Phrase it as the miss, not the feature. */
  statement: string;
  /** Why the boundary is there — cost, ambiguity, or an open question. */
  why: string;
  /** Where the boundary lives in rhizome's own source, repo-relative. */
  file: string;
  /** 1-indexed line of the boundary. `0` if it is the whole module. */
  line: number;
}

/** One independent answer to "what source files exist in this repository?"
 *
 *  Rhizome never trusts a single answer. Two derivations that disagree
 *  are the blind-spot signature this tool exists to detect, so the
 *  disagreement is a finding rather than something to reconcile away. */
export interface ScopeDerivation {
  /** Stable id, e.g. `git-tracked`. */
  id: string;
  /** How the list was obtained, verbatim enough to re-run by hand. */
  method: string;
  /** Repo-relative POSIX paths, sorted. */
  files: readonly string[];
  /** What this derivation structurally cannot see. */
  blindTo: string;
}

/** Why one derivation holds a path another does not.
 *
 *  A machine-readable classification, because the alternative was reading
 *  the prose `reading` back with `startsWith` — two probes did exactly
 *  that, and one of them then printed a `detail` explaining untracked
 *  files over a group of tracked ones. A classification a consumer has to
 *  reconstruct from an English sentence is not a classification. */
export type DisagreementKind =
  /** On disk, and version control does not know about it. */
  | "untracked"
  /** Tracked, and the walk refuses to follow the symlink that reaches it. */
  | "symlink"
  /** Tracked, and an ignore rule covers it — force-added at some point. */
  | "ignored-yet-tracked"
  /** Tracked, and rhizome's own ignore matching dropped it. Rhizome's miss. */
  | "unexplained";

/** A path one derivation found and another did not. */
export interface ScopeDisagreement {
  file: string;
  /** Derivation ids that contain this path. */
  presentIn: readonly string[];
  /** Derivation ids that do not. */
  absentFrom: readonly string[];
  /** What kind of absence this is. Switch on this, never on `reading`. */
  kind: DisagreementKind;
  /** Plain-language reading of what the absence means. */
  reading: string;
}

/** The resolved repository, handed to every probe.
 *
 *  `files` is the UNION of the derivations, never the intersection.
 *  Intersecting would rebuild the blind spot inside the instrument that
 *  is supposed to find blind spots: a file only one derivation can see is
 *  exactly the file most worth looking at. */
export interface Scope {
  /** Absolute path to the repository root (the directory holding `.git`). */
  root: string;
  /** Union of every derivation, repo-relative POSIX, sorted. */
  files: readonly string[];
  /** Every directory implied by `files`, repo-relative, no trailing slash. */
  directories: ReadonlySet<string>;
  derivations: readonly ScopeDerivation[];
  disagreements: readonly ScopeDisagreement[];
  /** Paths in `files` that were too large or too binary to read. Rhizome's
   *  own unread set, published rather than silently dropped.
   *
   *  Only complete after `readAll()`. Before that it holds whatever the
   *  probes that happened to run tried to read, which is why `readAll()`
   *  exists: `--probe self` — the one command a reader uses to ask "where
   *  can rhizome not see?" — reported an empty unread set, because asking
   *  the question alone meant nothing had read anything. */
  unread: readonly string[];
  /** Attempt every file in `files`, so `unread` is the corpus's unread set
   *  rather than an artefact of which probes were selected. Idempotent and
   *  cached; free once a full run has read the tree. */
  readAll(): void;
  /** File text, or `null` when unreadable/oversized/binary. Cached. */
  read(file: string): string | null;
  /** File text split on `\n`, or `[]` when unreadable. Cached. */
  lines(file: string): readonly string[];
  /** Every file in `files` whose text contains `marker`. Cached per marker.
   *  This is the derived sweep probes use instead of guessing a scope. */
  filesContaining(marker: string): readonly string[];
}

/** A probe: a question asked of a resolved repository.
 *
 *  Probes are pure with respect to the tree. They read; they never write
 *  inside the checkout, and never reach the network.
 *
 *  One exception, stated here rather than left as a docstring that is
 *  quietly false: `pretend` has an executing half behind `RHIZOME_MUTATE=1`
 *  which copies the packages a mutant touches into a shadow root under the
 *  system temporary directory, edits the copies, and runs the guard there.
 *  Nothing inside the checkout is written in either mode, and without the
 *  environment variable it publishes the mutation plan it did not run. A
 *  probe that executes repository code must say so in its `limits`. */
export interface Probe {
  /** Stable kebab-case id. Also the CLI selector: `--probe edge`. */
  readonly id: string;
  /** Short human title for the section header. */
  readonly title: string;
  /** The one question this probe asks, in the reader's language. */
  readonly question: string;
  /** Boundaries this probe genuinely has. Empty array is a claim, not a
   *  default: it asserts the probe has no unstated edge. */
  readonly limits: readonly ProbeLimit[];
  run(scope: Scope): Finding[] | Promise<Finding[]>;
}

/** A whole run. Stable enough to diff between commits. */
export interface SoilReport {
  tool: string;
  version: string;
  root: string;
  scope: {
    fileCount: number;
    derivations: Array<{ id: string; method: string; fileCount: number; blindTo: string }>;
    disagreementCount: number;
    unreadCount: number;
  };
  probes: Array<{ id: string; title: string; question: string }>;
  findings: Finding[];
  counts: Record<Verdict, number>;
}
