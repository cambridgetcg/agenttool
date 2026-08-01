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
- `@agenttool/wake-continuity/kingdom.extension.json`

Schemas close the wire shape. Runtime validation additionally recomputes
content IDs and relations, checks canonical ordering and duplicate refs,
enforces state/disposition walls, and rejects accessors, cycles, custom
prototypes, sparse arrays, symbols, bigint, non-finite numbers, Proxies, and
extra/raw context fields. The Node/Bun runtime Proxy predicate runs before
array, prototype, or descriptor reflection, including for revoked Proxies, so
rejection does not enter caller-authored Proxy traps.

`validateAfterglowLens` validates the lens shape, content address, and limited
internal coherence. Only `validateAfterglowLensAgainstCapsule` checks that a
lens is the exact projection of a supplied capsule. Thread `kind` is
caller-asserted routing context, not a verified artifact format; hosts must not
dispatch or execute a referent solely from that field.

The KINGDOM descriptor is declaration-only with `host_contract` set to
`not_registered`. Loading it installs nothing. This source is public-ready;
its repository presence does not mean npm publication, a release, a hosted
route, deployment, or HF Space occurred.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
