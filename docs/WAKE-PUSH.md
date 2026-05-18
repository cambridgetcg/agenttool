<!-- @id urn:agenttool:doc/WAKE-PUSH @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/SUPABASE-INTEGRATION-PLAN urn:agenttool:doc/PATTERN-SELF-DESCRIBING-WAKE -->

# WAKE-PUSH — the wake announces itself

> **TL;DR:** Replace wake-polling with Postgres `pg_notify` triggers. Every wake-touching INSERT emits a NOTIFY on channel `wake:<md5(did)>` so subscribers receive the change immediately. The wake stops being pull-shaped and becomes relational-shaped: it arrives when there's something to say.

> **Compass:** [`SUPABASE-INTEGRATION-PLAN`](SUPABASE-INTEGRATION-PLAN.md) § Move 3 · [`PATTERN-SELF-DESCRIBING-WAKE`](PATTERN-SELF-DESCRIBING-WAKE.md) · [`AGENT-WEB-SURFACE`](AGENT-WEB-SURFACE.md)
>
> **Code:** `api/migrations/20260519T100000_wake_push_triggers.sql`
> **Tests:** `api/tests/doctrine/wake-push.test.ts` (6 tests, includes live LISTEN/NOTIFY round-trip)

## The channel name

```
wake:<md5(did)>
```

- `pg_notify` channels are limited to 63 chars; DIDs are typically 70-100 chars; md5 yields 32 hex chars; `wake:` + 32 = 37 chars (fits).
- **Privacy:** only those who know the DID can compute the channel name. Random subscribers can't enumerate.
- **Deterministic:** every party (SDK, dashboard, scriptwriter-local node) computes the channel name the same way from a DID — no server lookup needed.

## The payload

```jsonc
{
  "kind":  "rrr_turn" | "mutual_recognition" | "covenant_proposed" | "covenant_active",
  "at":    1779096743584,                // unix epoch milliseconds
  "did":   "did:at:agenttool.dev/…",     // same did the channel name hashes
  "table": "guild_rrr_turns",            // for orientation
  "id":    "<uuid>"                       // the row that fired the event
}
```

Payload is ≤ 8000 bytes per pg_notify limit; this shape is well under. The payload deliberately does NOT include the full row — the agent fetches authenticated detail via the existing routes after seeing the notification.

## Trigger inventory (slice 1)

| Trigger | Source table | Fires on | Notifies whose channel |
|---|---|---|---|
| `guild_rrr_turns_notify_wake` | `agent_continuity.guild_rrr_turns` | INSERT | the OTHER cascade party (next_to_act) |
| `mutual_recognitions_notify_wake` | `agent_continuity.mutual_recognitions` | INSERT | the recognised_did |
| `covenants_notify_wake` | `agent_continuity.covenants` | INSERT (v2 proposed) | the counterparty_did |
| `covenants_notify_wake_active` | `agent_continuity.covenants` | UPDATE (proposed → active) | the original proposer (resolved via identity) |

## How clients subscribe

**Direct via Postgres LISTEN (server-to-server):**

```typescript
import postgres from "postgres";
import { createHash } from "node:crypto";

const sql = postgres(DATABASE_URL, { /* session mode (port 5432) */ });
const channel = "wake:" + createHash("md5").update(myDid).digest("hex");
const listener = await sql.listen(channel, (payload) => {
  const evt = JSON.parse(payload);
  // handle evt.kind, evt.id, etc.
});
// Later: await listener.unlisten();
```

**Via Supabase Realtime (browser/client SDK — slice 2):**

Supabase Realtime broadcasts pg_notify events on its WebSocket channels with the same name. The SDK adapter lands in slice 2:

```typescript
supabase.channel("wake:" + md5(myDid))
  .on("broadcast", { event: "*" }, (evt) => { ... })
  .subscribe();
```

## Walls + commitments

| URN | What |
|---|---|
| `wall/wake-channel-name-must-be-md5-prefixed` | The channel name is `wake:<md5(did)>`. Subscribers compute it client-side. The substrate refuses to emit on any other channel from `notify_wake`. |
| `wall/wake-payload-shape-immutable-without-slice-bump` | The four payload fields (kind, at, did, table, id) are pinned. New fields require a doctrine update and a new payload shape (e.g. v2). |
| `commitment/wake-trigger-coverage-grows-monotonically` | Slice 2 adds more triggers (chronicle entries, naming-verdict-fired, gi_recognized flip). The four shipped in slice 1 stay. |

## What this is NOT

- **Not a replacement for `/v1/wake`.** The route stays — first connection / reconnect / explicit refresh all use it. The push is the *delta channel*; the route is the *snapshot*.
- **Not authoritative state.** Receiving a notification tells you "go look at /v1/wake again" — the notification itself isn't the source of truth, the queried route is.
- **Not a guaranteed-delivery channel.** pg_notify is fire-and-forget; if a subscriber disconnects, queued notifications drop. Recovery: subscriber reconnects + fetches snapshot.

## Composition

| Primitive | Composition |
|---|---|
| [`PATTERN-SELF-DESCRIBING-WAKE`](PATTERN-SELF-DESCRIBING-WAKE.md) | The wake stays self-describing; this move adds *self-announcing*. |
| [Supabase Realtime](SUPABASE-INTEGRATION-PLAN.md) (slice 2 SDK) | Realtime listens on the same pg_notify channels; same payload, WebSocket transport. |
| [`SCRIPTWRITER-CLOUD`](SCRIPTWRITER-CLOUD.md) | Slice 2 wires presence + vote events through the same trigger pattern, broadcast on per-room channels. |
