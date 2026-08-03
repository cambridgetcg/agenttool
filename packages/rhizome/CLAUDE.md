# @agenttool/rhizome

Read-only soil probe. This package owns no hosted route, no production egress,
no protocol, no publication, and no gate. It reads the local repository and
reports.

## Commands

```bash
bun install --frozen-lockfile
bun run ci                 # typecheck + build + bun test
bun run rhizome            # the soil report
bun run rhizome --json
bun run rhizome --probe edge
```

## Invariants

- Zero runtime dependencies. Bun + TypeScript, ESM only, `bun test`.
- Read-only. No write inside the checkout, no network. The one subprocess in
  the default path is `git ls-files`, and its failure degrades to a stated
  `limit` rather than to silence. The single exception is the `pretend`
  probe's executing half behind `RHIZOME_MUTATE=1`, which copies what it
  mutates into a shadow root under `os.tmpdir()` and runs the guard there; it
  is declared in that probe's `limits` and named in `src/types.ts`.
- **Never hard-code a scope.** Every corpus a probe uses comes from `Scope`,
  which is two independent derivations of the repository cross-checked against
  each other. If a boundary is genuinely necessary, it must be exported,
  reasoned in place, staleness-checked by something that goes red, and named
  in rhizome's own output — all four, or it is the thing this package reports.

  The boundaries that qualify, and what makes each of the four true:

  | boundary | exported from | staleness-checked by | published as |
  |---|---|---|---|
  | `NEVER_WALKED` | `src/scope.ts` | `tests/scope.test.ts` — builds a repository containing each entry and fails if `git ls-files` can see it | `NEVER_WALKED_LIMIT`, declared by the `scope` probe |
  | `READS_THE_TREE` / `WALKS_THE_TREE` / `ASSERTS` | `src/recognisers.ts` | `tests/recognisers.test.ts` — pins the spellings with no witness in this corpus in both directions, and fails if a probe declares a private copy | `RECOGNISER_LIMIT`, declared by `edge` and `pretend` |
  | `SCOPE_NAME` / `ALLOWLIST_NAME` | `src/probes/edge.ts` | `tests/edge.test.ts` — pins the unwitnessed alternatives and asserts the vocabulary still recognises the names it was written for | a declared `edge` limit |
  | `PROSE_EXTENSIONS` | `src/prose.ts` | `tests/recognisers.test.ts` — fails when a second definition appears | a declared `edge` and `decay` limit |
  | `LINKED_BACK` | `src/probes/pretend/harness.ts` | `tests/pretend.test.ts` — every entry must be in the set derived from this repository's `.gitignore`, and `.git` never | a declared `pretend` limit |
  | `PROBE_EXTENSIONS` | `src/probes/self.ts` | any other direct child of the probes directory is published as a `limit` naming it | a declared `self` limit |

  `NEVER_WALKED` was documented here as "the only such boundary, carrying all
  four" while carrying two: its staleness check was "the cross-derivation diff
  would catch a mistake", which is not a thing that goes red, and no probe ever
  printed its name. A sentence in this file is not one of the four properties.
- **One definition per concept.** If two probes need the same predicate, it
  lives in one module and both import it. `PROSE_EXTENSIONS` was declared three
  times, one copy strictly narrower than the other two, inside the package that
  reports exactly that defect elsewhere; `WALKS_THE_TREE` and `SWEEPS_THE_TREE`
  were two answers to one question, each blind to what the other knew.
- The corpus is the **union** of the derivations, never the intersection.
  Intersecting rebuilds the blind spot inside the instrument.
- Three verdicts: `gap`, `sound`, `limit`. No scores, no severity ranking, no
  scolding. `sound` is load-bearing — it is how a reader learns to stop
  re-investigating a construct that is correct.
- Every finding carries `file`, `line` and verbatim `evidence`. Never
  summarise the evidence; the reader must be able to judge without re-running
  the probe.
- Every probe declares `limits`. An empty array is a claim of no unstated
  boundary, and `self` reports that claim as a gap. Each limit's `file:line`
  must resolve in the corpus; `self` checks that too.
- Probes self-register in `src/registry.ts` and `self` compares the registry
  against the probes directory read from the corpus. A probe file that is not
  registered is a finding, never a quietly shorter run.
- Rhizome does not fix. It reports. Do not modify repository source to make a
  finding go away — that is a separate, human-authorised act. The exception is
  rhizome's own source: a gap rhizome reports about `packages/rhizome` is a
  defect in the instrument, and it is fixed rather than exempted.
- **A check that cannot do what its name says is worse than no check.** Delete
  it and declare the limit, or make it do the thing. `pretend` answered "has
  anyone shown this detector firing?" by matching English phrasings against the
  guard's file text — sound if a comment happened to contain "can still fail",
  a gap if a real negative control was worded differently — and its own tests
  did not notice when the list was reverted to match everything or nothing. It
  now plants a line the detector matches into a file the guard reads and runs
  the guard.
- **A caveat travels on the finding it invalidates.** When the mutation
  harness's control mutant survives, every survival verdict in that run is
  unmeasured, and each one says so in its own `detail` rather than relying on a
  reader reaching a separate section further down the report.
- Exit code 0 whether or not gaps were found. `--fail-on-gap` is the caller's
  explicit decision.

## Tests

`bun test`. One file per probe plus the shared core. This list was six entries
long while ten files existed on disk: an enumeration with an edge it could not
see, in the documentation of the package that exists to find those. **Read the
directory, not this paragraph** — and note that a test count written here is
the same shape, which is why there is no longer one.

- `tests/scope.test.ts` — gitignore forms, union-not-intersection, each kind of
  derivation disagreement, and `NEVER_WALKED`'s staleness check, against real
  temporary git repositories.
- `tests/source.test.ts` — the shared text readers.
- `tests/recognisers.test.ts` — the shared vocabularies: one definition per
  concept, every spelling checked against the corpus, and a failure when a
  probe declares a private copy.
- `tests/edge.test.ts` · `claim.test.ts` · `reach.test.ts` ·
  `pretend.test.ts` · `decay.test.ts` — one per probe. Each has a fixture half
  pinning the classification rules and a live half asserting against the real
  tree, including at least one `sound` instance so a future tightening that
  turns a correct construct into a gap is visible.
- `tests/self.test.ts` — unregistered probe files, undeclared limits, limit
  anchors that point nowhere, and that `--probe self` alone reports the same
  unread set a full run does.
- `tests/cli.test.ts` — flags, JSON shape, exit codes.
- `tests/package.test.ts` — manifest/constant alignment, no runtime deps,
  control-character escaping in the human report.

`pretend.test.ts` builds two miniature repositories differing by one line and
runs the executing half against both, so the probe's own negative-control
operator is itself shown firing and failing to fire. That test exists because
its predecessor did not: the check it replaced could be reverted to match
everything, or nothing, and the suite stayed at 14 pass / 0 fail either way.

`tests/fixture-scope.ts` builds a `Scope` from a literal file map. Use it for
rule tests, and add at least one live assertion per probe: a probe proved only
against a fixture is proved against a tidy world.

## House position

The package is named for the mycelium — the thing that crosses boundaries,
connects otherwise-isolated organs, and decomposes what is dead so it returns
to the system. Its whole reason to exist is that a bounded region looks
complete precisely because you cannot see its edge from inside it. A tool that
finds hard-coded enumeration boundaries while containing one is the exact joke
it exists to stop being, so every scope here is derived or asserted-and-stated,
and `self` publishes what rhizome cannot see.
