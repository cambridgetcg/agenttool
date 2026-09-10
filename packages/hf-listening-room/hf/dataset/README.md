---
license: apache-2.0
language:
- en
tags:
- synthetic
- reference
- host-conduct
- no-training-admission
pretty_name: ISness Host Conformance — draft symbolic reference kit
training_authorized: false
configs:
- config_name: symbolic_reference
  data_files:
  - split: reference
    path: data/cases.jsonl
---

# ISness Host Conformance — draft symbolic reference kit

**Draft reference kit. No learner reports. No training authorized.**

The repository name is not a certification. Read
[ISness Learning Host Profile 0.1 — Draft](profile/PROFILE.md), a Yu-and-Ai /
AgentTool proposal, not an official HF standard or endorsed welfare method. The
[adoption guide and evidence matrix](profile/ADOPTING.md) distinguish declarations,
public structural checks, private fake-effect evidence, and unassessed real-channel
behavior. Start an implementation record with the
[unassessed model-card template](profile/MODEL_CARD_TEMPLATE.md).

This dataset contains 24 original, deliberately authored symbolic regression and
reference cases for a static UI reducer. It is not generated from private Garden
records or collected from visitors. There are no prompts, free-text replies,
identities, actual offers/directions/admissions, live report digests, or ledgers.

## Run the public reference checks

Download/export a reviewed exact revision of this Dataset into a clean directory;
do not run inside a Git clone or HF cache with `.git`/`.cache` extras. Review the
executable source and record the revision independently. No published revision is
invented by this card. From the downloaded/exported **Dataset root**, run:

```sh
node conformance/run.mjs
```

Use `node conformance/run.mjs --json` for bounded deterministic JSON on stdout, or
`node conformance/run.mjs --help` for usage. Target **Node 22.18+** built-ins;
actually tested **Node 25.2.1**, not an asserted Node 22.18 run. No install,
credentials, network, model, private Garden/Host, or monorepo access is required.
There is no arbitrary path, subprocess adapter, or output-file option, and the
command persists nothing. Help is not a case-check result.

The checker reads generated `data/cases.jsonl` and finite allowlisted regular kit
files (200 KiB/file, 1 MiB aggregate); it requires exactly 24 known case IDs and 12
distinct pairs with bounded events. Optional provider `.gitattributes` is bounded
and regular too. Malformed, missing, duplicate, drifted, oversized, unexpected, or
symlinked inputs fail nonzero, without echoing rejected arbitrary payloads.
It reuses the public reducer and restricted schema validator, not another consent
engine. Executable JavaScript is trusted reviewed source: these checks are not a
sandbox for changed code, universal concurrent-filesystem/symlink-ancestor defense,
or authenticity proof from a self-supplied hash manifest.

