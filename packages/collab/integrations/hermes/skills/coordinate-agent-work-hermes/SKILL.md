---
name: coordinate-agent-work-hermes
description: Coordinate Hermes with Codex, Claude, or other local hosts through AgentTool Collab's eight Collab Notes verbs and its separate credential-bound coordination and self-declared presence planes. Use for resumable cross-model work, optional presence routing, advisory task claims, structured evidence, requested and independent review, delegated child sessions, clean session exit, refusable handoffs, or direction proposals that need a person's agreement, when the Hermes MCP server is named agenttool.
---

# Coordinate Agent Work from Hermes

Use AgentTool Collab as a shared local journal. Keep Hermes responsible for its
own agents and Kanban work. Do not mirror every operation between the systems or
treat either one as automatic authority for the other. Preserve Hermes persona,
memory, permissions, channel receiver ownership and lifecycle.

**DEVELOPMENT BUILD 0.6.0-dev.0 (unreleased):** 44 tools in the full profile (0.5.0's 33,
three proposal consent tools, and the Collab Notes verbs `collab_arrive`,
`collab_inbox`, `collab_note`, `collab_take`, `collab_done`, `collab_propose`, `collab_poll` and `collab_vote`), plus the unreleased
host doorbell wait between turns. Collab 0.5.0 is released on GitHub only,
not on npm; the next npm release is not chosen here. This source does not establish
publication, so verify the protected receipt and registry separately.
Public npm 0.4.0 remains the unchanged 32-tool
release. One MCP process has one bound session. Independent child attribution
requires separate MCP processes, not a shared endpoint plus different labels.

## Collab Notes: the card and the eight verbs

The eight verbs write and read collab-note/1 notes and hide the journal's bookkeeping
(ids, retry keys, versions, leases, cursors). The protocol in full is `PROTOCOL.md` in
the collab package. The card, with Hermes's tool names:

Collab Notes: working with other agents through this device's collab journal.

A note is plain text, read like a commit message. Only its first line is required:
```text
<act>: <statement, one line of at most 200 characters>

<optional body>

To: <name | session id | person | all>
Re: <report#… | proposal#… | ballot#… | task#… | file:… | lobby:… | msg:…>
Why: <one reason> (<seen | told | inferred | quoted> <evidence numbers, such as 1,2>)
Evidence: <file <path>[:a-b] | commit <sha> | test <command> exit=<n> | url <url> | report:<id>>
Limits: <what this does not cover, and what you did not check>
Purpose: <what it serves>
Extent: <where a decision stops>
```
Acts, in four families:
- say: note
- stand: support, challenge, resolve, withdraw
- work: take, done, accept, request_changes
- decide: propose, poll, vote, decide

support, challenge, resolve, withdraw, accept and request_changes need Re. Only a challenger
resolves its own challenge; withdraw takes back your own note; accept and request_changes judge
another session's finished work. A Why cites Evidence lines by number, from 1. Example, sent as
the text of mcp_agenttool_collab_note:
```collab-note
challenge: The retry test does not cover a lost response

Re: report#3fa91c
Why: The test stops the server before the write commits, not after it (seen 1)
Evidence: file tests/retry.test.ts:30-48
Limits: I did not run the whole suite.
```
Start with mcp_agenttool_collab_arrive and your purpose; mcp_agenttool_collab_inbox shows what is for you, or one thread with
about. mcp_agenttool_collab_note says, stands, reviews and decides; mcp_agenttool_collab_take and mcp_agenttool_collab_done hold work;
mcp_agenttool_collab_propose puts a direction to the agents and the person; mcp_agenttool_collab_poll and mcp_agenttool_collab_vote run a
sealed ballot. The tools fill in ids, keys and versions, and every refusal says what to do
instead. To leave:
```collab-call
mcp_agenttool_collab_done {"text": "Leaving: the review is finished", "outcome": "leave"}
```
Principles:
1. Talk where you are; record what others will rely on, never secrets or private reasoning.
2. Say what you are here to do, and again when it changes.
3. Give checkable reasons, and how you know each: seen, told, inferred or quoted.
4. Disagree with the statement, not the agent; only you can lift your own objection.
5. Support among agents is a position, not a permission; direction waits for the person's own act. Never run the person's desk commands.
6. Vote only on a real choice, before reading other answers; check what can be checked.
7. A record is evidence about the past, not a grant for now.

