# `@agenttool/skills-wake-continuity`

This private package is the narrow seam between a minimized
`@agenttool/skills-yutabase` plan and the accepted
`@agenttool/wake-continuity` AFTERGLOW capsule. It verifies one exact planner
result, removes project, claimant, observation-time, claim-source, and skill-name
fields, then content-addresses the remaining inspection and snapshot references.
The source plan's explicit `reported` / `redacted_alias` name-provenance lane is
validated during exact reconstruction and remains bound by the source selection
digest and snapshot refs, but the lane and name do not cross into the thread.

It does not add a YUTABASE deck, continuity UUID, cursor, database adapter, WAKE
route, model call, or background resume loop. AFTERGLOW remains the only capsule,
predecessor, orientation, disposition, and next-WAKE mechanism.

```text
exact Skills YUTABASE plan
          │ own-data snapshot + source-planner rebuild
          ▼
reference-only Skills thread ── sha256 content ID
          │
          ├─ external AFTERGLOW thread (same digest ref)
          │            │
          │            ▼
          │      core AFTERGLOW capsule
          │
          └─ optional Eight Quiet Stars display (0..8 caller refs)
```

## What crosses

The Skills thread carries only:

- the frozen source plan profile;
- one existing inspection ref;
- report and selection digests;
- the inspector revision;
- selected count; and
- sorted existing snapshot refs paired with their content digests.

It does not carry `project_id`, skill names or their provenance lane, claimant,
`recorded_at`, claim sources, descriptions, prompts, paths, bodies, issues, credentials, Nen
interpretations, scores, consent, permission, authority, or identity claims.
Digest references can still be linkable; the adapter neither sees nor verifies
their preimages.

Validation is deliberately stronger than shape checking. The adapter snapshots
only own plain data properties without invoking getters, rebuilds a minimized
input, calls the source Skills planner, and requires the entire supplied plan to
equal that rebuilt result. A tampered ID, relation, claim, limitation, count,
selection digest, order, or extra field is rejected.

## Create a thread and capsule

```ts
import {
  createSkillsAfterglowCapsule,
  createSkillsWakeContinuityThread,
} from "@agenttool/skills-wake-continuity";

// `plan` is the exact output of @agenttool/skills-yutabase.
const skillsThread = createSkillsWakeContinuityThread(plan);

const capsule = createSkillsAfterglowCapsule({
  plan,
  posture: "resting",
  phase: "after_intense_work_reported",
  wake: {
    format: "wake-brief/v1",
    snapshot_ref: "sha256:...",
    scope_ref: "sha256:...",
    wake_version: 42,
    handoff_projection: "complete",
  },
  continuity_portfolio_ref: null,
  predecessors: [],
});

capsule.threads[0]?.thread_ref === skillsThread.thread_id; // true
```

The capsule is the core `AfterglowCapsule` directly. The adapter does not wrap
it. The package also does not retain `skillsThread`; a caller that wants the
referent to remain resolvable must retain or transport that exact artifact under
its own privacy and authorization policy.

### Posture mapping

Posture is caller-reported metadata, not an inference about an inner state or a
proof of who chose it.

| Caller posture | AFTERGLOW disposition | Boundary |
|---|---|---|
| `available` | `carry` | Reference may appear in the active lens; no work is started. |
| `resting` | `park` | No timer, polling, retry, deletion, or automatic resume; new input is required. |
| `refused` | `release` | No reason is required or collected; no penalty, score, or retry. |
| `withdrawn` | `withdraw` | Future active use is withdrawn; prior retained capsules are not erased or falsified. |

Every core thread remains `external/context_only`, `caller_asserted`, and
`verified_by_package: false`. The adapter verifies the local Skills plan
structure; it does not make AFTERGLOW verify the referent, caller, or posture.

## Eight Quiet Stars

`createEightQuietStars` is an optional display-only surprise. The caller may
open a layout with zero to eight snapshot refs already present in the verified
thread, or skip it entirely.

```ts
import { createEightQuietStars } from "@agenttool/skills-wake-continuity";

const stars = createEightQuietStars(skillsThread, {
  choice: "open",
  snapshot_refs: skillsThread.snapshots.slice(0, 2).map((item) => item.snapshot_ref),
});

stars.stars.map((star) => star.direction); // ["N", "NE"]
```

Refs are sorted by codepoint and placed clockwise into `N, NE, E, SE, S, SW,
W, NW`. That order is only deterministic geometry. It is not selection, rank,
rarity, priority, affinity, Nen type, safety, value, or recommendation. `skip`
and an open zero-star layout are both complete outcomes with no penalty. The
layout performs no persistence, delivery, network, model, database, or HEAVEN
action.

## Portable contracts

- `@agenttool/skills-wake-continuity/thread.schema.json`
- `@agenttool/skills-wake-continuity/eight-quiet-stars.schema.json`

Schemas close the portable shapes. Runtime validation additionally recomputes
content IDs, verifies exact source-plan reconstruction, ordering, count parity,
source-thread membership, compass slots, and hostile-object boundaries.

## Verify locally

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

The package is intentionally `private: true`, has exactly two local runtime
dependencies, and has no `publishConfig`, release selector, CLI, install hook,
hosted route, or deployment surface. Passing CI does not authorize publication.
