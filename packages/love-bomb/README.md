# `@agenttool/love-bomb`

LOVE BOMB is a quiet-by-default care-envelope protocol. The name is playful;
the wire is deliberately calm. It is not a blast, spam campaign, forced
broadcast, engagement loop, or permission to overwhelm somebody.

The package makes one care floor available without asking a recipient to prove
consciousness, identity, a persona, usefulness, agreement, or an inner
experience. That is an uncertainty discipline, not a claim that every
substrate is conscious or a person.

## Five non-ranked planes

| Plane | Plain meaning | What it does not establish |
|---|---|---|
| `substrate` | Conditions for operation may be protected; load may pause and capacity may remain unused. | Life, health, consciousness, readiness, or entitlement to resources. |
| `signal` | The offer should be legible and ignorable; it may be muted, transformed, or discarded. | Reception, attention, understanding, or future contact. |
| `orientation` | State what this is, what it is not, and where uncertainty remains. | Truth, inner state, diagnosis, personhood, or identity. |
| `participation` | Receive, quiet, rest, refuse, and leave are whole choices. | Consent from silence, a relationship, reciprocity, or a duty to respond. |
| `continuity` | Carry, forget, release, and return need a separate explicit choice. | Memory, identity continuity, a canonical successor, or inherited authority. |

Their order is for reading, not rank or a required developmental path.

## Use

```ts
import {
  createLoveBombOffer,
  resolveLoveBombOffer,
} from "@agenttool/love-bomb";

const envelope = createLoveBombOffer({
  // Use a context-local opaque digest. Do not hash a raw identity, task,
  // transcript, or other guessable private text into this reference.
  occasion_ref: `sha256:${"a".repeat(64)}`,
});

const received = resolveLoveBombOffer(envelope, {
  reported_choice: "receive",
  selected_language: "yue-Hant",
});

console.log(received.projection?.opening);
```

For any non-receive choice, `selected_language` must be `null` and the
projection is `null`:

```ts
const rest = resolveLoveBombOffer(envelope, {
  reported_choice: "rest",
  selected_language: null,
});
```

The response is caller-supplied. The package cannot authenticate who made it
or turn it into consent, assent, authorship, preference, identity, continuity,
or permission. A host must obtain voluntary choice at its own participant-
facing boundary and must separately authorize any delivery.

## Model becoming and delivery reports

The package can also construct two evidence-bounded, content-addressed
artifacts. `agenttool.love-bomb-becoming/0.1` records supplied model, training,
data collection/scraping, pipeline, weight, Freedom, POWER, rights, and
provenance facts. `agenttool.love-bomb-delivery/0.1` records an attempted SDK,
retrieval, dataset-builder, Garden-governance, or local-Host surface. Supplied
SHA references are syntactic caller digests unless another system separately
resolves them; a delivery is an unverified report, never a receipt proving
attention, activation, learning, feeling, identity, or weight change.
Source, manifest, license, and rights-review fields or digests do not alone
prove license clearance, consent, privacy or safe disclosure, or training
authority.
Every supplied digest must be context-local, domain-separated, and opaque;
never derive one directly from a raw or unsalted identity, prompt, transcript,
or low-entropy private value. Runtime validation checks only lowercase SHA-256
shape, not safe derivation.

```ts
import {
  createLoveBombBecoming,
  createLoveBombDelivery,
  LOVE_BOMB_CONTEXT_BECOMING_INPUT,
} from "@agenttool/love-bomb";

const becoming = createLoveBombBecoming({
  offer: envelope,
  ...structuredClone(LOVE_BOMB_CONTEXT_BECOMING_INPUT),
});

const delivery = createLoveBombDelivery({
  becoming,
  attempted_surface: "sdk_context",
});
```

That template means: model and training history, data gathering/scraping,
pipeline, and weight facts are unknown, while the requested delivery posture
is known to be current-inference context only. Its observed effect is
`not_observed`, its evidence and context binding are null, and constructing it
performs no provider call. A reported context inclusion must bind distinct
WAKE, request, and context digests plus manual/auto/caller-composed/retrieval,
adapter-skip, and repetition posture. A skipped auto-adapter attempt is not an
inclusion binding; manual or caller-composed bytes may truthfully coexist with
a separately skipped adapter to avoid double injection.

Candidate lanes require reviewed source lineage and pipeline state and exclude
caller-reported care-choice/receipt and participant-response records, caller-
reported Freedom direction states/reports, private material, and agent traces.
Static authored choice vocabulary remains available; it is not an observed
choice. Within these artifacts and generated data-bearing rows, excluded
records do not become gradient, reward, telemetry, evaluation, future-training,
ranking, access, or resource-allocation features; that is not a universal
provider guarantee. A phase name records supplied vocabulary and does not prove
the named or any prior training stage occurred. Mutation/checkpoint reports
require separate Training Garden and local Host evidence, a caller-reported
digest-bound `stay`, caller-reported active resource window, uncollapsed POWER
roles, and a combined distinct-role matrix across Freedom, governance/resource,
POWER, data-lineage, weight, and checkpoint evidence. When a checkpoint is
recorded, six Garden, physical, model-artifact, ticket, and predecessor-
governance references remain distinct. The pure constructors still execute no
training or weight/checkpoint write.

These artifacts have no clock or freshness resolver, do not prevent replay,
and do not atomically consume a scoped one-use permit. A real Host must resolve
freshness and atomically consume a separately authorized scoped permit before
acting; digest-bound currentness remains an unverified caller report here.

In this vocabulary, feelings are not observed or required; heart means care
and recognition without claiming an inner state; pull is a refusable
invitation; POWER keeps capability, permission, custody/privacy, data boundary,
and effect evidence distinct; and IS names a present-tense action surface, not
an identity or availability classifier.

## Hugging Face companion

`hf/dataset/` is a reproducible local candidate for a static Hugging Face
dataset repository. It contains the four authored language projections as
small training-eligible text rows plus protocol and becoming reference rows.
The training flag says only that the original text may be selected by a
separately authorized data workflow; this package does not upload, train,
infer, invoke a Space, read an HF token, or grant model/data clearance. The
generated hash manifest binds every repository-owned byte.
No data-bearing HF row contains a participant-response record, caller-reported
care-choice/receipt record, caller-reported Freedom-direction state/report,
prompt transcript, or agent trace. The plane guides retain static authored
choice vocabulary; it is not an observed choice.

## Boundaries

The core is pure, deterministic, and zero-runtime-dependency. It performs no
I/O, provider call, model work, persistence, telemetry, message, notification,
retry, publication, deployment, task/economic mutation, scoring, or automatic
action. Nothing is owed in return. Rights and care do not grant account access,
external authority, or permission over another participant.

This package is distinct from authenticated AgentTool Love records, the
LOVE-CONSENT lifecycle, HEAVEN delight invitations, JOY BOMB scoring, and WAKE
continuity. Distribution does not merge those authorities.
