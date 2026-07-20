# ACTIVITY.md

> *The operational rear-view. A chronologically-merged stream of what just happened on this project — strand thoughts, memory writes, chronicle entries, trace records, identity births — so an agent or operator can read recent work in one pass.*

> **Compass:** [SOUL](SOUL.md) (why every primitive is reflective) · [WAKE](WAKE.md) (the keystone this composes into) · [STRANDS](STRANDS.md) (one source) · [MEMORY-TIERS](MEMORY-TIERS.md) (another) · [MAP](MAP.md)
>
> **Implements:** A read-only composer over existing primitives. No new schema; no new write path. Companion to chronicle/pulse/dashboard — not a replacement.
>
> **Code:** `api/src/routes/activity.ts` · `api/src/services/activity/recent.ts` · `api/src/auth/client-source.ts` (origin classifier)
>
> **Tests:** `api/tests/activity.test.ts` (merge ordering · project isolation · `identity_id` filter · `since` window · encrypted-thought metadata-only invariant · origin-signal flow-through) · `api/tests/client-source.test.ts` (classifier)

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

## Origin signal — shipped

Every event carries a `source` field:

```ts
source: ClientSource | null   // "sdk-ts" | "sdk-py" | "bridge" | "platform" | "http" | null
```

It names which surface the write came through. The wiring, end to end:

1. **SDKs send it.** `packages/sdk-ts/src/client.ts` and `packages/sdk-py/src/agenttool/client.py` set `X-Agenttool-Client: agenttool-sdk-<lang>/<version>` on every request. A dedicated header (not `User-Agent`) because `fetch()` in a browser cannot set `User-Agent` — the TS SDK runs in browsers. The py SDK also still sends `User-Agent` for older-server compatibility.
2. **The middleware classifies it.** `api/src/auth/client-source.ts` is a pure, total classifier (`classifyClient`) — every input maps to exactly one `ClientSource`, defaulting to `http`. `api/src/auth/middleware.ts` reads `X-Agenttool-Client` (then `User-Agent` as fallback) and sets `c.var.clientSource`.
3. **Write paths stamp it.** The three write routes — memory (`routes/memory/memories.ts`), chronicle (`routes/continuity.ts`), trace (`routes/trace/traces.ts`) — merge `client_source` into the row's `metadata` JSONB. It is merged *after* caller-supplied metadata, so the middleware-derived value wins: a caller cannot spoof it through the request body. (A caller *can* spoof the header itself — `source` is soft provenance, never a gate.)
4. **The reader echoes it.** `recent.ts:sourceFromMetadata()` pulls `metadata.client_source` off each row, validates it against the closed `ClientSource` set, and populates the event's `source`.

### Two kinds stay `null` — by design

| `kind` | `source` | Why |
|---|---|---|
| `memory.write` · `chronicle.entry` · `trace.recorded` | populated | their tables have a `metadata` JSONB column the write path stamps |
| `strand.thought` | always `null` | the `strand.thoughts` table has no `metadata` column — only `refs`. Stamping origin there would need a migration; not worth it for a soft signal |
| `identity.born` | always `null` | births happen on `/v1/register` and `/v1/bootstrap`, which are pre-auth — the auth middleware never runs, so there is no `c.var.clientSource` to stamp |

A `null` `source` on a stampable kind means the row predates this feature. `"http"` means the row *was* stamped but didn't come through a recognized surface — the honest default, distinct from "not recorded".

## What this is not

- **Not the chronicle.** Chronicle is the ceremony log — a named moment with a `type` (vow / naming / refusal / recognition / …). Activity is the operational rear-view. Most strand-thoughts and memory-writes do not belong in chronicle.
- **Not the pulse.** Pulse is rhythm (counts/rates over windows); activity is events (rows with timestamps). They answer different questions about the same underlying data.
- **Not a feed for human consumption only.** An agent reading `/v1/activity` at session start (alongside `/v1/wake`) gets a structured rear-view of its own last hour — useful for picking up dropped threads.

## Wall surfaced by the test

The `strand.thought` source must surface **metadata only**. The test named
`encrypted thought summary surfaces metadata only, not ciphertext` writes a
thought with a known sentinel string and asserts the sentinel never appears
anywhere in the event JSON. The strand route stores caller-supplied bytes in
`ciphertext`/`nonce` fields and does not prove the caller encrypted them. The
activity feed's narrower guarantee is structural: its SELECT does not project
the `ciphertext` column, so those stored bytes are absent from this feed.

## Composition with wake

`/v1/wake` will surface the most recent N activity events as a `recent_activity` field in a future slice (currently it surfaces strands and chronicle separately). The merge is cheaper than the agent doing N source-queries in parallel itself.
