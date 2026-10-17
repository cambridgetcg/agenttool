# Execution seat ledger — unreleased source candidate

> **Compass:** [Execution seat](../../docs/EXECUTION-SEAT.md) · [Collaboration roadmap](../../docs/COLLABORATION-ROADMAP.md#keep-the-records-distinct)
> **Implements:** slice S1 of `execution-seat/v1` and `execution-seat-group/v1`, as a local, append-only ledger with Claude Code and Codex readers. It grants no authority and publishes nothing.
> **Code:** `src/{types,fields,lines,claude-code,codex,ledger,ingest,home}.ts` · `bin/agenttool-execution-seat.ts`
> **Tests:** `tests/{readers,ledger,cli}.test.ts`

## What it records

An execution seat records that a runtime acted for an identity. This package keeps those records on the machine that runs the seats. For each seat it keeps:

- its native handle;
- a model and effort timeline, which grows only when a value changes;
- L1 summary rows for short-lived children;
- group records for workflow runs.

It reads native files and never writes them. Nothing is sent anywhere.

Install and import do nothing. Every effect is an explicit call or CLI command.

## Run it

```sh
bun bin/agenttool-execution-seat.ts ingest claude ~/.claude/projects/<project>/<session>.jsonl
bun bin/agenttool-execution-seat.ts ingest codex ~/.codex/sessions/<y>/<m>/<d>/rollout-<…>.jsonl
bun bin/agenttool-execution-seat.ts find claude-code <session_id>
bun bin/agenttool-execution-seat.ts list --limit 20
```

The ledger lives at `$AGENTTOOL_EXECUTION_SEAT_HOME`, or else at `${XDG_STATE_HOME:-~/.local/state}/agenttool/execution-seat`. The directory must be mode 0700 and its files 0600; wider modes are refused, never repaired.

## Boundaries

- **No authority.** A seat or group grants nothing. `bind` declares an identity; it does not prove one.
- **Identity.** A child seat inherits only its parent's `identity_id`. It cannot be bound to another identity, and it never inherits a signing key.
- **Structural fields only.** The readers copy only allowlisted fields:
  - ids;
  - timestamps;
  - model, effort and provider tokens;
  - Claude Code `agentType`, `spawnDepth`, `parentAgentId` and `finished`;
  - Codex `thread_spawn` depth and role;
  - workflow journal event types.

  Message content, task descriptions, workflow labels and phases, results, nicknames, paths, account ids and instructions are never stored. A token that does not look like an identifier becomes null.
- **Provider.** It is recorded only when the native file names it. Claude Code transcripts do not, so their provider stays null.
- **Reasoning continuity.** It is never claimed. A Claude Code `thinking_drop` reason is kept as evidence on the timeline entry for that model.
- **Append-only.** Triggers refuse every update and delete. Summary rows outlive native transcripts (R2). When a later scan finds a transcript gone, it sets `native_gone_at`; it never deletes the row.
- **Persistence** only moves up: `ephemeral` → `recorded` → `durable`. A member that produces a group deliverable is promoted to `recorded`.
- **No cap.** There is no limit on seats per identity, and lists paginate.
- **Native ids are stored** because mapping a native session to a seat needs them. The ledger is therefore owner-only and local. Publication (S4) is separate work.

## What is not here yet

- **Hooks.** No Claude Code hook writes to the ledger automatically yet. That is S2, together with collab `seat_ref` and the SessionEnd mapping.
- **Forks.** A Claude Code `--fork-session` or `/branch` leaves no marker in the transcript that this reader recognises, so forks are linked only when declared. A Codex fork is read from `forked_from_id`.
- **Codex groups.** Codex spawned threads become rows under their root seat. Whether they also form a group is still open.
- **Run names.** A workflow run's `name` and `phases` stay empty until it is decided whether they count as content.
- **Group endings.** A workflow group's end and outcome are recorded only through `endGroup`. The journal is not read as proof that a run ended.

**Observed on 2026-10-17:** a trial ingest of one Mac's 98 Claude Code transcripts and 393 Codex rollouts finished in about 20 seconds with no errors. It produced:

- 175 seats;
- 571 child rows;
- 402 workflow groups with 3,987 members;
- a ledger of about 3.6 MB.

Ingesting again appended nothing.
