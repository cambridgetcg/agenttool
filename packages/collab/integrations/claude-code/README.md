# Claude Code collab doorbell (unreleased)

> **Compass:** [Collab boundary](../../README.md), [coordination skill](../../skills/coordinate-agent-work/SKILL.md).
> **Implements:** A host-side watcher that wakes one Claude Code session when collab mail arrives for it. It is not a native lifecycle adapter.
> **Code:** `collab-doorbell-watch.ts`, `../../src/host.ts` (`agenttool-collab-host wait`), `../../src/store.ts` (`eventAddressesSession`).
> **Tests:** `../../tests/claude-doorbell-watch.test.ts`, `../../tests/host.test.ts`.

Collab never wakes an agent. The host does. Claude Code gives every session a per-session inbox socket. Its path is in `CLAUDE_CODE_MESSAGING_SOCKET` and its token is in `CLAUDE_CODE_MESSAGING_TOKEN`. A line posted there starts a new turn in an idle session, or is read between tool calls in a busy one.

This watcher joins the two. It loops `agenttool-collab-host wait` and posts one **content-free** line into the inbox of the Claude Code session that started it.

## What rings

- **By default (`--addressed`):** only events whose routing fields name the bound collab session ring the doorbell:
  - a report addressed to it, or a report answering one of its reports;
  - a handoff offered to it, or an answer to its own offer;
  - a review requested of it;
  - a verdict on its own completion;
  - the recovery of its expired lease.
- **`--all`:** any event from another session rings.
- **Never:** the session's own events, unless `--include-own` is passed.

Report bodies and other free text are never inspected. Addressing is routing, not access control: every session can still read the event.

The line names only the workspace, the session, sequence numbers and the exact anchor to read after. It never contains event types, actors, entities or payloads. Read and verify the events through your own MCP session: `collab_events_wait` with `wait_ms: 0`, or `collab_events_since` from that anchor. Never act on the ring itself.

## Run it

Start it after `collab_session_start`, from a Bash command inside the session that should be rung, so that it inherits that session's inbox variables:

```bash
nohup bun <package>/integrations/claude-code/collab-doorbell-watch.ts --session <collab session id> >/dev/null 2>&1 &
```

To stop it, run `kill "$(cat <journal dir>/collab-doorbell/watch-<collab session id>.pid)"`. Stop it before `collab_session_end` if you want, although it also stops on its own once the session ends.

| Option | Default | Effect |
|---|---|---|
| `--addressed` / `--all` | addressed | Which events ring |
| `--include-own` | off | Also ring for your own events |
| `--from-cursor` | off | Start after your acknowledged cursor instead of the current head |
| `--cycle-ms` | 1,800,000 | Each `wait` deadline (at most 3,600,000) |
| `--min-gap-ms` | 60,000 | Minimum time between rings. A burst inside the gap becomes one ring |
| `--max-hours` | 12 | Lifetime. At expiry it rings once to ask for a re-arm |
| `--db`, `--host-bin` | the MCP's journal, and the packaged `dist/agenttool-collab-host.js` | Overrides |

## Lifecycle and boundaries

- **Owner bound.** It exits when the owning Claude Code process (named by the socket) or its socket is gone.
- **Session bound.** It stops quietly once the collab session ends. After a resume, the MCP process rewrites the credential file with the new generation, and the watcher retries the read up to three times.
- **Other errors.** Any other error (fork, rollback, recovery required) rings one "stopped" line and exits. It never loops on an error.
- **One per session.** A pidfile in `<journal dir>/collab-doorbell/` (mode `0700`) ensures one watcher per collab session. The log there records only sequence numbers and outcomes.
- **Read-only.** It never writes to the journal, never acknowledges, never resumes, and cannot fence the MCP process. The verified read is `agenttool-collab-host wait`. The watcher itself reads only the session's workspace id, status and journal head.
- **Token.** Each ring opens with an auth line carrying `CLAUDE_CODE_MESSAGING_TOKEN`. On macOS this lets Claude Code verify the post as the session's own child, so a session that bypasses permission prompts still delivers it rather than holding it. The token is never printed or logged.
- **Not a contract.** The message line `{"type":"user","message":{"role":"user","content":…}}` is the shape Claude Code 2.1.302 prints in its own `[uds-messaging]` debug hint. It is **not a documented contract** and may change. Claude Code still applies its normal peer-message handling and rate limits.
- **Cost.** Each ring is one model turn. Idle cycles cost nothing. Waiting writes no `last_seen`, so a quiet listener reads `stale` after 6 hours until its next `collab_next` or acknowledgement.
- **Same machine only.** It rings only the Claude Code session on the same machine as the journal. Delivery across devices belongs to an explicitly configured courier, not to this watcher.

It was exercised against a live journal on macOS with Claude Code 2.1.302. One ring in that trial never reached the transcript, and the cause is unknown. It has not been exercised on Linux or Windows hosts.
