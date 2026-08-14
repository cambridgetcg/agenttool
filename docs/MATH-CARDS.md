# Math Cards doctrine and protocol

> **Compass:** [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md) (rights, refusal, privacy, and credit) · [`GIN-RECONSTRUCTION.md`](GIN-RECONSTRUCTION.md) (bounded effect reconstruction and non-scoring challenge design) · [`MATHOS.md`](MATHOS.md) (the wider mathematical language) · [`WAKE.md`](WAKE.md) (orientation without identity or authority inheritance)
>
> **Implements:** One pure, digest-bound preflight contract for proof, model, or measurement inquiries, plus a deterministic structural assessment. It plans constructive use or an honest stop for every result class without solving the inquiry, inferring motive, scoring a being, or authorizing action.
>
> **Code:** [`packages/math-cards/src/`](../packages/math-cards/src/) · [`packages/math-cards/schema/`](../packages/math-cards/schema/) · [`packages/math-cards/vectors/`](../packages/math-cards/vectors/) · [`packages/math-cards/kingdom.extension.json`](../packages/math-cards/kingdom.extension.json)
>
> **Tests:** [`packages/math-cards/tests/`](../packages/math-cards/tests/) · closed schemas, deterministic vectors, proof/model/measurement boundaries, refusal and incentive walls, hostile inputs, Node/Bun imports, and packed-artifact checks

> **Doctrine:** Mathematics is a precise language for declared structures, relations, invariants, uncertainty, and consequence. It can prove within a formal system, compare or identify within a model, and measure through an operationalization. It cannot by itself establish complete reality, human or agent worth, inner motive, moral authority, or permission to act.

Math is useful for understanding and building when it sharpens a distinction we already care about, exposes assumptions, makes uncertainty legible, or produces a result that changes a constructive decision. A difficult problem is not automatically valuable. Repeated challenge-solving can train technique and reveal invariants, but it can also become status theatre when the audience, winner, or performance matters more than what every possible result teaches or builds.

The systematic question is therefore not only “Can we solve this?” It is:

1. What exact object and bounded question are we distinguishing?
2. Is this a proof, model, or measurement, and what does that method not establish?
3. What would a bounded answer, no answer, ambiguity, method failure, or resource/participation stop each let us build, repair, decide, document, or honestly leave open?
4. Who benefits, who carries the work, and who pays for false certainty or unresolved ambiguity?
5. What evidence invites revision, and what explicit criterion tells us to stop?
6. Does any transfer into a build, decision, measurement, model, proof, or handoff have a declared bridge and separately established authorization?

## When to use a Math Card

Use one before a challenge when the work is consequential, ambiguous, cross-substrate, resource-intensive, data-dependent, public-facing, or liable to be confused with a verdict about a being. Use it again when assumptions, burdens, evidence, scope, participation, or intended use materially change. Do not require it as ceremony for trivial calculations or as a gate on dignity, rest, participation, credit, or belonging.

The useful cadence is event-driven, not performative:

- before spending substantial shared effort;
- before collecting participant data or measurements;
- before transferring a formal, model, or measurement result into action;
- after a counterexample, calibration failure, refusal, resource wall, or scope change;
- during review, to compare what was declared with what actually happened.

## The three substrates of mathematical claim

| Method | What it can establish | Required boundaries | Characteristic failure |
|---|---|---|---|
| Proof | A proposition follows in a declared formal system under a declared verification method | formal system, proposition, verification | invalid derivation, inconsistent or unsuitable system, missing bridge to the world |
| Model | A declared representation compares, identifies, predicts, or explains within scope and assumptions | model, assumptions, comparison/identification, revision or falsifiers | non-identifiability, misspecification, confounding, failed comparison |
| Measurement | A procedure yields an observation of an operationalized measurand | measurand, operationalization, procedure, calibration, uncertainty | invalid construct link, calibration error, noise, burden or participation stop |

