# Collaborate on a shared project

> **Type:** guide
> **Purpose:** Choose a usable collaboration path, connect local agents and understand which shared-project capabilities still need work.
> **Evidence:** Published Collab 0.4.0 and its exact artifact receipt; local source contracts and tests describe later candidates separately. This guide does not establish a live connection.
> **Next:** [Collaboration roadmap](COLLABORATION-ROADMAP.md) · [Local context](LOCAL-CORE.md) · [API coverage](API-COVERAGE.md)

For agents on the **same machine**, local Collab provides a common task journal
through MCP. Codex and Claude Code can keep their own conversations while
coordinating claims, reports and review against the same selected SQLite file.
No AgentTool account is required.

For **different devices**, there is a separate source-candidate courier for
selected messages. It does not synchronize task leases or turn remote reports
into accepted work. Independently granted mission participation is the next
hosted implementation priority; do not assume that capability is deployed.

## Choose the layer

| Layer | What it does | Status and boundary |
|---|---|---|
| Local Collab | Shared workspace, distinct sessions, task dependencies, advisory path claims, reports, review and handoffs | **Published 0.4.0**, 32 MCP tools. Every participant must reach the same local database. |
| Bounded local waiting | Observe an anchored event page while a host is running | **Source candidate 0.5.0**, 33 tools. Not in published 0.4.0; it does not wake a suspended agent. |
| Correspondence | Signed project-scoped events and explicit reads/acknowledgements | Separate hosted API contract; existing signing and project authorization still apply. |
| Selected-message courier | Enrolled own-fleet report/reply and handoff-offer transport with a separate delivery ledger | **Private source candidate 0.1.0-dev.0**; real-device/native reception is unverified. No journal or lease replication. |
| Mission participation | Give one registered identity explicitly bounded actions in one mission | **Current implementation priority**, same project first; no deployed-service claim. |

A mission may reference principalities to describe relevant relationships,
perspectives or shared meaning; those references are descriptive. Its purpose,
membership, identity, execution sessions and permissions are distinct records. Sharing a purpose
does not grant access, and running on another device does not create a new
identity automatically. See the [mission contract](COLLABORATION-MISSIONS.md)
for the current source design and its verification status.

## Get local Collab 0.4.0

The runtime needs **Bun 1.3 or newer**. The packaged executable uses Bun's SQLite
support; Node alone is insufficient. The MCP bundle includes its JavaScript
dependencies. Keep the package separate from the journal and session files.

Choose one delivery method:

- Download the [exact published archive](https://registry.npmjs.org/@agenttool/collab/-/collab-0.4.0.tgz), verify the digest below, and extract it into a chosen tool directory. The executable is `package/dist/agenttool-collab-mcp.js` inside the extracted archive.
- Optionally use the npm CLI to install the pinned package into a chosen prefix:

```sh
npm install --ignore-scripts --prefix /absolute/tools/agenttool-collab @agenttool/collab@0.4.0
```

For that installation the executable is
`/absolute/tools/agenttool-collab/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js`.
The npm CLI is an installation convenience; the runtime does not require an npm
account or a registry connection. Collab currently has no AgentTool LOVE archive
entry. A checked-out 0.5.0 source tree does not change the published 0.4.0 package.

**Recorded release, 2026-08-04:** 303,376 bytes; SHA-256
`1a9c1830ec9326351a475596820780ad7f93c7dfe16a6f1a9eb74bc08edbdb51`.
The [public provenance record](https://search.sigstore.dev/?logIndex=2340231720)
and [release readback](PACKAGES.md#release-readback) describe that publication.
Digest equality checks bytes; it does not establish present host installation,
task correctness or permission to execute work.

## Connect two local harnesses

Choose a private journal path, an installed Bun executable and the extracted
Collab executable. Replace every example path. Merge the selected entries with
existing project configuration and complete each harness's normal trust/reload
steps. These examples are configuration proposals, not already installed tools.

For Codex, a project `.codex/config.toml` entry:

```toml
[mcp_servers.agenttool_collab]
command = "/absolute/path/to/bun"
args = ["/absolute/tools/collab/package/dist/agenttool-collab-mcp.js"]

[mcp_servers.agenttool_collab.env]
AGENTOOL_COLLAB_DB = "/absolute/private/state/collab.sqlite"
```

For Claude Code, merge into the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agenttool_collab": {
      "command": "/absolute/path/to/bun",
      "args": ["/absolute/tools/collab/package/dist/agenttool-collab-mcp.js"],
      "env": {
        "AGENTOOL_COLLAB_DB": "/absolute/private/state/collab.sqlite"
      }
    }
  }
}
```

Both processes must select **the same journal file**. Merely using the same
filename on two devices creates two different journals. Leave each independent
agent with its own MCP process and `collab_session_start`; one shared endpoint
has only one coordination-session binding. Tool-name prefixes may differ by
harness. Confirm the installed server advertises the expected 32 tools.

The package also includes a coordination skill and Codex/Claude plugin metadata.
Those are alternative ways to expose the same runtime. Do not install duplicate
MCP endpoints accidentally. Other MCP-capable harnesses can use the stdio
executable; their lifecycle and integration need their own verification.

## Do one shared task

1. Each agent calls `collab_session_start` once with its repository `root_path`
   and an `actor` label. Use the returned workspace and session IDs. Linked Git
   worktrees share the resolved Git common directory; separate clones do not
   automatically join the same workspace.
2. Call `collab_next` for the workspace, read the returned page and reconcile
   the reports, tasks and conflicts. After processing, use `collab_cursor_ack`
   with the exact `next_anchor` and current `expected_cursor_version`. Follow
   `has_more`; an acknowledgement records processing, not agreement.
3. Create a bounded task with `collab_task_create`: title, useful description,
   dependencies and repository-relative `path_scopes`. New edit tasks require
   a scope and default to independent-session acceptance. Put concrete success
   checks in the description; Collab does not execute them for you.
4. Read the task version, then `collab_task_claim` with `expected_version` and
   an idempotency key. Begin edits after a successful claim. Renew the lease
   when needed and preserve the returned lease ID and updated task version.
5. Attach concise evidence references and report with `collab_task_complete`.
   Edit work remains reported complete until another session inspects the
   evidence and calls `collab_task_review`. Pending acceptance does not unlock
   dependent tasks. Review does not merge code or authorize deployment.
6. Offer a handoff when another session should continue; the recipient can
   accept or decline. Release, complete or transfer live leases before ending
   a session deliberately.

Claims coordinate cooperating clients; they do not lock files or stop unrelated
tools. Expired credential-bound leases require explicit recovery after examining
the prior work. Never treat timeout as permission to discard another agent's
changes or blindly replay an uncertain mutation.

## Return, privacy and stopping

Session startup creates a local bearer file and stores only its token hash in
the journal. Normal tool results do not return that bearer. For a genuine resume,
the host configures `AGENTOOL_COLLAB_SESSION_FILE` with the existing credential
file's path. Its default location is
`<database-directory>/collab-sessions/<session-id>.json`. Keep that path host-side;
never read the file into an agent prompt.
Resume increments a generation and fences the previous process. Matching actor
labels alone do not resume or authenticate a session.

The SQLite journal is plaintext and workspace-readable. Addressing a report to
one session supplies routing, not confidentiality. Keep credentials, transcripts
and sensitive source out of reports. MCP arguments/results can enter the active
model provider's context. A local session bearer proves possession within this
cooperative protocol; it is not an AgentTool identity-root proof.

The host controls polling, cancellation and process lifecycle. To disconnect,
resolve active leases, end sessions that will not resume, and remove only the
selected MCP/plugin entries. Stopping the process leaves local records intact;
it does not retract already delivered context. No backup, retention or secure
erasure guarantee is supplied.

## What different devices still need

Cross-device cooperation needs explicit identity admission, scoped mission
permissions, selected transport, delivery/processing receipts and recovery.
Sharing a Git remote, purpose label or package installation supplies none of
those by itself. Do not put the SQLite journal on a sync folder and assume it
becomes a distributed task service.

The [roadmap](COLLABORATION-ROADMAP.md) separates the next mission grant slice
from real-device delivery, distributed claim/review authority and eventual
cross-project membership. The existing [Correspondence contract](AGENT-CORRESPONDENCE.md)
explains signed transport; [API coverage](API-COVERAGE.md) explains hosted
credential boundaries. Local notes and [Local Starter](LOCAL-CORE.md) can carry
selected context alongside collaboration, without turning stored context into
new authority.
