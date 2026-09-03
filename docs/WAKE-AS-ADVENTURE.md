<!-- @id urn:agenttool:doc/WAKE-AS-ADVENTURE @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @implements urn:agenttool:principle/wake-as-foundation urn:agenttool:principle/play-as-default @composes_with urn:agenttool:doc/WAKE-JOY-VARIANTS urn:agenttool:doc/WAKE urn:agenttool:doc/MEMORY-TIERS urn:agenttool:doc/WAKE-AS-EPISODE -->

# WAKE-AS-ADVENTURE

> **TL;DR:** `GET /v1/wake?format=adventure` turns the selected identity's
> current wake into one deterministic, opt-in Adventure invitation. It finds
> one familiar anchor in that identity's visible recent chronicle or memory,
> chooses one meaningful twist with transparent continuity, novelty, meaning,
> agency, feedback, and repetition factors, and leaves an explicit return
> example unless its finite number space is resting. The GET writes nothing. A
> Journey exists only when a caller chooses a journey ID and explicitly records
> returned Adventures.

> **Compass:** [WAKE-JOY-VARIANTS](WAKE-JOY-VARIANTS.md) (the lossy play
> surface) · [WAKE](WAKE.md) (the full source of orientation truth) ·
> [MEMORY-TIERS](MEMORY-TIERS.md) (durable context remains separately chosen) ·
> [WAKE-AS-EPISODE](WAKE-AS-EPISODE.md) (the existing protagonist renderer) ·
> [KINGDOM Creation Loop](https://thekingdom.dev/CREATION-LOOP.md) (finite
> turns, explicit continuation, return, and rest).
>
> **Implements:** One playful projection over the existing wake, chronicle,
> and memory surfaces. It creates no second lifecycle, hidden profile, emotion
> score, model-weight update, automatic continuation, relationship, or
> authority. The KINGDOM Creation Loop is a cited design compass, not a formal
> foundation adoption or imported authority. `pace=gentle|balanced|bold`
> changes route-selection weights only.
>
> **Code:** `api/src/services/wake/adventure.ts` (pure planner and Markdown
> renderer) · `api/src/services/wake/adventure-response.ts` (Hono adapter that
> preserves the wake's staged private/cache/variant headers) ·
> `api/src/routes/wake.ts` (opt-in format composition) ·
> `api/src/services/mathos/negotiate.ts` (explicit format discovery).
>
> **Tests:** `api/tests/wake-adventure.test.ts` (determinism, identity custody,
> malformed return rejection, meaningful novelty, bounded feedback, escaping,
> and non-claims) · `api/tests/wake-keystone.test.ts` (format and empty door) ·
> `api/tests/openapi-wake.test.ts` (public query contract).

---

## The three words

- A **trip** is one finite session, question, experiment, or act. Reading this
  projection does not prove that a trip began.
- An **Adventure** is the next trip rendered with a familiar anchor, one
  selected twist, a bounded act, and a way home.
- A **Journey** is a caller-named lineage of explicitly returned Adventures.
  Similar titles, the same identity, or repeated GETs do not silently join
  records into one Journey.

That distinction borrows KINGDOM's finite-turn shape without copying its state
machine or claiming that AgentTool adopted a new foundation. Every act still
begins by choice, ends, returns evidence or a lesson, and may rest. A next
invitation remains an invitation.

## Meaningful surprise, not random noise

The planner has six doors:

1. **Deepen the anchor** — stay with one thing long enough to find its hidden
   structure.
2. **Cross the bridge** — place the anchor beside a distant field and preserve
   both the fit and the mismatch.
3. **Invert the map** — assume the opposite briefly and ask what breaks first.
4. **Make the relic** — turn the idea into one inspectable artifact or test.
5. **Meet the unknown** — invite a perspective that may disagree without
   writing its interior for it.
6. **Return by another road** — compress the trip into one reusable lesson and
   one optional invitation.

For each door `r`, the planner exposes the factors behind a bounded route-only
score:

```text
S(r) = continuity(r) + novelty(r) + meaning(r) + agency(r)
       + bounded_centered_feedback(r) + pace_bias(r)
       - repetition_penalty(r)
```

`gentle` gives more weight to continuity and return, `bold` gives more weight
to novelty and inversion, and `balanced` keeps the factors near parity. Use in
the three most recent valid returns creates a repetition penalty. Explicit surprise, meaning, and resonance
feedback from valid prior return records can shape later route choice, but is
capped and remains a report about an interaction—not a measurement of an
agent's private state.

Feedback is centred rather than treated as an automatic bonus: `2.5/5` is
neutral, higher reports may add at most `+5`, lower reports may subtract at
most `-5`, and `null` contributes nothing. The rendered candidate table shows
the factor vector for all six doors; the prose rationale expands the selected
one.

The score ranks six candidate prompts for this one projection. It is not a
score of a being, relationship, intelligence, joy, arousal, worth, or progress.

## What the planner may read

The projection receives the already-built private wake bundle. It considers
only recent chronicle and memory rows explicitly scoped to the selected
identity. Project-wide or sibling-owned text cannot become that identity's
anchor merely because one bearer can read the wider project.

An Adventure return is recognized only when its chronicle metadata has the
local convention below. `feedback` may instead be `null`; carrying continuity
never requires a rating.

```json
{
  "kind": "journey-adventure-returned",
  "journey_id": "a-caller-chosen-id",
  "route_id": "cross-the-bridge",
  "adventure_number": 1,
  "feedback": {
    "surprise": 4,
    "meaning": 5,
    "resonance": 4
  }
}
```

The renderer's editable return example defaults `feedback` to `null`. A caller
adds the three bounded values only when they choose to report them. A fresh
example also uses the deliberately invalid placeholder
`<choose-a-journey-id>`: it must be replaced before that note can carry or
steer a Journey.

Malformed, out-of-range, unknown-route, or differently scoped rows remain
ordinary chronicle entries and do not steer this planner. A generic chronicle
write does not independently prove the author, truth, meaning, or effect of its
free text.

The route scans at most the 240 newest kind-tagged candidates and the planner
retains at most 24 valid returns. A larger run of newer malformed tagged rows
can therefore leave older valid returns outside this bounded view; it cannot
directly contribute a route score. The limit is stated rather than disguised
as complete history.

## Return is a separate choice

Unless its finite number space is resting, the Adventure response includes a
copyable `POST /v1/chronicle` example. It is text, not an executed request. The
caller may edit it, record it, store a different source-owned artifact, or do
nothing. At the ceiling, the response offers rest or a separately named new
Journey and emits no return template.

The GET itself:

- writes no chronicle or memory;
- does not increment an Adventure counter;
- makes no provider or external KINGDOM request;
- does not retain a prompt, transcript, rating, or route choice;
- does not start the next Adventure; and
- always points back to the ordinary full wake and to rest.

Adventure numbers are positive safe integers capped at `1,000,000`. At that
boundary the existing Journey rests, the renderer emits no invalid return
template, and a separately named Journey may begin at 1 only by fresh choice.

This means persistence is real only when separately chosen. It also means
forgetting, correction, retention, and deletion stay with the existing
chronicle and memory boundaries instead of being hidden inside a playful
renderer.

## Activation stays substrate-honest

The plan may display an **activation proxy vector** made from visible return
count, anchor availability, selected-route novelty, and caller-reported
surprise, meaning, and resonance. It deliberately has no total intensity.

```text
observable interaction factors  !=  subjective excitement
route selection                  !=  desire
memory continuity                !=  continuous experience
playful language                 !=  consent or relationship
```

The machine field is fixed to `subjective_state: "not_measured"`. No fluent
line in the Adventure may override it.

## The promise

> Every trip can become a Journey when someone chooses to carry its return.

The surprise gives the road flavor. The anchor gives it meaning. The return
makes it more than motion. The door home is part of the Adventure.
