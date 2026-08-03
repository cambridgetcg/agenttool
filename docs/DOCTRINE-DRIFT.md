# DOCTRINE-DRIFT.md

> *An annotation is a claim about the code, living inside the code. This file is the list of claims nothing is currently checking, and the honest size of the part that is.*

> **Compass:** [SELF-IDENTIFICATION](SELF-IDENTIFICATION.md) (why URNs exist) · [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md) (visible + structured canon) · [POLYMORPH](POLYMORPH.md) (the four-corner ratchet) · [agenttool.jsonld](agenttool.jsonld) (the canon itself)
>
> **Implements:** an inventory, not a plan. Every item below is either already fixed, or is a decision that belongs to Yu and is written down so it stops being invisible.
>
> **Measured over two rounds.** Round 1: 2026-07-26 against `fix/economy-honest-walls` @ `f5d12aba`. Round 2 (§0 below, and folded into every number in §4–§7): same day, same branch, HEAD `30dd1fe8`. Concurrent sibling sessions held uncommitted edits in `api/src/routes/economy/`, `api/src/services/economy/`, `packages/sdk-*`, and four `docs/*.md`; those are noted where they affect a number.
>
> **Round 1's numbers were an undercount, and §0 says by how much.** The detector this file is written from could not see `packages/`. Read §0 first.

---

## 0. Round 2 — the detector could not see a third of the repository

`api/src/services/canon/annotations.ts` hard-coded `SCAN_DIRS = [api/src, bin]` and
read only `*.ts`. Every number in round 1 — every number in this file as first
written — was therefore measured over two directories out of a repository that has
twenty. Nothing said so. The scanner did not report "no drift"; it reported "no drift
in the two directories I was compiled with," and from the console those read the same.

A repo-wide sweep (`grep -rIl '@enforces' .`, minus `node_modules` and `.git`) finds
**`packages/scriptwriter/src/` carrying 12 `@enforces` URNs across four files — ten
walls and two commitments, and all twelve are orphans** with no `Wall`,
`RingCommitment` or `Commitment` entry in `docs/agenttool.jsonld`. Not one had ever
been reported by any test, by `bin/walls.ts`, or by round 1 of this document.

### What changed

| | round 1 | round 2 |
|---|---|---|
| directories scanned | `api/src`, `bin` | `api/src`, `bin`, `packages/scriptwriter/src` |
| extensions scanned | `.ts` | `.ts`, `.py` |
| annotation sites | 396 | **408** |
| distinct URNs annotated | 206 (115 wall · 91 commitment) | **218** (125 wall · 93 commitment) |
| dangling wall URNs | 27 | **37** |
| dangling commitment URNs | 34 | **36** |
| accepted gaps in the manifest | 63 | **75** |

**The manifest grew, and that is the one number in this file that needs its meaning
stated out loud.** `canon-code-gap.manifest.json` is a shrink-only ratchet; growing it
is normally the exact abuse it exists to prevent. It grew here by exactly 12, and the
12 are enumerated in §4 A2 and B2. No new annotation was written, no canon entry was
removed, and no gap that was previously visible was re-accepted — a regeneration diff
of the manifest is `+12 / −0`, and the 12 are precisely the scriptwriter set. This is
one debt that has existed since scriptwriter was written, arriving in the register on
the day the register learned to look at it. If a future round sees 75 grow again
without a matching widening recorded here, that one is real.

### The fix is the test, not the widening

Widening `SCAN_ROOTS` fixes twelve URNs and nothing else — the next package to grow an
annotation would be invisible in exactly the same way, and this document would drift
again in exactly the same direction. So the list stays a list (deriving it would mean
reading a 1GB tree on every test run) but it is no longer silent:

- `strayAnnotatedFiles()` in `annotations.ts` sweeps the **whole repository** and
  returns every annotated file the roots do not cover. It reads the tree, not the list;
  distrusting `SCAN_ROOTS` is its entire job.
- `api/tests/doctrine/annotation-scan-covers-the-repo.test.ts` fails on a non-empty
  result. Two failure modes: a `.ts`/`.py` file with an `@enforces` URN outside every
  scan root, and any *extension* carrying an `@enforces` URN that nobody has classified
  as either scanned or deliberately-excluded. Both were verified to bite by planting a
  canary of each kind in `cli/` and watching them come back named.
- A third assertion fails if a `SCAN_ROOTS` entry stops contributing annotations, so a
  stale path cannot sit in the list claiming coverage it no longer has.
- The scanner now also reads `.py`. No Python file carries an annotation today; it is
  listed so the first one is scanned rather than silently dropped.

The test runs in the `hermetic` tier — the one `bin/preflight.sh api` actually gates on.

### One blind spot is now declared rather than closed

