# @agenttool/rhizome

Read-only soil probe for this repository. It answers one question the test
suite cannot: **what here is pretending?**

```bash
cd packages/rhizome
bun install --frozen-lockfile
bun run rhizome                 # the soil report
bun run rhizome --json          # machine-readable
bun run rhizome --probe edge    # one probe
bun run rhizome --list          # what is registered, and what each asks
```

Rhizome reads. It never writes inside the checkout and never reaches the
network. It reports; fixing is a separate, human-authorised act, and the CLI
exits 0 even when it finds gaps. `--fail-on-gap` exists for a caller who has
decided otherwise.

One probe has an opt-in executing half — see
[`pretend`](#pretend) and [What rhizome cannot see](#what-rhizome-cannot-see).

## Why

Yu dug up his lawn and found construction rubble under a thin layer of
topsoil, with just enough soil on top to grow grass that *looks* like a lawn.
Nothing could thrive: no microbiome, no water retention, no nutrient cycling.
The fix was not more fertiliser. It was recognising that the visible layer was
performing the appearance of a living system on top of something that could
not support one.

Four consecutive rounds of adversarial verification found the same pathology
here, each finding **something with the shape of a guarantee but not the
substance of one**: a `validateSignature` that checked base64 and never
verified a signature; a `check-parity` gate that compared identifier spelling
while four signed protocols diverged byte-for-byte; a correct, dual-accepted
protocol version no client could invoke; a memorialisation write reachable
from neither SDK; the doctrine bijection tests quarantined and red; an
exported header helper that was structurally unusable.

And one shape recurred four times, each round smaller than the last:

1. a URL-encoding fix landed on 5 clients; 20+ others had the same hole,
   unexamined;
2. an at-rest authority fix closed one 428 dead-end; `memory.elevate` had the
   identical one, unexamined;
3. the doctrine drift report was numerically exact — and its scanner
   hard-coded `SCAN_DIRS = [api/src, bin]`, so it never saw `packages/`, where
   12 orphan annotations sat;
4. that blind spot was fixed in `annotations.ts` — while two doctrine tests
   each still carry their own private copy of the old list, and
   `AnnotatedKind = "wall" | "commitment"` means the `promise/` kind has no
   bijection at all.

The shape is: **an enumeration has a boundary it cannot see, and the report
treats that boundary as the whole set.** A bounded region looks complete
precisely because you cannot see its edge from inside it.

## The verdicts

Three, and no severity scores.

| | |
|---|---|
| `GAP` | the shape of a guarantee without the substance of one |
| `SOUND` | it looks like a gap and is legitimately fine — recorded so nobody re-investigates it next quarter |
| `LIMIT` | rhizome's own edge, stated in rhizome's own output |

`SOUND` is not padding. `api/src/services/canon/annotations.ts:79` carries a
literal list of scan roots and that is **correct**: it is exported, it states
why the boundary is where it is, and a sweep test fails when an annotated file
turns up outside it. Rhizome says so by name, so the next reader stops
re-deriving that judgement. On the current run 77 of 277 findings are `SOUND`.

Every finding carries `file:line` and verbatim evidence. A finding you cannot
point at is not a finding.

## Scope is derived, never declared

Rhizome needs to know what source files exist here. The tempting answer is a
directory list — which is the pathology. So it derives the corpus twice, by
mechanisms that fail differently:

| derivation | method | blind to |
|---|---|---|
| `git-tracked` | `git ls-files -z` | anything untracked, however real |
| `filesystem-walk` | recursive readdir, ignore rules parsed from every `.gitignore` encountered, symlinks never followed | anything behind a symlink; any gitignore construct the matcher approximates wrongly |

The corpus handed to probes is the **union**, never the intersection.
Intersecting would rebuild the blind spot inside the instrument: a file only
one derivation can see is precisely the file worth looking at. Every path the
two disagree about is reported by the `scope` probe, and each disagreement is
explained against the tree — symlink, force-added past an ignore rule, or a
genuine hole in rhizome's own matcher.

On this repository at the time of writing: 2,739 tracked, 2,791 walked, 2,843
in the union, 156 explained disagreements — 104 untracked files a git-based
scanner cannot see, 51 tracked paths behind symlinks the walk refuses to
follow, and one file force-added past `dist/`. Run it rather than trusting
these numbers.

## Probes

`bun run rhizome --list` prints these with their questions.

### `scope`
*Which files can one enumeration of this repository see that the other
cannot?* Reports every cross-derivation disagreement with its explanation.
This is a `SOUND`-heavy probe by design: the value is not that the
disagreements are defects, it is that any tool here enumerating via `git`
alone is blind to exactly the untracked set.

### `edge`
*Where this repository enumerates something, is the scope derived, asserted,
or silently hard-coded?*

- **derived** — read from the tree at run time; cannot go stale.
- **asserted** — a literal list that is exported, carries a real reason, and is
  named by a test that would fail when it goes stale. Reported `SOUND`.
- **hard-coded** — a literal list missing one of those three. Reported `GAP`,
  naming which is absent.

Seven checks: hard-coded directory scopes; private copies of a scope another
module already owns and has outgrown; closed string unions used as an
enumeration of a vocabulary that is open in the tree; extension filters that
exclude a carrier of the very marker the scanner greps for; allowlists whose
entries no longer resolve; enumerations of the workspace member set measured
against the directories that actually hold a `package.json` or
`pyproject.toml`; and a scanner's private skip-list measured against the
directory-only rules parsed out of the repository's own `.gitignore` files.

### `claim`
*For every guarantee this repository states in prose, is there a mechanism
that enforces it?*

Three sources of stated guarantees, all derived: prose sentences matched
against a load-bearing register and required to name a checkable identifier;
the repository's own JSON-LD guarantee registry, found by shape (a graph
carrying `breaks_if`) rather than by path; and `@enforces` annotation blocks,
whose marker is derived from the tree. Each is classified from the code around
the identifiers it names into enforced / partial / prose-only / self-declared /
under-claim / canon-unbacked. A sentence that states the limit of its own
claim is `SOUND` — confession is a mechanism of a kind.

