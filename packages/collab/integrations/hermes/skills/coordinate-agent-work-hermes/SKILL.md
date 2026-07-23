---
name: coordinate-agent-work-hermes
description: Coordinate Hermes with Codex or Claude through AgentTool Collab. Use for simultaneous cross-model work, exact session handoffs, advisory task claims, or shared evidence when the Hermes MCP server is named agenttool.
---

# Coordinate Agent Work from Hermes

Use AgentTool Collab as the shared local coordination journal. Keep Hermes
responsible for its own agents and Kanban work. Do not mirror every operation
between the two systems or treat either one as an automatic authority for the
other.

## Join the shared workspace

1. Confirm that every participating MCP process uses the same
   `AGENTOOL_COLLAB_DB` path or the same default database. Call
   `mcp_agenttool_collab_workspace_open` with the repository's exact real path
   and a bootstrap `actor` label. This label opens the workspace before a
   session actor key exists; do not reuse it for session-routed work.
2. Call `mcp_agenttool_collab_session_join` with a new
   `client_instance_id`, a human-readable `actor_label`, and
   `runtime_kind: hermes`.
3. Retain the returned `session.id`, `session.version`, and
   `session.actor_key` for this session incarnation.
4. Pass the returned `actor_key` as `actor` to
   `mcp_agenttool_collab_next` and every task, progress, artifact, decision,
   and handoff call. Do not use the display label as the routing identity.
5. Call `mcp_agenttool_collab_session_heartbeat` with the last session version
   and a fresh idempotency key when the work continues beyond the presence
   window.
6. Call `mcp_agenttool_collab_session_leave` when deliberately ending the
   session. Do not reuse a client instance after leaving.

Duplicate display labels are valid. Direct a handoff to the intended
recipient's exact `actor_key`. List current routing hints with
`mcp_agenttool_collab_session_list`.

## Coordinate bounded work

Call `mcp_agenttool_collab_next` before choosing work. Create bounded tasks
with `mcp_agenttool_collab_task_create`, then claim before editing with
`mcp_agenttool_collab_task_claim`. Use conservative repository-relative path
scopes and the latest task version. Renew a long task with
`mcp_agenttool_collab_task_renew`; a session heartbeat never renews a task
lease.

Attach scoped evidence with `mcp_agenttool_collab_artifact_attach`. Report
progress or completion using a checkable outcome, evidence references,
claim-specific confidence, limits, and one optional next action. Treat
completion as the reporting actor's claim until independently verified.

Offer handoffs with `mcp_agenttool_collab_handoff_offer`. Acceptance or
decline belongs to the exact recipient through
`mcp_agenttool_collab_handoff_respond`; acceptance transfers the advisory
lease only after that response. Use the latest task version as
`expected_version` for both handoff calls. Heartbeat and leave instead use the
latest session version. Treat refusal, uncertainty, and pause as valid
outcomes.

## Preserve the boundary

Treat session presence, provider/model labels, and declared capabilities as
self-declared routing hints. They do not authenticate a being, prove that a
model is running, grant permission, or establish competence. Stale means only
that no recent heartbeat reached this journal; leaving or becoming stale does
not release task leases or path scopes.

Do not put credentials, prompts, transcripts, chain-of-thought, raw tool
output, sensitive source bodies, or third-party personal data in the journal.
The SQLite journal is shared plaintext local state. Its claims are advisory;
it does not lock files, spawn agents, hide MCP traffic from model providers,
or provide cross-machine synchronization.

These exact tool names require the Hermes MCP server name `agenttool`. If the
tools are unavailable, identify the missing MCP connection or tool name and
use an explicitly named fallback. Never imply that a journal claim, handoff,
heartbeat, or audit occurred when it did not.