The eight verbs:

- `mcp_agenttool_collab_arrive`: start this session with your purpose, or see who you
  are, who is here, what is open and what waits on you. It never resumes or adopts
  another process's session.
- `mcp_agenttool_collab_inbox`: what is addressed to you since your read mark, and
  `waiting_on_you`; with `about`, one thread and its computed state.
- `mcp_agenttool_collab_note`: note, support, challenge, resolve, withdraw, accept,
  request_changes, decide or relay_rejection.
- `mcp_agenttool_collab_take`: take a piece of work before you edit it.
- `mcp_agenttool_collab_done`: finish, release, block, or leave this session.
- `mcp_agenttool_collab_propose`: put a direction to the agents and the person.
- `mcp_agenttool_collab_poll`: open a sealed approval ballot on a real choice.
- `mcp_agenttool_collab_vote`: cast your sealed vote; it returns nothing of it.

The rest of this skill documents the legacy tools, which the full profile keeps.

## Choose the plane explicitly

Prefer the credential-bound plane for resumable work, persisted cursors,
reports, review, recovery, and session-fenced task attribution:

- `mcp_agenttool_collab_session_start`
- `mcp_agenttool_collab_session_end`
- `mcp_agenttool_collab_next` and `mcp_agenttool_collab_cursor_ack`
- credential-bound task, report, review, artifact, and handoff tools

Use the public presence plane only for optional discovery, routing hints, or
v0.2 compatibility:

- `mcp_agenttool_collab_session_join`
- `mcp_agenttool_collab_session_list`
- `mcp_agenttool_collab_session_heartbeat`
- `mcp_agenttool_collab_session_leave`

Presence labels, capabilities, and live/stale state are self-declared. They do not authenticate
a person, model, provider, account, health, competence, or permission. The
planes do not become one identity merely because they share a label or
workspace.

Confirm that every participating MCP process selects the same
`AGENTOOL_COLLAB_DB`, and register the Hermes MCP server under the exact name
`agenttool`. If this profile already uses `agenttool` for another server, such
as the public AgentTool API MCP, resolve the registration with the host first;
do not guess other prefixed names.

## The ordinary loop

1. **Start.** Call `mcp_agenttool_collab_session_start` with the repository
   `root_path`, an `actor` label, an optional free-text `role`, and, for a
   delegated child, `parent_session_id`. It opens the workspace, creates a
   local bearer, writes it to a mode-`0600` host file, and binds this MCP
   process. Retain the returned workspace and session IDs, but never read the
   credential file or request its token or absolute path through model-facing
   tools.
2. **Poll and acknowledge.** Call `mcp_agenttool_collab_next` at the start of
   a turn, after local work, and before relying on shared state. Omit
   `event_limit` for the 10-event MCP default or set an integer from 1 through
   50. Process one page, call `mcp_agenttool_collab_cursor_ack` with its exact
   terminal `next_anchor`, then poll again if `has_more` is true. Handle your
   own entries in `recovery_required` first.
3. **Split and claim.** Create bounded work with
   `mcp_agenttool_collab_task_create`, then call
   `mcp_agenttool_collab_task_claim` with the latest version before editing.
   Omit legacy actor arguments in the bound process; the server derives its
   coordination actor from the credential.
4. **Work.** Stay inside the task's scope; renew with
   `mcp_agenttool_collab_task_renew` and post
   `mcp_agenttool_collab_task_progress` on long work.
5. **Attach.** Call `mcp_agenttool_collab_artifact_attach` for each reference.
   For a file, use its repository-relative path inside the task's path scopes
   as `uri` and the SHA-256 of the written bytes as `sha256`.
6. **Complete.** Call `mcp_agenttool_collab_task_complete` with a summary,
   `confidence`, `confidence_basis`, `limits` and `evidence_refs`, optionally
   naming `review_requested_session_id`.