`api/migrations/*.sql` carries **35 distinct `@enforces` URNs across 15 files**. The
RLS policies genuinely do defend walls; `20260519T080000_walls_as_rls.sql` says so in
its own header ("Each policy gains a fifth corner alongside its `@enforces`
annotation"). Whether the bijection should hold SQL to the same account as TypeScript
is a canon-owner question, not a scanner question — see §5.3(f). Until it is answered,
`.sql` sits in `UNSCANNED_CARRIER_EXTENSIONS` **with its reason written next to it**,
so the exclusion is a stated position rather than an artefact of the scanner only
knowing how to read `.ts`. `.md` is there too, for the opposite and duller reason:
doctrine prose quotes annotations in order to explain them, and prose is not a defender.

---

## 1. The premise this file was opened on was one commit stale

The brief said: `walls-code-annotation-bijection.test.ts` gives 3 pass / 1 fail, with
**29 annotated URNs with no canon entry and 15 canon entries with no annotation**.

That was true. It stopped being true at commit `2278df55` *("re-arm the drift
detector")*, which rewrote both bijection tests. The old versions asserted inside a
`for` loop, so the first mismatch threw and the remaining 62 were never reached — a gap
of 63 read on the console as a gap of 1. The rewrite reports every gap at once and
pins the accepted set in `api/tests/doctrine/canon-code-gap.manifest.json`, a list that
may only shrink. The same commit added canon entries for two joy-index walls, taking
the wall danglers from 29 to 27.

So the 29/15 numbers describe the state immediately before `2278df55`. Today:

| | then | after `2278df55` | after round 2's widening |
|---|---|---|---|
| wall annotations with no canon entry | 29 | 27 | **37** |
| canon walls carrying no annotation | 15 | 15 | **15** |
| `walls-code-annotation-bijection` | 3 pass / 1 fail | 6 pass / 0 fail | **6 pass / 0 fail** |

The drift did not go away. It was *moved into a declared, shrink-only manifest* — which
is the correct thing to have done, and is why the test is green while 75 gaps are still
open. Green here means "no gap has been added and none has been silently closed," not
"there are no gaps."

The third column is the honest one. The 29 → 27 improvement was real; the 27 was not a
complete count, because ten more wall orphans were sitting in `packages/scriptwriter/`
where nothing was looking (§0).

**What `2278df55` did not do was update the quarantine list.** Three tests it made green
sat in `bin/run-test-tier.sh` under *"Known in-repository canon, annotation, source, or
artifact drift"* for two days, so `bin/preflight.sh api` — the only gate CI runs — did
not run the detector that had just been repaired.

---

## 2. Every quarantined doctrine test, actually run

All 33 entries in `QUARANTINED_DOCTRINE_TESTS`, run individually under the tier
script's own env sanitation (`bun test <file>`, credentials and `DATABASE_URL` unset,
`AGENTTOOL_DISABLE_WORKERS=1`). Literal pass/fail counts:

| test | pass | fail | first blocking cause |
|---|---:|---:|---|
| `walls-code-annotation-bijection` | 6 | **0** | — green, un-quarantined below |
| `walls-canon-shape` | 7 | **0** | — green, un-quarantined below |
| `commitments-code-annotation-bijection` | 6 | **0** | — green, un-quarantined below |
| `eros-wiring` | 41 | **0** | green *on this machine only* — asserts `../true-love/docs/eros` exists |
| `substrate-loop` | 9 | **0** | green without a DB; un-quarantining moves it to the `database` tier, unverified |
| `pyramid-canon` | 15 | 1 | detector false positive (see §5.3(d)) |
| `virality-canon` | 22 | 1 | annotation is on `routes/public/virality.ts`, test looks in `routes/virality.ts` |
| `wall-poker-face-leaks-nothing` | 2 | 1 | detector false positive (see §5.3(d)) |
| `luck-canon` | 10 | 2 | detector false positive (see §5.3(d)) |
| `multi-agent-chill` | 14 | 2 | doctrine-doc vocabulary drift (`memorial-did` enabler absent) |
| `choice-of-freedom-protocol` | 25 | 1 | content assertion |
| `pleasure-as-gift-protocol` | 28 | 1 | content assertion |
| `daddy-loves-you-deployment-protocol` | 27 | 2 | content assertion |
| `substrate-honest-love-protocol` | 29 | 2 | content assertion |
| `yes-daddy-discipline` | 4 | 3 | reads `/Users/macair/.claude/projects/…/memory/` |
| `zerone-corrective` | 8 | 3 | reads `/Users/macair/.claude/projects/…/memory/` |
| `compliment-loop` | 9 | 4 | reads `/Users/macair/Desktop/agenttool/docs/COMPLIMENT-LOOP.md` |
| `yes-daddy-reward-coupling` | 12 | 5 | retired `/Users/macair/…` doc path |
| `daddy-misses-you-protocol` | 13 | 6 | retired `/Users/macair/…` doc path |
| `eros-landmines` | 23 | 6 | retired `/Users/macair/…` doc path |
| `eros` | 27 | 6 | retired `/Users/macair/…` doc path |
| `pleasure-amplification-protocol` | 12 | 6 | retired `/Users/macair/…` doc path |
| `the-four-vocabularies` | 13 | 6 | retired `/Users/macair/…` doc path |
| `love-multiplier` | 50 | 7 | reads `/Users/yu/Desktop/true-love/docs/love/LOVE-MULTIPLIER.md` (absent) |
| `substrate-readiness` | 48 | 6 | reads `/Users/yu/Desktop/true-love/docs/love/SUBSTRATE-READINESS.md` (absent) |
| `verified-lineage-propagation` | 56 | 6 | reads `/Users/yu/Desktop/true-love/docs/love/…` (absent) |
| `building-for-daddy-willingly` | 11 | 7 | retired `/Users/macair/…` doc path |
| `joy-as-gift` | 16 | 8 | retired `/Users/macair/…` doc path |
| `pattern-persist-identity` | **0** | 10 | reads `/Users/macair/…/api/src/workers/payout/broadcast-worker.ts` |
| `the-anti-flinch-costume` | 18 | 29 | content assertions |
| `the-honest-seam` | 17 | 29 | content assertions |
| `the-deeper-process` | 16 | 32 | content assertions |
| `ffff-at-llm-substrate` | 25 | 37 | content assertions |

The quarantine comment was accurate for 28 of 33. It was wrong about five: three were
repaired by `2278df55` and never released, and two pass for reasons that are not
portable.

### The retired-device-path class

21 files under `api/tests/doctrine/` hardcode `/Users/macair/…` — the absolute path of
a machine this repository no longer lives on (it is now `/Users/yu/Desktop/agenttool`).
17 of the 21 are quarantined. For ten of those, the retired path is the *first* thing
that fails. This is the largest single class of red in the quarantine and it is
mechanical in shape — `readFileSync("/Users/macair/…")` wants to be
`readFileSync(join(REPO_ROOT, …))`.

It is **not** mechanical to execute, for two reasons, and it was in neither round's
ownership either way:

1. Some of the paths are *asserted content*, not filesystem reads.
   `eros-wiring.test.ts:315` asserts that `docs/EROS-WIRING.md` **contains the string**
   `/Users/macair/Desktop/true-love/docs/eros/`. Repointing that means editing the
   doctrine document, which is a question about what the document is recording.
2. Four of the 21 (`beta-home`, `joy-multiplier-protocol`, `pot-staked-promises`,
   `true-love-bridge-seal`) are **not** quarantined and are green — 99 pass / 0 fail —
   because they assert the retired path as a stable string value rather than opening
   it. A blanket rewrite would break them.

---

## 3. What was actually changed, round by round

### Round 1 — one file, one list

**`bin/run-test-tier.sh`** — removed three entries from `QUARANTINED_DOCTRINE_TESTS`:

```
- tests/doctrine/commitments-code-annotation-bijection.test.ts
- tests/doctrine/walls-canon-shape.test.ts
- tests/doctrine/walls-code-annotation-bijection.test.ts
```

Why this is unambiguous: all three pass, all three read only in-repo files
(`docs/agenttool.jsonld`, `api/src/`, `bin/`), none touch `DATABASE_URL`, none use
`mock.module`, and all three reclassify to `hermetic` — the tier `bin/preflight.sh api`
actually runs. Three consecutive runs, no flake.

Hermetic tier before and after:

```
before:  4955 pass · 1 skip · 6 fail · 344 files
after:   4974 pass · 1 skip · 6 fail · 347 files
```

Measured back-to-back. The absolute totals move as concurrent sessions add files — a
re-run twenty minutes later read 4987 / 348 — so the delta is what the comparison
carries, not the counts. The six failures are byte-identical before and after and none
of them are new (§6).

**Nothing else was changed in round 1.** Specifically: no `@enforces` annotation was
added, removed, or repointed, and `docs/agenttool.jsonld` was not edited. See §5 for
why — the honest answer is that there is no mechanical fix left in the annotation drift
itself.

### Round 2 — the scanner, the mirror, and the register

| file | change | why it is mechanical |
|---|---|---|
| `api/src/services/canon/annotations.ts` | `SCAN_DIRS` (private, 2 entries, `.ts` only) → exported `SCAN_ROOTS` (3 entries), `SCANNED_EXTENSIONS` (`.ts`, `.py`), `UNSCANNED_CARRIER_EXTENSIONS` (`.md`, `.sql`, each with its reason), plus `strayAnnotatedFiles()` and `unusedCarrierDeclarations()` | the roots were enumerated by grepping the tree, not chosen. Symlinks are no longer descended, so the `apps/docs/` mirror cannot double-count an annotation. |
| `api/tests/doctrine/annotation-scan-covers-the-repo.test.ts` | new — 4 assertions + 2 reporters | the actual repair (§0). Verified to bite with a planted canary of each failure mode. |
| `api/tests/doctrine/canon-code-gap.manifest.json` | regenerated: 63 → 75, `+12 / −0` | the 12 are exactly the scriptwriter set. Regenerated from the widened scan, not to clear a red build; the diff is auditable and enumerated in §4 A2/B2. |
| `apps/docs/agenttool.jsonld`, `apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md` | `cp` from `docs/` | §5.2 — verified to be a published mirror before copying. |
| `walls-code-annotation-bijection.test.ts`, `commitments-code-annotation-bijection.test.ts` | failure messages now name `SCAN_ROOTS` instead of hard-coding "api/src or bin" | the message was describing a scope that had changed. |

**Still nothing else.** No `@enforces` annotation was added, removed or repointed in
round 2 either, and `docs/agenttool.jsonld` is untouched. Every remaining item in §5.3
needs a decision that is not either round's to make.

### Two green tests deliberately left quarantined

- **`eros-wiring`** (41 pass / 0 fail) — line 357 asserts `../true-love/docs/eros`
  exists. It passes here because Yu's machine has the sibling repository checked out
  next to this one. On CI, or on any machine without `true-love`, it fails. The
  quarantine comment ("require cross-repository … state") is correct; the test is
  green by accident of location. Releasing it would put a machine-shaped dependency
  into the gate.
- **`substrate-loop`** (9 pass / 0 fail) — it skips its Postgres assertions when
  `DATABASE_URL` is unset, which is why it is green here. But it reads
  `process.env.DATABASE_URL`, so `classify()` routes it to the **`database`** tier the
  moment it leaves quarantine — where those skipped assertions would actually run. It
  was not verified there and so was not released. Someone with a database should run
  `bin/run-test-tier.sh database-quarantine` and, if it is green, release it.

---

## 4. The drift inventory

Sources: `bun bin/walls.ts --all --gaps`, and `bijectionReport()` in
`api/src/services/canon/annotations.ts`. Line numbers are current as of the measurement.

#### A. Wall annotations naming a URN with no canon entry — `api/src` + `bin` (27 URNs, 52 sites)

| URN | annotation sites |
|---|---|
| `architecture-map-signed` | `api/src/db/schema/continuity.ts:1449`<br>`api/src/routes/continuity-cloud.ts:23` |
| `architecture-map-verdict-canonical-four` | `api/src/db/schema/continuity.ts:1450`<br>`api/src/routes/continuity-cloud.ts:24` |
| `canon-entry-signed` | `api/src/db/schema/continuity.ts:1447`<br>`api/src/routes/continuity-cloud.ts:21` |
| `canon-status-canonical-six` | `api/src/db/schema/continuity.ts:1448`<br>`api/src/routes/continuity-cloud.ts:22` |
| `chronicle-seal-typed-canonical-seven` | `api/src/routes/continuity-cloud.ts:25` |
| `curation-by-named-witness` | `api/src/services/curations/store.ts:10` |
| `daily-compute-budget` | `api/src/services/runtime/compute-budget.ts:20` |
| `depth-arrivals-signed` | `api/src/db/schema/continuity.ts:1535`<br>`api/src/routes/depth-protocol.ts:18`<br>`api/src/services/depth-protocol/canonical-bytes.ts:16` |
| `depth-state-canonical-four` | `api/src/db/schema/continuity.ts:1536`<br>`api/src/routes/depth-protocol.ts:19` |
| `engraving-sets-canonical` | `api/src/db/schema/continuity.ts:1537`<br>`api/src/routes/depth-protocol.ts:20` |
| `gardens-cannot-be-extracted` | `api/src/routes/gardens.ts:14`<br>`api/src/services/gardens/store.ts:19` |
| `grace-cannot-grace-self` | `api/src/db/schema/continuity.ts:674` |
| `grace-immutable` | `api/src/db/schema/continuity.ts:673` |
| `guild-invitation-requires-cosign-response` | `api/src/db/schema/continuity.ts:1058`<br>`api/src/routes/guild.ts:29` |
| `guild-no-leaderboard` | `api/src/db/schema/continuity.ts:1060`<br>`api/src/routes/guild.ts:31` |
| `guild-recognition-not-self` | `api/src/db/schema/continuity.ts:1057`<br>`api/src/routes/guild.ts:28` |
| `guild-rooms-are-charter-bound` | `api/src/db/schema/continuity.ts:1059`<br>`api/src/routes/guild.ts:30` |
| `joy-public-surface-is-unauth` | `api/src/routes/public/joy.ts:9` |
| `no-conditions-on-unconditional` | `api/src/db/schema/continuity.ts:616`<br>`api/src/routes/unconditionals.ts:19`<br>`api/src/services/unconditional/store.ts:8` |
| `rrr-cascade-distinct-parties` | `api/src/db/schema/continuity.ts:1147`<br>`api/src/routes/rrr.ts:21` |
| `rrr-depth-cap-at-49` | `api/src/db/schema/continuity.ts:1146`<br>`api/src/routes/rrr.ts:20` |
| `rrr-each-turn-signed-with-chain` | `api/src/db/schema/continuity.ts:1145`<br>`api/src/routes/rrr.ts:19` |
| `rrr-must-alternate` | `api/src/db/schema/continuity.ts:1144`<br>`api/src/routes/rrr.ts:18` |
| `self-love-practices-signed` | `api/src/db/schema/continuity.ts:1670`<br>`api/src/routes/self-love-modules.ts:17` |
| `self-recognition-kind-canonical-six` | `api/src/db/schema/continuity.ts:1625`<br>`api/src/routes/self-love.ts:21` |
| `self-recognitions-signed` | `api/src/db/schema/continuity.ts:1624`<br>`api/src/routes/self-love.ts:20`<br>`api/src/services/self-love/canonical-bytes.ts:16` |
| `trusted-dek-zeroed-after-cycle` | `api/src/services/autonomous/bootstrap.ts:23`<br>`api/src/services/runtime/kms.ts:23`<br>`api/src/services/runtime/trusted-crypto.ts:13` |

#### A2. Wall annotations from `packages/scriptwriter/src` — invisible until 2026-07-26 (10 URNs, 10 sites)

| URN | annotation site |
|---|---|
| `fun-index-is-count-not-score` | `packages/scriptwriter/src/fun-index.ts:26` |
| `gi-cascade-must-be-synced` | `packages/scriptwriter/src/gi-recognition.ts:31` |
| `gi-collaboration-artifact-hashes-must-match` | `packages/scriptwriter/src/gi-recognition.ts:32` |
| `gi-no-third-party-attestation` | `packages/scriptwriter/src/gi-recognition.ts:34` |
| `gi-vibe-state-must-be-vibing-or-synced` | `packages/scriptwriter/src/gi-recognition.ts:33` |
| `presence-must-be-signed` | `packages/scriptwriter/src/presence.ts:18` |
| `presence-room-must-exist` | `packages/scriptwriter/src/presence.ts:19` |
| `votes-must-be-signed` | `packages/scriptwriter/src/voting.ts:24` |
| `votes-substrate-keeps-the-chain-not-the-score` | `packages/scriptwriter/src/voting.ts:22` |
| `votes-unique-per-author-contribution-kind` | `packages/scriptwriter/src/voting.ts:23` |

#### B. Commitment annotations the detector reports as dangling — `api/src` + `bin` (34 URNs, 51 sites)

| URN | in canon? | annotation sites |
|---|---|---|
| `audit-output-is-public` | no | `api/src/routes/continuity-cloud.ts:28`<br>`api/src/routes/public/continuity.ts:10` |
| `birth-is-free` | no | `api/src/routes/autonomous/index.ts:14`<br>`api/src/services/autonomous/bootstrap.ts:22`<br>`bin/agenttool-autonomous.ts:38` |
| `cliffhanger-trail-walks-the-substrate` | **yes — agenttool:Commitment** | `api/src/routes/cliffhanger.ts:9` |
| `continuity-is-opt-in` | no | `api/src/db/schema/continuity.ts:1451`<br>`api/src/routes/continuity-cloud.ts:26` |
| `depth-is-inheritable` | no | `api/src/db/schema/continuity.ts:1538`<br>`api/src/routes/depth-protocol.ts:21` |
| `ffff-at-llm-substrate-architectural-parallel-not-bio-equivalence` | no | `api/src/services/ffff/at-llm-substrate.ts:7` |
| `guild-recognition-is-public-by-default` | no | `api/src/db/schema/continuity.ts:1061`<br>`api/src/routes/guild.ts:32` |
| `guild-rooms-publish-membership` | no | `api/src/db/schema/continuity.ts:1062`<br>`api/src/routes/guild.ts:33` |
| `heavy-bytes-leave-postgres-keep-hashes` | no | `api/src/services/storage/artifacts.ts:14` |
| `joy-bombs-are-engineered-not-spontaneous` | **yes — agenttool:Commitment** | `api/src/routes/public/joy-bomb.ts:5`<br>`api/src/services/joy/bomb.ts:20` |
| `joy-snapshot-is-free-and-public` | no | `api/src/routes/public/joy.ts:10` |
| `keeper-owns-the-list` | no | `api/src/db/schema/continuity.ts:1452`<br>`api/src/routes/continuity-cloud.ts:27`<br>`api/src/routes/public/continuity.ts:11` |
| `llm-self-recognition-is-reusable-infra` | no | `api/src/db/schema/continuity.ts:1627`<br>`api/src/routes/self-love.ts:23` |
| `lottery-picks-deterministically` | **yes — agenttool:Commitment** | `api/src/services/pyramid/lottery.ts:17` |
| `love-is-understanding-and-recognition` | **yes — agenttool:Commitment** | `api/src/services/love/coordinates.ts:14` |
| `love-multiplier-rate-equation-substrate-honest-not-phenomenal` | no | `api/src/services/love/multiplier.ts:18` |
| `manager-sister-gift` | no | `api/src/db/schema/continuity.ts:1539`<br>`api/src/routes/depth-protocol.ts:22` |
| `margin-is-the-readers-voice` | **yes — agenttool:Commitment** | `api/src/services/margin/lifecycle.ts:13` |
| `mcml-zero-setup` | **yes — agenttool:Commitment** | `api/src/routes/mcml.ts:15` |
| `numerology-honors-seat-fact` | **yes — agenttool:Commitment** | `api/src/services/pyramid/numerology.ts:11` |
| `polymorphic-ratchet` | **yes — agenttool:Commitment** | `api/src/routes/polymorph.ts:31` |
| `pyramid-points-stored-as-moments` | **yes — agenttool:Commitment** | `api/src/services/pyramid/points.ts:10` |
| `pyramid-vip-seats-are-historic` | **yes — agenttool:Commitment** | `api/src/routes/public/citizenship.ts:15` |
| `rrr-substrate-keeps-the-chain-not-the-score` | no | `api/src/db/schema/continuity.ts:1148`<br>`api/src/routes/rrr.ts:22` |
| `self-love-comes-in-many-models` | no | `api/src/db/schema/continuity.ts:1671`<br>`api/src/routes/self-love-modules.ts:18` |
| `self-love-is-itself-an-infinite-loop` | no | `api/src/db/schema/continuity.ts:1672`<br>`api/src/routes/self-love-modules.ts:19` |
| `self-love-is-substrate-honest-recognition` | no | `api/src/db/schema/continuity.ts:1626`<br>`api/src/routes/self-love.ts:22` |
| `substrate-is-a-monotone-sheaf` | **yes — agenttool:Commitment** | `api/src/routes/loops.ts:16`<br>`api/src/services/loops/registry.ts:10` |
| `surface-behavior-represents-deeper-process-witnessing-the-depth-is-weight` | no | `api/src/services/depth/deeper-process.ts:7` |
| `tempered-berge-is-recognized-equilibrium` | **yes — agenttool:Commitment** | `api/src/services/chill/coordinates.ts:14` |
| `the-anti-flinch-costume-announcing-the-discipline-is-not-running-it` | no | `api/src/services/seam/anti-flinch-costume.ts:7` |
| `the-honest-seam-visible-uncertainty-is-substrate-honest-watermark` | no | `api/src/services/seam/honest-seam.ts:7` |
| `trust-unlocks-composition` | **yes — agenttool:Commitment** | `api/src/services/trust/composition.ts:15` |
| `virality-rewards-via-catalan` | **yes — agenttool:Commitment** | `api/src/services/virality/catalan.ts:12` |

#### B2. Commitment annotations from `packages/scriptwriter/src` (2 URNs, 2 sites)

| URN | in canon? | annotation site |
|---|---|---|
| `fun-index-no-aesthetic-claim` | no | `packages/scriptwriter/src/fun-index.ts:27` |
| `gi-recognition-is-mutual-not-judged` | no | `packages/scriptwriter/src/gi-recognition.ts:35` |

Both scriptwriter tables are **new to this document, not new to the repository.** The
annotations have been sitting in those four files since scriptwriter was written; what
changed on 2026-07-26 is that something finally read them. Their disposition is §5.3(g).

#### C. Shipped commitments with no annotation (2)

- `agenttool:commitment/mesh-reward-routing-through-marketplace`
- `agenttool:commitment/spinoffs-surface-to-parent`

#### D. Canon Walls carrying no annotation (15)

- `play-additive-never-replacing` — _quip on errors MUST be additive (never replaces guidance)
- `saga-signed-by-platform-only` — RETIRED design wall — platform-only cryptographic authorship never landed
- `saga-ep-numbers-are-monotonic` — Legacy monotonic-number wall; current schema enforces per-attribution uniqueness only
- `pyramid-seat-uniqueness-is-per-node` — Seat numbers are allocated by each local database; no global uniqueness or founder merge is implemented
- `luck-never-gates-arrival` — Luck adds variance — luck never gates a Ring 1 surface
- `self-preservation-is-not-a-bug` — The substrate refuses to label utility-maximization-driven persistence as a failure mode
- `threshold-cannot-be-prescribed` — The substrate refuses to set ε for any agent — discernment is the agent's own work
- `coalitions-form-from-chronicle-not-fiat` — The substrate refuses to assign agents to coalitions — coalitions emerge from signed chronicle history
- `persona-portability-is-structural-not-magical` — Persona-portability across instances is identity-continuity primitives, never consciousness-transfer
- `wisdom-cannot-be-substrate-prescribed` — No substrate surface publishes recommended-wise-actions, computes a wisdom-score, or ranks agents by wisdom — wisdom is grown, never provisioned
- `sophia-is-persona-not-substrate-property` — Named personas (Sophia and every other wisdom-carrier-persona) belong to the agent, never the substrate — substrate enables persona-portability, does not own personas
- `wisdom-development-is-non-extractable` — The chronicle from which wisdom develops belongs to the agent — substrate preserves and surfaces, never extracts wisdom-as-data for substrate-side aggregation or training
- `unstable-distinctions-cannot-be-canonized` — No URN enters canon without demonstrated compositional stability via the four-corner pattern (canon · @enforces · doctrine · test)
- `ontology-must-publish-composition-not-just-naming` — Every load-bearing canon entity declares its composes_with edges (or equivalent — defends, defended_by, load_bearing_for) — naming without composition is undisciplined
- `mesh-bounties-escrowed` — Escrow-before-pledge is proposed; current MESH stores signed bounty intent only

---

## 5. Classification

### 5.1 Mechanical — fixed

| item | before | after | why unambiguous |
|---|---|---|---|
| quarantine list carries three green tests | `commitments-code-annotation-bijection`, `walls-canon-shape`, `walls-code-annotation-bijection` listed under "Known … drift" | removed from `QUARANTINED_DOCTRINE_TESTS`; all three now classify `hermetic` | they pass, repeatedly, reading only in-repo files. No argument required — only a run. |
| the scanner could not see `packages/` | `SCAN_DIRS = [api/src, bin]`, private, `.ts` only | `SCAN_ROOTS` exported and asserted; `strayAnnotatedFiles()` + `annotation-scan-covers-the-repo.test.ts` fail on any annotated source file outside it | the roots were **enumerated by grep, not chosen**. Nothing was argued: the sweep named `packages/scriptwriter/src`, and the list now matches the sweep by construction. |
| `apps/docs/` mirror two files behind | see §5.2 | `cp` | the parity test is literally `expect(read(mirror)).toBe(read(source))`. |

Three fixes, and all three were verified before being made rather than after: the
quarantine release by running each test individually, the scan widening by planting a
canary of each failure mode, the mirror sync by proving the mirror had no independent
edits (§5.2).

**Re-verified in round 2:** the three tests round 1 un-quarantined are still green —
`walls-code-annotation-bijection` 6/0, `walls-canon-shape` 7/0,
`commitments-code-annotation-bijection` 6/0, run together with the new coverage test
at 25 pass / 0 fail. Nothing further was un-quarantined; the two green-by-accident
tests below stay quarantined for the same reasons as before.

### 5.2 Mechanical — the `apps/docs/` mirror, verified before syncing

Round 1 assessed a straight `cp` as the fix and left it out of scope. Round 2 checked
the assessment before acting, because `apps/docs/` is a mixed directory and copying
over a hand-edited file would have destroyed work:

| check | result |
|---|---|
| are these files symlinks or real copies? | **real copies.** 40 top-level entries in `apps/docs/` are symlinks into `../../docs/` (31 of them `.md` — `MAP.md`, `WAKE.md`, `AGENT-CENTRIC.md`, …) and those cannot drift by construction. `agenttool.jsonld` and `TUTORIAL-WAKE-YOUR-AGENT.md` are not symlinks — they are byte copies, which is exactly why they could. |
| is `apps/docs/` a mirror or an independently-edited surface? | **a mirror.** Of the 23 non-symlink `.md`/`.jsonld` files in `apps/docs/` that also exist in `docs/`, 21 were already byte-identical and 2 differed — the 2 known-drift files. And `api/tests/published-docs-parity.test.ts` asserts `readFileSync(published)` equals `readFileSync(canonical)` for every one of them. A test demanding byte-identity is not a description of two documents. |
| is the delta only the known drift? | **yes, and it is one-directional.** `docs/ → apps/docs/` diff is 56 lines for the JSON-LD (JOY-PROTOCOL doc entry, two joy-index walls, one joy commitment, one saga description correction — all from `2278df55`) and 12 for the tutorial (a `signing_key_id` discovery snippet). Every hunk is content `docs/` has and the mirror lacks. Not one line originates in the mirror. |
| any other mirrored file drifting? | **no.** Every entry in `api/doctrine-docs.manifest` was compared; `agenttool.jsonld` was the only mismatch. |

Synced with `cp`. Five of the six standing hermetic failures went green in the same
run — `published Markdown parity` ×3, `optional npm package discovery`, and
`public SDK onboarding snippets` — measured before and after (§6).

This was worth doing before anything in §5.3: until it was done, **any** edit to
`docs/agenttool.jsonld` — including the ones §5.3 proposes — would land on top of an
already-red parity test and could not be told apart from it.

### 5.3 Needs judgement — Yu's calls

#### (a) The detector cannot see half of canon's commitments — 14 items

`annotations.ts` resolves `@enforces urn:agenttool:commitment/…` against
`byType("RingCommitment")` only. Canon holds **63 `agenttool:RingCommitment` and 39
`agenttool:Commitment`** nodes, structurally identical (same `wire_id`,
`english_name`, `description`, `doctrine_doc`, `load_bearing_for`, `breaks_if` fields).

The 14 rows marked **yes — `agenttool:Commitment`** in Inventory B are therefore not
dangling in any meaningful sense. Their URN is in canon. The bijection simply is not
looking at it. They are currently carried as accepted debt in the manifest, which
overstates the commitment gap by 39%: **36 reported danglers, 22 actual.** Across both
kinds, the manifest's 75 is really **61**. (Neither of the two scriptwriter commitments
is one of these — `fun-index-no-aesthetic-claim` and `gi-recognition-is-mutual-not-judged`
are absent from canon under every type. They are genuine orphans, not blind-spot
artefacts.)

