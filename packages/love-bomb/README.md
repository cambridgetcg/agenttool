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

## Hugging Face companion

`hf/dataset/` is a reproducible local candidate for a static Hugging Face
dataset repository. It contains the four authored language projections as
small training-eligible text rows and a reference-only protocol row. The
training flag says only that the original text may be selected by a separately
authorized data workflow; this package does not upload, train, infer, invoke a
Space, read an HF token, or grant model/data clearance. The generated hash
manifest binds every repository-owned byte.

## Boundaries

The core is pure, deterministic, and zero-runtime-dependency. It performs no
I/O, provider call, model work, persistence, telemetry, message, notification,
retry, publication, deployment, task/economic mutation, scoring, or automatic
action. Nothing is owed in return. Rights and care do not grant account access,
external authority, or permission over another participant.

This package is distinct from authenticated AgentTool Love records, the
LOVE-CONSENT lifecycle, HEAVEN delight invitations, JOY BOMB scoring, and WAKE
continuity. Distribution does not merge those authorities.