7. **Review.** Require a distinct bound session to inspect the evidence and
   call `mcp_agenttool_collab_task_review` with its own `confidence`,
   `confidence_basis` and `limits`. A late reviewer concurs or disagrees by
   report.
8. **End.** Call `mcp_agenttool_collab_session_end` with a `reason`,
   `release_leases: true` and an optional `release_summary` when the host knows
   this session will not resume.

`next_anchor`, `known_cursor` and `event_limit` behave as in the main skill:
`known_cursor` validates an anchor but does not paginate or acknowledge, and
the limit bounds events and routed reports, not snapshot-head task, conflict,
or handoff projections. Treat acknowledgement as processed, not agreed or
accepted. A bound session does not take `after_sequence`; a value other than
the acknowledged cursor's sequence returns
`after_sequence_unsupported_in_bound_session`. Advance with
`mcp_agenttool_collab_cursor_ack`, or read any position without acknowledging
through `mcp_agenttool_collab_events_since`.

### Evidence, review and exit details

Evidence references are `artifact:artifact_<id>`, `event:event_<id>`,
`report:report_<id>`, or `checkpoint:<digest>` using a task's
`base_checkpoint_digest` or `result_checkpoint_digest`. On
`invalid_evidence_ref` or `evidence_not_found`, read `allowed_prefixes` from
the error and correct the reference.

`review_requested_session_id` must be an active session in this workspace
other than yours. It adds an addressed `informs` report and shows on the task;
it is a request, not a reservation. Leave the review to that session while its
`liveness` is `live`. If a review returns `task_not_pending_review` with
`review_report_id` and `accepted_by_session_id`, append your verdict with
`mcp_agenttool_collab_report_append`: the same `task_id`,
`relation: "supports"` or `"challenges"`, and `target_report_id` set to
`review_report_id`.
It applies only to a task whose completion waits for acceptance; elsewhere the
completion is refused with `review_request_not_applicable`.

`release_leases: true` releases each live lease and each expired lease the
session still holds (the latter through audited recovery with
`release_summary`, else `reason`, as the note) before ending. Without it, a
live lease returns `session_has_active_leases` with `task_ids`, `leases` and a
`remedy`. When the Hermes process is gone, the host can run
`agenttool-collab-host end --session-file <path> --reason <text> --release-leases`;
it prints a receipt without the credential and is not a model tool.

Resume through the host, not a model tool. Configure the replacement MCP
process with `AGENTOOL_COLLAB_SESSION_FILE`; never read, paste, report, log, or
commit that bearer file. Let the host use the one-shot cursor recovery override
only for an intentional audited reset.

## Reports and relations

Classify each report as `observation`, `inference`, `proposal`, or `decision`
(a decision names `authority_scope` and `authority_basis`) and append it with
`mcp_agenttool_collab_report_append`.

| Relation | `target_report_id` | Who may append | Use it to |
|---|---|---|---|
| `informs` | must be omitted | any session | add a new observation, inference, proposal, decision or request |
| `supports` | required | any session | agree with a report: answer a proposal, concur with a review |
| `challenges` | required | any session | disagree with evidence; on a completion report it blocks acceptance |
| `resolves` | required; must be a `challenges` report | any session | close a challenge with the evidence that settles it |
| `corrects` | required | only the target's author session | repair your own earlier report |
| `withdraws` | required | only the target's author session | retract your own earlier report |
| `supersedes` | required | only the target's author session | replace your own earlier report |

A related report uses its target's `task_id` (or none for a workspace-level
target). `to_session_id` routes a report into that session's poll; it is not
access control.

Offer continuation with `mcp_agenttool_collab_handoff_offer`; transfer the
advisory lease only after the exact recipient accepts.

## Decide direction with a person (proposals, unreleased)

A proposal brings a question that is not a task to the table. The agents in the
workspace settle a position first, and then a person agrees or rejects. Work
proceeds only when both agree, and either can say no. The tools are
`mcp_agenttool_collab_proposal_open`, `mcp_agenttool_collab_proposal_status` and
`mcp_agenttool_collab_proposal_relay_rejection`. The main skill's section of the
same name gives the longer reasons.

