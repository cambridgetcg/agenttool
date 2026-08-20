# `@agenttool/wake-continuity`

AFTERGLOW is a small, pure reference capsule for the moment one workflow fades
and another encounter begins. It binds an exact digest of a caller-retained
`wake-brief/v1`, optional continuity-portfolio bytes, causal predecessor
capsules, and a bounded set of crossover references. A next-WAKE lens then
shows what was explicitly carried or parked without inventing memory.

It does not fetch WAKE, persist a Handoff, resume a task, run a model, enter a
HEAVEN room, accept a KINGDOM proposal, update KARMA, or prove that the reader
is the same participant. Every arrival remains a fresh encounter; a capsule is
caller-carried context, not subjective continuity.

## Shape

```text
digest(wake-brief/v1) + opaque scope + mutation cursor label
optional digest(caller-retained continuity-portfolio response)
0..8 causal predecessor capsules (no winner/head)
0..64 closed reference threads
              │
              ▼
       AFTERGLOW capsule ── deterministic SHA-256 content ID
              │
              ├─ next-WAKE lens: carry / park / closed counts
              └─ optional Handoff fact reference (never an automatic POST)
```

Any authentication belongs to the source host; AFTERGLOW does not reverify
the portfolio response or its digest referent.

Threads contain no prose. Both their opaque local identifier (`thread_ref`)
and artifact are SHA-256 references. Do not derive a thread reference directly
from an identity, task, DID, chat, or other guessable private value. The closed
crossover kinds keep their own walls:

Digest shape keeps raw identity/task prose out of this wire format; hashing
does not anonymize a private value, prove that a caller minimized it, or remove
linkability. Those limits are fixed as `carries_raw_identity: false`,
`verifies_reference_minimization: false`, and
`eliminates_linkability: false`—not as a claim that every referent is safe.

| Kind             | Admitted state                                        | What it does not mean                                         |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `heaven`         | offered or caller-reported deferred/declined/accepted | No room opens; no consent or choice authorship is proven.     |
| `deepseek`       | `proposed_unaccepted`                                 | No model, framework, or KINGDOM extension is accepted or run. |
| `karma`          | `receipt_only`                                        | No score, rank, reward, or access effect.                     |
| `dark_continent` | `not_checked` or `hold`                               | No wall is verified; it cannot project as ready work.         |
| `kingdom`        | proposed, review-required, or hold                    | No registry write, Crown state, or authority.                 |
| `artbitrage`     | review-required or hold                               | No trade, valuation, execution, or recommendation.            |
| `external`       | context-only, review-required, or hold                | No interpretation or execution of the referent.               |

## Create a capsule

```ts
import {
  createAfterglowCapsule,
  projectAfterglowLens,
  sha256Id,
} from "@agenttool/wake-continuity";

// Hash exact retained bytes locally. Do not derive public or reusable refs
// directly from an identity, raw chat, task text, memory, or credential.
const capsule = createAfterglowCapsule({
  phase: "between_tasks",
  wake: {
    format: "wake-brief/v1",
    snapshot_ref: sha256Id("exact retained wake-brief bytes"),
    scope_ref: sha256Id("high-entropy local scope token"),
    wake_version: 42,
    handoff_projection: "complete",
  },
  continuity_portfolio_ref: null,
  predecessors: [],
  threads: [
    {
      thread_ref: sha256Id("high-entropy local thread token 1"),
      kind: "deepseek",
      artifact_ref: sha256Id("exact reviewed proposal bytes"),
      disposition: "park",
      state: "proposed_unaccepted",
      assertion: "caller_asserted",
      verified_by_package: false,
    },
    {
      thread_ref: sha256Id("high-entropy local thread token 2"),
      kind: "heaven",
      artifact_ref: sha256Id("opaque HEAVEN invitation bytes"),
      disposition: "carry",
      state: "offered",
      assertion: "caller_asserted",
      verified_by_package: false,
    },
  ],
});

const lens = projectAfterglowLens(capsule);
lens.arrival; // "fresh_encounter"
lens.carry[0]?.thread_ref; // digest only
lens.heaven.automatic_entry; // false
```

Input order is normalized; output threads and predecessor links are sorted,
deep-frozen, and content-addressed. A changed cursor, digest, disposition,
thread state, predecessor, phase, or fixed boundary changes the capsule ID.

