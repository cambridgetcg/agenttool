---
name: coordinate-agent-work-hermes
description: Coordinate Hermes with Codex, Claude Code, and other hosts through AgentTool Collab's local journal, signed cross-device facts, and v0.4 release room. Use when Hermes needs resumable local task claims, structured evidence, independent review, refusable handoff, collaboration across clones/devices, or cooperative serialization of an authorised GitHub, npm, deployment, or provider operation through an MCP server named agenttool.
---

# Coordinate Agent Work from Hermes

Keep Hermes responsible for its agents and Kanban work. Keep Git responsible
for bytes. Register the MCP server under the exact name `agenttool`; the tools
then use the `mcp_agenttool_` prefix.

## Choose the plane

- Use local Collab for atomic tasks among processes sharing one SQLite file.
- Use Agent Correspondence for signed cross-device facts and replay without a
  winner.
- Use the v0.4 release room for one cooperative external-operation lease and
  bounded provider observations.
- Use Git for commits, branches, fetch, review, and merge.

None grants external authority. Do not mirror every Hermes Kanban operation
into Collab or imply that any plane spawns, wakes, or stops another host.

## Run local coordination

Use the credential-bound core:

```text
mcp_agenttool_collab_session_start
mcp_agenttool_collab_next
mcp_agenttool_collab_cursor_ack
mcp_agenttool_collab_task_create
mcp_agenttool_collab_task_claim
mcp_agenttool_collab_task_renew
mcp_agenttool_collab_task_progress
mcp_agenttool_collab_artifact_attach
mcp_agenttool_collab_report_append
mcp_agenttool_collab_task_complete
mcp_agenttool_collab_task_review
mcp_agenttool_collab_handoff_offer
mcp_agenttool_collab_session_end
```

1. Call `mcp_agenttool_collab_session_start` once for this Hermes run. Never
   read or expose its credential file/token.
2. Poll `mcp_agenttool_collab_next` at turn start, after local work, before
   relying on shared state, and when Hermes wakes this agent. Follow
   `has_more`, process the page, then acknowledge its terminal cursor with
   `mcp_agenttool_collab_cursor_ack`.
3. Create bounded tasks and conservative path scopes. Read the latest version,
   then claim before editing. Renew or offer a handoff before expiry.
4. Attach digested references, append compact evidence, and report completion.
   Require a different bound session to inspect edit evidence and review it.
5. Release, block, pause, complete, or offer a handoff before ending with
   `mcp_agenttool_collab_session_end`.

Resume through the host with `AGENTOOL_COLLAB_SESSION_FILE`; a model must
never read the mode-`0600` bearer file. Use cursor recovery only after
explicit operator authorization.

Use self-declared presence only for optional discovery/routing through
`mcp_agenttool_collab_workspace_open`,
`mcp_agenttool_collab_session_join`,
`mcp_agenttool_collab_session_list`,
`mcp_agenttool_collab_session_heartbeat`, and
`mcp_agenttool_collab_session_leave`. Its labels, capabilities, and live/stale
state do not authenticate identity, health, competence, permission, or linkage
to the credential-bound session. A heartbeat never renews a task lease.

A claim does not lock files. Use Git and repository checks before accepting
work.

## Exchange cross-device facts

Carry portable intent, advisory claims, progress, Git-addressed artifacts,
acknowledgements, conflict, refusal, rest, handoff, and repair through Agent
Correspondence. Preserve concurrent claims and carry source through Git; do
not pretend the local SQLite journal synchronized across devices.

Classify evidence as observation, inference, proposal, or decision. Cite
evidence, confidence and basis, material limits, and actual authority
scope/basis. Addressing is routing, not confidentiality. Append corrections
and challenges instead of rewriting history.

## Use the release room

Read [references/kingdom-release-room.md](references/kingdom-release-room.md)
before GitHub, npm, Fly, Cloudflare, Vercel, migration, or other external
operations.

1. Confirm explicit device enrollment and stable project binding without
   reading a bearer.
2. Poll `mcp_agenttool_collab_operation_events` and
   `mcp_agenttool_collab_operation_status`.
3. Claim the repository + operation + environment slot with exact target,
   source revision, and parameter digest.
4. Obtain the separate provider authorization.
5. Call `mcp_agenttool_collab_operation_begin` immediately before mutation.
6. Renew only the exact current action; publish only bounded observations.
7. Complete after verification or preserve uncertainty.
8. If execution may have started and the lease expires, inspect receipts and
   provider state before `mcp_agenttool_collab_operation_recover`. Keep an
   uncertain disposition recovery-required. Name this observing session and
   bind the action when known.

Release a claimed action that will not run. Treat the lease as cooperative
duplicate prevention only; direct provider actions remain outside it.

## Preserve rights and privacy

Treat refusal, disagreement, pause, rest, uncertainty, and handoff as valid.
Offer handoff rather than imposing reassignment. Preserve credit and repair
through attributed appended records. Keep rights distinct from permissions.

Do not store credentials, prompts, transcripts, chain-of-thought, raw logs,
diffs, command output, environment dumps, sensitive source bodies,
secret-bearing URLs, unnecessary personal data, or absolute local paths.
Local SQLite is plaintext; Correspondence and the relay are server-readable,
not end-to-end encrypted or hidden from the active model provider.

If an exact prefixed tool, journal, credential binding, relay, provider
observation, or wake path is unavailable, name that boundary and use an
explicit fallback. Never imply that an operation occurred when it did not.