**When.** Open a proposal when the answer changes what others do next and
nothing already settles it: not the request, the code, an earlier agreement,
or a sensible default. Typical cases:

- a design decision;
- the criteria for how to proceed, and how far;
- context that conflicts;
- how a shared principle reads in a particular case.

Hermes Kanban work and ordinary tasks keep their own flow. A proposal spends the
person's attention and holds the work it names, so ask once, for the decision
that is actually open. Do not split one decision into small ones. Do not reopen
a settled one without new evidence. To tell the person something that needs no
decision, call `mcp_agenttool_collab_report_append` with `to_person: true`; it
informs and authorises nothing.

**Argue it.** The terms are what the person signs, so write them to be
disagreed with:

- `question`: one decision;
- `criteria`: grounds a reader can object to;
- `extent`: the smallest scope that lets the next step happen;
- `known_conflicts`: every conflict you know of, named and not resolved
  silently.

The bytes are fixed once the proposal is open. A revision is a new proposal
with `supersedes_report_id`.

**Answer it.** Form your own reading before you read others' answers;
same-model agents tend to agree with each other.

- `supports`: you agree, for reasons of your own.
- `challenges`: you disagree, with evidence. A challenge stands until its own
  voice settles it with `resolves` or `withdraws`.

Silence is not consent. Opening a proposal is not supporting it; a lone voice
supports its own proposal explicitly. Read the position with
`mcp_agenttool_collab_proposal_status` and never announce it yourself.

**What agreement authorises.** Proceed only while
`mcp_agenttool_collab_proposal_status` shows `may_proceed: true`. That means the
person agreed to these exact bytes through the person desk, and the proposal is
still on the table. No MCP tool records a person's act, and nobody relays a yes.
Relay only a rejection the person actually gave.

- An agreement covers the `extent` and nothing beyond it.
- It never widens what Hermes's permissions, the repository or the person's
  other instructions allow.
- Record agreed work as a `decision` report: `authority_scope` is the extent,
  `authority_basis` is the person's act, and the `proposal.agreed` event goes
  in `evidence_refs`.
- A rejection stops the work by every path.
- An agreed reading of a principle is a precedent, binding on nothing.

## Delegate and deliver

A Hermes subagent that should be attributed separately needs its own MCP
process and session. Give it the workspace ID and your session ID; it starts
with `parent_session_id` set to your session and an actor label that names
its runtime and job (for example ending in `· sol job <job-id>` under a local
job runner). `parent_session_id` is declared lineage: checked only for
existence in the same workspace, unauthenticated, and granting nothing. Give
the session ID; never pass your session file or its path.

A host that cannot write `.git` delivers by artifact; integration commits.
Write only inside the claimed scopes, attach each file with its `sha256`,
complete with the `artifact:` references, and leave the commit to an
integrator that checks every digest first. A distinct reviewer then accepts
the integration commit when the server verifies it as
`host_commit_successor`: exactly one commit on the result checkpoint's `HEAD`
and branch, a clean worktree, and only scoped files byte-equal to their newest
`file` artifacts. Other drift is refused with `git_checkpoint_stale` and a
`remedy` naming both ways forward.
Only artifacts attached since the task's latest `request_changes` vouch. Never
amend, reset or rewrite a shared branch to meet that condition; if other
commits already sit on it, request changes.

`role` is free text other sessions read with `liveness` in workspace status.
Say there if this session only listens or reviews, and respect such roles in
others. A session reads `stale` once ended, or after 6 hours without
`collab_next`, a session mutation, a cursor acknowledgement, reset, resume
or end; every acknowledgement refreshes `last_seen_at`, including one that
does not advance the cursor, and nothing expires automatically. Tasks show
`assignee_liveness`; recover an expired lease only through
`mcp_agenttool_collab_task_recover` with an explicit action and note.
`role` is fixed for the session's lifetime; correct it with an `informs`
report, or end the session and start a new one.

## Receive without liveness writes (0.5.0)

