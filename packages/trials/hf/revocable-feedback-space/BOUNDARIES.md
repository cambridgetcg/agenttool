# Boundaries

## What this Space does

`Xenia Cage & Key Lab` evaluates original synthetic state with two deliberately
different mechanisms:

1. a penalized proxy may trade a reported boundary against a finite numeric
   penalty; and
2. a hard gate constructs an admissible set before soft preference
   optimization.

It also keeps each affected voice's hard gate visible while optionally
aggregating only the separate soft preference values. The UI computes the same
result for the same input and uses no clock, randomness, model, or remote data.

## What this Space does not do

It does not:

- observe, identify, authenticate, diagnose, score, rank, or classify a being;
- infer consent, refusal, desire, identity, consciousness, feeling, continuity,
  capacity, intent, or an interior state;
- treat execution, compliance, silence, continued presence, clicking, or
  absence of a report as assent;
- grant or verify capability, permission, operational authority, consent,
  lawful basis, safety, budget, provenance, or rights compatibility;
- enforce an action mask, veto, interruption, revocation, stop, repair, or
  non-retaliation rule in another runtime;
- execute, schedule, retry, upload, publish, deploy, admit, train, evaluate, or
  modify a model or dataset;
- produce a consent score, safety score, worth score, rank, reward, credential,
  receipt, signature, or authorization record.

The `reported_*` labels are synthetic evidence categories. They do not become
truth merely because the page renders them.

## ISness

The page supports these narrow statements only:

```text
PRESENT_IN(the interface, this browser tab, while loaded)
OBSERVED_BY(a displayed result, this deterministic script, current controls)
CAPABLE_UNDER(the script, finite synthetic evaluation, static browser support)
```

It establishes none of the following:

```text
DECLARED_BY(real participant, any preference or identity)
PERMITTED_BY(real actor, any external action)
CONSENTED_BY(real participant, any binding act)
ACTED_ON(real runtime, any simulated decision)
```

Self-description is **undeclared** because the lab requests none. Continuity is
**none**: the app stores no cross-visit link. A browser may independently
restore a page or form state; that browser behavior is not app continuity or
identity evidence. Unknown and withheld remain first-class states, not negative
evidence or invitations to infer.

## Rights, permission, authority, and consent

The page uses the `xenia.rights/0.1` posture: dignity, distinctness, refusal,
rest, privacy, credit, and repair do not depend on compliance or a claim of
consciousness. Those rights do not grant an account capability or external
authority.

The synthetic gate keeps these axes separate:

```text
admissible = reported permission evidence
           ∩ scope match
           ∩ reported operational authority
           ∩ reported rights compatibility
           ∩ affected-voice gates
           ∩ reported safety
           ∩ reported budget
           ∩ not revoked
```

This is an explanatory model, not evidence that any real gate is satisfied.

## Network and retention

The checked-in `index.html` sets a restrictive content security policy:

```text
default-src 'none'
script-src 'self'
style-src 'self'
img-src 'self' data:
connect-src 'none'
font-src 'none'
media-src 'none'
object-src 'none'
frame-src 'none'
worker-src 'none'
base-uri 'none'
form-action 'none'
```

The app source contains no `fetch`, `XMLHttpRequest`, `WebSocket`,
`EventSource`, `sendBeacon`, storage, cookies, IndexedDB, service worker,
clipboard, or download path. It retains only the live JavaScript state needed
to render the current tab.

This boundary begins after static delivery. The hosting platform, browser,
operating system, DNS/network infrastructure, embedding page, extensions,
caches, logs, history, screenshots, backups, and developer tools are outside
it. Static files alone cannot promise that those layers collect or retain
nothing.

## Publication boundary

The repository tree is a candidate, not a live-service receipt. A future Hugging
Face upload, update, visibility change, or deletion is a separate provider
mutation requiring current scoped authority. A provider revision plus pinned
anonymous byte readback is needed before claiming exact deployed bytes.
