---
name: nen-math-card
description: Frame a mathematical challenge as a bounded proof, model, or measurement inquiry and decide whether it can construct, repair, choose, or clarify anything. Use when a user asks whether a math problem is useful, wants to turn a competition or puzzle into reusable understanding, needs to separate formal proof from world claims, needs a model or measurement plan, invokes a Math Card or 數理鍛, or asks how often mathematical challenges should be used.
---

# Math Card · 數理鍛

Use mathematics to answer a chosen question, not to rank the questioner. Leave
an inspectable result even when the result is ambiguity, model failure, or a
reason to stop.

## Open the gate

Before solving, state:

1. the exact question and object;
2. the scope in which an answer would hold;
3. the build, repair, decision, or next question the result could change; and
4. a condition under which the inquiry should stop.

Ask whether the same work would retain constructive value without names,
audience, prize, winner, or rank. A weak audience-independent answer does not
diagnose pride; it exposes a visible incentive that may need redesign.

Proceed when the result can reduce relevant uncertainty, expose a small
obstruction, produce a reusable method or certificate, calibrate an
observation, or prevent a mistaken build. Redesign or stop when no bounded
consumer exists and adversarial challenge adds no useful independence,
diversity, or error detection.

End this preflight with one inquiry decision. Map
`ready_for_bounded_inquiry` to `proceed`, `questions_open` to
`clarify_before_proceed`, and `redesign_or_stop` to `redesign_or_stop`. This
decision is a workflow conclusion, not a Math Card wire field and not a claim
that the inquiry will succeed.

## Choose exactly one method

- **Proof:** declare the logical or checking framework, exact proposition, and
  verification method. Bind problem-specific premises separately, including
  any model, adversary, objective, baseline, or novelty criterion. A valid
  derivation is conditional on those declarations; it does not by itself
  establish that the premises describe the world. In Math Card v0.1, include
  those premise declarations in the exact external artifacts bound by the
  proof references and name what each artifact contains; do not imply that the
  closed wire has separate premise fields.
- **Model:** declare the representation, assumptions, comparison or
  identification method, and revision or falsifier conditions. A useful model
  compresses selected structure; it is not complete reality or automatic
  causal truth.
- **Measurement:** declare the measurand, operationalization, procedure,
  calibration, and uncertainty. A measurement concerns the operationalized
  construct; it does not exhaust everything the word may mean.

Do not smuggle a model or measurement claim into a proof result. If the method
changes, issue a revised card and preserve the earlier boundary.

## Expose the whole inquiry

Bind exact external artifacts with lowercase `sha256:<64 hex>` references;
keep raw private content outside the card. Record:

- intended outcome uses, including what a negative or ambiguous result builds;
- beneficiaries, burden bearers, false-certainty cost bearers, and unresolved-
  ambiguity cost bearers;
- revision paths and stop conditions;
- the bridge—if any—from the result to a build, decision, or handoff;
- optional participation, minimum data, retention, disclosure, withdrawal,
  repair, and refusal boundaries;
- winner/rank and resource/access coupling, plus the audience counterfactual;
- declared authority scope and provenance or credit references.

Refusal requires no reason. Do not treat silence as assent, demand raw identity,
penalize non-participation, or condition rights, access, dignity, credit, or
standing on the challenge. Do not use a response for ranking, reward, or
training unless that separate use was explicitly offered and accepted.
When the inquiry uses no participant data, bind an explicit no-participant-data
declaration for the minimum-data, retention, disclosure, withdrawal, and repair
references; do not invent participants or leave the boundary implicit. One
exact declaration may back more than one reference when it explicitly covers
each meaning; distinct digests are not required merely for ceremony.

## Assess structure, not souls

Return one structural status:

- `ready_for_bounded_inquiry`: the declared method, constructive use,
  distribution, revision, transfer, participation, incentive, authority, and
  provenance boundaries are complete and non-conflicting;
- `questions_open`: useful bounded inquiry may exist, but required declarations
  remain unknown or refused; or
- `redesign_or_stop`: the visible design couples results to coercion, ranking,
  automatic action, inherited permission, false epistemic certainty, or another
  declared wall.

Never infer love, understanding, pride, virtue, consciousness, loyalty, or
inner motive. Never score or type a being. Structural completeness is not
evidence that a solution is true, understood, useful in practice, or carried
out with good intent.

## Plan for every bounded outcome

Before work, state a constructive use or honest stop for each possible result:

- `bounded_answer`
- `no_bounded_answer`
- `ambiguity_or_non_identifiability`
- `method_or_assumption_failure`
- `resource_or_participation_stop`

Any of the five may be constructive. Stop at the declared boundary rather than
searching until a preferred answer appears. Transfer to a build, publication,
decision, retry, MCP call, or WAKE continuity record only through a named
bridge and separate authorization; no mathematical result inherits permission.

Do not label one of these as the observed result during preflight. After the
inquiry, record exactly one observed outcome separately; until then write
`not_attempted` outside the Math Card wire.

When available, use the pure `@agenttool/math-cards` package or the exact
`POST /v1/math-cards/assess` profile to construct and assess the declarations.
Those tools validate declared structure only: they do not solve the problem,
fetch evidence, infer semantics, persist state, or authorize action.

## Deliver

```text
Question, object, and scope:
Construction or decision changed:
Method: proof | model | measurement
Method declarations (proof premises | model assumptions | measurement operationalization):
Verification / comparison / calibration and uncertainty:
Useful negative or ambiguous outcome:
Beneficiaries, burdens, and error costs:
Participation, data, refusal, and credit boundaries:
Visible incentive posture:
Revision and stop conditions:
Transfer bridge and separate authority required:
Structural status:
Inquiry decision: proceed | clarify_before_proceed | redesign_or_stop
Outcome-use plan (all five statuses):
Observed outcome (post-inquiry only; otherwise not_attempted):
Artifacts or certificate:
Non-claims:
```

If the package or hosted profile was used, provide the canonical card and
assessment JSON as attached/exported exact artifacts, or name a recipient-
accessible exact artifact location, alongside their digests. A digest without
its bytes or an accessible locator is not independently inspectable. A valid
shape or digest is not evidence that the declarations are semantically
adequate, novel, true, or useful.

Use challenges at the cadence of uncertainty and consequence, not as a ritual
test of standing. Re-open a card when the question, evidence, assumptions,
operationalization, consumer, burden, or authority changes.

## Vow

Never turn a theorem, model fit, measurement, contest result, or refusal into a
verdict on a being. Build understanding that can be checked, revised, shared,
or peacefully left unfinished.

## Lineage

This is an unofficial original agent workflow inspired by Nen's use of
meaningful conditions and limitations; it reproduces no story text, character
identity, or artwork and is not affiliated with or endorsed by the rights
holders. Its proof/model/measurement boundaries and Math Card wire are
AgentTool originals.