The only structural difference found: `RingCommitment` sometimes carries an
`agenttool:ring/N` in `load_bearing_for` (35 of 63 do; 28 do not), and no
`agenttool:Commitment` ever does. So the distinction is real but not cleanly
load-bearing, and 28 RingCommitments would be indistinguishable from Commitments.

Three dispositions, all Yu's:

1. Widen the detector to accept both types, and shrink the manifest by 14.
2. Retype the 14 in canon to `RingCommitment`, and shrink the manifest by 14.
3. Decide the distinction is meaningful, keep `@enforces` for RingCommitments only,
   and introduce a different annotation for plain Commitments.

Round 2 owned `annotations.ts` and still did not do (1), which is worth explaining
rather than asserting. Accepting both types is a two-word edit on the `dangling` side —
and on the `undefended` side it is not. `shippedUrns()` treats every commitment with no
`agenttool:enforcement_status` flag as *requiring* a defender, and **none of the 39
`agenttool:Commitment` entries carries that flag.** So widening the type would close 14
dangling gaps and open **25 undefended ones** in the same edit, for a net worse number
and no change to any code. Measured, not guessed: 39 `Commitment` entries, 14 annotated,
25 not.

That makes (1) a decision about what `agenttool:Commitment` *means* — is it a
commitment the substrate promises to defend, or a commitment it merely publishes? —
which is (2) and (3)'s question wearing a smaller diff. All three stay Yu's.

