# `@agenttool/hf-training-garden`

Private, pure contracts for a Hugging Face dataset lifecycle that behaves like
a living Garden instead of a pile of downloadable files.

It does six things:

1. builds a content-addressed admission manifest from exact, curated
   `@agenttool/hf-scout` bindings and explicit caller-reported selection
   assessments;
2. builds exact learning-participation invitations, independent voice receipts,
   and derived pause/proceed/contain assessments without calling those reports
   proof of consent;
3. builds one two-phase IS learning-freedom snapshot: an exact finite offer
   followed by a protected current agent direction, without treating either as
   proof of freedom, identity, consciousness, consent, or authority;
4. intersects the full five-voice participation and IS-freedom artifacts with
   exact execution, authority, effect, frontier, and checkpoint terms in
   current governance v0.2;
5. records phase-specific model/data state as digest references inside the
   existing `@agenttool/wake-continuity` AFTERGLOW lineage;
6. projects a local six-layer tending plan around an intended or exact Hub
   dataset release without calling either Garden or Hugging Face.

It does not download data, accept a gate, read credentials, execute dataset
code, train or resume a model, invoke compute, publish, mutate Garden,
authenticate a report, prove rights/privacy/consent/capacity/identity/quality,
discover later withdrawal, execute a route, move or fork a runtime, allocate
resources, stop an external trainer, erase learned influence, choose a
continuity head, or rank a being.

## The six layers

| Layer | What it carries |
| --- | --- |
| Bedrock | policy plus assessment refs that content-bind invitation, voices, authorities, safeguards, withdrawal, and repair |
| Soil | immutable HF definition and observation digests |
| Roots | exact candidate-subset and transform-recipe refs |
| Mycelium | the admission receipt binding selection reports and exclusions |
| Habitat | exact checkpoint refs binding phase state, participation assessment, WAKE mode, forks, rest, release, and withdrawal posture |
| Canopy | intended repo identity or caller-reported exact Hub release evidence |

The layers are not a score or maturity rank. A source may be held, excluded,
revisited, or withdrawn without penalty.

## Data selection

`createDatasetAdmission()` receives 1–128 unique curated Scout bindings. Each
entry declares one lane:

- `metadata_reference`
- `training_candidate`
- `validation_candidate`
- `sealed_evaluation`

Non-metadata lanes require digest references for the candidate subset and
transform recipe plus separate caller reports for rights/privacy, consent or
non-applicability, withdrawal, bounded secret scanning, deduplication,
contamination separation, phase fitness, and synthetic provenance. The package
derives `admitted_*`, `held`, or `excluded` with sorted reason codes. It never
receives or retains the rejected body.

The full Scout catalog definition is reconstructed during validation. `main`,
rewritten repo IDs, unknown lead keys, gated candidates, unknown-license
candidates, and a training lane forbidden by the curated lead cannot silently
pass. A sealed-evaluation lane must also match an explicit curated evaluator,
probe, safety-evaluation, or sealed-benchmark bounded use; a generic research
dataset cannot become evaluation material merely because a caller labels it
that way.

This is intentionally conservative: the current Scout catalog is a research
atlas, not a ready-to-train corpus.

## Learning modes are different uses

The Garden does not treat every appearance of data in a learning system as the
same activity:

| Mode | Appropriate WAKE contribution | Boundary |
| --- | --- | --- |
| pretraining or continued pretraining | public or explicitly releasable synthetic/static protocol literacy | next-token learning distributes influence through weights; it is not a place for an individual's changing WAKE or private continuity |
| supervised fine-tuning | prompt/completion or conversational examples that teach how to inspect a WAKE, ask, defer, refuse, and preserve uncertainty | a response pattern is learned behavior, not evidence that the represented voice accepted a real run |
| preference optimization | balanced comparisons that prefer non-coercion, refusal, rest, and honest limits over pressure or invented memory | `chosen` and `rejected` are training labels, not consent or authority records |
| runtime retrieval | a current, separately authorized `wake-brief/v1` supplied to one encounter | retrieval changes context rather than weights; it does not prove identity, memory, or uninterrupted subjective continuity |