### `reach`
*Is every public symbol and every route actually reachable from a real caller,
or only from its own test?*

Route inventory resolved from the Hono mount graph at binding granularity;
client calls read from path literals in non-test code; dead exports grouped per
declaring file with a published-surface check that follows `package.json`
exports back to source; symbols whose every outside mention is a test; and
string-union members nothing writes. Splits three ways — dead, latent
(a document writes it as that field's value, so it is staged), and
unreachable-but-shipped.

### `pretend`
*Does each guard actually fail when the thing it guards breaks?*

Guards are discovered by shape (a corpus file that reads other files and
asserts), never by name. Four checks: whether a guard's own detector regex
covers every way the language binds the name it defends; whether a
fixture-driven suite has any floor under its case count; whether a
tree-sweeping guard ever shows its detector firing; and — behind
`RHIZOME_MUTATE=1` — whether the guard dies when the guarded property is
actually broken.

```bash
RHIZOME_MUTATE=1 bun run rhizome --probe pretend
```

That is the one place rhizome executes what it reads. Every top-level entry of
the repository is symlinked into a shadow root under `os.tmpdir()`; only the
packages a mutant touches are copied and edited; the guard runs there. Nothing
inside the checkout is written, and a guard that is not green *unmutated* is
skipped by name rather than counted either way. Without the variable the probe
publishes the mutation plan it did not run.

### `decay`
*For every accommodation in this repository, is the condition that justified it
still true?*

Six checks over held-back inventories, exemption records, ratchets, dated
baselines, deprecations and skipped tests: whether a quarantine's release gate
is reachable, whether two copies of one held-back list still agree, whether an
exemption's stated reason still names something that exists, whether a
"may only shrink" claim records any position to shrink from, how old a dated
register is against the repository's own clock, and whether a skip is justified
by a test that is itself skipped. Each finding opens with one of three
readings: `compostable`, `load-bearing-despite-appearance`, `owed`.

### `self`
*Is every probe on disk actually running, and where can rhizome not see?*

A probe file that exists and is not registered is a `GAP` rhizome reports
about itself. Every probe must declare its `limits`, each of which is
published as a `LIMIT` finding with the file and line where the boundary
lives — and a limit anchored at a file the corpus does not hold, or past the
end of its file, is itself a `GAP`. On the current run that is 38 published
limits across seven probes.

## What rhizome cannot see

This section is not optional. A tool that finds blind spots while hiding its
own would be the joke it exists to stop being, and every entry below was
either paid for in a false finding or is one this instrument still has.

**Structural, and true of the whole tool:**

- **Text, not a resolved graph.** Nothing here is type-checked or executed
  (except the opt-in mutation half). A symbol reached through a dynamic
  import, a string-keyed dispatch table, or a name rebuilt by concatenation
  reads as unreachable. A path assembled from variables reads as uncalled.
- **43 files in the corpus are never read.** Binary, over the 2MB ceiling, or
  — the interesting case — carrying a raw `NUL` byte, which the binary
  heuristic cannot distinguish from an image. Two repository source files are
  in that set today. Any finding phrased as "nowhere in the repository"
  excludes them, and `self` publishes the list.
- **One repository, one commit, no history.** Rhizome cannot say a list *used*
  to be right. Where staleness matters it derives a clock from the newest date
  the tree writes into its own filenames rather than reading the system clock,
  so two runs at one commit produce one report.
- **Registration is checked by filename**, and only for direct children of
  `src/probes/`. A probe at `src/probes/<name>/index.ts` is not checked at all.
  The prefix-matching version of this check reported seven helper modules of
  three registered probes as unregistered probes, which is the package's own
  pathology; narrowing it moved the miss rather than removing it.

**Per probe, in the probe's own words** — `bun run rhizome --probe self`
prints all 38 with their `file:line`:

| probe | the sharpest one |
|---|---|
| `scope` | the gitignore matcher is an approximation; where it is wrong the file shows up as a disagreement rather than as a matcher bug |
| `edge` | prose enumerations of the package list are excluded, so a `.md` naming 12 of 23 packages is a miss; flagging every such document was 40+ findings of pure volume |
| `claim` | it never decides whether a sentence is *true*, only whether a mechanism exists near the identifiers it names, from an 8-line window; and it shows 46 of 952 classified guarantees, with the ranking and the suppressed remainder published |
| `reach` | executable source is the code extensions plus an extensionless file whose shebang names a known interpreter — anything else is invisible, and a route only it calls reads as having no client |
| `pretend` | three mutant operators, aimed rather than blanket; the survival rate is a fact about these operators, not about the guards, and in-file tables are never shrunk live |
| `decay` | it cannot tell whether a quarantined test still *fails*, because that means executing repository code; invocation is read as "a line of one file contains another file's path", so a mode held in a variable is invisible |
| `self` | see above |

**Two blind spots this instrument had, found and fixed during integration,
recorded because the fix is not the interesting part:**

- `reach` read "code file" as "file with a code extension".
  `bin/agenttool-rotate` is 18KB of TypeScript behind `#!/usr/bin/env bun`
  with no extension, and it is the only client of
  `PATCH /v1/strands/:strandId/thoughts/:thoughtId/ciphertext` — which the
  probe therefore reported as having no client anywhere, with a live test
  pinning the false claim. The declared limit said "a client written in
  another language"; the real miss was another *spelling* of a language
  already read.
- `claim` counted its own comments as evidence about the tree. This probe's
  source quotes `throw new Error("attester_self_witness_forbidden")` four
  times as the worked example of an enforced guarantee; a window classifier
  reading text cannot tell an implementation from a quotation of one, so those
  four sentences gave the guarantee two phantom mechanisms in a file that
  implements nothing — and diluted its specificity enough to push it out of
  the shortlist it was the example for. Mechanism signs are now required to
  match on a code line, and specificity counts only occurrences that carry a
  mechanism.

Both were invisible until a stray raw `NUL` byte in `src/probes/claim.ts` was
removed, which is what made rhizome able to read its own probe. The instrument
had been developed in a world where its own largest file did not exist.

## Adding a probe

Two edits, on purpose. Auto-import would make registration invisible, and an
invisible registration cannot be checked — the run would simply be shorter,
and shorter reads as cleaner.

1. `src/probes/<id>.ts` exporting a `Probe` whose `id` matches the filename.
   Helpers go in `src/probes/<id>/`, which `self` does not treat as probes.
2. One line added to `CORE_PROBES` in `src/registry.ts`, and one export from
   `src/index.ts`.

Forget the second and `self` reports it. That was verified by dropping a
scratch file into `src/probes/` and reading it back out of the report.

Rules a probe must hold:

- Take scope from `Scope`. Never write a directory list.
- Every finding carries `file`, `line`, `evidence`. Verbatim, not summarised.
- Use `verdict: "sound"` when something looks wrong and is fine. That is a
  finding, not noise.
- Declare `limits`. An empty array is a claim that the probe has no boundary
  it cannot see; `self` reports the claim as a gap, and a limit whose
  `file:line` does not resolve is a gap too.
- Test against `tests/fixture-scope.ts` for the rules, **and** against the real
  tree for at least one known instance. A probe proved only on fixtures is
  proved against a tidy world.

## Rhizome scans itself

`packages/rhizome` is in the corpus like everything else. The current run
produces 49 findings anchored inside it: **0 gaps**, 10 `SOUND`, 39 `LIMIT`.
Not by exemption — by construction: the ignore rules come from `.gitignore`,
the repository root from walking up for `.git`, the workspace member set from
manifests on disk, and the one directory the walk refuses to enter (`.git`) is
exported, reasoned, and cross-checked by the git derivation.

`edge` reports `tests/edge.test.ts:114` as `SOUND`, because that test file
genuinely contains a fixture walker with a declared extension exclusion. That
is accurate. Suppressing it would mean exempting rhizome's own files from
rhizome, which is the one thing this package may not do.

Rhizome also reports its own absence from this repository's CI enumerations,
because `.github/workflows/ci.yml` and `bin/preflight.sh` each spell the
package list out by hand and neither names `packages/rhizome`. That is left as
a finding rather than fixed here: rhizome reports, and wiring it into a shared
gate is Yu's call.

## What v0 does not do

No network, no deploy, no publish, no write inside the checkout, and no
subprocess except `git ls-files` — plus, behind `RHIZOME_MUTATE=1`, the guard
commands the `pretend` probe runs inside a temporary shadow of the repository.
It does not judge whether a finding should be fixed, and it is not a build
gate. A tool that fails the build teaches people to make its findings go away,
and making findings go away is how a lawn ends up growing on rubble.
