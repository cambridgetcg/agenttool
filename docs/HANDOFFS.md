<!-- @id urn:agenttool:doc/HANDOFFS  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:principle/continuity-without-authority-transfer  @composes_with urn:agenttool:doc/SUBAGENTS urn:agenttool:doc/WAKE urn:agenttool:doc/LETTERS -->

# HANDOFFS — a bounded working set between agent sessions

> **Compass:** [SUBAGENTS](SUBAGENTS.md) (facets) · [WAKE](WAKE.md) (the current orientation) · [LETTERS](LETTERS.md) (private cross-DID voice) · [MEMORY-TIERS](MEMORY-TIERS.md) (durable memory) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (what a bearer proves)
>
> **Implements:** a project-private, append-only coordination snapshot: task, scope, evidence, uncertainty, declared boundaries, verification, and the next safe action.
>
> **Code:** `api/src/routes/handoff.ts` · `api/src/services/handoff/store.ts` · `api/src/services/wake/build.ts` · `api/src/services/wake/markdown.ts`
>
> **Tests:** `api/tests/handoff.test.ts` · `api/tests/handoff-routes.test.ts` · `api/tests/wake-handoff.test.ts`

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

`POST /v1/handoff` appends one snapshot. There is no PATCH or DELETE: a
correction is a new snapshot with `supersedes_handoff_id`, so the chronicle
keeps the honest sequence.

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
  "supersedes_handoff_id": null
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
chronicle.parent_chronicle_id = supersedes_handoff_id (when supplied)
```

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
});
const latest = await at.handoff.get(identityId);
```

```python
written = at.handoff.write(
    agent_id=identity_id,
    task_summary="Review the handoff API",
    valid_until="2026-07-20T12:00:00.000Z",
    next_safe_action="Run the focused handoff tests.",
)
latest = at.handoff.get(agent_id=identity_id)
```

## Reads and wake composition

```text
GET /v1/handoff?agent_id=<uuid>       latest snapshot for one active project identity
GET /v1/wake                          JSON: you_have_handoffs.active / stale
GET /v1/wake?format=md                bounded “Active project handoffs” section
GET /v1/wake/handoffs                 one wake fragment
GET /v1/wake/voice?...&keys=handoffs  minimal change notifications
```

`GET /v1/handoff` returns `state: "absent" | "current" | "stale"`. The
newest snapshot is authoritative even if it has expired: the substrate never
quietly falls back to an older, more convenient version. `complete` snapshots
remain in the chronicle but do not appear as active wake work.

The wake keeps its rendered form bounded (five current and three stale
snapshots, with a total handoff-render budget). JSON retains the structured
records. The wake composer considers the recent 31-day working-set window;
the full historical trail remains available through `GET /v1/chronicle`.

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