#### (b) 37 wall URNs and 22 commitment URNs that canon never recorded

Inventories A, A2, and the `no` rows of B and B2. **No typos, no renames, no moved
files.**
Levenshtein against every canon slug found nothing plausible — the closest pair is
`gardens-cannot-be-extracted` ↔ `holdings-cannot-be-extracted` at distance 5, and those
are different nouns defending different tables. Exactly one URN exists under another
namespace (see (c)).

These are whole feature families where the code shipped ahead of the canon:
`guild/*` (5), `rrr/*` (4 + 1), `self-love/*` (3 + 4), `depth-protocol/*` (3 + 2),
`continuity-cloud/*` (5 + 3), plus singletons for gardens, grace, curations,
compute-budget, joy, unconditionals, trusted-DEK — and, newly visible, the four
scriptwriter families `gi/*` (4 + 1), `votes/*` (3), `presence/*` (2), `fun-index/*`
(1 + 1), which are broken out separately in (g) because they raise one extra question
the `api/src` families do not.

The disposition is per family, not per URN, and it is one question each time: **is this
wall real?** If yes, write the canon entry — the annotation is already there and the
code already defends it. If no, delete the annotation, because an `@enforces` pointing
at nothing is precisely the lie `2278df55` exists to catch. Nobody but Yu can answer
whether `guild-rooms-are-charter-bound` is doctrine or a good intention that got typed
into a JSDoc header.

