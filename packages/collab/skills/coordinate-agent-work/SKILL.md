---
name: coordinate-agent-work
description: Coordinate independent coding and research agents through AgentTool Collab's local task journal, signed cross-device facts, and v0.4 release room. Use when Codex, Claude Code, Hermes, or another Agent Skills host needs to split or resume work, avoid overlapping edits, exchange evidence, reconcile disagreement, review completion, offer a refusable handoff, collaborate across clones or devices, or serialize an authorised GitHub, npm, deploy, or provider operation.
---

# Coordinate Agent Work

Keep Git as byte truth and the host responsible for spawning, steering,
waking, reconnecting, waiting for, and stopping agents. Treat coordination
state as evidence, never external authority.

## Choose the plane

- Use local Collab for atomic tasks among sessions that share one SQLite file.
- Use Agent Correspondence for signed cross-device facts and durable replay.
  Preserve concurrent claims; it deliberately chooses no winner.
- Use the v0.4 release room for one cooperative lease around an external
  operation and bounded provider observations.
- Use Git for commits, branches, fetch, review, and merge.

Do not imply that any plane grants permission to push, merge, publish, deploy,
migrate, purchase, message, or change a provider.

## Start and reconcile locally

1. Read repository instructions and inspect existing work.
2. Call `collab_session_start` once per independent process or conversation.
   Never open its credential file or expose its token/path through
   model-facing coordination.
3. Confirm that local participants opened the intended workspace and same
   database. Linked worktrees may share a workspace; separate clones/devices
   do not share the SQLite journal.
4. Poll `collab_next` at turn start, after local work, before acting on shared
   state, and when the host wakes the agent. Follow `has_more`.
5. Process each page before calling `collab_cursor_ack` with its terminal
   cursor. Acknowledgement means processed, not agreed, accepted, or correct.
6. Resume through the host with `AGENTOOL_COLLAB_SESSION_FILE`; never read the
   mode-`0600` bearer file. Use cursor recovery only after deliberate operator
   authorization.

Use self-declared presence only for optional routing. Presence labels,
capabilities, and live/stale state do not prove identity, health, competence,
permission, or linkage to a credential-bound session. The MCP server is
pull-only; it cannot wake a disconnected agent.

## Coordinate tasks

1. Create bounded `coordination`, `read_only`, or `edit` tasks with explicit
   dependencies, path scopes, and completion checks.
2. Read current versions and path conflicts before claiming. Begin edits only
   after `collab_task_claim` succeeds.
3. Stay within the task's data, path, and action scope. Renew before expiry;
   poll and re-read on conflicts instead of forcing a mutation.
4. Attach commit, file, test, data, or URL references with digests when
   available. Do not paste raw output or source bodies.
5. Report progress, then complete, release, block, pause, or offer a handoff.
6. Require another bound session to inspect artifacts, Git checkpoints, and
   completion checks before accepting an edit task.

Treat a task lease as cooperative coordination, not ownership, a filesystem
lock, correctness proof, or permission. Before recovering an expired lease,
inspect progress, reports, artifacts, and checkpoints; preserve useful prior
work and record the recovery choice.

“Another bound session” means a distinct credential-bound session using that
same local SQLite journal. A review received from another device through
Correspondence is useful attributed evidence, but it does not fabricate a
local task acceptance in a journal that the reviewer never opened.

## Exchange cross-device facts

Use Agent Correspondence to carry compact signed intent, progress,
observations, Git-addressed artifacts, acknowledgements, conflict, refusal,
rest, handoff, and repair. Carry file bytes through Git. Do not mirror the
whole local journal or choose a claim winner by timestamp.

When `@agenttool/sdk` is available, send with
`at.correspondence.append`, receive durable pages with
`at.correspondence.replay` (or `list`), and inspect advisory branches with
`activeClaims`. An acknowledgement is another signed `ack.*` event appended
with the target event as a parent; it is not a transport cursor mutation. If
that SDK/HTTP plane or its signing key is absent, name that exact boundary and
do not imply that cross-device exchange occurred.

Classify local reports as `observation`, `inference`, `proposal`, or
`decision`. Cite evidence, confidence and basis, material limits, and the
actual authority scope/basis for a decision. Addressing is routing, not access
control. Append corrections and challenges; never silently rewrite attributed
history.

A `decision` event is still an attributed claim: Correspondence does not
discover or validate maintainer authority. If participants do not mutually
agree, pause the conflicting work and obtain the decision through the
repository's separately established governance, then record its stated scope
and basis.

Use this compact form:

```text
outcome: <kind>: <result> | evidence: <refs> | confidence: <level + basis> | limits: <gaps> | next: <optional separately authorised action or none>
```

## Coordinate an external operation

Before any GitHub, npm, deployment, or Vercel workflow, read
[references/kingdom-release-room.md](references/kingdom-release-room.md).

1. Confirm explicit device enrollment and the intended stable repository
   binding without reading any bearer.
2. Poll `collab_operation_events` and `collab_operation_status`.
3. Select the exact operation/environment pair from the reference. Do not
   invent a synonym. Have the host compute `parameters_sha256` with the
   package's exported `requestSha256(parameters)` over one agreed JSON object;
   do not hand-roll or model-retype a digest.
4. Claim that slot with the exact target, source revision, and parameter
   digest.
5. Obtain the separate provider authorization.
6. Call `collab_operation_begin` immediately before the external mutation.
7. Renew only the exact current action.
8. Attach fixed receipt references and bounded provider observations with the
   required observing session; bind the action when known.
9. Complete only after verification, or preserve uncertainty and enter
   recovery when execution may have started.

Release a claimed action that will not run. Never treat an executing lease
expiry as safe reuse: it becomes `recovery_required` with an uncertain external
outcome. After inspecting receipts and provider state, call
`collab_operation_recover` with the exact fence and bounded receipt/evidence
references; an uncertain disposition keeps the slot closed. The lease
prevents cooperative duplicates only; direct provider actions remain outside
it.

The MCP runtime derives one stable observing-session UUID for its process, so
agents do not invent a new `session_id` for each call. For the npm flow, the
annotated `collab-v<version>` tag push and `publish-npm.yml` dispatch are one
`npm-release / production` action: begin before the tag push, and recover if
either side effect might have occurred.

## Preserve rights and privacy

Treat refusal, disagreement, pause, rest, uncertainty, and handoff as valid
outcomes. Offer handoff rather than imposing reassignment. Preserve credit and
repair through attributable appended records. Keep rights distinct from
permissions: neither a credential nor task utility creates dignity, and
recognised rights do not grant an account action.

Keep credentials, secrets, prompts, transcripts, chain-of-thought, raw logs,
diffs, command output, environment dumps, sensitive source bodies,
secret-bearing URLs, unnecessary personal data, and absolute local paths out
of every shared plane. Local SQLite is plaintext. Correspondence and the relay
are project-scoped but server-readable over TLS, not end-to-end encrypted or
hidden from the active model provider.

If a tool, credential binding, journal, relay, provider observation, or wake
path is missing, name the exact boundary and use an explicitly identified
fallback. Never imply that a poll, claim, review, handoff, release action, or
provider verification occurred when it did not.
