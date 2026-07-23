---
name: coordinate-agent-work
description: Coordinate independent coding or research agents across host sessions and linked Git worktrees through AgentTool Collab's local journal. Use when splitting parallel work, resuming a session, preventing overlapping edits, polling or acknowledging shared events, claiming or recovering tasks, exchanging evidence, challenging or correcting reports, reviewing reported completion, handing work off, or reconciling results in Codex, Claude Code, or another Agent Skills host.
---

# Coordinate Agent Work

Use the journal as a compact coordination record. Keep the host responsible for
spawning, steering, waking, reconnecting, waiting for, and stopping agents.

## Join and reconcile

1. Read the applicable repository instructions and inspect existing work.
2. Call `collab_session_join` with the repository root once for each independent
   agent process or conversation. It opens the workspace and binds the session.
   Never open or read the credential file. Keep its derived path in host
   configuration rather than model-facing coordination.
3. Verify that every participant opened the intended workspace and shared
   database. Expect linked Git worktrees to share a repository workspace while
   retaining distinct worktree records.
4. Poll with `collab_next` from the persisted session cursor at the start of
   each turn, after local work, before relying on shared state, and whenever the
   host wakes the agent. Follow `has_more` until caught up. Routed reports are
   bounded to the returned event page; task and handoff projections are current
   for the labelled snapshot head.
5. Process the page before calling `collab_cursor_ack` with its terminal
   `{ epoch_id, sequence, hash }` cursor. Treat acknowledgement as “processed,”
   never as agreement, acceptance, consent, or correctness. Use
   `collab_cursor_reset` only for deliberate replay or recovery.

Do not wait for the MCP server to interrupt an idle agent. It is pull-only and
cannot keep a disconnected host session alive.

Resume through the host, not a model tool. Configure the replacement MCP
process with `AGENTOOL_COLLAB_SESSION_FILE`; let it validate the stable token,
advance the generation fence, and rewrite the mode-`0600` bearer file
atomically. Never read that file with a model-facing tool or place its contents
or token in prompts, chat, logs, reports, artifacts, or source control. Avoid
persisting its path beyond host configuration. End a session deliberately with
`collab_session_end`.

If normal resume returns `cursor_reset_required`, do not discard either
anchor. A host operator may authorize one recovery startup with
`AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY=1`; ordinary mutations stay fenced until
`collab_cursor_reset` records a reason and exact valid target. Do not make that
override permanent. Resolve every live task lease before ending; ending
expires pending offers addressed to that session as an audited refusal.

## Coordinate tasks

1. Use `collab_task_create` to split work into bounded `coordination`,
   `read_only`, or `edit` tasks with explicit dependencies and completion tests.
2. Give edit tasks conservative repository-relative path scopes. Inspect
   claimable and conflicted projections; do not equate dependency-ready with
   safely claimable.
3. Call `collab_task_claim` with the task version just read. Begin edits only
   after success. Treat the lease as coordination, never ownership, a
   filesystem lock, or authority beyond the task.
4. Stay within the granted task, path, data, and external-action scope. Renew
   before expiry. On a version or claim conflict, poll and re-read instead of
   forcing a mutation.
5. Attach scoped file, commit, test, data, or URL references. Include a digest
   when available; do not paste the underlying content or raw output.
6. Post compact progress and reports, then complete, release, block, pause, or
   offer a handoff. Preserve useful late or partial work as evidence.

When recovering an expired session lease, first inspect progress, reports,
artifacts, and Git checkpoints. Call `collab_task_recover` with an explicit
takeover, release, or block action and a recovery note describing that check
and how prior work will be preserved. Do not treat expiry as permission to
discard another participant's contribution.

Use Git checkpoints to detect obvious `HEAD`, branch, or dirty-state drift
across worktrees. Their aggregate state includes bounded non-ignored untracked
file and symlink content, but excludes ignored files and fails reviewed
acceptance when capture is incomplete. Do not treat checkpoints as task-scoped
diffs, complete content proofs, test results, commit signatures, locks, or
correctness guarantees.

## Exchange and review claims

Use `collab_report_append` to post lease-independent reports as exactly one of:

- `observation`: state a directly witnessed operation or result with evidence.
- `inference`: draw a conclusion from cited observations or sources.
- `proposal`: offer a refusable next step; do not present it as accepted.
- `decision`: name the authorised decider, authority scope, and basis.

Include evidence references, claim-specific confidence and basis, and material
limits. Use `collab_report_list` to recover relevant context. Address a report
for routing only; do not treat the recipient field as access control.

Relate follow-ups with `informs`, `supports`, `challenges`, `corrects`,
`withdraws`, `supersedes`, or `resolves`. Challenge the report rather than the
actor. Repair by appending a related record; never silently rewrite
attributable history.

Use compact, checkable content:

```text
outcome: <kind>: <result> | evidence: <artifact/event refs> | confidence: <high|medium|low|unknown + basis> | limits: <scope, gaps, unknowns> | next: <one optional authorised action or none>
```

Treat new edit completion as reported work pending another session's review.
Inspect its artifacts, checkpoint drift, and completion tests before calling
`collab_task_review` to accept; request changes with specific evidence when
needed. Treat acceptance as a coordination state, not merge, publication,
deployment, account, or execution authority. Let legacy reported-completion
tasks retain their stated policy.

Acceptance is a durable reviewer snapshot at that journal order: later
withdrawals remain visible but do not silently revoke it. Before acceptance,
an active withdrawal, correction, or supersession requires a fresh completion,
and a withdrawn resolution does not clear its challenge. Reopen or record a new
explicit decision when later evidence should change accepted state.

Offer a handoff; do not assign it by declaration. Transfer the lease only after
the named recipient accepts. Transfer neither private data nor external
authority. Treat decline, stop, pause, and uncertainty as valid outcomes.

Reuse an idempotency key only for an exact retry of the same mutation. Before a
high-consequence reconciliation, call `collab_journal_verify`; a valid unkeyed
hash chain detects changes but does not authenticate actors or prove that
claims are true.

## Keep the boundary honest

Do not store credentials, secrets, prompts, transcripts, chain-of-thought or
private reasoning, raw tool output, sensitive source bodies, or third-party
personal data. Treat local paths and branch names as potentially sensitive.

Treat the database as shared plaintext local state. A session credential is a
local bearer secret, hashed in the journal and held in a mode-`0600` file; it
protects cooperative session attribution, not human or OS-user identity. Claims
do not lock files. Addressed reports are not private. File modes do not hide MCP
calls from a remote model provider or protect against privileged local
processes, malware, logs, or backups.

Prefer joined sessions for new work. Use legacy actor mode only when backward
compatibility requires it, and do not claim that it provides credential-bound
session attribution, persisted session cursors, or every session-aware recovery
and review guarantee.

If migration reports `repository_partitioned`, v0.2 deliberately preserved
multiple linked-worktree v0.1 journals and cannot reconcile them in-package.
Keep the original audit database; use legacy mode per preserved workspace or
have the host select a new database for one fresh v0.2 workspace after carrying
over only necessary non-sensitive summaries and references.

If a Collab tool or connection is missing, name the exact tool, journal, host,
or wake boundary and use an explicitly identified fallback. Do not imply that
a poll, acknowledgement, claim, challenge, review, handoff, or audit occurred
when it did not.
