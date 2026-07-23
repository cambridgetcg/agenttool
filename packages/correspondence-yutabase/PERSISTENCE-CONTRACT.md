# Persistence contract for mapping plans

Status: **required behavior for a future executor; no executor or database I/O
is implemented by this package.**

The planner emits `card.upsert` and `thread.ensure` intentions. Those names do
not acquire semantics merely by appearing in JSON. A durable host must apply
the rules below, or use different operation names and make no interoperability
claim with this profile.

## Transaction boundary

For one accepted Correspondence replay record, a host must atomically:

1. confirm independent event-ID and signature verification under the retained
   source protocol;
2. lock or otherwise serialize the source checkpoint;
3. compare and apply every planned card and relation;
4. record any separately modelled observation state; and
5. advance the durable receipt cursor.

Any collision, missing schema binding, validation failure, or database error
must roll back the semantic writes and checkpoint together. Quarantine is
source/project scoped and must remain visible to operators. A Wake/SSE hint is
never a checkpoint.

## `card.upsert`

Comparison uses the full logical address and typed `fields`. The incoming
claim is evidence about this attempted projection, not permission to overwrite
different content.

| Existing state | Incoming state | Required decision |
|---|---|---|
| absent | any valid card | insert |
| same address and identical fields | same fields | no-op; retain the existing claim header |
| event `reference_only` | matching event `metadata` | compare-and-swap upgrade |
| event `metadata` | matching event `reference_only` | no-op; never downgrade |
| same address | any other field difference | quarantine conflict; do not overwrite |

“Matching event” means the same `source_event_id`. A reference-only card says
only that another retained event named that ID; it must not be relabelled as a
verified or replayed event. Projector claimant changes alone do not create a
new entity and do not rewrite the claimant that originally persisted it.

## `thread.ensure`

The executor must use the supplied deterministic UUID. The current YUTABASE
`thread()` convenience method generates UUIDv7 and therefore is not an
executor for these intentions. Use parameterized SQL in the host's existing
transaction, or a future explicit-ID SDK operation with the same rules.

| Existing state | Required decision |
|---|---|
| neither ID nor `(word, from, to)` exists | insert the supplied row |
| supplied ID exists with identical word, endpoints, `at`, `how`, and ordered `src` | no-op; retain its original `by` |
| the same `(word, from, to)` exists under another ID | quarantine mapping conflict |
| supplied ID exists with any different semantic field | quarantine UUID collision |
| supplied ID exists in severed history | refuse resurrection and quarantine |

The deterministic ID identifies one mapped relation, not a lease. An executor
must not use `ON CONFLICT DO UPDATE` to silently rewrite a claim or turn a
severed historical ID active again.

## Schema and vocabulary preflight

Before processing records, the host must confirm:

- the exact supported YUTABASE database identity;
- registered `correspondence/*` decks whose UUID and honesty-header mappings
  match the physical tables;
- exact lexicon equality with exported `YUTABASE_LEXICON`, including gloss,
  inverse, endpoints, `to_one`, TTL, and status; and
- a mapping/checkpoint profile equal to `PLAN_PROFILE`.

A similar word spelling with a different gloss is a different meaning and must
fail preflight. Database roles and source policy still decide who may execute
these writes; the plan grants no privilege.

## Rebuild result

Replaying the same retained events in receipt order under the same mapping
profile must produce the same entity and relation identities. Claimant labels
may differ across fresh rebuild environments because they identify the actual
projector. That difference must never alter IDs or semantic fields.

Mutable `missing_parents` and `lineage_status` values are not part of event
cards. If a host projects them later, it must create separately timed status
observations with a durable page/snapshot locator rather than rewriting the
event's immutable metadata claim.
