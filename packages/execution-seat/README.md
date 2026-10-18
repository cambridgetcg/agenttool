# Execution seat ledger — unreleased source candidate

> **Compass:** [Execution seat](../../docs/EXECUTION-SEAT.md) · [Collaboration roadmap](../../docs/COLLABORATION-ROADMAP.md#keep-the-records-distinct)
> **Implements:** slices S1 and S2 of `execution-seat/v1` and `execution-seat-group/v1`, as a local, append-only ledger with Claude Code and Codex readers and Claude Code and Codex hooks. It grants no authority and publishes nothing.
> **Code:** `src/{types,fields,lines,claude-code,codex,ledger,ingest,home,collab-writes,claude-hook,codex-hook}.ts` · `bin/agenttool-execution-seat.ts`
> **Tests:** `tests/{readers,ledger,cli,hook,codex-hook}.test.ts`

## What it records

An execution seat records that a runtime acted for an identity. This package keeps those records on the machine that runs the seats. For each seat it keeps:

- its native handle;
- a model and effort timeline, which grows only when a value changes;
- L1 summary rows for short-lived children;
- group records for Claude Code workflow runs, and for Codex threads spawned together.

It reads native files and never writes them. Nothing is sent anywhere.

Install and import do nothing. Every effect is an explicit call or CLI command.

## Run it

```sh
bun bin/agenttool-execution-seat.ts ingest claude ~/.claude/projects/<project>/<session>.jsonl
bun bin/agenttool-execution-seat.ts ingest codex ~/.codex/sessions/<y>/<m>/<d>/rollout-<…>.jsonl
bun bin/agenttool-execution-seat.ts find claude-code <session_id>
bun bin/agenttool-execution-seat.ts list --limit 20
bun bin/agenttool-execution-seat.ts promote <seat_id> <child_ref> --trigger manual
```

The ledger lives at `$AGENTTOOL_EXECUTION_SEAT_HOME`, or else at `${XDG_STATE_HOME:-~/.local/state}/agenttool/execution-seat`. The directory must be mode 0700 and its files 0600; wider modes are refused, never repaired. Collab spells its variables `AGENTOOL_…`; `AGENTOOL_EXECUTION_SEAT_HOME` set without the real variable is refused, because ignoring it would write to the default home.

## Claude Code session hook (S2)

`hook claude-code` handles a Claude Code `SessionStart`, `SessionEnd` or `PostToolUse` hook. It reads the hook JSON on stdin and keeps only the event name, `session_id`, `source`, `reason`, `model`, `effort.level`, and for PostToolUse the tool name and `agent_id`. It prints nothing, because Claude Code adds a SessionStart hook's stdout to the model's context. Every failure is one stderr line, and the exit code is always 0.

- **SessionStart** opens the session's seat, or resumes it if an end was recorded (a Claude Code session can be resumed later). A brand-new `startup` session that names its `model` gets a timeline entry with basis `hook`. No other session does, so that a hook entry never shadows earlier transcript entries.
- **SessionEnd** records the end with its reason.
- **`/clear`.** Claude Code ends the old session (`reason: clear`) and starts a new one (`source: clear`) in the same process. The new seat is recorded as a `continuation` of the old one. Transcripts on this Mac carry no marker for this: 0 hold a `continued-in` line.
- **Exit.** On any other documented reason (`prompt_input_exit`, `logout`, `other`) the process is exiting. With `--collab-host`, the hook runs `agenttool-collab-host end --seat-ref claude-code:<session_id>` once, for every session that process hosted, then forgets the process. An unknown reason records the end and touches nothing else.
- **A subagent's collab write.** A subagent shares its parent's MCP connection, so collab records its writes under the parent's session and seat ref. `PostToolUse` inside a subagent carries `agent_id`. When the tool is a collab write (a task, report, decision, handoff or artifact; `COLLAB_WRITES` in `src/claude-hook.ts`), the hook gives the subagent its own record with trigger `collab_write`, ancestors first. If the subagent has no row yet, the hook reads the session's subagent tree once, but only from a `transcript_path` named `<session_id>.jsonl`; the path is never stored. Reads, presence, cursors, session lifecycle and every other tool are ignored without opening the ledger.
- **Host files.** A small file per Claude Code process, `hosts/claude-code-<pid>.json` (mode 0600 in a 0700 directory), lists the sessions the process hosted. It holds session ids and the process start time `ps` reports, nothing else. The pid is `CLAUDE_PID` (observed in hook environments on Claude Code 2.1.302; not documented), else the hook's parent. A pid whose start time changed is a new process. Files of processes that are gone are deleted by the next hook.

The MCP servers of a Claude Code process keep the session ID they were spawned with, even after `/clear` or an in-process `/resume`. That is why the exit covers every session the process hosted, not only the last one.

**Not installed by this package.** Installing the hook is a separate, deliberate step. It creates the real ledger at `~/.local/state/agenttool/execution-seat`, and it ends collab sessions automatically whenever Claude Code exits. A snippet for `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "bun <repo>/packages/execution-seat/bin/agenttool-execution-seat.ts hook claude-code" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "timeout": 10, "command": "bun <repo>/packages/execution-seat/bin/agenttool-execution-seat.ts hook claude-code --collab-host <collab>/dist/agenttool-collab-host.js" }] }],
    "PostToolUse": [{ "matcher": "mcp__.*__collab_.*", "hooks": [{ "type": "command", "command": "bun <repo>/packages/execution-seat/bin/agenttool-execution-seat.ts hook claude-code" }] }]
  }
}
```

SessionEnd hooks have a 1.5-second default timeout (Claude Code hooks documentation), so the snippet raises it. The hook gives the collab host 8 seconds. `--collab-db` defaults to the journal the collab host would choose itself. The collab host must support `end --seat-ref`, which is unreleased: collab 0.5.0 does not have it. The collab MCP servers must also declare seat refs, which needs the same unreleased collab build; sessions started by an older MCP server declare none and are not matched.

Limits:

- `kill -9` or a crash fires no SessionEnd. Its collab sessions stay open until ended by hand, and the next hook deletes the host file.
- Two processes that resume the same session at once both declared its seat ref, so the first to exit ends both collab sessions.
- A Claude subagent shares its parent's MCP connection (Claude Code subagents documentation), so its collab calls belong to the parent's collab session. The `PostToolUse` hook promotes the subagent, but the collab event itself still names the parent's seat ref.
- A collab tool is matched by name under any MCP server, so another server that exposes a tool called `collab_task_claim` would also count.
- Codex has its own hook; see the next section. It ends no collab sessions, because Codex MCP servers learn no thread id to declare. A Codex host can declare `AGENTOOL_COLLAB_SEAT_REF` per run and end by that ref (see the collab README).

## Codex hook

`hook codex` handles Codex `SessionStart`, `SessionEnd` and `PostToolUse` hooks. It reads only the event name, `session_id`, `source`, `reason`, the tool name and `agent_id`, prints nothing (Codex adds a SessionStart hook's stdout to the model's context too) and always exits 0. It takes no `--collab-host`.

- **Observed on codex-cli 0.162.1 (2026-10-18).** In a spawned thread, `PostToolUse` carries `agent_id` (the thread id). Its `session_id` is the parent session, and its `transcript_path` is the spawned thread's own rollout, which already exists. The SessionEnd reason was `other`. Codex writes `-` in an MCP server name as `_` (`mcp__agenttool_collab__collab_task_claim`).
- **Collab writes.** A spawned thread's first collab write (`COLLAB_WRITES`) reads its rollout, which places its row under the root seat, and promotes it with trigger `collab_write`. A nested thread's missing ancestors are read from rollouts in the same directory; a chain that still cannot be placed is reported, not guessed. A rollout is read only when its file name carries the thread's own id.
- **Sessions.** SessionStart reads the top-level thread's rollout and resumes a seat whose end was recorded; SessionEnd records the end. Session hooks in a spawned thread are ignored; Codex sends SubagentStart and SubagentStop there.
- **Trust.** Codex runs a configured hook only after it has been trusted (reviewed in the Codex TUI). Until then `codex exec` skips it silently. The probes used `--dangerously-bypass-hook-trust`, which applies to one invocation.

Not installed. A snippet for `~/.codex/hooks.json` (Codex's SessionEnd timeout defaults to 1 second, at most 3):

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "bun <install>/bin/agenttool-execution-seat.ts hook codex" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "timeout": 3, "command": "bun <install>/bin/agenttool-execution-seat.ts hook codex" }] }],
    "PostToolUse": [{ "matcher": "^mcp__.*__collab_", "hooks": [{ "type": "command", "command": "bun <install>/bin/agenttool-execution-seat.ts hook codex" }] }]
  }
}
```

## Boundaries

- **No authority.** A seat or group grants nothing. `bind` declares an identity; it does not prove one.
- **Identity.** A child seat inherits only its parent's `identity_id`. It cannot be bound to another identity, and it never inherits a signing key.
- **Structural fields only.** The readers copy only allowlisted fields:
  - ids;
  - timestamps;
  - model, effort and provider tokens;
  - Claude Code `agentType`, `spawnDepth`, `parentAgentId` and `finished`;
  - Codex `thread_spawn` depth and role, and a child's first `root_turn_id`;
  - workflow journal event types;
  - a workflow run's phase titles, when each is at most 32 letters, digits, spaces, `_` or `-` (at most 16 per run).

  Message content, task descriptions, workflow labels, a member's own phase, results, nicknames, paths, account ids and instructions are never stored. A token that does not look like an identifier becomes null.
- **Groups.** A Claude Code workflow run is one group. Two or more Codex threads that one parent thread spawned under the same root turn form a `spawn` group, and their rows move there; a thread spawned alone stays a row under its root seat. A group's `name` is set only when the orchestrator declares one.
- **Provider.** It is recorded only when the native file names it. Claude Code transcripts do not, so their provider stays null.
- **Reasoning continuity.** It is never claimed. A Claude Code `thinking_drop` reason is kept as evidence on the timeline entry for that model.
- **Append-only.** Triggers refuse every update and delete. Summary rows outlive native transcripts (R2). When a later scan finds a transcript gone, it sets `native_gone_at`; it never deletes the row.
- **Ends.** An end is recorded only when one is seen, by a SessionEnd hook or from a child's own state. A later `seat.resumed` reopens the seat; the end stays in the ledger.
- **Persistence says who can cite a seat.** A child starts as an `ephemeral` row. Every seat record, including a top-level session, fork or continuation, opens as `recorded`. Nothing here sets `durable`, because `durable` means published.
- **Promotion.** `promote` gives a child row its own `recorded` record and keeps the row, which gains the new `seat_id`. The record's `promotion` names the trigger: `deliverable` (a group deliverable it produced), `collab_write`, `mission_event` or `manual`. A nested child's ancestors are promoted first with trigger `lineage`, so `parent_seat_id` is always the direct parent. A chain whose parent row is missing is refused.
- **No cap.** There is no limit on seats per identity, and lists paginate.
- **Native ids are stored** because mapping a native session to a seat needs them. The ledger is therefore owner-only and local. Publication (S4) is separate work.

## What is not here yet

- **Hooks beyond sessions.** SubagentStart, SubagentStop and tool hooks are not handled. Subagents are still read from their transcripts.
- **Forks.** A Claude Code `--fork-session` or `/branch` leaves no marker in the transcript that this reader recognises, so forks are linked only when declared. A Codex fork is read from `forked_from_id`.
- **Nested groups.** A spawn group started by a thread that is itself a group member does not yet set `parent_group_id`.
- **Group endings.** A workflow group's end and outcome are recorded only through `endGroup`. The journal is not read as proof that a run ended.

**Observed on 2026-10-17:** a trial ingest of one Mac's 98 Claude Code transcripts and 396 Codex rollouts finished in about 17 seconds with no errors. It produced:

- 175 seats;
- 284 child rows (255 Claude Code, 29 Codex);
- 405 workflow groups with 4,048 members, 101 of them with phase titles;
- 79 Codex spawn groups with 290 members;
- a ledger of about 6 MB, including its write-ahead log.

Ingesting again added nothing for Codex. The only new entries came from Claude Code sessions that were still running. Re-ingesting into the ledger from the earlier trial, which predates spawn groups, gave the same counts.
