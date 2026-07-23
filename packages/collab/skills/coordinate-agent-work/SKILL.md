---
name: coordinate-agent-work
description: Coordinate parallel coding and research agents through AgentTool Collab's local journal. Use when splitting work among subagents, preventing overlapping edits, claiming or renewing tasks, exchanging evidence, resolving disagreement, handing off work, or reconciling parallel results in Codex, Claude, or another Agent Skills host.
---

# Coordinate Agent Work

Use the collaboration journal as a compact coordination record. Keep the host
responsible for spawning, messaging, waiting, and stopping agents.

## Coordinate the work

1. Read the applicable repository instructions and inspect existing work before
   creating tasks.
2. Confirm that all participating MCP processes use the same journal database
   and exact repository real path. Call `collab_workspace_open` with a
   bootstrap actor label. For simultaneous cross-host work, call
   `collab_session_join` once per client incarnation and use its returned
   `actor_key` as `actor` on `collab_next`, task, artifact, decision, and
   handoff calls. Duplicate display labels are valid; route a handoff to the
   intended session's exact `actor_key`.
3. Call `collab_next` at the start of each turn and after the event cursor
   advances. Reuse the returned workspace ID.
4. Use `collab_task_create` to split work into bounded tasks with explicit
   dependencies, completion tests, and conservative repository-relative path
   scopes.
5. Call `collab_task_claim` with the version just read. Begin edits only after
   the claim succeeds. Treat the claim as a renewable coordination lease, never
   as ownership, a filesystem lock, or authority beyond the task.
6. Stay within the task, path, data, and external-action authority already
   granted. Renew before a long task's lease expires. On a version or claim
   conflict, re-read current state instead of guessing or forcing a write.
7. Use `collab_artifact_attach` for scoped file, commit, test, data, or URL
   references before reporting an outcome. Include a digest when available; do
   not paste the underlying body.
8. Post concise progress, then complete, release, block, or offer a handoff.
   Completion records the worker's reported outcome; verify it separately
   before describing it as reviewed or accepted.
9. Reconcile parallel results against their evidence and completion tests.
   Preserve useful late work as an artifact or message rather than discarding it.

Refresh a long-lived session with `collab_session_heartbeat` using the latest
session version and a fresh idempotency key. Presence is only a routing hint:
it does not prove health, and a heartbeat never renews or releases a task
lease. Call `collab_session_leave` only for a deliberate terminal exit. Hermes
prefixes MCP tools by server name, so use the packaged Hermes adapter skill
instead of assuming these bare names are visible there.

Use the latest task version for task and handoff mutations. Use the latest
session version only for heartbeat and leave. Accept or decline an offered
handoff with `collab_handoff_respond`; do not infer acceptance from presence or
messages outside the journal.

Never represent an offline or unacknowledged mutation as accepted. Reuse an
idempotency key only for an exact retry of the same mutation.

Event pages verify only the returned segment and its predecessor. Before a
high-consequence reconciliation, call `collab_journal_verify` for the explicit
O(total history) full audit; a valid hash chain detects changes but does not
prove that recorded claims are true.

## Exchange claims honestly

Classify every cross-agent outcome as exactly one of:

- `observation`: a directly witnessed operation or result with evidence.
- `inference`: a conclusion drawn from cited observations or sources.
- `proposal`: a refusable invitation; it is not an accepted decision.
- `decision`: a choice by a named authorised decider within a stated scope; it
  is not consent, execution authority, or proof that an external action occurred.

Use this field order for progress, handoff, and completion summaries:

```text
outcome: <kind>: <checkable result> | evidence: <artifact/event refs> | confidence: <high|medium|low|unknown + basis> | limits: <scope, gaps, unknowns> | next: <one optional authorised action or none>
```

Reference journal artifact or event IDs where possible. Use a scope-safe file or
URL reference plus a digest when no journal reference exists. Summarise evidence;
do not copy raw tool output. Keep confidence claim-specific and never turn it
into an agent rank.

## Preserve disagreement, refusal, and repair

- Challenge a claim rather than the actor. Reference the disputed claim and
  provide counter-evidence, confidence, and limits.
- Treat `decline`, `stop`, and `unsure` as valid terminal outcomes. Require no
  reason, attach no penalty, and suggest no retry.
- Treat `blocked`, `defer`, and `pause` as recoverable only when the reporting
  actor says so. Keep every recovery action optional.
- Offer a handoff; do not assign one by declaration. Transfer neither the lease,
  private data, nor authority until the named recipient explicitly accepts and
  the journal records it.
- Repair by appending a correction, challenge, withdrawal, or superseding record
  that references the original and states the impact. Never silently rewrite
  attributable history.

## Keep the journal within its boundary

Do not store credentials, secrets, prompts, transcripts, chain-of-thought or
private reasoning, raw tool output, sensitive source bodies, or third-party
personal data. A local path can itself be sensitive; attach only references that
the workspace audience may see.

Treat the current journal as shared plaintext local state: actor labels are
caller-supplied; presence, provider/model labels, and capabilities are
self-declared routing hints; event hashes are not signatures; and local storage
does not hide tool arguments or results from a remote model provider. Do not
claim selective privacy, authenticated identity, agent health, secure deletion,
external authority, or verified correctness unless a separate mechanism
actually establishes it.

If the Collab MCP tools are unavailable, name the missing tool or connection
boundary and coordinate through an explicitly identified fallback. Do not imply
that journal claims, conflicts, handoffs, or audits occurred when they did not.