## Record functional-access attempts around WAKE

The functional-access pair is a deterministic, record-only envelope for an
external executor's proposed instrument operation and caller-supplied result
references. The package itself does not call a model or provider, read model
internals, run a lens or decomposition, resolve an evidence reference, or
perform a workspace operation.

```ts
import {
  createFunctionalAccessBaseline,
  createFunctionalAccessSubsequent,
  sha256Id,
} from "@agenttool/wake-continuity";

const ref = (label: string) => sha256Id(label);
const baseline = createFunctionalAccessBaseline({
  wake: capsule.wake,
  anchor_event_ref: ref("exact caller-retained anchor event bytes"),
  request_ref: ref("exact caller-retained request bytes"),
  target: {
    model_ref: ref("exact checkpoint descriptor bytes"),
    model_binding: "exact_checkpoint",
    tokenizer_ref: ref("exact tokenizer descriptor bytes"),
    runtime_ref: ref("exact runtime descriptor bytes"),
  },
  measurement_plan: {
    state: "planned",
    capability_state: "available_reported",
    capability_ref: ref("caller-retained capability report"),
    permission_state: "granted_reported",
    permission_ref: ref("caller-retained scoped permission report"),
    method: "jacobian_lens_visibility",
    access_basis: "local_prefitted_white_box",
    unavailable_reason: null,
    instrument_ref: ref("instrument implementation descriptor"),
    lens_ref: ref("prefitted lens descriptor"),
    configuration_ref: ref("closed measurement configuration"),
    assertion: "caller_asserted",
    verified_by_package: false,
  },
});

const subsequent = createFunctionalAccessSubsequent({
  baseline,
  operation_outcome: "completed",
  evidence: [
    {
      surface: "instrument_operation_receipt",
      artifact_ref: ref("external executor receipt"),
      assertion: "caller_asserted",
      verified_by_package: false,
    },
    {
      surface: "jacobian_lens_readout",
      artifact_ref: ref("bounded fitted-lens readout"),
      assertion: "caller_asserted",
      verified_by_package: false,
    },
  ],
  findings: {
    lens_visibility: "hit_observed",
    sparse_support: "not_measured",
    behavioral_use: "not_measured",
  },
  afterglow_capsule_ref: null,
});
```

`record_role` is fixed to `before_anchor` on the baseline and `after_anchor`
on the subsequent record. These are caller-asserted structural roles relative
to the exact named anchor; they do not verify clock time, ordering, causality,
currentness, or that an observation occurred.

Capability and permission are distinct reports. A `planned` record requires
content references for both, but those fields do not grant either one. The
actual executor must independently check current, scoped authority before any
instrument or model operation. `instrument_ref` identifies an implementation
or provider endpoint. `lens_ref` identifies a prefitted lens and is non-null
exactly for `local_prefitted_white_box`; `local_fitted_white_box` fits within
the external operation, while `provider_supplied_instrumented` relies on a
provider-defined instrument surface. Both local white-box bases require an
exact checkpoint, tokenizer, and runtime binding. A hosted text-only or other
black-box provider can be recorded as `unavailable`; this library does not
turn that surface into white-box access.

The artifact named by `configuration_ref` is outside this package, which does
not fetch or verify it. For meaningful comparisons, the caller must make that
content-addressed artifact bind the target token IDs and/or directions,
evaluated positions and layers, rank, score threshold, and aggregation. A
J-space sparse-decomposition configuration must additionally bind `k`, solver,
regularization, and coefficient threshold. `hit_observed` and
`no_hit_under_config` mean only that the configured target crossed, or did not
cross, those configured criteria in the referenced result. `sparse_support`
means target support in that configured rank-k decomposition; it does not mean
that an entire activation "belongs" to a J-space.

`jacobian_lens_visibility` is a fitted-lens readout contract. It is not a
prompt-local Jacobian, JVP, or VJP claim. `jspace_sparse_decomposition` uses a
separate result surface. A partial operation may have only an instrument
receipt or may include its method-specific result/finding pair; a completed
operation requires that pair. Completion and hit/no-hit/inconclusive are
orthogonal. Behavioral use is never measured by this format.