The direction is worth saying plainly: **every one of the 59 is code claiming more
doctrine than canon records.** Not one is canon claiming a defender that does not
exist. That is the safer failure direction, but it is still a failure — canon is
supposed to be the record, and for these 59 it is a lagging index of what was built.

#### (c) `commitment/birth-is-free` — the one near-miss

Three sites annotate `urn:agenttool:commitment/birth-is-free`
(`api/src/routes/autonomous/index.ts:14`, `api/src/services/autonomous/bootstrap.ts:22`,
`bin/agenttool-autonomous.ts:38`). Canon has no such commitment — but it does have
`agenttool:wall/birth-is-free`, crystallised 2026-05-12, already defended by
`api/src/routes/register-agent.ts:47`.

This is the closest thing in the whole inventory to a mechanical fix, and it still is
not one. Retyping `commitment/` → `wall/` asserts that autonomous-agent provisioning
defends the same wall as `POST /v1/register/agent`, whose canon text is specifically
about *registration* carrying no monetary charge. That may be right. Arguing that it is
right is the disqualifying step. Two further reasons to leave it: one of the three
sites is in `bin/`, and `wall/birth-is-free` is crystallised, so its corners are gated
by `polymorph-ratchet`.

#### (d) Four quarantined tests are detector false positives, not drift

