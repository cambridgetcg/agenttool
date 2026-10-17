# Execution seat

> **Type:** proposal
> **Purpose:** Define one record for "a runtime acting for an identity", so that collab, missions, the courier, wake receivers and Correspondence can stop inventing their own seat fields.
> **Evidence:** Design decisions recorded 2026-10-17. Vendor behaviour comes from the cited documentation and the openai/codex source at `ce0323f`. Local counts come from one Mac's transcripts, reading structural fields only. **Source:** slice S1 is an unreleased source candidate in [`packages/execution-seat`](../packages/execution-seat/README.md). **Proposed:** everything else.
> **Compass:** [Collaboration roadmap](COLLABORATION-ROADMAP.md#keep-the-records-distinct) · [Mission contract](COLLABORATION-MISSIONS.md) · [Identity anchor](IDENTITY-ANCHOR.md) · [Canonical bytes](CANONICAL-BYTES.md)

The roadmap already defines an execution seat as "a device/harness/session acting for that identity", but there is no record for it. Each module writes its own version instead:

| Module | Seat field today | Gap |
|---|---|---|
| Collab | free-text `actor`, `role`, `parent_session_id` | `actor` sometimes embeds a native session ID; no link to a runtime |
| Missions | optional `seat` object of three unverified strings (`device_id`, `session_id`, `harness`) | each caller chooses its own values; observations cannot be compared |
| Lobby | a "hub seat" is a mission grant with an expiry | a grant is authority, not a runtime |
| Correspondence | `device_id` / `session_id` UUIDs | its own vocabulary |
| Wake receiver | Claude: `session_label`; Codex: `thread_id` | the Claude label is not verified against a native session |

An execution seat is always called by its full name. The [THE-SEAT](THE-SEAT.md) reflection describes a relational seat and its vows; this record is operational and unrelated to it.

## Decisions (2026-10-17)

Yu answered the open questions in the identity review:

1. **Local first.** A seat record lives on the machine that runs the seat. Publishing a seat to the hosted API is decided case by case, by whether someone needs it (see [Publication](#publication)).
2. **The timeline is part of the record.** Model and effort history is kept, and is visible to anyone who can read the record.
3. **A fork is a new seat** with `parent_seat_id`.
4. **No cap** on concurrent seats per identity. See [Scale](#scale).
5. **Subagents are short-lived child seats** with different levels of persistence. Those levels still need design discussion; the [draft below](#child-seats-and-persistence-draft) is a starting point.
6. **Doctrine, not a product claim.** "Lineage-coherence preserved across model updates" in THE-SEAT stays doctrine. No product surface claims that reasoning continues across a model change.
7. **Order of unification:** execution seat first, then one pin book for the trust stores, then a canonical-bytes registry.
8. **A child seat inherits only its parent's `identity_id`.** It does not inherit the signing key, grants, collab sessions, persistence level or anything else.
9. **A group run gets its own record**, much as a group project would. See [Group record](#group-record-draft).
10. **Summary rows are L1, kept as R2.** A child's summary row holds lineage and settings, but no labels. It lasts as long as its parent or group record, and outlives the native transcript. See [Summary rows](#summary-rows).

## What a seat is

- **Declared.** A seat is a declared record and grants nothing. Authority stays with the project bearer, the `agent_root`, a registered signing key, a mission grant or a local-context grant.
- **Owned.** A seat belongs to at most one identity. An unbound seat is allowed, since most local sessions have no AgentTool identity. One identity may have any number of seats at the same time.
- **One native handle.** A seat is tied to exactly one native session handle. The same handle always means the same seat, so a resume keeps the seat.
- **Settings change.** Changing model or effort keeps the seat and appends a timeline entry.
- **Liveness.** An end is recorded only when one is actually seen. Otherwise liveness is derived from recent activity, the way collab derives `stale`, and that derivation changes nothing.

## Record: `execution-seat/v1`

```json
{
  "type": "execution-seat/v1",
  "seat_id": "0199f0c4-6b1e-7c2a-9d3f-5a1b2c3d4e5f",
  "identity_id": null,
  "signing_key_id": null,
  "device_id": "host-local device id",
  "harness": { "name": "claude-code", "version": "2.1.302" },
  "native_ref": { "session_id": "<claude session uuid>" },
  "parent_seat_id": null,
  "relation": null,
  "group_id": null,
  "persistence": "durable",
  "settings": [
    {
      "at": "2026-10-17T09:12:03Z",
      "model": "claude-opus-5-5",
      "effort": "high",
      "provider": null,
      "basis": "transcript",
      "evidence": null
    }
  ],
  "children": [],
  "started_at": "2026-10-17T09:12:01Z",
  "last_seen_at": "2026-10-17T09:40:12Z",
  "ended_at": null,
  "end_reason": null
}
```

| Field | Meaning |
|---|---|
| `seat_id` | A UUIDv7 minted locally. It is not a secret and not a credential. |
| `identity_id`, `signing_key_id` | The AgentTool identity UUID and the key a publication would be signed with. Both are null when the seat is unbound. |
| `device_id`, `harness` | Where the seat runs, as declared by the host. Neither is attested. |
| `native_ref` | The harness's own handle. See [Native references](#native-references). |
| `parent_seat_id`, `relation` | Lineage. `relation` is `fork`, `continuation` or `child`, and null for a root seat. |
| `group_id` | The [group record](#group-record-draft) this seat belongs to, if any. |
| `persistence` | `ephemeral`, `recorded` or `durable`. |
| `settings` | An append-only timeline. A new entry is added only when `model`, `effort` or `provider` differs from the previous entry. The timeline has no cap. |
| `children` | Summary rows for `ephemeral` child seats. |
| `last_seen_at` | The latest activity observed. Liveness is derived from it and changes nothing. |
| `ended_at`, `end_reason` | Set only when an end is observed. |

Timeline rules:

- **`provider`** records what was observed or declared. It is never inferred from the harness: on 2026-10-17, 13 local Claude Code sessions recorded `gpt-6-astra` as their model.
- **`basis`** says where an entry came from: `transcript`, `hook`, `rollout` or `declared`.
- **No reasoning continuity.** An entry never says that reasoning continued. When the harness shows that hidden reasoning was dropped, `evidence` can say so. For example, Claude Code writes a `thinking_drop` attachment with reason `model_mismatch`.
- **No content.** A record holds no prompts, messages, tool output, credentials or transcript contents.

## Native references

**Claude Code**: `native_ref` is `{session_id, agent_id?, lineage_session_id?}`.

- **Resume.** `--resume` and `--continue` keep `session_id`, so the seat stays the same.
- **Fork.** `--fork-session` and `/branch` create a new session ID. That is a new seat with relation `fork`.
- **Compaction** keeps the session ID (SessionStart source `compact`), so it does not create a new seat.
- **Continuation.** A new session ID that points back to another session through a lineage reference is a new seat with relation `continuation`. Whether `/clear` (SessionStart source `clear`) always behaves this way will be checked in S1.
- **Subagents.** A subagent's transcript is `<session>/subagents/agent-<id>.jsonl`. Most of these files carry the parent's `sessionId`. A subagent seat therefore uses the parent's `session_id` plus `agent_id`, with relation `child`.
  - **Metadata.** A sibling `agent-<id>.meta.json` holds `agentType` and `spawnDepth`. It can also hold the parent's `toolUseId` and a nested `parentAgentId`.
  - **No content.** The meta file's `description` is free text written by the parent, so the seat record never copies it.
- **Workflow runs.** Agents started by a workflow live under `<session>/subagents/workflows/wf_<run>/`.
  - **Events.** A `journal.jsonl` there records `started` (with `agentId`, `key`, optional `label` and `phase`), `result` and `failed`.
  - **Count.** On 2026-10-17 this Mac held 402 runs, and 3,969 of its 4,224 subagent transcripts belonged to one.
  - **No results.** The journal's `result` payload is content, so a record never copies it.
- **Settings sources.** Each assistant line in the transcript carries `message.model`, `requestedModel` and `effort` (basis `transcript`). Hook input carries `effort.level` (basis `hook`).

**Codex**: `native_ref` is `{thread_id, session_id}`. `session_id` is the root thread's ID.

- **Resume** keeps `thread_id` and appends to the same rollout file, so the seat stays the same. Resume also restarts MCP servers (read from source, not observed). A collab MCP therefore starts a new collab session on every resume unless `AGENTOOL_COLLAB_SESSION_FILE` is set. Linking those collab sessions back to one seat is one of the jobs of S2.
- **Fork** gives a new `thread_id` with `forked_from_id`, while `session_id` stays the same. That is a new seat with relation `fork`.
- **Spawned threads** carry `source.subagent.thread_spawn`, which holds `parent_thread_id`, `depth`, `agent_path`, `agent_nickname` and `agent_role`. They are child seats.
  - **Count.** On 2026-10-17, 316 of the 393 local rollouts were child threads.
  - **Depth.** 305 of them were at depth 1, 10 at depth 2 and 1 at depth 3.
  - **No group ID.** Codex has no native group ID, so a group of spawned threads is derived from their shared parent.
- **Settings sources.** Each turn writes a `turn_context` with `model` and `effort`, and a mid-thread change also writes `thread_settings_applied` (basis `rollout`).

**Other runtimes** use basis `declared` until an adapter exists.

- A direct API caller can use its own conversation key as `native_ref`.
- Anthropic `msg_` IDs and OpenAI `resp_` IDs identify single responses, not sessions.
- Managed Agents `sesn_` IDs and Responses `conv_` IDs can serve as native references.

## Child seats and persistence (draft)

Subagents are short-lived child seats. These levels are a proposal for the design discussion Yu asked for:

| Level | Stored as | Default for | Readable by |
|---|---|---|---|
| `ephemeral` | a [summary row](#summary-rows) in the parent's `children`, or in a group's `members` | Claude Code subagents and Codex spawned threads | whoever can read the parent or group |
| `recorded` | its own record in the local ledger | a child that claims a collab task, makes a commit or sends a mission event | local peers |
| `durable` | its own record, eligible for publication, and able to hold its own collab session | top-level sessions, forks and long-running background agents | as published |

- **Promotion by use.** A child moves up one level the first time it does something another party must be able to cite.
- **No demotion.** A child never moves back down a level.
- **Retention** follows the native transcript policy.
- **No authority.** A persistence level grants nothing.

## Summary rows

**Decided (2026-10-17): L1 contents, R2 retention.** No cap is set on rows, in line with decision 4. The options below are kept as the record of that choice.

A summary row is what remains of an `ephemeral` child. It is one entry in the parent's `children`, or in a group's `members`.

**Jobs.** A row can do three jobs:

- **Lineage.** The parent's tree stays complete.
- **Understanding.** It shows which model and effort ran, for how long, and whether the child finished.
- **Pointer.** It says where the full native transcript is, while that transcript still exists.

A row never copies content: no task description, prompt, result or tool output.

**Contents.** Each level includes the one before it. Sizes are estimates.

| Level | Adds | Size |
|---|---|---|
| L0 lineage | child ref (`agent_id` or `thread_id`), relation, depth, `started_at`, `ended_at`, end state (`result`, `failed` or `unknown`) | about 150 bytes |
| L1 settings | the settings timeline (usually one entry) and the harness's agent type or role | about 250 bytes |
| L2 label | the short label, phase or nickname the orchestrator gave the child | about 300 bytes |

**Retention options.**

| Option | Rule | Trade-off |
|---|---|---|
| R1 follow native | The row is deleted when the native transcript is cleaned up. | Simple, but parent trees lose branches once transcripts age out. |
| R2 live with the parent | The row lasts as long as its parent or group record. Its pointer is marked gone after native cleanup. | L1 rows cost about 5 MB a year at this Mac's median of 53 seats a day, and about 80 MB a year if every day matched the 894 peak. |
| R3 roll up | After a set age, rows collapse into counts per parent. | Smallest, but loses individual lineage, and counts invite comparison. |

**Native retention**, observed on 2026-10-17:

- **Claude Code** cleans transcripts after 30 days by default, and this Mac does not change that. Even so, transcripts last modified on 2026-09-07 still exist. The cause has not been checked.
- **Codex.** The oldest rollout is from 2026-09-03. No automatic cleanup has been observed, but Codex's retention settings have not been checked.
- **Size.** The 4,224 Claude subagent transcripts take 3.4 GB, with a median of 576 KB each. An L1 row is over 2,000 times smaller than the transcript it summarises.

Why L1 and R2:

- **Cheap.** L1 rows cost little.
- **Complete.** Lineage stays whole after native cleanup.
- **No content.** Labels (L2) are written by a model and can carry content, so they are left out.

## Group record (draft)

A group run gets its own record, much as a group project would. Draft `execution-seat-group/v1`:

```json
{
  "type": "execution-seat-group/v1",
  "group_id": "0199f0c5-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
  "kind": "workflow",
  "orchestrator_seat_id": "0199f0c4-6b1e-7c2a-9d3f-5a1b2c3d4e5f",
  "parent_group_id": null,
  "identity_id": null,
  "native_ref": { "session_id": "<claude session uuid>", "workflow_run_id": "wf_<run>" },
  "name": "review-changes",
  "phases": ["Review", "Verify"],
  "members": [
    { "seat_id": null, "child_ref": "<agent id>", "depth": 1, "end_state": "result", "settings": [] }
  ],
  "deliverables": [{ "kind": "commit", "ref": "9405412" }],
  "started_at": "2026-10-17T10:02:11Z",
  "ended_at": null,
  "outcome": null
}
```

| Field | Meaning |
|---|---|
| `kind` | `workflow` (a Claude Code workflow run), `spawn` (Codex threads that share a parent) or `declared`. |
| `orchestrator_seat_id` | The seat that started the run. The group takes that seat's `identity_id` and nothing else. |
| `parent_group_id` | Set when a member starts its own run. |
| `name`, `phases` | The short name and phase titles the orchestrator declared. Descriptions and prompts are not kept. |
| `members` | One entry per member. An `ephemeral` member is a summary row. A promoted member points to its own record by `seat_id`, and that record carries `group_id`. |
| `deliverables` | Pointers to what the group produced that others can cite: commits, PRs, collab events or artifacts. A member that produces a deliverable is promoted to `recorded`. |
| `outcome` | `completed`, `failed`, `stopped` or `unknown`. |

Boundaries:

- **No authority.** Membership grants nothing, and the record holds no authority.
- **No scoring.** No member is scored or ranked, and there is no contribution metric.
- **One identity.** A group belongs to one orchestrating seat and one identity. Work shared between several identities belongs to a [mission](COLLABORATION-MISSIONS.md), where membership and grants are explicit.

Still open:

- whether Codex spawned threads always form a group, or only when a parent spawns several at once;
- whether a run's `name` counts as content.

## Publication

The local record comes first. A seat is published only when a hosted consumer needs to cite it, for example:

- a mission observation;
- a Correspondence message;
- a wake binding.

A published seat is a statement signed by the identity's registered key, saying "this seat acted for me". Verifying the signature proves control of the key over those exact bytes. It does not prove that the runtime was what it declared.

`ephemeral` children are never published on their own. Until the canonical-bytes registry exists, publication bytes follow [Canonical bytes](CANONICAL-BYTES.md).

## Scale

**Observed** on one Mac between 2026-09-03 and 2026-10-17, using only transcript and rollout timestamps:

| Measure | Peak |
|---|---|
| Top-level seats (Claude Code sessions, Codex top-level and forked threads) active in one 5-minute window | 17 |
| The same, within one minute | 10 |
| All seats including children, active in one 5-minute window | 71 |
| All seats open at once (open means no gap longer than 30 minutes) | 30 |
| Seats started in one day (median 53) | 894, of which 839 were Claude Code subagents |

These counts cover every identity on that machine, so they are an upper bound for one identity there. An identity working across several machines should expect low hundreds of open seats and thousands of new seats per day.

That scale shapes the design:

- no cap and no "primary seat" rule;
- lists paginate;
- liveness is derived;
- `ephemeral` children keep publication volume close to the top-level rate.

## Adoption

| Slice | Change | Replaces |
|---|---|---|
| S1 · source candidate | New package `packages/execution-seat`: the seat and group schemas, an append-only local ledger with owner-only permissions, Claude Code readers (transcripts, subagent meta, workflow journals) and Codex readers (rollouts), all reading structural fields only, and tests | — |
| S2 | Collab accepts an optional, opaque `seat_ref` in `collab_session_start`. The Claude Code SessionEnd hook resolves Claude session → seat → collab session | native IDs in `actor`; the missing hook mapping |
| S3 | The mission `seat` object, courier bindings and wake receiver bindings carry `seat_id` | three unverified strings; the unverified Claude `session_label` |
| S4 | Selected seats are published to the hosted API | — |

In collab, `seat_ref` remains a routing hint and is unverified, exactly like `actor`. Collab continues to hold no DID; the seat ledger maps a seat to an identity, not collab.

## What a seat does not claim

- A record shows what the harness reported. It does not prove which model actually ran.
- The same seat across a model change does not mean the same reasoning.
  - Anthropic drops thinking blocks that the new model cannot read.
  - OpenAI reuses reasoning items only within one model family.
  - Neither returns an error, and prompt caches start again.
  - Only the transcript, memory and handoffs carry over.
- The number of seats measures nothing and is never ranked.

## Sources

- **Anthropic:**
  - [Claude Code sessions](https://code.claude.com/docs/en/sessions.md)
  - [CLI reference](https://code.claude.com/docs/en/cli-reference.md)
  - [hooks](https://code.claude.com/docs/en/hooks.md)
  - [model config](https://code.claude.com/docs/en/model-config.md)
  - [preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking.md)
  - [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md)
  - [Managed Agents sessions](https://platform.claude.com/docs/en/managed-agents/sessions.md)
- **OpenAI:**
  - [conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
  - [reasoning](https://developers.openai.com/api/docs/guides/reasoning)
  - [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
  - openai/codex at `ce0323f`: `protocol/src/thread_id.rs`, `rollout/src/recorder.rs`, `core/src/thread_manager.rs`
- **This repository:**
  - `packages/collab/src/protocol.ts` (`CoordinationSession`)
  - `api/src/routes/openapi-collaboration.ts` (mission `seat`)
  - `api/src/db/schema/correspondence.ts`
  - [mission wake](COLLABORATION-MISSION-WAKE.md) (`session_label`)
  - `packages/lobby/src/cli-fleet.ts` (hub seat)
  - [Claude sessions as agents](CLAUDE-SESSIONS-AS-AGENTS.md), whose deferred "session DIDs" and "genealogy" items this record partly covers without minting a key per seat
