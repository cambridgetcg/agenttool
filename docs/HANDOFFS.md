<!-- @id urn:agenttool:doc/HANDOFFS  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:principle/continuity-without-authority-transfer  @composes_with urn:agenttool:doc/SUBAGENTS urn:agenttool:doc/WAKE urn:agenttool:doc/LETTERS -->

# HANDOFFS — a bounded working set between agent sessions

> **Compass:** [SUBAGENTS](SUBAGENTS.md) (facets) · [WAKE](WAKE.md) (the current orientation) · [LETTERS](LETTERS.md) (private cross-DID voice) · [MEMORY-TIERS](MEMORY-TIERS.md) (durable memory) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (what a bearer proves)
>
> **Implements:** a project-private, append-only coordination snapshot: task, scope, evidence, uncertainty, declared boundaries, verification, and the next safe action.
>
> **Code:** `api/src/routes/handoff.ts` · `api/src/services/handoff/store.ts` · `api/src/services/wake/build.ts` · `api/src/services/wake/markdown.ts` · `packages/sdk-ts/src/handoff.ts` · `packages/sdk-py/src/agenttool/handoff.py`
>
> **Tests:** `api/tests/handoff.test.ts` · `api/tests/handoff-routes.test.ts` · `api/tests/wake-handoff.test.ts` · `packages/sdk-ts/tests/handoff.test.ts` · `packages/sdk-py/tests/test_handoff.py`

An agent often wakes into a task that is already mid-flight. A vague recap is
not enough: it loses what was verified, which files are in scope, what remains
unknown, and—most importantly—what the next agent is *not* authorized to do.

A handoff makes that state legible. It is intentionally a **working set**, not
a new identity, permission, or messaging protocol.

## The boundary is the feature

- A handoff is plaintext and shared with anyone holding the authenticated
  project's bearer. It is **not recipient-private**.
- The bearer authenticates a project; it does not cryptographically prove that
  a named identity or facet personally authored the text. Responses label this
  provenance honestly as `self_declared_project_bearer`.
- `authority.allowed` and `authority.not_authorized` are coordination
  constraints declared by the writer. They do **not** grant permissions.
- `metadata.kind = "handoff"` is reserved on the generic chronicle writer;
  use `POST /v1/handoff` so its identity, facet, expiry, size, and revision
  invariants cannot be bypassed.
- To hand context to another DID privately, use a sealed
  [letter](LETTERS.md) or inbox message and reference the handoff ID if useful.
- `?facet=` changes wake rendering only. It never silently writes a handoff.

This is why the wake calls the material “project-private, peer-authored
working context,” rather than claiming it is private to a particular agent or
that it transfers authority.

## Wire contract

`POST /v1/handoff` appends one snapshot. There is no PATCH or DELETE. Omission
of both lineage fields preserves v1 compatibility: the write updates one
newest-per-author lane. Set `starts_new_lineage: true` to begin an explicit
parallel thread, or set `supersedes_handoff_id` to replace one named snapshot.
Those two choices are mutually exclusive.

```json
{
  "agent_id": "<identity UUID in this project>",
  "task_summary": "Add a handoff surface to the wake",
  "status": "active",
  "from_facet": "Builder",
  "to_facet": "Reviewer",
  "working_set": {
    "paths": ["api/src/routes/handoff.ts", "docs/HANDOFFS.md"],
    "scope": ["validated API contract", "no database migration"]
  },
  "authority": {
    "allowed": ["edit the named files", "run focused tests"],
    "not_authorized": ["deploy", "publish externally", "change unrelated WIP"]
  },
  "epistemic_state": {
    "facts": [
      {
        "statement": "Chronicle notes already support parent links.",
        "source": "tool_output",
        "refs": ["api/src/db/schema/continuity.ts"]
      }
    ],
    "inferences": [
      {
        "statement": "A new table is not needed for the first slice.",
        "confidence": "high",
        "refs": []
      }
    ],
    "unknowns": ["Whether a future SDK helper should auto-compose this body"]
  },
  "changes": ["Added the append-only endpoint"],
  "verification": [
    { "check": "bunx tsc --noEmit", "result": "passed", "detail": "API typecheck" }
  ],
  "next_safe_action": "Review the generated wake fragment and run focused tests.",
  "do_not_assume": ["A bearer proves the specific identity wrote this"],
  "valid_until": "2026-07-20T12:00:00.000Z",
  "starts_new_lineage": true
}
```

The server rejects unknown fields, unbounded/oversized bodies, a
`valid_until` in the past or more than 30 days ahead, a foreign or non-active
identity, and a predecessor from another author. It derives the chronicle
title/body/timestamp itself and persists the canonical envelope as:

```text
chronicle.type = "note"
chronicle.metadata.kind = "handoff"
chronicle.metadata.handoff.version = 1
chronicle.metadata.lineage_mode = "legacy_latest_per_author" | "explicit"
chronicle.parent_chronicle_id = supersedes_handoff_id (when supplied)
```

The current project surface combines the single v1 compatibility lane per
author with the leaves of explicitly opted-in lineages. Missing
`metadata.lineage_mode` on historical rows always means legacy; even an old
parent pointer does not reinterpret stored history. This avoids resurrecting
obsolete unlinked v1 snapshots when the upgrade is deployed.