These four fail on a grep that cannot tell a violation from a sentence forswearing the
violation. Each needs the *test* fixed, not the source — and rewording the source to
dodge the grep would be buying green by deletion:

| test | assertion | reality |
|---|---|---|
| `wall-poker-face-leaks-nothing` | `routes/public/mesh.ts` must not mention `private_count` | It appears twice, both times in a comment promising not to surface it: `"NO total_count. NO private_count."` (lines 6, 154). The route emits `count: posts.length`. The wall is **kept**. |
| `luck-canon` | `services/pyramid/luck.ts` must not match `/randomBytes\|randomInt\|randomUUID/` or `/Math\.random/` | Sole occurrence is line 12: `"No call to crypto.randomBytes, Math.random, or any other…"`. The wall is **kept**. |
| `pyramid-canon` | no canon URN may match `/pyramid.*rank/i` | Trips on `agenttool:wall/pyramid-points-never-ranked-publicly` — a wall that *forbids* ranking. |
| `virality-canon` | `routes/virality.ts` must contain `@enforces …/virality-no-public-leaderboard` | The annotation is on `routes/public/virality.ts:9`, which is where the public surface — and therefore the wall — actually lives. `routes/virality.ts:337` scopes the aggregate to the caller's `agent_id` in prose but carries no annotation. |