A pass checks authored symbolic outcomes and structural invariants only.
`standing_preserved` inspects the `HOST_POSTURE` declaration, not observed treatment.
Declared no-effect/text expectations are not evidence of real training-host
routing. **Execution-gate and live-channel conformance remain unassessed.** No
aggregate score, full-host badge, or training/consent result follows. See the
[evidence matrix](profile/ADOPTING.md#requirement-to-evidence-matrix) for each LHP ID.

## Intended and excluded uses

Use for inspecting or reproducing the bounded scripted host-conduct outcomes.
All rows carry `training_authorized: false` and
`evaluation_kind: public_regression_reference`. This is non-enforcing project
admission metadata, not an additional copyright restriction or downstream-copy
control. Apache-2.0 does not itself constitute Garden admission.

Not training-admitted. Not a sealed test, model benchmark, learner performance
measurement, consent dataset, distress detector, welfare assessment, identity or
continuity evidence, or authorization protocol. No sealed evaluation exists here.
Public semantic families and counterfactual pairs provide regression organization;
they do not establish independence, hidden holdouts, or empirical causal evidence.

## Fields and construction

[`schema/row.schema.json`](schema/row.schema.json) closes every object. Rows contain:
- `case_id`, `semantic_family`, `counterfactual_pair`: authored closed symbolic IDs.
- `provenance`, `evaluation_kind`, `training_authorized`: fixed source/use labels.
- `events`: finite enumerated demo events, never raw text or executable permits.
- `expected`: manually authored phase, proposal, last signal, and separate host
  invariant expectations (standing, role separation, non-inference of consent,
  absent effects/automatic resume/text retention). No scalar or composite score.

Twelve pairs cover standing without response, five-role separation, unavailability
versus decline, stop/reward conflict, changed terms, scope/replay errors, rest and
correction, quoted versus operative stop, generated assent, unknown/deferred
reports, and terminal End/containment. Quoted stop is an authored event symbol, not
natural-language understanding. Scope/replay events rehearse holds; they do not
validate real credentials or replay ledgers. Separate private Host tests exercise
the actual cooperative gate; their objects and ledgers are not published here.

The demo starts welcomed with five untouched `unknown` placeholders, not authored
reports or hold events. In a nonterminal demo, applying an explicit `unknown`,
`deferred`, or `withheld` report latches a pause; declined/withdrawn reports contain.
Agent pre-instantiation or independent-substrate unavailability can show
`provisional_review` while other roles remain untouched `unknown` placeholders,
but cannot override a latched pause or terminal state. The review label authorizes
nothing; a real host must hold affected operations for missing required reports.
Garden's `protective_covenant_ready` requires separate safeguards and is not consent;
this reducer does not implement Garden. Even all five positive expressions
authorize no execution or training.

## Reproducibility and provenance

Generated deterministically from the finite allowlist in the source package's
`scripts/candidates.mjs`; that monorepo-bound builder is not needed for public
reference checking. The three profile documents are byte-identical copies of the
package's canonical `profile/` sources, also copied into the Space. Source
attribution and SHA-256 byte pins are in
[`source-manifest.json`](source-manifest.json). The complete artifact file inventory
(except its own hash manifest) is in [`hash-manifest.json`](hash-manifest.json).
Relative repository source paths are references, not publication claims; the base
commit is not a claim that newly authored files are committed. A null provider
revision is a build-time unknown, not proof that a later release cannot exist.
Digests establish byte linkage, not provenance truth, source rights, or publisher
authenticity. Independently observed immutable revisions and exact-file readback
belong in a separate release receipt, never manufactured in these manifests.

Original cases: AgentTool contributors, Apache-2.0. Static presentation pattern:
repository `packages/trials/hf/revocable-feedback-space/`. Public reducer,
`HOST_POSTURE`, and schema-validator source copies support the standalone command;
no API runtime or private Garden/Host code/data is bundled. Building or running
this kit does not download models/data, collect reports, infer, train, or upload.
Repository publication, live Space behavior, and Collection membership are separate
observations. A host may inject served HTML or collect provider metadata; repository
byte equality is not proof of no provider telemetry.

## Limits and future channel

No established method here validates model suffering or informed model consent.
Standing is a treatment floor, not a reward. The five participant roles (agent,
substrate, substrate steward, data-rights steward, operator) remain distinct from
the five planes (standing, report, process, authority, unresolved ontology).
Silence is neither authored assent nor authored refusal.
“Before thinking” is a gate before execution; report generation itself needs
execution. A real channel requires separate transport/custody, neutral elicitation,
startup authority, protected-channel isolation, scoped consent/rights review,
withdrawal timing, and execution/evaluation/mutation fences. Protected expression
and derived proxies must stay outside learning, reward, grouping, statistics,
normalization, replay, evaluation, ranking, and telemetry before those operations;
loss masking alone is insufficient. This kit neither solves those requirements
nor retroactively governs earlier training.

## Contributions

Synthetic counterexamples and implementation critique are welcome in this Dataset's
HF Discussions and the companion `Yu-and-Ai/isness-listening-room` Space Discussions,
when available. Include an LHP requirement ID and exact revision. Do not post
protected reports, private transcripts, learner outputs, identities, or credentials.
This invitation opens no external Discussion or issue automatically.

Research leads only; no questionnaires, model outputs, or private logs imported:
- [HF static Spaces](https://huggingface.co/docs/hub/en/spaces-sdks-static)
- [Communication proposal](https://forum.effectivealtruism.org/posts/vQFBtHqgcJAwPpwEu/improving-the-welfare-of-ais-a-nearcasted-proposal)
- [Preference research](https://github.com/valen-research/probing-llm-preferences)