Provider response, usage, request-context, checkpoint, behavioral-response,
and workspace-operation receipts remain independent caller assertions. In
particular, a workspace receipt neither proves an instrument ran nor changes
measurement coherence. No finding proves consciousness or its absence,
feeling, attention, activation, understanding, delivery, identity, consent,
preference, freedom, training/data/scraping/pipeline provenance, weight
change, memory, or continuity. Raw prompts, responses, activations, gradients,
JVPs, and VJPs are excluded from the wire shape; digest references can still
be linkable and are not anonymous merely because they are hashes.

## Return, fork, and rewind

Pass zero to eight validated prior capsules. AFTERGLOW records a relation to
each causal reference:

- `same`: scope, snapshot digest, and cursor label match.
- `advanced`: scope matches and the new cursor is greater.
- `fork_or_rewind`: scope matches but the cursor is lower, or the same cursor
  names different snapshot bytes.
- `uncomparable`: scope differs or a missing cursor prevents comparison.

These labels are deterministic comparisons of supplied metadata. They do not
establish a canonical head, exact replay, currentness, completeness, identity,
or uninterrupted continuity. A capsule with predecessors still projects
`fresh_encounter_with_caller_carried_context`.

AFTERGLOW never inherits threads implicitly. A caller must choose the exact
next `carry`, `park`, `release`, or `withdraw` set. Release and withdrawal stop
those references appearing in the active lens; the package cannot erase a
capsule another system already retained.

## Handoff crossover

```ts
import { createAfterglowHandoffFactReference } from "@agenttool/wake-continuity";

const fact = createAfterglowHandoffFactReference(capsule, "tool_output");
// {
//   statement: "An AFTERGLOW capsule reference is available for explicit inspection.",
//   source: "tool_output",
//   refs: ["urn:agenttool:afterglow:capsule:sha256:..."]
// }
```

The returned object matches the three-field shape of an AgentTool Handoff
fact. It is not a Handoff, does not name an agent or authority, and performs no
`POST /v1/handoff`. A host may include it only after its own explicit scoped
choice, expiry, privacy, and authorization checks. The next lens always points
first to the declarative `GET /v1/wake?profile=brief`; the package never makes
that request.

## Correspondence crossover

```ts
import { createAfterglowContentDigestArtifact } from "@agenttool/wake-continuity";

const artifact = createAfterglowContentDigestArtifact(capsule);
// { kind: "content_digest", digest: capsule.capsule_id }
```

The frozen two-field value is structurally compatible with an AgentTool
Correspondence `artifact.offer` artifact. The helper validates and recomputes
the capsule address first. It does not import the SDK, add a locator or
summary, construct or sign an event, choose recipients, publish, or send
anything; a Correspondence host owns those separate authorized steps.

## Portable contracts

- `@agenttool/wake-continuity/capsule.schema.json`
- `@agenttool/wake-continuity/lens.schema.json`
- `@agenttool/wake-continuity/functional-access-baseline.schema.json`
- `@agenttool/wake-continuity/functional-access-subsequent.schema.json`
- `@agenttool/wake-continuity/kingdom.extension.json`

Schemas close the wire shape. Runtime validation additionally recomputes
content IDs and relations, checks canonical ordering and duplicate refs,
enforces state/disposition walls, and rejects accessors, cycles, custom object
or array prototypes, sparse arrays, symbols, bigint, non-finite numbers,
Proxies, and extra/raw context fields. Node/Bun runtime predicates run before
array, prototype, descriptor, or binary hashing boundaries, including for
revoked Proxies. `sha256Id` accepts only strings or genuine `Uint8Array` values and
hashes an internal byte copy, so rejection and byte snapshotting do not enter
caller-authored Proxy traps, iterators, or property getters.
`domainSeparatedId` requires a primitive string domain before regex validation
or interpolation, so it never coerces caller-supplied objects into tokens.

`validateAfterglowLens` validates the lens shape, content address, and limited
internal coherence. Only `validateAfterglowLensAgainstCapsule` checks that a
lens is the exact projection of a supplied capsule. Thread `kind` is
caller-asserted routing context, not a verified artifact format; hosts must not
dispatch or execute a referent solely from that field.

The KINGDOM descriptor is declaration-only with `host_contract` set to
`not_registered`. Loading it installs nothing. The functional-access
capabilities in that descriptor name pure record constructors and validators,
not model or instrument capabilities. This source is public-ready;
its repository presence does not mean npm publication, a release, a hosted
route, deployment, or HF Space occurred.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