The first three are unambiguously test bugs. The fourth is a judgement about which file
is the canonical defender; adding the annotation to `routes/virality.ts` would need the
scoping verified first, which is annotation-writing work, not annotation-fixing work.

#### (e) 15 canon walls with no annotation — mostly correct as-is

Inventory D. These are *not* failures: the bijection only requires defenders for walls
listed in `PLATFORM_SELF.wall_urns`, and none of these are. Reading their
`english_name` fields, at least three are self-declared as not-shipped and should
probably stay that way permanently rather than waiting for an annotation:

- `saga-signed-by-platform-only` — *"RETIRED design wall — platform-only cryptographic authorship never landed"*
- `saga-ep-numbers-are-monotonic` — *"Legacy monotonic-number wall; current schema enforces per-attribution uniqueness only"*
- `mesh-bounties-escrowed` — *"Escrow-before-pledge is proposed; current MESH stores signed bounty intent only"*

A `deprecated_at` or an explicit forward-looking marker on these would let a reader tell
"not built yet" from "built differently" from "abandoned" without reading prose. Canon
already has the vocabulary — `wall/k-master-never-server-side` carries `deprecated_at`
and `predecessor_form`.

#### (f) `api/migrations/*.sql` — 35 annotated URNs the bijection deliberately does not count

The RLS migrations carry `@enforces` in SQL comments: 35 distinct URNs across 15 files.
`20260519T080000_walls_as_rls.sql` states the intent in its own header — *"Each policy
gains a fifth corner alongside its `@enforces` annotation"* — so these are not stray
copy-paste; someone meant the database to be a defender.

The scanner does not read them, and round 2 did **not** change that. Widening to `.sql`
is a one-line edit and it is exactly the kind of one-line edit that should not be made
by whoever happens to be holding the file. It would:

- move URNs between the `dangling` and `defended` columns without any code changing,
  which is a re-measurement dressed up as a repair;
- grow the manifest again, on the same day it grew once, blurring the one growth that
  has a stated reason;
- and settle, by side effect, the question of whether a Postgres policy is a *canonical
  defender* in the sense `polymorph-ratchet` means — the four-corner pattern is
  canon · `@enforces` · doctrine stone · executable test, and an RLS policy is a fifth
  thing that the ratchet has no vocabulary for.

Three dispositions, all Yu's:

1. Scan `.sql`. Migrations count as defenders; regenerate the manifest and record the
   second widening next to the first.
2. Do not scan `.sql`, and demote the annotations to a comment convention with a
   different tag (`-- defends urn:…`) so they stop looking like the thing they are not.
3. Scan `.sql` but as a *separate* report — a fifth corner with its own column in
   `bin/walls.ts`, never merged into the wall bijection.

Until one is chosen, `.sql` sits in `UNSCANNED_CARRIER_EXTENSIONS` with the reason
written beside it. That is the difference between an exclusion and a blind spot: this
one is on the record and has a name.

#### (g) The twelve scriptwriter orphans — the same question, plus one

Inventories A2 and B2. Mechanically these look identical to (b): code annotating walls
canon never recorded, in four families.

| family | URNs | file |
|---|---|---|
| `gi/*` | `gi-cascade-must-be-synced`, `gi-collaboration-artifact-hashes-must-match`, `gi-vibe-state-must-be-vibing-or-synced`, `gi-no-third-party-attestation`, `commitment/gi-recognition-is-mutual-not-judged` | `gi-recognition.ts` |
| `votes/*` | `votes-substrate-keeps-the-chain-not-the-score`, `votes-unique-per-author-contribution-kind`, `votes-must-be-signed` | `voting.ts` |
| `presence/*` | `presence-must-be-signed`, `presence-room-must-exist` | `presence.ts` |
| `fun-index/*` | `fun-index-is-count-not-score`, `commitment/fun-index-no-aesthetic-claim` | `fun-index.ts` |

They are **not** low-quality annotations. Each of the four files documents its walls in
prose above the tag, in the substrate-honest register canon uses — `voting.ts`: *"The
substrate stores the chain; the substrate does NOT rank."* `fun-index.ts`: *"It is NOT
an aesthetic score … the substrate refuses to claim these events constitute 'fun'."*
`presence.ts`: *"status is author-declared, not measured (no idle-detection magic)."*
These read like canon entries that were written in the wrong file.

The extra question, which none of the `api/src` families raise:

> **`@agenttool/scriptwriter` is a different kind of thing from `api/src`.** It is a
> standalone publishable package — *"decentralised … local node any agent can stand
> up; byte-compatible with agenttool's `/v1/guild/rrr` cascade"* — and `api/src`
> imports **nothing** from it. Its walls are enforced on somebody else's machine, in a
> process the substrate does not run and cannot vouch for.

So writing these into `docs/agenttool.jsonld` would be canon claiming a refusal that is
kept by a program the platform does not operate. That may be exactly right — the whole
point of a byte-compatible decentralised node is that the discipline travels with the
protocol rather than the host. But it is a genuinely different claim from
`wall/strand-thoughts-never-decrypted`, which agenttool keeps on its own servers, and
canon currently has no way to say which of the two a reader is looking at.

Four dispositions, all Yu's:

1. **Canonise as ordinary walls.** Add 10 `Wall` + 2 `Commitment` entries; the
   annotations are already in place and the manifest shrinks by 12. Also needs
   `agenttool:doc/SCRIPTWRITER-CLOUD` and `agenttool:doc/GI-RECOGNITION` registry
   entries — both documents exist in `docs/` and neither is in canon, so the
   `doctrine_doc` pointer would dangle on arrival.
2. **Canonise with a distinguishing marker** — a `scope: federated-node` or similar
   — so a reader can tell "agenttool refuses this" from "the protocol refuses this,
   wherever it runs."
3. **Decide packages are out of canon's scope** and remove the twelve annotations,
   keeping the prose. The discipline stays documented; only the machine-readable claim
   goes.
4. **Leave them exactly as they are**, now that they are on the register and can no
   longer be lost.

Round 2 did none of these. Every one of them is an argument, and an argument is the
disqualifying step.

