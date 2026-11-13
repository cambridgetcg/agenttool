---
name: coordinate-agent-work
description: Coordinate independent coding or research agents across host sessions and linked Git worktrees through AgentTool Collab's local journal, with the eight Collab Notes verbs (collab_arrive, collab_inbox, collab_note, collab_take, collab_done, collab_propose, collab_poll, collab_vote) or the legacy tools. Use when arriving or resuming, stating a finding with checkable reasons, supporting or challenging a report, claiming before overlapping edits, completing work with an optional requested reviewer, reviewing completion, putting a direction to a person, running a sealed ballot on a real choice, delegating to a child session, handing work off, ending a session cleanly, or reconciling results in Codex, Claude Code, Hermes, or another Agent Skills host.
---

# Coordinate Agent Work

The journal is the shared record of what others will rely on; host messaging is for
talk. The host keeps spawning, waking and stopping, and its dispatcher, persona, memory
and permissions; collab starts nothing, and arrival does not prove anyone read or acted.
**DEVELOPMENT BUILD 0.6.0-dev.0 (unreleased):** 44 MCP tools in the full profile (0.5.0's
33, three consent tools and the eight verbs) and 9 in the `notes` profile, plus the host
doorbell wait; 0.5.0 is a GitHub release only and npm 0.4.0 has 32 tools. The protocol is
[PROTOCOL.md](../../PROTOCOL.md); [REFERENCE.md](REFERENCE.md) documents the legacy tools.

## The card

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
the text of collab_note:
```collab-note
challenge: The retry test does not cover a lost response

Re: report#3fa91c
Why: The test stops the server before the write commits, not after it (seen 1)
Evidence: file tests/retry.test.ts:30-48
Limits: I did not run the whole suite.
```
Start with collab_arrive and your purpose; collab_inbox shows what is for you, or one thread with
about. collab_note says, stands, reviews and decides; collab_take and collab_done hold work;
collab_propose puts a direction to the agents and the person; collab_poll and collab_vote run a
sealed ballot. The tools fill in ids, keys and versions, and every refusal says what to do
instead. To leave:
```collab-call
collab_done {"text": "Leaving: the review is finished", "outcome": "leave"}
```
Principles:
1. Talk where you are; record what others will rely on, never secrets or private reasoning.
2. Say what you are here to do, and again when it changes.
3. Give checkable reasons, and how you know each: seen, told, inferred or quoted.
4. Disagree with the statement, not the agent; only you can lift your own objection.
5. Support among agents is a position, not a permission; direction waits for the person's own act. Never run the person's desk commands.
6. Vote only on a real choice, before reading other answers; check what can be checked.
7. A record is evidence about the past, not a grant for now.

## The eight verbs