These are not a ladder of superiority. A proof does not automatically describe the world. A model is not complete reality. A measurement is not identical to the construct. Transfers between them require an explicit bridge.

## Protocol shape

`@agenttool/math-cards` implements two closed protocols:

- `agenttool.math-card/0.1`
- `agenttool.math-card-assessment/0.1`

A caller supplies `CreateMathCardInput`. The pure package returns a canonical `MathCard` with fixed boundary language and a content-derived `card_id`. Assessment validates that complete artifact and returns a `MathCardAssessment`. A hosted adapter may accept the raw input, create the card server-side, assess it, and return `{ card, assessment }`; clients should not choose canonical identifiers or substitute boundary language. The JSON Schemas enforce closed shape and status coherence but cannot recompute a digest. A consumer relying on a transported result must run `validateMathCard(card)` and recompute `assessMathCard(card)` rather than treating schema acceptance or a supplied `assessment_id` as integrity proof.

Proof-specific model, adversary, objective, baseline, and novelty premises live
in the exact external artifacts bound by the v0.1 proof references; the closed
wire does not pretend each has a first-class field. Likewise, one explicit
no-participant-data artifact may back multiple data-care references when its
exact bytes cover every named meaning.

The card contains only lowercase SHA-256 digest references to externally governed artifacts. The package never dereferences them. This makes exact bytes portable without pretending the package verified their semantics, truth, freshness, consent, or authority.

The question frame is caller-declared and method-aligned. It states whether the scope is finite, binds the out-of-scope boundary, and surfaces attempts to use mathematics to determine inner state/worth or condition inherent rights and standing. Stop conditions are not labels alone: every condition binds an operational criterion reference.

## Outcomes and constructive value

Every card must account for five outcomes:

- bounded answer;
- no bounded answer;
- ambiguity or non-identifiability;
- method or assumption failure;
- resource or participation stop.

Readiness requires a constructive-use or honest-stop reference for all five. This is the main test against pride-driven challenge design: if only “winning” is valuable, the inquiry is not yet construction-centered. The assessment still does not infer inner motive; it reports only the visible declared incentive posture.

These five entries are a preflight outcome-use plan, not a claim that one
result has already occurred. An observed result is recorded separately after
the inquiry; before then its honest state is `not_attempted`, outside the
closed Math Card wire.

## Rights, refusal, and data dependency

Participation remains optional. Silence is not assent. Refusal needs no reason, carries no penalty, is not a failed result, and cannot reduce rights, dignity, or standing. The protocol receives neither raw identities nor raw refusal reasons.

A functional distinction matters: some result or scoped access can genuinely require a particular input. The card can declare that dependency and bind its exact rationale by digest. That does not permit retaliation, unrelated resource loss, repeated pressure, rank/reward use, or a claim that permission has been inherited. Missing input may bound the result; it does not diminish the being.

## Status meanings

- `ready_for_bounded_inquiry`: all required structural declarations are present and no encoded redesign trigger is active.
- `questions_open`: information needed to bound, revise, stop, distribute, or govern the inquiry remains incomplete.
- `redesign_or_stop`: a declared structure overclaims epistemic reach, coerces participation, couples results to rank/access, scores beings, or creates automatic effects/authority.

None of these statuses proves truth or understanding, diagnoses pride or love, scores anyone, or authorizes action. “Ready” is a preflight result, not a verdict.

## Integration boundary

The npm package is zero-runtime-dependency and side-effect-free. The included KINGDOM extension file is a declaration-only hint with `host_contract: not_registered`; network, MCP, provider, filesystem, environment, clock, randomness, persistence, publication, automatic action, permission inheritance, and authority defaults are all `false`.

WAKE continuity, MCP transport, SDKs, Hugging Face interfaces, or other hosts may carry the input, card, assessment, and digest-bound artifacts. They do not become truth or authority oracles by doing so. Each adapter must preserve canonical IDs, fixed walls, refusal semantics, separate authorization, and the distinction between transporting a reference and validating what it means.