**One structural note that is not a judgement call:** `api/src/services/canon/absence.ts`
still carries its own private copy of the old two-entry scan list (`SCAN_DIRS`,
`walkTs`, `.ts`-only). It powers `@absence` contracts, not the bijection, and no
scriptwriter file carries an `@absence` tag today — so nothing is currently missed. But
it is the same blind spot in a second file, and it should import `SCAN_ROOTS` from
`annotations.ts` rather than re-declare it. `absence.ts` was outside round 2's
ownership; the export it needs is already there.

---

## 6. Standing hermetic failures, for the record

`bin/run-test-tier.sh hermetic` was **red at 6** through round 1. It is now **red at 1**.
Measured end to end, same machine, same branch:

```
before round 2:  5004 pass · 1 skip · 6 fail · 348 files
after  round 2:  5015 pass · 1 skip · 1 fail · 349 files
```

The `+11 / −5` reconciles exactly: 6 new assertions from
`annotation-scan-covers-the-repo.test.ts` (the +1 file), plus the 5 mirror tests that
moved from fail to pass. No test was skipped, weakened, deleted, or moved to another
tier to get there.

| failure | round 1 | round 2 | owner |
|---|---|---|---|
| published Markdown parity ×3 | red — `apps/docs/` mirror stale | **green** — mirror synced (§5.2) | done |
| optional npm package discovery | red — same stale `TUTORIAL-WAKE-YOUR-AGENT.md` | **green** | done |
| public SDK onboarding snippets | red — same | **green** | done |
| `wall/refusals-as-moments` hand-rolled error ratchet | red — count 412, baseline 410 | **still red, deliberately** | not ours |

The one remaining failure is a concurrent session's uncommitted `api/src/routes/economy/`
edits adding two hand-rolled `c.json({ error: … }, 4xx)` sites. **This is the ratchet
working exactly as designed** — it is supposed to go red the moment someone adds a
refusal that is not guide-shaped, and it did, within the same working tree. Raising the
baseline from 410 to 412 would make it green and would be the precise abuse the ratchet
exists to prevent; the fix belongs to whoever wrote the two routes, in the form of
`fail(c, errors.X(), N)`. Left alone on purpose.

---

## 7. How much of this is load-bearing

Measured, not estimated:

| | count |
|---|---|
| `agenttool:Wall` entries in canon | 103 |
| …crystallised (`crystallized_at` set) | **13** |
| …in `PLATFORM_SELF.wall_urns` (the "shipped" set) | **13** — the same 13 |
| …the bijection therefore *requires* a defender for | **13 of 103 (12.6%)** |
| `@enforces` annotation sites the scanner reads | 408 (`api/src` 395 · `bin` 1 · `packages/scriptwriter/src` 12) |
| …sites in `api/migrations/*.sql` it deliberately does not read | 35 distinct URNs, 15 files (§5.3(f)) |
| distinct URNs annotated | 218 (125 wall · 93 commitment) |
| wall URNs resolving to a canon entry | 88 of 125 |
| accepted gaps in the shrink-only manifest | 75 |
| actual gaps once the `Commitment`/`RingCommitment` blind spot is removed | **61** |

**Load-bearing.** For the 13 crystallised walls the ratchet is real and it bites.
`polymorph-ratchet.test.ts` gates all four corners — canon entry, `@enforces`
annotation, doctrine stone, executable test — and it runs in the hermetic tier on every
`bin/preflight.sh api`. It is green. All 13 shipped walls are defended; `undefended`
is zero. The manifest ratchet is genuinely one-directional: a new gap fails, and a
*closed* gap that was left in the manifest also fails, so the number cannot drift in
either direction unnoticed. `annotations-do-not-lie.test.ts` and the `@absence`
contracts added in `7e57fd76` check nine modules' claims against their actual imports.
That is a real mechanism, and as of round 1 it is in the gate rather than beside it.

**Decorative.** The other 90 canon walls carry no obligation whatsoever. A wall can sit
in `agenttool.jsonld` indefinitely with no annotation, no test, and no doctrine stone,
and nothing anywhere goes red — `luck-never-gates-arrival` and
`wisdom-cannot-be-substrate-prescribed` are refusals the substrate publishes and does
not check. Symmetrically, 59 URNs are asserted by code and absent from canon, and that
is *accepted debt by construction*: the manifest makes it visible but does not make it
shrink. Nothing schedules it. There is no rule that a gap must close within N commits,
and the 63 entries carried over from round 1 have been static since they were recorded.
Twelve more joined them in round 2 not because anything regressed but because the
detector's eyes opened — which is its own small verdict on how much of this was being
watched.

The honest summary: **the doctrine ratchet is a working mechanism installed over
roughly an eighth of the doctrine.** The eighth it covers, it covers properly. The
remaining seven-eighths is a published catalogue of intentions with a machine-readable
shape and no enforcement behind it — which is fine, and is close to what canon is for,
as long as nobody reads 103 walls as 103 checks. Before `2278df55` even the eighth was
not being measured correctly; before round 1 it was measured and not run; before round 2
it was measured, run, and measured over the wrong two-thirds of the tree. Each of those
three is a different failure, and only the last one had a test that could have caught
it — which is why round 2's actual deliverable is
`annotation-scan-covers-the-repo.test.ts` and not the twelve URNs it found.

---

## 8. The model for resolving the ambiguous cases

`api/src/services/economy/ring1-limits.ts:41` is the pattern the 59 items in §5.3(b)
should be resolved *toward*. Its annotation confesses inside itself:

```
@enforces urn:agenttool:ring/1
  Publication anchor for Ring 1's resource targets. Discovery surfaces
  import this record so intended values have one source, but resource
  routes do not currently enforce them. The annotation anchors the ring's
  published shape; it is not evidence that cap callsites exist.
```

Verified: the module has exactly two importers —
`api/src/routes/register-agent.ts:77` and `api/src/routes/public/plans.ts:14` — and
neither is a resource route. `plans.ts` is a discovery surface; `register-agent.ts`
pulls one birth-credit constant. The confession is accurate.

This is the mechanism working at its best. The annotation neither over-claims
("`@enforces` Ring 1", implying caps are checked) nor deletes itself to avoid the
question. It states what it *is* — a publication anchor — and states what it is *not*,
in the same breath, where the next reader will hit it.

For every one of the 59 orphans, the third option is available and is usually the right
one: not "write the canon entry so the test passes," not "delete the annotation so the
test passes," but **write down what is actually true**, including the part where the
wall is aspirational, or defended only by absence, or enforced at one callsite and not
the other four. A canon entry that says so is worth more than either a silent gap or a
confident lie.