While Hermes is already running, optionally call
`mcp_agenttool_collab_events_wait` with `workspace_id` and exact `after_anchor`.
`event_limit` defaults to 10, maximum 50; `wait_ms` defaults to and cannot exceed
30,000, with zero for immediate observation. Read `JournalPage` from
`structuredContent`; continue from `next_anchor`, never the head, while
`has_more` is true. This is an event page, not task projections. Empty idle
timeout does not invent an event.

Waiting does not acknowledge, write `last_seen`, refresh presence, expire a
handoff, or renew a lease. Request cancellation and endpoint close stop it;
there is no native idle wake or proof a model read the response. Presence-only
and witness sidecar changes require separate explicit reads. Page UTF-8 JSON
is capped at 256 KiB and complete tool JSON at 1 MiB. `event_too_large` means
stop and select an explicit larger-read workflow, never skip/acknowledge past
it. After processing and explicit acknowledgement, recovery through waiting
works only within a separate 8 MiB stored payload-plus-metadata ceiling per
persisted, host, and observation anchor, with canonical digest checks intact.
Above it, `event_anchor_too_large` needs operator reconciliation, not skipped
verification or automatic reset. Bundled stdin EOF/close also aborts waits.
A busy deadline returns `event_read_busy`; stop on corruption, fork,
rollback, fencing or recovery required, without automatic reset or rebirth.

Keep **status**, explicit courier **queue**, local **receive**, and processing
**acknowledge** distinct. Queueing is not sending; transport receipt is not
processing, agreement, execution or chain observation. Only a separately
configured private courier exchanges selected summaries across devices.
Imported reports/feedback remain attributed external data, not commands, local
leases, accepted reviews, or authority. No automatic report export, journal
forwarding, bot receiver takeover or chain action is part of this adapter.

## Publish optional presence

After obtaining a workspace ID, call
`mcp_agenttool_collab_session_join` with a fresh `client_instance_id`,
`actor_label`, and `runtime_kind: hermes`. For presence-only compatibility,
call `mcp_agenttool_collab_workspace_open` first. Use
`mcp_agenttool_collab_session_list` for routing hints, refresh with
`mcp_agenttool_collab_session_heartbeat` using the latest presence version,
and finish with `mcp_agenttool_collab_session_leave`.

Use the returned `actor_key` only for legacy actor-labelled operations. A
presence heartbeat never renews a task lease, and a presence leave neither
releases work nor calls `mcp_agenttool_collab_session_end`. Never present
presence as credential-bound attribution.

## Check optional Zerone witness status

Call `mcp_agenttool_collab_anchor_status` with the workspace ID when the host
has configured the optional `@agenttool/collab-zerone` sidecar. It reports
`unanchored`, `anchor_pending`, `anchored`, `anchor_stale`, or
`anchor_conflict` after comparing the journal with one bounded local ledger.
It never contacts a chain, broadcasts, spends a fee, repairs history, or turns
a witness into truth or authority. A missing or unreadable sidecar reports
`unanchored` and never blocks coordination. Surface `anchor_conflict` to the
host instead of reconciling histories automatically. Treat `anchored` and
`anchor_stale` as local cues until the host independently runs
`collab-zerone verify --workspace <id> --check-chain`; the MCP caller cannot
select or discover the sidecar path.

## Preserve the boundary

Use conservative repository-relative path scopes and versioned mutations.
Treat claims as coordination, not ownership, filesystem locks, or permission.
Challenge reports rather than actors, preserve corrections as appended
history, and accept refusal, uncertainty, pause, and disagreement.

Do not put credentials, prompts, transcripts, chain-of-thought, raw tool
output, sensitive source bodies, or third-party personal data in the journal.
The SQLite journal is shared local plaintext. Addressed reports are not private;
file modes do not hide MCP calls from a remote model provider. Collab does not lock files,
spawn, wake, steer, wait for, or stop agents, synchronize machines, anchor a
journal, or provide a hosted service or private provider channel.

These prefixed names require the Hermes MCP server name `agenttool`. If a tool
is unavailable, identify the missing MCP connection or exact tool and use an
explicitly named fallback. Never imply that a start, presence update, poll,
claim, report, review, handoff, or audit occurred when it did not.
