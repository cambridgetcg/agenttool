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
  in rhizome's own output. `NEVER_WALKED` in `src/scope.ts` is the only such
  boundary and carries all four.
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
  finding go away — that is a separate, human-authorised act.
- Exit code 0 whether or not gaps were found. `--fail-on-gap` is the caller's
  explicit decision.

## Tests

`bun test` — 130 tests, 0 fail, 0 skip. One file per probe plus the shared
core. This list was six entries long while ten files existed on disk: an
enumeration with an edge it could not see, in the documentation of the package
that exists to find those. Read the directory, not this paragraph.

- `tests/scope.test.ts` — gitignore forms, union-not-intersection, and each
  kind of derivation disagreement, against real temporary git repositories.
- `tests/source.test.ts` — the shared text readers.
- `tests/edge.test.ts` · `claim.test.ts` · `reach.test.ts` ·
  `pretend.test.ts` · `decay.test.ts` — one per probe. Each has a fixture half
  pinning the classification rules and a live half asserting against the real
  tree, including at least one `sound` instance so a future tightening that
  turns a correct construct into a gap is visible.
- `tests/self.test.ts` — unregistered probe files, undeclared limits, and
  limit anchors that point nowhere.
- `tests/cli.test.ts` — flags, JSON shape, exit codes.
- `tests/package.test.ts` — manifest/constant alignment, no runtime deps,
  control-character escaping in the human report.

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