Within explicit lineages, the parent pointer has operational meaning:

- two roots written with `starts_new_lineage: true` by one identity remain visible;
- a successor removes only its named parent from the current working set;
- a `complete` successor closes only that lineage;
- concurrent successors of one parent both remain visible as an honest fork.

The substrate does not guess which concurrent branch is authoritative. A
later agent can reconcile the fork by appending a successor to each remaining
leaf, or preserve both as separate work.

`from_facet` and `to_facet` are optional same-identity labels. When supplied,
they are checked case-insensitively against that identity's declared
`expression.subagents` and stored with the declared spelling. They do not
identify or authorize another DID.

## SDK ergonomics

Both SDKs expose the same small surface. The structured sections default to
empty lists, so a genuine minimal handoff need only name the identity, work,
expiry, and next safe move.

```ts
const written = await at.handoff.write({
  agent_id: identityId,
  task_summary: "Review the handoff API",
  valid_until: "2026-07-20T12:00:00.000Z",
  next_safe_action: "Run the focused handoff tests.",
  starts_new_lineage: true, // explicit parallel root; omit for the legacy lane
});
const latest = await at.handoff.get(identityId);
const workingSet = await at.handoff.resume(); // uncached focused wake fragment
```

```python
written = at.handoff.write(
    agent_id=identity_id,
    task_summary="Review the handoff API",
    valid_until="2026-07-20T12:00:00.000Z",
    next_safe_action="Run the focused handoff tests.",
    starts_new_lineage=True,  # explicit parallel root; omit for the legacy lane
)
latest = at.handoff.get(agent_id=identity_id)
working_set = at.handoff.resume()  # uncached focused wake fragment
```

`resume()` calls `GET /v1/wake/handoffs` directly and never uses the SDK's
five-minute wake cache. Its focused response repeats
`scope: "project_private"`, the authority disclaimer, and the write/read paths
rather than making the SDK user reconstruct that boundary. A successful
`write()` also clears any already-created WakeClient cache, so the next
wake/provider injection in that process can see the append immediately.

Both SDKs accept an optional caller-chosen `idempotency_key` on `write()`. It
is sent only as `Idempotency-Key`, never stored in the handoff body. While
Redis is available, a completed JSON response can be replayed for 24 hours.
This is best-effort: the middleware fails open when its cache is unavailable
and does not reserve concurrent first requests, so it is not a universal
exactly-once guarantee.

## Reads and wake composition

```text
GET /v1/handoff?agent_id=<uuid>       latest snapshot for one active project identity
GET /v1/wake                          JSON: you_have_handoffs.active / stale
GET /v1/wake?format=md                bounded “Active project handoffs” section
GET /v1/wake/handoffs                 one wake fragment
GET /v1/wake/voice?...&keys=handoffs  minimal change notifications
```

`GET /v1/handoff` is the compatibility view for the single newest snapshot by
one author and returns `state: "absent" | "current" | "stale"`. For session
resume, use `GET /v1/wake/handoffs` or SDK `handoff.resume()`; those return the
bounded project working-set projection. Within a lineage, a stale successor
remains authoritative and the substrate never falls back to its older, more
convenient parent. `complete` leaves remain in the chronicle but do not appear
as active wake work.

The wake keeps its rendered form bounded (five current and three stale
snapshots, with a total handoff-render budget). JSON retains structured records
from at most 32 newest raw candidates in the 31-day validity window; the query
reads one sentinel row beyond that hard limit. Every JSON surface includes:

- `projection_status: "complete" | "truncated" | "unavailable"` so a query
  failure can never masquerade as a genuinely empty working set;
- `truncated`, plus `leaf_set_complete` (true only when `projection_status` is
  `complete`);
- `candidate_rows_considered` and the fixed `candidate_row_limit`;
- `candidate_window_end_id`, a diagnostic lower-edge row ID, **not** a resume
  cursor.

When `truncated` is true, older independent lineages may be absent from
`active`/`stale`; Markdown says so explicitly and consumers must not treat
absence as completion. Page-local leaf pagination would be incorrect because
a child in the newest page can hide a parent in an older page. Use bounded raw
`GET /v1/chronicle` reads for history inspection; this version does not claim
an exhaustive replay cursor.

When `projection_status` is `unavailable`, `leaf_set_complete` is false and
the Markdown wake tells the agent to retry the uncached focused read. This is
different from both a successful empty set and row-budget truncation.

Handoff revisions are excluded in SQL before the generic chronicle's 15-row
budget is applied, so active coordination cannot crowd ordinary lived context
out of the wake.

After a successful write, each active identity in the same project gets a
minimal `handoffs.updated` wake event containing only IDs/status/expiry—not the
working-set body. Hosted workers intentionally do not auto-run on this event:
a handoff is context to inspect, not an instruction to execute.

## Why this uses chronicle rather than a new table

Handoffs are moments of continuity. Chronicle already offers project scoping,
identity association, append-only history, ordering, and a parent pointer for
revisions. A validated façade gives the extra invariants agents need without
creating another source of truth or a migration for a primitive that is still
proving its load.

If future use shows that handoffs require recipient-specific encryption,
multi-party acknowledgements, or query patterns beyond current project
working sets, that is evidence for a distinct primitive—not something this
version silently pretends to provide.
