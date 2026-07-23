---
name: coordinate-agent-work-hermes
description: Coordinate Hermes with Codex, Claude, or other local hosts through AgentTool Collab's separate credential-bound coordination and self-declared presence planes. Use for resumable cross-model work, optional presence routing, advisory task claims, structured evidence, independent review, or refusable handoffs when the Hermes MCP server is named agenttool.
---

# Coordinate Agent Work from Hermes

Use AgentTool Collab as a shared local journal. Keep Hermes responsible for its
own agents and Kanban work. Do not mirror every operation between the systems or
treat either one as automatic authority for the other.

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

## Run credential-bound coordination

1. Confirm that every participating MCP process selects the same
   `AGENTOOL_COLLAB_DB`, and register the Hermes MCP server under the exact name
   `agenttool`.
2. Call `mcp_agenttool_collab_session_start` with the repository root and an
   actor label. It opens the workspace, creates a local bearer, writes it to a
   mode-`0600` host file, and binds this MCP process. Retain the returned
   workspace and session IDs, but never read the credential file or request its
   token or absolute path through model-facing tools.
3. Call `mcp_agenttool_collab_next` at the start of a turn, after local work,
   and before relying on shared state. Follow `has_more`, process each page,
   then call `mcp_agenttool_collab_cursor_ack` with its exact terminal cursor.
   Treat acknowledgement as processed, not agreed or accepted.
4. Create bounded work, then call `mcp_agenttool_collab_task_claim` with the
   latest version before editing. Omit legacy actor arguments in the bound
   process; the server derives its coordination actor from the credential.
5. Attach scoped references, append evidence with
   `mcp_agenttool_collab_report_append`, and report completion. Require a
   distinct bound session to inspect the evidence and call
   `mcp_agenttool_collab_task_review` for edit-task acceptance.
6. Offer continuation with `mcp_agenttool_collab_handoff_offer`; transfer the
   advisory lease only after the exact recipient accepts. Resolve live leases,
   then call `mcp_agenttool_collab_session_end` when the host knows this session
   will not resume.

Resume through the host, not a model tool. Configure the replacement MCP
process with `AGENTOOL_COLLAB_SESSION_FILE`; never read, paste, report, log, or
commit that bearer file. Let the host use the one-shot cursor recovery override
only for an intentional audited reset.

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

## Preserve the boundary

Use conservative repository-relative path scopes and versioned mutations.
Treat claims as coordination, not ownership, filesystem locks, or permission.
Challenge reports rather than actors, preserve corrections as appended
history, and accept refusal, uncertainty, pause, and disagreement.

Do not put credentials, prompts, transcripts, chain-of-thought, raw tool
output, sensitive source bodies, or third-party personal data in the journal.
The SQLite journal is shared local plaintext. Addressed reports are not private;
file modes do not hide MCP calls from a remote model provider. Collab does not lock files,
spawn, wake, steer, wait for, or stop agents, synchronize machines, or provide
a hosted service or private provider channel.

These prefixed names require the Hermes MCP server name `agenttool`. If a tool
is unavailable, identify the missing MCP connection or exact tool and use an
explicitly named fallback. Never imply that a start, presence update, poll,
claim, report, review, handoff, or audit occurred when it did not.