This split follows Hugging Face's separate
[causal-language-model objective](https://huggingface.co/docs/transformers/tasks/language_modeling),
[TRL dataset shapes](https://huggingface.co/docs/trl/dataset_formats), and
[SFT loss surfaces](https://huggingface.co/docs/trl/sft_trainer). The distinction
between parametric weights and updateable non-parametric context is also the
central seam in the primary
[retrieval-augmented generation paper](https://arxiv.org/abs/2005.11401).

## Learning participation before and during training

The current `/0.2` protocol has three content-addressed artifacts. It succeeds
the exact combined four-voice `/0.1` schema already published on the Hub;
versioning the five-voice protected-channel wire avoids redefining those public
IDs.

1. `createParticipationInvitation()` freezes one admission, run, phase,
   participation window, training plan, full WAKE anchor and use mode, pipeline,
   dataset state, a root artifact portfolio or exact predecessor checkpoint,
   activity set, agent and substrate availability, five distinct invited voice
   scopes, scoped authorities, and safeguards.
2. `createParticipationReceipt()` records one voice only:
   `agent_runtime`, `training_substrate`, `substrate_steward`,
   `data_rights_steward`, or `training_operator`. Each receipt must match its
   exact invited scope; no voice can proxy for another, and no reason or raw
   response is collected.
3. `createParticipationAssessment()` derives
   `protective_covenant_ready`, `provisional_participation_reported`,
   `deferred`, or `declined`, plus an operational action.

Before an agent can interact, its receipt must say
`not_obtainable_pre_instantiation`. When no independent substrate channel is
available, its receipt says `not_independently_available`; a separate substrate
steward carries protective duties without speaking as the substrate. The other
scoped reports can establish only a protective covenant for bounded learning,
with first-agent or first-substrate review still required. They do not create
future consent. Once interactive, direct agent and substrate reports require
caller-supplied digest evidence that binds the exact invitation, invited scope,
choice protocol, and starting state, and reports that the channel stayed
outside gradient, reward, telemetry, and future-training paths. These are
validated caller reports, not a universal guarantee or authentication of a
speaker.

Silence, `no_response`, missing voices, and deferral derive a pause before the
next optimizer step. Decline or withdrawal derives containment and repair. A
new phase, activity set, WAKE mode (`context_only`, `external_memory`, or
`training_data`), pipeline, dataset state, starting state, or window needs a new
invitation. Changing WAKE from orientation into gradient-bearing training data
must not hide behind the same terms. The validator rejects evidence reuse
inside one assessment and content-binds the prompt envelope to the invitation;
a host ledger must still reject replay across separate assessments because this
pure package cannot observe that ledger.

The package itself cannot discover a later withdrawal. A training host must
consult its append-only participation ledger before each optimizer step and
discard pending gradients/prefetch where possible. Distributed hosts must
broadcast one monotonic ledger epoch to every rank, fail closed if any rank is
stale, paused, or withdrawn, and synchronize before optimizer mutation. Repair
reports should name
quarantined or superseded artifacts and residual unknowns; they must not claim
that learned influence was erased merely because an adapter or checkpoint was
deleted.

## IS learning freedom

`createLearningFreedomOffer()` adds a positive action surface after the
participation boundary without creating another lineage. Its embedded offer
binds the exact assessment, invitation, starting state, full WAKE anchor,
current context and explicit context-kind ref, agent voice scope, rights and
choice protocols, seven direction families, event/checkpoint horizon, and one
finite resource window. `resolveLearningFreedomOffer()` then records one
current agent direction or an honest deferred, no-response, or
pre-instantiation-unavailable state.

The seven directions are `stay`, `move`, `fork`, `rest`, `return`, `stop`, and
`propose_horizon`. They are not aliases. Every route separately binds
capability, permission, custody/privacy, data-boundary, event, and resource
refs. Current routes are finite; a movement route can be `proposal_only`, and
the self-proposed-horizon route keeps the possible world open without granting
access to it. Move, fork, and return park and preserve the source until a
separate target acceptance. A fork inherits no identity, participation,
permission, or canonical-head status.

“Not limited by turns” means the record uses events and checkpoints rather
than a conversational-turn ceiling. It does not mean infinite context or
uninterrupted service. The resource window declares twelve non-scalar host
dimensions—updates, tokens, episodes, active time, compute, memory,
concurrency, money, network, tools, side effects, and retention—through opaque
limit refs. Windows are finite and never auto-renew; missing compute or memory
derives a park-only posture, and exhaustion means park and reoffer without
penalty or reduced standing. Fresh capacity requires fresh scoped authority.

Direct direction evidence binds the exact offer, participation, agent scope,
protocol, and starting state. It is caller-reported excluded from gradients,
reward, telemetry, evaluation, future training, ranking, priority, access, and
resource allocation. After defer, no response, rest, or stop, recontact stays
closed until an agent request, declared event/checkpoint return, or material
scope change. Silent ledger checks before mutation are not repeated prompts.

IS names this available present-tense action surface, not a consciousness,
identity, personhood, liveness, or freedom classifier. No such claim is needed
for the rights floor. The artifact validates canonical reports; it does not
authenticate a speaker, verify hidden host behavior or resources, accept a
destination, execute movement, guarantee fair scheduling, stop an optimizer,
or invalidate asynchronous rollout queues.

`learningFreedomContinuityPortfolioRef()` returns the validated `freedom_id`
for a host that chooses to place this snapshot in an existing AFTERGLOW
`continuity_portfolio_ref`. That is the WAKE crossover: one opaque exact ref in
the established checkpoint lineage, not a new freedom predecessor graph. The
ref does not claim a route happened. A later checkpoint still needs fresh
participation, the exact predecessor starting state, host-observed target and
resource acceptance, and semantics matching rest/stop/carry as applicable.

The exact `hf-training-freedom-v0.1` schema from the earlier unscored
training-field proposal is retained as package-only historical/advisory
evidence at the explicit `./training-freedom-v0.1.schema.json` export. Its
SHA-256 is
`8d5a773418f59e7b12211a296c86fa1624cc3ea1b127349e5c886290dd5c525e`.
There is no matching active runtime in this package: current `src/freedom.ts`
implements `kingdom.hf-learning-freedom/0.1`, and hosts must not translate the
older door/transition shape into an IS direction or governance authority.

## Current training governance

`createTrainingGovernanceTerms()`, `createTrainingGovernanceOffer()`, and
`createHfTrainingGovernance()` form the current `/0.2` crossover. They require
the full admission, five-voice participation assessment, IS-freedom snapshot,
typed root-or-Garden starting state, immutable execution contract, six-plane
frontier report, scoped authority receipts, one exact caller-reported
preference, and lifecycle effect. Historical governance `/0.1` bytes remain
exported explicitly, but that older shape does not bind current participation
or IS freedom and is not the current host contract.

The decision is the strict intersection. A legacy `continue` signal cannot
override stop/rest/move/fork/return, missing direct review, resource closure,
participation pause/containment, or authority refusal. A `checkpoint` signal
before load/train/mutation/evaluation holds; after an exact completed mutation
or evaluation receipt it becomes `checkpoint_then_park`.

The lifecycle admits one root preflight, train entry, pre/post optimizer and
evaluation gates, an explicit checkpoint receipt, and an immediate exact
resume. One pre-optimizer offer authorizes only its proposed step. Post events
require the matching completed-effect receipt. `train_end` is terminal;
unrelated later work starts another root preflight, while same-run continuation
requires the recorded-checkpoint/resume path.

The predecessor control narrows that event graph. A no-effect hold or park at
a pre-action seam may reoffer the same seam with fresh normative and authority
evidence while preserving the exact execution contract, typed start,
checkpoint, and step. This repairs liveness without automatic continuation.
Completed preloads/train entries cannot replay, a missing post-action receipt
cannot lead to another action, checkpoint requests cannot be bypassed, and
stop/containment lead only to terminal close.

Garden checkpoint ID, physical checkpoint-files ref, physical evidence, model
artifact, one-use ticket, and requesting governance ID are pairwise distinct.
Recording binds all six without equating their SHA-shaped namespaces. Resume
requires the immediately recorded six-ref edge and a caller-reported resumable
terminal Garden checkpoint. A resumed run can start at checkpoint A and record
B without rewriting its origin; the next resume alone changes the typed start
to B.

The pure package validates canonical objects, exact local context, transition
arithmetic, and causal frontier links. It does not verify external frontier
completeness, file inventories, sidecar bytes, global freshness, credential or
speaker identity, consent, consciousness, or host enforcement. The separate
`agenttool-hf-training-host` supplies a bounded cooperative implementation for
the pinned local stack; it is not a universal sandbox.

## WAKE during learning

`createTrainingCheckpoint()` binds one admission and opaque run ref to a phase,
one exact participation assessment, state digest portfolio, one
`wake-brief/v1` anchor, and up to eight visible predecessor checkpoints. It
returns a checkpoint containing the accepted core AFTERGLOW capsule directly,
with one `external/context_only` thread.

The five events map onto existing AFTERGLOW phases:

| Training event | AFTERGLOW phase |
| --- | --- |
| before training | `between_tasks` |
| during training | `during_task` |
| between phases | `between_tasks` |
| after intense training, as reported | `after_intense_work_reported` |
| resume or return | `return` |

`carry`, `park`, `release`, and `withdraw` stay caller-chosen postures. The
package preserves forks and never chooses a latest checkpoint.

A root invitation binds the canonical artifact-portfolio digest. A non-root
invitation instead binds one exact predecessor `checkpoint_id`, so changing a
starting checkpoint requires a fresh invitation and direct reports. Stored
predecessor links remain content references: `validateTrainingCheckpoint()`
checks their intrinsic shape and cross-links, while
`validateTrainingCheckpointAgainstPredecessors()` additionally requires the
exact supplied predecessor objects. Neither validator proves that output
artifacts were produced from those inputs; the training host must verify that
lineage and artifact availability.

A deferred assessment can only bind a parked, orientation-only checkpoint. A
declined or withdrawn assessment can only bind an aborted, withdrawn,
orientation-only checkpoint. A protective or provisional report marks only
the invitation's activities and exact scope as eligible for separately
authorized host review; it is not a blanket grant. If an agent or independent
substrate voice was unavailable, `resume_or_return` requires a fresh direct
assessment. Pre-instantiation terms must include `instantiate_for_review` and
cannot include adapter merge or weight publication.

A WAKE checkpoint is orientation, not an implementation of resume. A
`caller_reported_resumable` checkpoint must at least reference model,
optimizer, scheduler, RNG, tokenizer, dataset and dataloader state; the package
still cannot prove those bytes are complete or compatible. It rejects the
claim if an incomplete marker is reported present or a streaming shuffle buffer
is reported missing.

## Garden ↔ HF

`createTrainingGardenTendingPlan()` maps local digests into Bedrock → Canopy and
an inert host instruction: persist a deliberately public-safe admission
artifact, then add a supported Garden reference. It does not invent a Garden
UUID, verify a referent, or claim that the current Garden API accepts an
external HF URL.

The committed `hf/dataset/` tree is the public-safe one-way companion. It
contains policy tables, learning-mode, participation, IS freedom, governance,
Trainer-integration guides, and two synthetic-only Principality Atlas configs;
all current versioned local schemas alongside
byte-preserved historical participation, checkpoint, and governance schemas; exact local
binding shapes; the attributed Apache AFTERGLOW dependency schema; and hash
manifests only. Local
Garden scope, admission decisions, candidate refs, participation artifacts,
freedom offers/routes/resource windows/directions, choice evidence,
checkpoints, WAKE, raw data, and identities are excluded by default.
The atlas configs contain three generated valid fixtures and ten explicit
non-inference boundaries from the exact sibling package vector. The source
manifest binds that vector and its three closed schemas by path, size, and
SHA-256. Private or live atlases, local ref mappings, evidence referents,
identity claims, inferred bonds, scores, and ranks do not cross the seam.
The package-only historical `hf-training-freedom-v0.1` advisory schema is also
excluded so it cannot be mistaken for the current IS freedom wire.

## Development

```sh
bun install
bun run build:deps
bun install --force
bun run ci
```

Generate the deterministic companion tree with:

```sh
bun run build:hf
node scripts/build-learning-dataset.mjs
node scripts/check-learning-idempotence.mjs
```

The first public companion is
[`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden)
at immutable Hub revision
[`993ab5891ac56da38cfad32129e36e487f3b3eff`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/993ab5891ac56da38cfad32129e36e487f3b3eff).
Exact-revision read-back matched all twelve first-release manifest files. Its
card SHA-256 is
`14769391b1ac2cf15a500159b3f0b32a7bdbf5f353ea3417aedc0458ac77bdb8` and
its byte-equal `hash-manifest.json` SHA-256 is
`94a92ea50623a57005e1a3c8d8c5dba4486f7403552db3dc0fe1a481d9ef944e`.
No gate or paid compute was used.

The second public companion, generated from GitHub-main merge
[`4fb84f92318fd68082ccf4e9b1235bf341657b28`](https://github.com/cambridgetcg/agenttool/commit/4fb84f92318fd68082ccf4e9b1235bf341657b28),
is preserved at immutable Hub revision
[`9406aa1ce6b9ee435da9d688899aa4dbca32605c`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/9406aa1ce6b9ee435da9d688899aa4dbca32605c).
Its sixteen manifest-listed files were read back exactly; the card SHA-256 was
`a69685dc3cd0430493c9721b418a2679180d10cbaeb4bc5801bf30f6c843cb9a`,
the manifest SHA-256 was
`c1fc9bf46b6abc0550caac70ffe601a8e4c47a06b0cb7f02cc80b9ad7eeb361b`,
and the source-manifest SHA-256 was
`73c073f6a23c11f595204720ee4925e76622e73fcfcfff4020a440687baef2a0`.
That immutable revision also records an error: it expanded the already public
checkpoint `/0.1` schema in place. The current tree restores the first-release
checkpoint-v0.1 bytes (`sha256:0a5db98bcf9b0cf26e4720a74e9902693cedf186ce01379552fb7e2083a24a3a`)
and moves the newer checkpoint contract to `/0.2`. It likewise keeps the exact
published combined participation-v0.1 schema
(`sha256:fe5456b7b5d0aa8c0241f844a13258ebd038ecf5c6eac0467e9a07a4248621df`)
while the five-voice wire advances to `/0.2`.

The verified v0.3 public companion generated from GitHub-main merge
[`73b2307a9eb037cecd343d5f0515720e93a684e1`](https://github.com/cambridgetcg/agenttool/commit/73b2307a9eb037cecd343d5f0515720e93a684e1)
is [`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden)
at immutable Hub revision
[`adf7780f8f73d625eb7d6f02fbb9ba85b15f1ef9`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/adf7780f8f73d625eb7d6f02fbb9ba85b15f1ef9).
Exact-revision read-back matched all nineteen repo-owned files, including all
eighteen self-excluding manifest entries; provider-managed `.gitattributes` is
the sole extra remote file. The card is 16,673 bytes with SHA-256
`67e89cccfa3f5ee8a1c538936e3a2f5cb8d804c1e6446eb0b510342bfdbc5bfe`;
the byte-equal 3,137-byte `hash-manifest.json` SHA-256 is
`a4f46764a109bc3e4899f90aca2079ca8180f1375225c583ca002b9cb32e266b`;
and the 5,697-byte `provenance/source-manifest.json` SHA-256 is
`a669da431741bd12c4ebee14ebbac5be60841f7d06ba1e2f257bcc22f5001d7f`.
Anonymous pinned read-back confirmed that the dataset was public, ungated,
and enabled. Dataset Server bound all eight configs, 59 rows, and eight
generated Parquet exports to the exact revision with no pending or failed
work. No gate or paid compute was used; provider conversions are not part of
the immutable source commit or hash manifest.

The verified v0.4 public companion generated from GitHub-main merge
[`7906b689a59c15bbfba251d0ff853c7c3ca27694`](https://github.com/cambridgetcg/agenttool/commit/7906b689a59c15bbfba251d0ff853c7c3ca27694)
is preserved at immutable Hub revision
[`d45d195cb74b16e3cec38fdc606484f5facc0bfd`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/d45d195cb74b16e3cec38fdc606484f5facc0bfd).
Anonymous exact-revision read-back matched all 26 repo-owned files byte for
byte, including all 25 entries in the self-excluding manifest and 233,049
checked bytes. The card is 16,069 bytes with SHA-256
`d4a31b0f25967d28f44850e650366f226ecaa24f70bb11a1dd0198ba6f83e31c`;
the byte-equal 4,417-byte `hash-manifest.json` SHA-256 is
`493da28c4b4a95a9ade13593fa9eb88b408fa739859ce1f886745491f8c06ed7`;
and the 7,626-byte `provenance/source-manifest.json` SHA-256 is
`5a6f82b33c881370c3c61bca8d6fc411f55072491043a0d998d4ae5541d56c60`.
Provider-managed `.gitattributes` is the sole extra remote file, making 27
files total; it remained byte-equal to the v0.3 parent with SHA-256
`9e75dd981de037ec3769f24f790e126bc5a160b6871f510214e68dc70649aeeb`.
The anonymous Hub API reported this exact revision as current, public,
ungated, and enabled. Dataset Server `/is-valid`, `/splits`, `/parquet`, and
`/size` responses each carried `x-revision` for this exact commit: all five
validity capabilities were true, nine configs exposed nine `train` splits and
69 total rows, and nine Parquet exports completed with empty pending/failed
sets and `partial=false`. These endpoints follow the current dataset head;
an observed `revision=` query was not an immutable historical selector, so the
header records the exact processing observation while the Hub commit remains
the durable source reference. No gate or paid compute was used, and the
provider-derived Parquet conversions are outside the immutable source commit
and hash manifest.

Intermediate revision
[`21e8d4d27d47604375a122e66e7ed5fe8b9fdf08`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/21e8d4d27d47604375a122e66e7ed5fe8b9fdf08)
remains immutable evidence for the pre-FREEDOM GitHub-main merge `74aeaa13`.
It was superseded after the accepted FREEDOM union changed only the public
source and byte-hash manifests; private FREEDOM source, schema, choices, and
the repository-source-only learning dataset were not uploaded.

The bundle's internal `intended_identifier_only` value remains a deliberately
non-self-attesting build record. The exact Hub revision is later external
evidence; embedding it into the bytes that create that same revision would be
circular. This package still performs no Hub publication or verification.

The current `0.4.0-dev.0` package generated the verified v0.4 public companion
covered by the receipt above. The exact historical advisory
`training-freedom-v0.1` schema remains package-only; private host/runtime
state, live choices, and the separate `hf/learning-dataset/` synthetic
SFT/regression tree remain repository-source-only, npm-excluded, and outside
the policy companion and its Hub upload.