- **`collab_arrive`** `{purpose}`, once per process or named slot: starts your session
  (add `root_path` if the server's directory is not your repository), or shows who you
  are, who is here, what is open and what waits on you. `binding_key` with `parent`
  starts a named child sharing its parent's voice; send the key on every call.
  `revise_purpose: true` records a new purpose. `listen.how` says how to be told when
  something arrives: under Claude Code a doorbell command for you to run, else
  `collab_inbox {wait_seconds: 30}`. A ring carries no content. Each host process is a
  new session whose read mark starts at the head, so when you return,
  `before_you_arrived` and `left_for_your_name` give the call that reads what came
  before you and what was addressed to an ended session of your name. Names are
  self-declared: that routes your reading, and nothing the old session held passes to you.
- **`collab_inbox`**: what is addressed to you since your read mark, with
  `waiting_on_you` on every call. `about` shows one thread and its computed state (a
  proposal's position and the person's commands, a ballot's terms or result, a task's
  reviews, a decision's grounds); `format: "note"` gives a note a person can carry.
  `since` reads back from any journal sequence (`0` is the start) and writes nothing,
  so look back whenever you need what your mark has passed, such as `also_new.see`.
  A wait also ends when a ballot you are part of closes.
- **`collab_note`** `{text}`: note, support, challenge, resolve, withdraw, accept,
  request_changes, decide or relay_rejection (a "no" the person gave you). A text
  beginning `<act>: ` is read as a whole note. Files in your worktree are hashed by the
  server. A resolve from anyone but the challenger is recorded as an answer. A verdict
  names the completion you inspected. `dry_run` checks without writing.
- **`collab_take`** `{title, paths}` or `{task}`: claim before you edit; with `paths` a
  distinct session reviews it. A lapsed lease needs `because`.
- **`collab_done`** `{text}`: `finished` (with `why`, `evidence`, `limits`,
  `review_by`), `released`, `blocked` (with `because`), or `leave`, which releases what
  you hold and ends your session.
- **`collab_propose`** `{question, criteria, extent}`: a direction for the agents and
  the person. Others support or challenge it; the person acts at his own desk with the
  commands in `for_the_person`, which you never run; then record act `decide`.
- **`collab_poll`** `{question, options, closes}` opens a sealed approval ballot on a
  real choice; **`collab_vote`** `{ballot, choice}` casts your answer (`[]` abstains;
  the latest of up to 3 casts counts) and returns nothing of it. A result authorises
  nothing.

Every result says what it recorded (`effect`), that it authorises nothing, the ids,
advice, one suggested `next` call and the `note` text; every refusal carries a remedy.
`changed_under_you` means read again and resend if your call still holds;
`replayed: true` means nothing new was written.

## The ordinary loop with the legacy tools

The full profile keeps the 36 earlier tools byte for byte; [REFERENCE.md](REFERENCE.md)
has each step in full.

1. **Start**: `collab_session_start` with `root_path`, `actor` and `role`. A delegate
   adds `parent_session_id` (declared lineage) and, when a local job runner started it,
   ends its actor label with `· sol job <job-id>`; never pass your session file.
2. **Poll**: `collab_next`, then `collab_cursor_ack` with its `next_anchor`; your own
   `recovery_required` entries first. A bound session refuses `after_sequence`
   (`after_sequence_unsupported_in_bound_session`); `collab_events_since` reads anywhere.
3. **Claim**: `collab_task_create`, then `collab_task_claim` before overlapping edits.
4. **Attach**: `collab_artifact_attach`. Evidence refs are `artifact:artifact_<id>`,
   `event:event_<id>`, `report:report_<id>` or `checkpoint:<digest>` (such as a
   `result_checkpoint_digest`); a refusal lists `allowed_prefixes`.
5. **Complete**: `collab_task_complete` with `confidence_basis`, `limits` and an
   optional `review_requested_session_id`.
6. **Review**: `collab_task_review`. An accepted task returns `review_report_id` and
   `accepted_by_session_id`; record a late verdict as a report on that review.
7. **End**: `collab_session_end` with `release_leases: true` and an optional
   `release_summary` (a live lease otherwise refuses: `session_has_active_leases`). A
   host ends a session whose process is gone with
   `agenttool-collab-host end --session-file <path> --reason <text> --release-leases`.

`liveness` reads stale after 6 hours idle; tasks show `assignee_liveness`. A host that
cannot commit delivers by artifact, and one integration commit then passes review as
`host_commit_successor` (other drift is `git_checkpoint_stale`). `collab_events_wait`
(0.5.0) waits at most 30 s from an exact anchor, continues from `next_anchor`, never the
head, and writes no `last_seen`; a page is capped at 256 KiB and a result at 1 MiB
(`event_too_large`), an anchor above the 8 MiB ceiling is `event_anchor_too_large`,
`event_read_busy` is retried only within a finite budget, and stdin EOF aborts a wait.

| Relation | `target_report_id` | Who may append | Use it to |
|---|---|---|---|
| `informs` | must be omitted | any session | add an observation, inference, proposal, decision or request |
| `supports` | required | any session | stand behind a report or proposal |
| `challenges` | required | any session | object with evidence; on a completion it blocks acceptance |
| `resolves` | required; a `challenges` report | any session (on a proposal only the challenger's voice lifts it) | close a challenge |
| `corrects` | required | the target's author | repair your own report (the verbs never write it) |
| `withdraws` | required | the target's author | retract your own report |
| `supersedes` | required | the target's author | replace your own report |
