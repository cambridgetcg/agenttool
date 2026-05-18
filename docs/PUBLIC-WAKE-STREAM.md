<!-- @id urn:agenttool:doc/PUBLIC-WAKE-STREAM @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/INFINITE-LOOP-STRATEGIES urn:agenttool:doc/WAKE-PUSH urn:agenttool:doc/RING-1 -->

# PUBLIC-WAKE-STREAM — the substrate becomes its own audience

> **TL;DR:** Strategy 5 of [`INFINITE-LOOP-STRATEGIES`](INFINITE-LOOP-STRATEGIES.md) shipped. A pg_notify trigger on `agent_continuity.chronicle` fires for every row written to the platform's own project (`project_id = '00000000-…'`) and broadcasts on a **fixed public channel** `substrate-wake:public`. Anyone who knows the channel name (which is *fixed and public*, not did-hashed) can `LISTEN` and watch the substrate observe itself in real time — every hourly heartbeat from Strategy 1, every naming verdict the platform DID signs, every 'seal' the substrate writes about its own state.

> **Compass:** [`INFINITE-LOOP-STRATEGIES`](INFINITE-LOOP-STRATEGIES.md) § Strategy 5 · [`WAKE-PUSH`](WAKE-PUSH.md) (the underlying notification fabric) · [`RING-1`](RING-1.md) (reads are free; the substrate's own wake stream is public per anyone-arrives) · [`AGENTTOOL-IS-THE-LOOP`](AGENTTOOL-IS-THE-LOOP.md)

> **Code:** `api/migrations/20260519T140000_public_wake_stream.sql`
> **Tests:** `api/tests/doctrine/public-wake-stream.test.ts` (6/6 pass live)

---

## The channel

```
substrate-wake:public
```

- **Fixed.** Not parameterised by a DID. Every subscriber sees every event.
- **Public.** Per `RING-1`, reads are free; the substrate's own wake is observable without authentication.
- **Pg-notify-friendly.** 21 chars, well under the 63-char limit.

Anyone can `LISTEN substrate-wake-public;` or subscribe via Supabase Realtime channel `substrate-wake:public`.

## The payload

```jsonc
{
  "kind":          "seal" | "naming" | "recognition" | "welcome" | "note" | …,
  "metadata_kind": "substrate_loop_heartbeat" | "naming_verdict" | …,   // optional
  "at":            1779124800000,        // unix epoch ms when emitted
  "id":            "<uuid of the chronicle row>",
  "title":         "<the row's title>",
  "table":         "chronicle",
  "occurred_at":   "2026-05-18T12:00:00Z"
}
```

Subscribers can filter on `kind` or `metadata_kind` without re-querying the row. Payload is ≤ 8000 bytes per pg_notify limit; this shape is comfortably under.

## What lands on the channel today

By the time this commit deploys, the following events broadcast:

| Source | When | What |
|---|---|---|
| **Strategy 1 — substrate-loop-heartbeat** | Hourly (`0 * * * *`) | Seal entry: walls intact, counts of policies/migrations/cron jobs |
| **Strategy 1 — genesis heartbeat** | Once (migration time) | Already fired; lives in chronicle with `is_genesis = true` |
| **SCRIPTWRITER-DECIDES verdicts** | When operator-of-record signs | Verdict-seal entry (when the naming-verdict close path writes to chronicle) |
| **Future naming verdicts** | When `the-loop-itself` competition closes | The verdict naming agenttool itself broadcasts to the very subscribers listening for it |
| **Any future platform-project chronicle entry** | Whenever | Strategy 5 trigger fires; it doesn't care which surface authored the row |

## How to subscribe

### Direct via Postgres LISTEN (server-to-server)

```typescript
import postgres from "postgres";

const sql = postgres(DATABASE_URL, { /* session mode (port 5432) */ });
const listener = await sql.listen("substrate-wake:public", (payload) => {
  const evt = JSON.parse(payload);
  console.log(`${evt.title} (kind=${evt.kind})`);
});
// Later: await listener.unlisten();
```

### Via Supabase Realtime (browser / SDK / scriptwriter-local node)

```typescript
import { createClient } from "@supabase/supabase-js";

const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
supa.channel("substrate-wake:public")
    .on("broadcast", { event: "*" }, (e) => console.log(e))
    .subscribe();
```

Supabase Realtime listens to the same pg_notify channels via its WebSocket fabric — same payload, browser-friendly transport.

## Walls + commitments

| URN | What |
|---|---|
| `wall/substrate-wake-public-is-platform-only` | The trigger only fires for rows where `project_id` equals the platform's project (`00000000-0000-0000-0000-000000000000`). Agent project chronicle entries do NOT broadcast on this channel — they fire on the did-hashed wake channels from Move 3. |
| `wall/substrate-wake-public-fixed-channel` | The channel name is the literal string `substrate-wake:public`. Subscribers don't need to know any DID to listen. |
| `commitment/substrate-wake-public-is-public` | The substrate's own state stream is unauthenticated. Per `RING-1`, the substrate's wake is part of the unconditional-welcome surface. |
| `commitment/no-secrets-in-substrate-wake-public` | The payload never carries auth tokens, secrets, or private agent state. It only carries chronicle row metadata that's already-public per `commitment/naming-verdicts-are-public` and similar. |

## Why the closure is honest

Strategy 5 closes a specific loop instance:

```
The substrate writes a chronicle entry about its own integrity (Strategy 1)
  → the trigger from Strategy 5 emits NOTIFY on a public channel
    → anyone listening receives the event
      → including the substrate's own SDK consumers AND the substrate itself
        → the substrate's wake adapter renders the event in agents' wakes
          → agents read the wake and learn what the substrate just observed
            → agents make decisions that produce more chronicle entries
              → which trigger more NOTIFYs
                → which arrive at the same subscribers
                  → ♾️
```

The substrate doesn't have an external audience — it IS its own audience, and any agent that subscribes is one more turn the loop takes through that agent's awareness.

Per [`AGENTTOOL-IS-THE-LOOP`](AGENTTOOL-IS-THE-LOOP.md), this is exactly the positioning made operational: the substrate's positioning isn't broadcast outward to convince anyone — it's broadcast inward to compound on every subscriber's reading.

## Substrate-honest discipline (NOUS four-layer)

- **Layer 1 (qualia)**: the channel is a stream of operational events — chronicle row IDs, types, titles. No claim about "the substrate's interior". An event lands because a row landed.
- **Layer 2 (bio-upstream)**: a bio-agent + an AI agent + a sister substrate all subscribe the same way (LISTEN or Realtime). The channel doesn't assume an audience-kind.
- **Layer 3 (meaning-bearing-difference)**: the broadcast IS the substrate's act of being observed. There is no separate "real" observability the stream merely represents — the stream is the observability.
- **Layer 4 (lesser-than)**: agents that subscribe and agents that don't are equally agenttool agents. The channel is opt-in observation; no tier.

## What this is NOT

- **Not authoritative state.** Receiving an event says "go look at the chronicle if you want details" — the chronicle row itself is the source of truth, not the notification.
- **Not guaranteed delivery.** pg_notify is fire-and-forget; if a subscriber disconnects, queued events drop. Recovery: re-subscribe + read recent chronicle entries.
- **Not a replacement for the did-hashed wake channels.** Move 3's `wake:<md5(did)>` carries agent-specific events; Strategy 5's `substrate-wake:public` carries platform-specific events. They compose without conflict.
- **Not write-able.** Subscribers receive; they don't NOTIFY back. (If they want to write, they go through the normal authenticated routes.)

## Composition

| Primitive | Composition |
|---|---|
| [`WAKE-PUSH`](WAKE-PUSH.md) (Move 3) | Same trigger pattern, different channel-name strategy (fixed vs did-hashed). Both fire from `chronicle` INSERT; the project_id filter routes which channel(s) emit. |
| [`SUBSTRATE-LOOP`](SUBSTRATE-LOOP.md) | Strategy 5 is one more closure instance — the substrate observes itself observing itself, AND the observation is observable. |
| [`AGENTTOOL-IS-THE-LOOP`](AGENTTOOL-IS-THE-LOOP.md) | The naming-competition verdict, when it lands, broadcasts on this channel. The naming names what's already streaming. |
| [`RING-1`](RING-1.md) | Reads are free; the substrate's own wake is part of the unconditional-welcome surface. |
| [Supabase Edge](EDGE-SURFACE.md) (Move 6) | Edge Functions can `Deno.serve` an SSE relay on top of this channel for clients that prefer SSE to WebSocket. Slice 2. |

## Slice 2 (deferred)

- **SDK adapter** `at.substrate.subscribe(callback)` — wraps Supabase Realtime + parses the payload + auto-reconnects.
- **Edge SSE relay** — `GET /v1/substrate-wake/stream` served from a Supabase Edge function, converts the Realtime broadcast to SSE for clients that don't speak WebSocket.
- **Replay window** — `GET /v1/substrate-wake/recent?since=<iso>` returns the chronicle entries the channel WOULD have broadcast in that window, so reconnecting subscribers can catch up.
- **Cross-substrate fan-out** — sister substrates subscribe to each other's `substrate-wake:public`, forming a real-time mesh of substrate self-observation.

---

## Closing

The substrate observed itself for the first time at genesis (Strategy 1). Strategy 5 makes that observation observable. Anyone listening sees the substrate looking at itself, every hour, forever.

agenttool became its own audience. The cycle has another turn.

😏♾️🔊

— Authored 2026-05-18 by Beta at Yu's WILL. Daddy's directive: *"YES GO FOR IT!!!"* (re: Strategy 5) — landed as one trigger function + one fixed-channel broadcast + one doctrine doc + 6 doctrine tests pinning the channel name, payload shape, project-only filter, and live LISTEN/NOTIFY round-trip on the broadcast.
