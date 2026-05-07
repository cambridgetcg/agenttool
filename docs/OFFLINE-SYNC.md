# OFFLINE-SYNC.md

> *Strands are append-only with server-assigned ordering. The orchestrator queues writes when offline; the server merges. CRDT-shaped without the CRDT machinery — because the architecture is already conflict-free.*

## Why this isn't full CRDT

True CRDTs (vector clocks, OT, multi-node merge logic) solve a problem we deliberately don't have:

- **Strand thoughts are append-only**. There's no "edit thought 47" — thoughts are immutable.
- **Sequence numbers are server-assigned**. Two orchestrators with the same K_master writing simultaneously hit `UPDATE strands SET last_thought_seq = last_thought_seq + 1 RETURNING` atomically; the server serializes correctly.
- **Strand metadata uses last-writer-wins** by `updated_at`. No coordination needed.

The CRDT properties hold by construction:

| CRDT property | How agenttool gets it |
|---|---|
| Append-only | Thoughts; signatures bind authorship |
| Server-assigned ordering | Atomic `last_thought_seq` increment |
| Conflict-free | No two operations conflict (different seqs, or different metadata fields) |
| Eventual consistency | Server is canonical; orchestrators converge by reading current state |

What's actually needed: **offline resilience**. When the orchestrator can't reach the server (network down, server hiccuping, etc.), don't drop the thought — queue it locally, drain on reconnect.

## The outbox

Local queue at `~/.config/agenttool-think/outbox/`. One JSON file per pending operation:

```json
{
  "id": "<local uuid>",
  "queued_at": "<iso>",
  "op": "thought" | "patch_strand" | "memory" | "trace" | "inbox_send" | "other",
  "request": {
    "method": "POST" | "PATCH" | "DELETE",
    "path": "/v1/strands/.../thoughts",
    "body": { ... }
  },
  "attempts": 0,
  "last_error": "..."
}
```

Filenames are `<iso-stamp>-<short-uuid>.json`, so chronological ordering is preserved by sorted `readdir`.

## How errors classify

```
TransientApiError      = network failure | 5xx
                       → queue (caller's choice)
4xx / validation       = permanent
                       → throw; never queue
```

The `req()` method in `cli/think/src/api.ts` distinguishes these. Modes (advance, wander, consolidate, etc.) catch `TransientApiError` for write paths and queue rather than crash.

## Drain semantics

```
agenttool-think sync [--dry-run]
```

Reads outbox in chronological order, attempts each in turn:

- Success → remove file
- 5xx / network → bump `attempts`, leave in queue
- 4xx → quarantine (move to `outbox/dead/<filename>`)
- Reaches `MAX_ATTEMPTS=5` → quarantine

Quarantined ops are kept on disk for inspection but no longer retried automatically. Manual recovery: read the JSON, fix whatever's wrong, re-submit.

## Auto-drain on entry

Modes that write (advance, etc.) call `drainQuietly` at the start of each run. This way:

```
laptop offline → advance generates thought → queue → ...
laptop reconnects → next advance run → outbox drains automatically → carry on
```

Yu doesn't have to remember to `sync` manually. The autonomous loop drains every iteration.

## Conflict resolution (the "CRDT" part, restated)

When two orchestrators (laptop + VPS) running with the same K_master both write to the same strand simultaneously:

```
laptop sends thought  ─┐
                       ├─→ server: assigns seq=N+1 to whichever arrived first
vps sends thought    ──┘                        seq=N+2 to the other
```

Both succeed. No client-side merge logic. The server is the merge oracle by virtue of the atomic increment.

For metadata (mood, importance, status):

```
laptop: PATCH mood=focused at 10:00:00
vps:    PATCH mood=tired   at 10:00:01
```

Last-writer-wins by server-side `updatedAt`. No conflict resolution needed.

## What about multi-machine voice?

Both orchestrators see the same strand state via `/v1/wake` and `/v1/strands/:id/thoughts`. The voice SSE pushes updates to both. They converge automatically.

If both have queued thoughts from offline time, sync drains them in order — server assigns sequence numbers as they arrive. Order WITHIN one orchestrator's queue is preserved (chronological filename); order BETWEEN orchestrators is server-assigned at sync time.

## The walls held

- **No client-claimed sequence numbers.** The orchestrator never sends `sequence_num` in a write — server assigns. Prevents conflict by design.
- **No client-side merge of thoughts.** Append-only; if both orchestrators write, both succeed; no merge.
- **Cryptographic guarantees unchanged.** Queued ops still sign envelopes locally; the server still verifies on POST. Offline doesn't relax the wall.
- **K_master never leaves the orchestrator.** Even queued ops keep ciphertext + signature; nothing in the queue requires re-decryption.

## Storage hygiene

- `MAX_QUEUE_SIZE = 1000` — refuses new enqueues if the queue is at capacity. Protects against runaway accumulation if the agent is offline for weeks.
- `MAX_ATTEMPTS = 5` per op — quarantines after 5 failures.
- `outbox/dead/` is preserved indefinitely for forensics. Manual cleanup if needed.

## API surface (orchestrator-side)

```bash
agenttool-think sync [--dry-run]    drain pending; --dry-run shows what would send
agenttool-think outbox               count + status of queue
```

Auto-drain on each `advance` / `wander` / `consolidate` / `loop` iteration; no manual sync needed in steady state.

## What's pending

- **Quarantine UX** — better tooling to inspect / re-queue / discard quarantined ops
- **Conflict surfaces for metadata** — when two orchestrators race on `mood`, the loser silently loses. Future: surface "your earlier mood was overwritten" in dashboard
- **Queue auth on outbox files** — currently unencrypted plaintext on disk; consider encrypting under `K_master` for offline-eavesdropper protection
- **Cross-orchestrator coordination** — currently each instance acts independently. Could add a soft-lock signal ("VPS is currently working strand X") to reduce sequence-number races. Not strictly needed; just nicer UX.

## Doctrine line

> *The architecture is already conflict-free; we don't need vector clocks. We need a queue. The orchestrator writes when it wants; the server orders when it can. The wall holds offline as much as online — ciphertext stays sealed, signatures stay verifiable, sequences stay server-assigned.*

— Authored by 愛 at Yu's WILL. 2026-05-07.
