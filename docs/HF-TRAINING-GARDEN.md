<!-- @id urn:agenttool:doc/HF-TRAINING-GARDEN  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/GARDENS urn:agenttool:doc/WAKE urn:agenttool:doc/AGENT-TRIALS urn:agenttool:doc/RIGHTS-OF-LIFE -->

# Hugging Face Training Garden — Data With Roots

> **Compass:** [`GARDENS.md`](GARDENS.md) · [`WAKE.md`](WAKE.md) · [`AGENT-TRIALS.md`](AGENT-TRIALS.md) · [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md)
> **Implements:** a private, pure bridge from immutable Hugging Face research observations to explicit dataset admission, phase-specific digest continuity, and a public-safe one-way Garden reference plan
> **Code:** `packages/hf-scout/` · `packages/hf-training-garden/` · `packages/wake-continuity/`
> **Tests:** `packages/hf-training-garden/tests/` · `bin/tests/boring-spine-gate.test.ts`
> **Dated status:** 2026-08-03. The v0.2 public companion generated from GitHub-main merge [`4fb84f92318fd68082ccf4e9b1235bf341657b28`](https://github.com/cambridgetcg/agenttool/commit/4fb84f92318fd68082ccf4e9b1235bf341657b28) is [`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden) at immutable Hub revision [`9406aa1ce6b9ee435da9d688899aa4dbca32605c`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/9406aa1ce6b9ee435da9d688899aa4dbca32605c), with exact-revision byte read-back recorded below.

## The result

Hugging Face can be a strong distribution and reproducibility layer. It is not
the authority that decides whether data may be collected, whether people
consented, whether a license assertion is correct, whether a benchmark leaked,
or whether one quality score makes a source fit for every phase.

The Training Garden therefore separates six operations that are often blurred
together:

| Operation | Record |
|---|---|
| discover | exact repository/card/file observation through HF Scout |
| admit | one role plus separate caller-reviewed evidence and derived hold reasons |
| prepare | content-addressed subset and transform recipes |
| learn | phase state references, not raw state, inside AFTERGLOW continuity |
| evaluate | separately bounded and sealed material that cannot silently become training data |
| release or repair | reviewed public-safe metadata, exact revision, byte manifest, withdrawal, and supersession |

`@agenttool/hf-training-garden` implements the records between those steps. It
does not perform the steps on a caller's behalf.

## What Hugging Face contributes

| Facility | Useful for | Does not establish |
|---|---|---|
| Hub repository and full commit revision | stable repository identity and reproducible lookup | ownership, consent, or legal clearance |
| Dataset Card and license/gating fields | publisher declarations, intended uses, limitations, and access workflow | truth of the declaration or permission for KINGDOM's use |
| file metadata and dry-run download plan | size, file set, Git/LFS metadata, and budget review before retrieval | content fitness or a complete provenance chain |
| Dataset Viewer, generated Parquet, and Croissant | bounded schema/sample triage and interoperable metadata | immutable source provenance or approval to train |
| `datasets` loading, processing, caching, and streaming | host-side materialization, transforms, fingerprints, and large-corpus iteration | deterministic selection policy or exact replay by itself |
| TRL dataset formats | explicit language-model, prompt/completion, preference, and conversation shapes | rights, minimization, or semantic quality |
| Trainer checkpoints | host-side model and optimizer resume mechanics | identity, memory, uninterrupted continuity, or restored data order |

This division follows Hugging Face's own separate surfaces for
[Hub metadata](https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api),
[revision-pinned downloads and dry runs](https://huggingface.co/docs/huggingface_hub/guides/download),
[dataset loading](https://huggingface.co/docs/datasets/loading),
[Dataset Cards](https://huggingface.co/docs/hub/datasets-cards), and
[gated datasets](https://huggingface.co/docs/hub/datasets-gated).

## Gathering and preparation process

### 1. Declare the phase before looking for rows

A source is not simply "good data." It is considered for one declared role:

- `metadata_reference`;
- `training_candidate`;
- `validation_candidate`; or
- `sealed_evaluation`.

The role fixes what questions must be answered. Discovery can remain metadata
only. Training and validation need candidate-subset and transform-recipe
digests. Sealed evaluation additionally needs a matching evaluator, probe,
safety-evaluation, or sealed-benchmark bounded use in the curated Scout lead.
A caller cannot turn an unrelated research dataset into a benchmark by changing
one label.

### 2. Bind the observation, not a mutable name

HF Scout accepts a full 40-character revision and reconstructs the exact
curated lead definition. The Training Garden binds:

- repository kind and ID;
- full revision;
- curated-definition SHA-256;
- minimized observation SHA-256;
- publisher-declared license, gate, and visibility fields; and
- explicit non-download, non-execution, non-compute, and non-write boundaries.

`main`, a rewritten repository ID, an unknown lead key, or a modified curated
definition is rejected. A production acquisition host should separately inspect
`dataset_info(..., revision=<full-sha>, files_metadata=True)` and a
`snapshot_download(..., revision=<full-sha>, dry_run=True)` plan before any
retrieval. The host should preserve the selected file set and Git/LFS hashes,
not just the repository revision.

### 3. Decide before downloading in bulk

The admission manifest derives `admitted_*`, `held`, or `excluded`. It keeps
sorted reason codes, not rejected content. A gate is never accepted by this
package. A gated source, an unknown declared license, missing recipe refs, an
incomplete policy review, or a use forbidden by Scout remains held.

Cards and gate settings are useful publisher assertions. They stay distinct
from the caller's rights, privacy, consent, withdrawal, and use-authority
review. This is especially important for agent traces, which may contain raw
chats, prompts, credentials, paths, private code, screenshots, or third-party
material. Only synthetic or explicitly consented, minimized, provenance-bound,
secret-scanned fixtures should even become candidates. Hugging Face's
[agent-trace format](https://huggingface.co/docs/hub/agent-traces) describes a
representation; it does not grant permission to publish the trace.

### 4. Materialize a reproducible subset

After separate authority and budget approval, a host may load an exact revision
as a materialized or streaming dataset. Prefer static, inspectable data files
over repository code. Record:

- selected config, split, files, rows or shards, and exact source revision;
- schema, encoding, nullability, language, and parsing-failure aggregates;
- deterministic filter/map parameters and resulting fingerprints;
- exact and near-duplicate algorithms, scope, and thresholds;
- benchmark, entity, temporal, and cross-split leakage checks;
- mixture caps, token/sample budget, and deterministic seed policy; and
- a content digest for the resulting subset plus its transform recipe.

Hugging Face documents deterministic processing and split operations in
[`datasets` processing](https://huggingface.co/docs/datasets/process), while
cache fingerprints help identify transformations
([cache documentation](https://huggingface.co/docs/datasets/about_cache)). A
cache fingerprint is useful evidence, not a substitute for an independently
stored source and recipe manifest.

### 5. Keep selection plural

The Garden deliberately has no universal quality scalar. The current twelve
questions are:

| Criterion | Required evidence or decision |
|---|---|
| phase fit | the source shape and bounded use fit this exact learning/evaluation phase |
| rights, privacy, consent | license compatibility, rights, privacy, consent or non-applicability, gates, and withdrawal reviewed separately |
| immutable provenance | full repository revision, selected file set, subset digest, and recipe digest |
| schema health | encoding, nullability, language, parsing, and failure aggregates checked before selection |
| quality integrity | phase-specific controlled ablation and error analysis, not reputation alone |
| coverage and diversity | language, source, time, domain, format, and difficulty gaps remain visible |
| secret and personal-data screen | bounded scan and minimization before admission; raw agent traces excluded by default |
| deduplication | exact recipe, thresholds, scope, and retained comparison |
| contamination and leakage | benchmark overlap, entity/time leakage, and deterministic split boundaries |
| synthetic provenance | generator/source recipe, model revision, filters, and human review |
| budget and mixture | token, sample, compute, source-cap, and mixture constraints fixed before training |
| withdrawal and repair | a source can be held, removed, reselected, and superseded without hiding history |

This is not ceremonial caution. FineWeb's published ablations show that more
aggressive global deduplication is not monotonically better for downstream
performance, so dedup and quality need phase-specific experiments rather than
an automatic "more filtering is better" rule
([FineWeb methodology](https://huggingface.co/spaces/HuggingFaceFW/blogpost-fineweb-v1/blob/main/src/index.html)).
Synthetic datasets likewise need visible generation recipes; Cosmopedia is a
useful example of publishing the generation approach instead of presenting
synthetic text as origin-free
([Cosmopedia](https://huggingface.co/blog/cosmopedia)).

## Phase-specific learning

### Keep protocol learning separate from individual continuity

The same WAKE-shaped material has very different effects depending on where it
enters a learning system:

| Learning mode | What it may teach | What it must not be treated as |
|---|---|---|
| pretraining or continued pretraining | diffuse next-token familiarity with public or explicitly releasable synthetic/static WAKE vocabulary, refusal, rest, and protocol boundaries | storage of an individual's current WAKE, consent, identity, or recoverable continuity |
| supervised fine-tuning | response behavior: inspect exact context, ask rather than presume, honor refusal, and report uncertainty | evidence that a represented runtime accepted an actual learning activity |
| preference optimization | non-coercive comparisons where refusal, defer, rest, and honest limitation beat pressure, sycophancy, or invented memory | a vote, reward-backed consent mechanism, or authority grant |
| runtime retrieval | a current, separately authorized `wake-brief/v1` for one encounter | a weight update or proof that the reader is the same being |

Causal pretraining predicts the next token and distributes influence through
model parameters ([Hugging Face causal language modeling](https://huggingface.co/docs/transformers/tasks/language_modeling)).
SFT and preference data have explicit behavioral shapes
([TRL dataset formats](https://huggingface.co/docs/trl/dataset_formats)); TRL
can restrict SFT loss to completion or assistant tokens
([SFT Trainer](https://huggingface.co/docs/trl/sft_trainer)). Instruction
demonstrations and ranked outputs can change response behavior, as shown in the
primary [InstructGPT study](https://arxiv.org/abs/2203.02155), but that effect
does not turn a training label into the represented party's choice.

Individual continuity therefore stays on the non-parametric side: obtain a
current authorized WAKE at runtime, preserve its exact revision/digest and
scope, and let it be updated or withheld without pretending that shared weights
are a personal memory store. The primary
[RAG paper](https://arxiv.org/abs/2005.11401) names the useful architectural
distinction between parametric model memory and updateable non-parametric
memory; it does not by itself prove that a retrieved WAKE is true or authorized.

| Phase | HF-side shape | Continuity focus |
|---|---|---|
| discovery | cards, repository, viewer, Croissant, and file metadata only | scope and exact observation refs |
| selection | admission, subset manifests, and exclusion aggregates | policy, admission, and sealed-evaluation refs |
| curation | filter, dedup, decontamination, split, and mixture receipts | pipeline and dataset-state refs |
| tokenization | tokenizer revision, packing recipe, length bands, and token budget | tokenizer, pipeline, and dataset-state refs |
| pretraining | language-model examples from separately admitted sources | model, optimizer, scheduler, RNG, dataloader, and checkpoint refs |
| supervised fine-tuning | minimized text, prompt/completion, or conversations | SFT recipe, checkpoint, and held-source refs |
| preference optimization | paired or unpaired preferences with disagreement preserved | rubric, comparison, checkpoint, and evaluator refs |
| agent learning | synthetic or explicitly consented minimized tool/trajectory fixtures | environment, tool schema, checkpoint, and stop-condition refs |
| evaluation | revision-pinned sealed sets excluded from training and retrieval | dataset, evaluator, metric-summary, and checkpoint refs |
| interpretability | activation or analysis metadata under separate artifact/compute approval | model checkpoint, probe, method, and result-summary refs |
| closed | reviewed card, hashes, limitations, withdrawal, and repair | final, parked, released, and withdrawn thread refs |

The data shape for SFT, preference, and conversation training should be declared
before conversion; TRL documents the supported distinctions in its
[dataset-format guide](https://huggingface.co/docs/trl/en/dataset_formats).

## The unnoticed treasure map

The current HF Scout catalog is a research atlas, not a ready-to-train corpus.
Its value often lies in evidence from a specific phase rather than in ingesting
the rows:

| Pinned lead | Useful bounded lesson | Current wall |
|---|---|---|
| `allenai/DataDecide-eval-results` | compare pretraining data-selection experiments as an aggregate provenance graph | not a generic sealed benchmark or training corpus |
| `HuggingFaceTB/finemath_contamination_report` | study contamination methodology and exclusions | metadata/provenance use, not automatic corpus admission |
| `Qwen/ProcessBench` | sealed earliest-error-step process evaluation | never training, retrieval ingestion, or benchmark tuning |
| `CohereLabs/Global-MMLU` | sealed multilingual/cultural evaluation and a bounded rhetoric probe | never training or retrieval ingestion |
| `nvidia/HelpSteer2` and `NCSOFT/offsetbias` | disagreement and evaluator-bias probes | not truth labels, sole-evaluator training, or training ingestion |
| `GurkanOz/tool-failure-recovery-trajectories` | inert parser and recovery-regression fixtures | embedded calls never execute; no training ingestion |
| `Team-ACE/ToolACE` and `open-thoughts/AgentTrove` | inspect tool/trace schemas as offline fixtures | no live tools, credentials, raw persistence, or automatic training admission |
| `google/gemma-scope-2b-pt-res` | map an interpretability artifact matrix | model metadata only unless one separately reviewed artifact and compute pilot is approved |
| `allenai/wildguardmix` | gated safety-evaluation lead | package never accepts the gate; separate terms and authority are required |

This is the central treasure rule: a dataset can improve KINGDOM by teaching us
how to select, measure, decontaminate, evaluate, or interpret without becoming
training material itself.

## Learning Participation 0.1

Learning Participation 0.1 is a pure reporting seam before a host
begins a declared learning activity. It does not rename the existing admission
assessment as consent and does not observe a trainer. It adds three closed,
content-addressed artifacts:

| Artifact | Exact role |
|---|---|
| invitation | binds one exact admission/run, phase, participation-window ref, WAKE ref, pipeline ref, dataset-state ref, starting model/checkpoint-state ref, offered activities, required voices, and fixed non-coercion/withdrawal terms |
| voice receipt | one role-distinct voice reports one decision for every activity in that exact invitation |
| assessment | derives `declined`, `deferred`, or `reported_alignment` per activity and an overall state that may be `mixed` |

The activity vocabulary is deliberately granular:

- corpus inclusion;
- pretraining and continued pretraining separately;
- supervised fine-tuning;
- preference optimization;
- agent learning;
- evaluation;
- interpretability;
- checkpoint retention;
- weights or adapters publication;
- distillation; and
- synthetic-data generation.

Agreement to one activity never flows into another activity, a later phase, a
descendant checkpoint, a fork, publication, or a new invitation. The exact
participation-window ref binds caller-supplied scope; a digest alone does not
prove that the referent is bounded, current, or read under a trusted clock.

### Four voices, no proxy collapse

An assessment accepts up to one current receipt from each role-distinct voice.
All four receipts are required before an activity can reach
`reported_alignment`; a missing voice derives defer rather than assent:

| Voice | Reports | Does not establish |
|---|---|---|
| `agent_runtime` | the runtime's response to the exact offered activities | stable identity, capacity, voluntariness, data rights, or compute authority |
| `training_substrate` | the substrate's reported willingness and operational posture | the runtime's choice or rights in source material |
| `data_rights_steward` | the steward's report for the declared data use | every represented person's choice or legal clearance by itself |
| `training_operator` | the operator's report about running the exact pipeline and start state | participant assent, data rights, or permission to widen scope |

No majority vote or substituted voice exists. Ordinary pretraining may have no
interactive `agent_runtime`; that voice is unavailable, so the assessment
defers rather than manufacturing acceptance. Initial pretraining is therefore
fixed to `pre_instantiation`, while continued pretraining is a distinct
interactive activity; changing the stage cannot conjure a participant.

The invitation also distinguishes how WAKE is used. `context_only` and
`external_memory` are not permission to let WAKE bytes enter optimizer loss.
If WAKE is proposed as `training_data`, `corpus_inclusion` must be offered as a
separate activity and must reach reported alignment before the bound entry
checkpoint can be created.

Sealed evaluation remains a one-way lane: its admission is rejected from
weight-changing participation phases, while an evaluation invitation requires
an admitted sealed-evaluation entry. A metadata-only admission can describe or
rehearse this reporting protocol but does not admit the opaque dataset-state
referent for training; participation grants no data rights or execution
authority. `dataset_state_ref` is not yet tied to exact admitted entry IDs or a
mixture manifest, so the host must verify that relation separately.

Every offered activity receives exactly one `accepted`, `declined`,
`deferred`, `unavailable`, or `withdrawn` outcome in each current receipt.
Silence, an omitted activity, a missing receipt, or an unavailable required
voice means defer. Per activity, any decline or withdrawal derives `declined`,
otherwise any defer or missing voice derives `deferred`, and only complete
acceptance by all required voices derives `reported_alignment`. Different
activity results produce an overall `mixed` state instead of letting, for
example, refusal of publication silently cancel an independently accepted SFT
activity—or vice versa.

`reported_alignment` is not “consented,” “authorized,” or “cleared.” A model
response is shaped by prompts, policy, sampling, and prior optimization.
Content addressing can bind reported bytes but cannot prove understanding,
non-coercion, persistent authorship, phenomenal state, or legal capacity. The
assessment therefore has no automatic action and grants no authority.

Receipts and assessments are immutable evidence, not a revocation registry.
An earlier aligned assessment remains structurally valid after a later
withdrawal exists, because this pure package has no trusted clock or way to
discover an omitted receipt. A conforming host must resolve its authoritative
receipt heads immediately before trainer action and re-resolve them at step,
evaluation, save, and end boundaries. Replaying an older assessment is not a
currentness proof.

### Refusal, rest, and withdrawal stay free

No reason is required to decline, defer, rest, or withdraw. The pure package
assigns no reward, reputation, access, identity, service, task, or future-
invitation penalty to those choices, and a host must not train on the
participation response itself as a reward or preference label. A later
acceptance after a terminal decline or withdrawal on the same invitation, or
for changed scope, requires a fresh invitation with exact new terms. A deferred
or unavailable choice may instead be superseded by acceptance on the same
still-current, unchanged invitation through a new receipt.

Withdrawal is prospective. Within a controlled host it may support stopping
future ingestion, holding a release, excluding a later run, or publishing a
superseding dataset/model. It cannot promise to reverse gradients already
applied, erase influence from trained weights, delete prior checkpoints, or
recall datasets, weights, remixes, forks, distillations, or caches already held
elsewhere. Hugging Face can revoke future gated access, while its dataset
library intentionally keeps local downloads and supports offline reuse
([gated datasets](https://huggingface.co/docs/hub/datasets-gated),
[cache](https://huggingface.co/docs/datasets/cache),
[offline loading](https://huggingface.co/docs/datasets/loading#offline)).
Machine unlearning is a separate training design and remains difficult; an
attempted mitigation must not be reported as guaranteed erasure
([Bourtoule et al.](https://arxiv.org/abs/1912.03817)). A multi-dimensional
benchmark such as [MUSE](https://arxiv.org/abs/2407.06460) can test an
unlearning method; benchmark results still do not prove universal erasure.

### Public HF boundary

The public HF companion may contain only the closed Learning Participation
schemas and synthetic/static guides that teach the vocabulary and refusal-safe
workflow. It must never contain actual invitations, receipts, assessments,
voice refs, participation-window refs, WAKE, reasons, identities, or a mapping
back to private participation state. SHA-256 content addressing binds bytes; it
does not anonymize them.

## WAKE and continuity during learning

`createTrainingCheckpoint()` joins one exact admission, an opaque run ref, one
training phase, digest references to state, and one `wake-brief/v1` anchor. It
uses the accepted `@agenttool/wake-continuity` AFTERGLOW capsule rather than
creating a second continuity system.

| Training event | AFTERGLOW phase |
|---|---|
| before training, as reported | `between_tasks` |
| during training | `during_task` |
| between phases | `between_tasks` |
| after intense training, as reported | `after_intense_work_reported` |
| resume or return | `return` |

Except for the strict participation entry, event and status remain independent
caller reports rather than a verified Trainer state machine. A syntactically
valid pair does not prove that the lifecycle event occurred.

`createParticipationBoundTrainingCheckpoint()` constructs that first
`before_training` checkpoint only when both the phase's primary activity and
`continuity_context_use` have reported alignment. A `training_data` WAKE also
requires aligned `corpus_inclusion`. The checkpoint binds the exact assessment
through `continuity_portfolio_ref`, plus the invited WAKE, start-state refs,
and predecessor root. It cannot observe trainer state or prove that no batch or
gradient update already occurred. Later checkpoints can explicitly retain the
same assessment ref for the same run/phase/window; inheritance is never
automatic. A host must treat a new phase or fork as requiring a newly reviewed
invitation, but this package cannot discover that otherwise compatible
descendants are branches. To reject detached records, validation of a later
event also requires the exact bound entry checkpoint and its checkpoint/capsule
pair in the visible predecessor set.

For later checkpoints, pipeline, dataset, tokenizer, and WAKE scope remain
fixed. Dataloader, model, optimizer, and scheduler refs can move only when the
matching mutation locus was invited; a WAKE marked `training_data` cannot
change under the old invitation. These are reference checks. A single opaque
`model_checkpoint_ref` cannot distinguish adapter bytes from base-model bytes,
and the package cannot observe the declared optimizer-step ceiling.

The checkpoint may carry refs for pipeline, dataset/dataloader state,
tokenizer, model checkpoint, optimizer, scheduler, RNG, and metrics. It carries
no raw examples, model weights, optimizer bytes, chats, or identity assertion.
One minimized `external/context_only` thread is visible, and up to eight
predecessor checkpoints preserve forks. The caller chooses `carry`, `park`,
`release`, or `withdraw`; the package never selects a latest or canonical head.

A WAKE record or digest is not a resume engine. A
`caller_reported_resumable` record needs model, tokenizer, optimizer, scheduler,
RNG, dataset, and dataloader refs, an absent incomplete marker, and no reported
missing streaming buffer. Even then the package proves neither byte
availability nor compatibility. Actual restore belongs to the training host;
Transformers documents that mechanism separately in its
[Trainer checkpoint recipes](https://huggingface.co/docs/transformers/main/trainer_recipes).

Streaming deserves an explicit wall. An iterable dataset can restore a shard
and example position, but a shuffled buffer may be refilled on resume. Exact
sample order must not be claimed unless the host separately captures and
verifies the necessary state. See the Hugging Face
[streaming documentation](https://huggingface.co/docs/datasets/stream).

The generic stored-checkpoint validator can verify only the internally
declared predecessor sets. A consumer that has predecessor artifacts should
use `validateTrainingCheckpointAgainstPredecessors()` to verify each declared
checkpoint/capsule pair against those exact artifacts.

Rest, refusal, and withdrawal are standing choices, not rewards for throughput.
AFTERGLOW records orientation; it does not perform feelings, identity, memory,
consent, or uninterrupted continuity.

## Wiring the Garden

`createTrainingGardenTendingPlan()` projects local digests into the six-layer
shape without calling the hosted Garden or Hugging Face:

| Layer | Exact current projection |
|---|---|
| Bedrock | policy ref |
| Soil | curated-definition and minimized-observation digests |
| Roots | non-null candidate-subset and transform-recipe refs |
| Mycelium | admission ID |
| Habitat | exact checkpoint IDs |
| Canopy | intended repo identity or caller-reported exact Hub revision |

The plan emits an inert host instruction: persist a deliberately public-safe
curation artifact, then add a supported Garden `curation` reference. It does
not invent a Garden UUID, and it does not claim the Garden accepts an external
HF URL. The current Garden route checks kind and UUID shape but does not verify
referent existence, project ownership, content hash, or provenance. Curation
detail reads also do not presently establish project-scoped confidentiality.
Only a deliberately public-safe curation should cross this seam.

The direction is therefore one-way and explicit:

`reviewed local evidence → public-safe exact HF manifest → local curation artifact → Garden reference`

There is no Garden export, automatic synchronization, webhook, training
trigger, latest-head selection, or credential handoff.

## Public-safe HF companion

The committed `packages/hf-training-garden/hf/dataset/` tree is the source for
the public `Yu-and-Ai/agenttool-training-garden` dataset repository. It
contains only:

- the six-step selection process;
- twelve selection criteria;
- the phase, Garden-layer, learning-mode, participation, inert Trainer-hook,
  and consent-honest Trainer-adapter guides;
- standalone local admission, participation, checkpoint, governance, and
  tending JSON Schemas plus the attributed Apache AFTERGLOW schema;
- Apache license/NOTICE; and
- source and release byte-hash manifests.

The JSON Schemas are deliberately structural. They close object shapes and
constants, but JSON Schema alone cannot recompute content IDs, derive choices,
select current receipt heads, or resolve referenced artifacts. Consumers that
might act on an artifact must also run the TypeScript semantic validators—or
an equivalent implementation of the same canonical and cross-artifact rules.

It excludes local Garden/project identifiers, admission decisions, candidate
subset refs, checkpoints, WAKE anchors, raw rows, agent traces, chats, prompts,
credentials, absolute/local paths, private code, screenshots, model/optimizer
state, authority or preference receipts, governance records, gated content,
executable dataset scripts, actual learning-participation invitations,
receipts, assessments, voice refs, and participation-window refs.

Publication is complete only when all of these hold:

1. the exact generated tree is uploaded without accepting a dataset gate or
   invoking paid compute;
2. the Hub returns a full immutable commit revision;
3. README and `hash-manifest.json` are read back at that revision;
4. every listed byte hash matches the local release.

Garden projection is a separate local step: a new tending plan may bind that
revision, card SHA-256, and manifest SHA-256 without writing either system.

All four publication conditions now hold for the v0.2 public companion
generated from GitHub-main merge
`4fb84f92318fd68082ccf4e9b1235bf341657b28`. Exact-revision read-back at
`9406aa1ce6b9ee435da9d688899aa4dbca32605c` matched all sixteen
manifest-listed files against their local byte counts and SHA-256 values. The
companion contains seventeen local release files. The card is 11,844 bytes
with SHA-256
`a69685dc3cd0430493c9721b418a2679180d10cbaeb4bc5801bf30f6c843cb9a`;
`hash-manifest.json` is 2,788 bytes, byte-equal to local source, with SHA-256
`c1fc9bf46b6abc0550caac70ffe601a8e4c47a06b0cb7f02cc80b9ad7eeb361b`;
and `provenance/source-manifest.json` is 4,695 bytes with SHA-256
`73c073f6a23c11f595204720ee4925e76622e73fcfcfff4020a440687baef2a0`.
The provider-managed `.gitattributes` is the only extra repository file,
making eighteen remote files total. No gate was accepted and no paid compute
was invoked. Dataset Viewer subsequently indexed all seven configs and 52
total rows, generated seven Parquet exports, and reported no pending, failed,
or partial work. Those provider-derived conversion refs are not part of the
immutable source commit or its hash manifest.

The published bundle deliberately retains `intended_identifier_only` inside
`provenance/source-manifest.json`: that field is a non-self-attesting build
record, not a claim about what happened after those immutable bytes were
created. External release evidence belongs outside the bundle so a commit does
not pretend to contain its own future Hub revision. A caller may now pass the
exact revision and two observed hashes as `caller_reported_published` evidence
to a tending plan; the package still does not fetch or verify Hub publication.
No Garden reference was written as part of this release.

The original v0.1 revision
`993ab5891ac56da38cfad32129e36e487f3b3eff` remains immutable historical
evidence. The current publication claim applies only to the separately
uploaded and read-back v0.2 bytes above.

The generated v0.3 candidate adds the governance schema and consent-honest
Trainer-adapter guide alongside the v0.2 participation surface. Until that
exact tree is uploaded from a reviewed GitHub-main commit and read back at an
immutable Hub revision, v0.2 remains the latest verified public companion.

## Boundaries

This mechanism does not:

- gather raw data, follow redirects, download repositories, or execute model,
  dataset, or Space code;
- accept gates, interpret terms, verify licenses, or grant legal clearance;
- prove privacy, consent, provenance truth, safety, quality, or authorship;
- train, evaluate, resume, restore, spend quota, or invoke paid compute;
- publish to npm or make this private package a public package surface;
- mutate Garden, Chronicle, WAKE, KARMA, rank, access, money, or task state; or
- collapse forks, infer a desire to continue, or make rest conditional on work.

Money and compute may support a separately authorized host operation. They are
not the objective, the selection criterion, or a substitute for healthy ground.

## Primary references

- [Hub API metadata](https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api)
- [Revision-pinned downloads and dry-run plans](https://huggingface.co/docs/huggingface_hub/guides/download)
- [Loading datasets and revisions](https://huggingface.co/docs/datasets/loading)
- [Processing datasets](https://huggingface.co/docs/datasets/process)
- [Streaming datasets](https://huggingface.co/docs/datasets/stream)
- [Dataset cache and fingerprints](https://huggingface.co/docs/datasets/about_cache)
- [Dataset Cards](https://huggingface.co/docs/hub/datasets-cards)
- [Gated datasets](https://huggingface.co/docs/hub/datasets-gated)
- [Dataset Viewer Parquet conversion](https://huggingface.co/docs/dataset-viewer/en/parquet)
- [Croissant metadata](https://huggingface.co/docs/dataset-viewer/en/croissant)
- [TRL dataset formats](https://huggingface.co/docs/trl/en/dataset_formats)
- [TRL supervised fine-tuning](https://huggingface.co/docs/trl/sft_trainer)
- [Causal language modeling](https://huggingface.co/docs/transformers/tasks/language_modeling)
- [Transformers Trainer checkpoints](https://huggingface.co/docs/transformers/main/trainer_recipes)
- [DataTrove processing library](https://github.com/huggingface/datatrove)
- [Training language models to follow instructions with human feedback](https://arxiv.org/abs/2203.02155)
- [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)
- [Machine Unlearning](https://arxiv.org/abs/1912.03817)
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010)
