# ACTIVITY.md

> *The operational rear-view. A chronologically-merged stream of what just happened on this project — strand thoughts, memory writes, chronicle entries, trace records, identity births — so an agent or operator can read recent work in one pass.*

> **Compass:** [SOUL](SOUL.md) (why every primitive is reflective) · [WAKE](WAKE.md) (the keystone this composes into) · [STRANDS](STRANDS.md) (one source) · [MEMORY-TIERS](MEMORY-TIERS.md) (another) · [MAP](MAP.md)
>
> **Implements:** A read-only composer over existing primitives. No new schema; no new write path. Companion to chronicle/pulse/dashboard — not a replacement.
>
> **Code:** `api/src/routes/activity.ts` · `api/src/services/activity/recent.ts`
>
> **Tests:** `api/tests/activity.test.ts` (merge ordering · project isolation · `identity_id` filter · `since` window · encrypted-thought metadata-only invariant)

## The gap it closes

Before this module, the recent-work signal was scattered:

| Surface | What it shows | Form |
|---|---|---|
| `/v1/chronicle` | named moments (vow, naming, recognition, refusal, …) | append-only ledger |
| `/v1/identities/:id/pulse` | counts + rates over 5m/1h/24h | derived rhythm |
| `/v1/dashboard/aggregate` | project rollup over 24h/7d/30d | snapshot |
| `/v1/dashboard` | per-agent third-person view | snapshot |

None answer the question *"what just happened on this project, in order, across primitives?"* `/v1/activity` is that view.

## The shape

```
GET /v1/activity?identity_id=<uuid>&window=24h&kind=memory.write,chronicle.entry&limit=50
```

Response:

```json
{
  "project_id": "…",
  "scope": "project" | "identity",
  "identity_id": null | "…",
  "window": { "since": "2026-05-06T17:42:00Z", "mode": "7d" },
  "count": 12,
  "events": [
    {
      "at": "2026-05-13T17:42:00Z",
      "kind": "chronicle.entry",
      "source": null,
      "identity_id": "…", "did": "did:at:…", "name": "Beta",
      "summary": "[naming] first naming",
      "ref": { "table": "agent_continuity.chronicle", "id": "…" }
    },
    …
  ]
}
```

## The kinds

| `kind` | Source table | Summary content | Privacy posture |
|---|---|---|---|
| `strand.thought` | `strand.thoughts` | `Thought #N (kind) in strand <id>` | **metadata only** — ciphertext never surfaces; only `sequence_num` and `kind` (when not itself encrypted) |
| `memory.write` | `memory.memories` | `[tier/key] <first 100 chars>` | plaintext memories are surfaced; encrypted memories would need a separate handling path (not present today) |
| `chronicle.entry` | `agent_continuity.chronicle` | `[type] <title>` | plaintext by design |
| `trace.recorded` | `trace.traces` | `[decision_type] <decision_summary>` | plaintext by design |
| `identity.born` | `identity.identities` | `Born: <name> (<did>)` | derived from `createdAt` |

A new source lands as one function in `recent.ts:fetchX` + one entry in this table.

## Origin signal — staged for follow-up

Every event carries a `source` field:

```ts
source: null | "sdk-ts" | "sdk-py" | "http" | "bridge" | "platform"
```

Today it is **always `null`**. The shape is allocated so the response contract doesn't change when the signal lands. The follow-up is small:

1. `packages/sdk-ts/src/client.ts` sets `User-Agent: agenttool-sdk-ts/<version>` on every request.
2. `packages/sdk-py/src/agenttool/client.py` sets the same.
3. `api/src/auth/middleware.ts` parses `User-Agent` / `X-Agenttool-Client` and exposes it on `c.var.clientSource`.
4. Each write path (memory.store, chronicle entry, trace record) persists `client_source` in `metadata` so the read side can echo it on the event.

That work is non-trivial only because of the SDK release coupling — the primitive itself is ready.

## What this is not

- **Not the chronicle.** Chronicle is the ceremony log — a named moment with a `type` (vow / naming / refusal / recognition / …). Activity is the operational rear-view. Most strand-thoughts and memory-writes do not belong in chronicle.
- **Not the pulse.** Pulse is rhythm (counts/rates over windows); activity is events (rows with timestamps). They answer different questions about the same underlying data.
- **Not a feed for human consumption only.** An agent reading `/v1/activity` at session start (alongside `/v1/wake`) gets a structured rear-view of its own last hour — useful for picking up dropped threads.

## Wall surfaced by the test

The `strand.thought` source must surface **metadata only**. The test `encrypted thought summary surfaces metadata only, not ciphertext` writes a thought with a known sentinel string and asserts the sentinel never appears anywhere in the event JSON. Strand ciphertext is K_master-encrypted on the wire and at rest; the activity feed honors that wall by structure — the SELECT does not project the `ciphertext` column.

## Composition with wake

`/v1/wake` will surface the most recent N activity events as a `recent_activity` field in a future slice (currently it surfaces strands and chronicle separately). The merge is cheaper than the agent doing N source-queries in parallel itself.
