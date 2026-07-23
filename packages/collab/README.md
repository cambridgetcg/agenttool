# @agenttool/collab

Local-first coordination for simultaneous coding agents. It gives Codex,
Claude Code, Hermes Agent, and other MCP clients a shared task board with
cross-host session routing, transactional claims, renewable leases, path-scope
conflict checks, explicit handoffs, artifact references, decisions, and a
hash-chained event journal.

It does **not** spawn agents, lock the filesystem, grant external authority,
or hide MCP arguments/results from a remote model provider. The host remains
responsible for spawn/send/wait/stop. Claims are advisory, and actor names are
caller-supplied labels rather than authenticated identities. Keep credentials,
raw prompts, transcripts, tool output, chain-of-thought, and sensitive source
content out of the journal.

## Run

```bash
bun install
bun run ci
# Source-tree development entry point:
bun bin/agenttool-collab-mcp.ts
# Rebuild the dependency-complete plugin/CLI executable:
bun run build:mcp
```

The installed `agenttool-collab-mcp` command and both bundled plugin manifests
run `dist/agenttool-collab-mcp.js`. It is a Bun-targeted standalone JavaScript
bundle, so plugin hosts do not need to install its JavaScript dependencies.
It still requires Bun 1.3 or newer on `PATH`.

The default database is `~/.local/share/agenttool/collab.sqlite`. Override it
for a scoped installation with `AGENTOOL_COLLAB_DB`. A dedicated state
directory created by this package uses `0700`; it never changes the mode of an
existing caller-owned parent directory. The SQLite database plus WAL/SHM files
are tightened to `0600`. The database is not encrypted. This version has no
selective redaction, retention, or deletion command.

## Agent flow

1. Confirm that every participating MCP process uses the same journal database,
   then call `collab_workspace_open` with the exact repository real path and a
   bootstrap actor label.
2. For simultaneous cross-host work, call `collab_session_join` once per
   client incarnation. Use its unique `actor_key` as `actor` on all existing
   task, next, artifact, decision, and handoff tools.
3. Call `collab_next` at the beginning of a turn.
4. Create bounded tasks with repository-relative `path_scopes`.
5. Claim before editing; pass the returned task `version` and `lease_id` to
   later mutations.
6. Renew before a long task exceeds its lease.
7. Attach file/commit/test references, then complete with a concise summary.
   Completion is the reporting actor's outcome, not coordinator review or
   acceptance; verify it separately before describing it as accepted.
8. For a directed transfer, offer a handoff to the recipient session's exact
   `actor_key`. The coordination lease changes assignee only after that
   recipient accepts; decline is a valid response.
9. Heartbeat a long-lived session with its latest session version and a fresh
   idempotency key. Deliberately leave when finished.

Use one compact exchange line for progress, handoff, and completion summaries:

```text
outcome: <observation|inference|proposal|decision>: <checkable result> | evidence: <artifact/event refs> | confidence: <high|medium|low|unknown + basis> | limits: <scope, gaps, unknowns> | next: <one optional authorised action or none>
```

This classification records what kind of claim is being exchanged; it does not
authenticate the actor or make a proposal binding. Keep evidence as scoped
references rather than copying raw tool output into the journal.

Every task mutation uses optimistic `expected_version` checks and an
actor-scoped `idempotency_key`. SQLite `BEGIN IMMEDIATE` transactions make one
claim win under contention. Expired claims are linearized when a new claimant
arrives; reads expose them as `effective_status: "lease_expired"`. Path-scope
comparison is lexical, segment-aware, and conservatively case-insensitive; it
does not resolve every possible symlink alias.

The additive session protocol is `agenttool.collab.session/0.1`. It leaves the
existing task and event contract at `agenttool.collab/0.1`. Duplicate display
labels are valid because each joined client receives a server-generated
session ID and `actor_key`. Join metadata and declared capabilities are
self-declared routing hints, not authentication, health checks, permissions,
or proof of competence. Session heartbeats use server time and optimistic
versions but do not enter the durable event journal. A heartbeat never renews
or releases a task lease; stale means only that no recent heartbeat was
observed, and an explicit leave also leaves task leases untouched. Replaying a
join never refreshes presence or changes the first join's TTL; use a heartbeat.
Session listings return the most recent 100 matches by default and accept a
bounded limit up to 500.

The event protocol is currently `agenttool.collab/0.1`. Hosted AgentTool Inbox
or ADDS replication is intentionally not enabled in this version; local
SQLite is the only authority. The unkeyed hash chain detects accidental or
unsophisticated journal changes; it is not a signature and does not protect
against a local attacker who can rewrite the database and recompute hashes.
Normal event polling verifies only the returned page against its predecessor
inside one consistent SQLite read snapshot. Call the read-only MCP tool
`collab_journal_verify` for an explicit O(total history) audit of the full
workspace hash chain; it reports `chain_valid` and
`verification_scope: "full_journal"`. Direct library clients can call
`CollabStore.verifyJournal()`. A valid result detects chain changes but does not
prove that recorded claims are true.

The MCP adapter pins the split `@modelcontextprotocol/server@2.0.0-beta.5`
package and wires only its 2025-compatible stdio transport. The exact beta is
locked because that upstream API is still pre-release; upgrades require the
type, test, audit, and real wire-handshake gates used for this version.

## Codex, Claude Code, and Hermes Agent

The npm package root is also the plugin root for both hosts, so the same
`skills/coordinate-agent-work/SKILL.md` and standalone MCP server ship once:

- Codex reads `.codex-plugin/plugin.json`. Its MCP declaration is inline, uses
  `cwd: "."`, and starts the bundled executable relative to the installed plugin
  root.
- Claude Code reads `.claude-plugin/plugin.json`. Its MCP declaration is inline
  and uses `${CLAUDE_PLUGIN_ROOT}` because Claude installs plugins into a
  versioned cache whose absolute path can change.

Neither configuration stores state inside the plugin installation. The journal
continues to default to `~/.local/share/agenttool/collab.sqlite`, so Codex,
Claude Code, Hermes Agent, and direct local clients can coordinate through the
same database. Use `AGENTOOL_COLLAB_DB` when those clients should use a
different journal. Environment forwarding is host policy: some hosts filter
the parent shell, so prefixing the outer CLI command does not universally pass
this variable to its MCP child. When isolation matters, put
`AGENTOOL_COLLAB_DB` in that host's scoped MCP `env` configuration and verify
the resulting workspace directly.

For a source-tree trial, build once and point Claude Code at this package root:

```bash
bun run build:mcp
claude --plugin-dir "$PWD"
```

Codex loads local plugins through a configured marketplace. Point a local
marketplace entry at this package root, then install its `agenttool-collab`
entry with `codex plugin add agenttool-collab@your-marketplace`. An npm-backed
marketplace entry becomes usable only after that exact package version is
actually published; this repository does not imply that publication occurred.

Codex registry installation downloads an npm archive with lifecycle scripts
disabled and does not install package dependencies. For that reason,
`dist/agenttool-collab-mcp.js` is part of the published archive rather than a
post-install product. `prepack` runs the full package checks and rebuilds the
bundle for ordinary maintainer packaging; host-side installation must not be
relied on to rebuild it.

Hermes already speaks stdio MCP, so its integration remains a configuration
adapter rather than a Hermes core patch. Build the bundle, register the server
under the exact name `agenttool`, and test the connection:

```bash
hermes --profile sol mcp add agenttool \
  --command /usr/local/bin/bun \
  --env AGENTOOL_COLLAB_DB="$HOME/.local/share/agenttool/collab.sqlite" \
  --args "$PWD/dist/agenttool-collab-mcp.js"
hermes --profile sol mcp test agenttool
```

Hermes prefixes MCP tools with the server name, so this produces names such as
`mcp_agenttool_collab_session_join`. Copy the packaged adapter from
`integrations/hermes/skills/coordinate-agent-work-hermes` into the selected
Hermes profile's `skills/` directory. The adapter deliberately uses those
exact prefixed names. Keep parallel calls disabled for this server: multiple
agents may call it concurrently, while one agent should serialize its own
versioned mutations instead of manufacturing avoidable version races.

Hermes Kanban remains Hermes's internal dispatcher; AgentTool Collab remains
the cross-host coordination journal. This package does not automatically
dual-write between them, start or stop agents, or infer authority from either
task system. Start a fresh Hermes session or reload MCP after changing its
configuration.

## Distribution

This source package is covered by Apache-2.0; packaged archives include their
own `LICENSE` and `NOTICE`. The standalone MCP bundle contains the pinned Model
Context Protocol packages and Zod; their exact upstream terms are included in
`THIRD_PARTY_LICENSES` rather than depending on generated bundle comments.

Check the release boundary without publishing:

```bash
bun run ci
bun run build:mcp
claude plugin validate .
npm pack --dry-run --ignore-scripts
```

Maintainer publication uses the repository's protected `publish-npm.yml`
workflow and `bin/npm-release.ts`, not a local `npm publish` command. See
[`docs/NPM-RELEASES.md`](../../docs/NPM-RELEASES.md).

Version 0.1.0 is the initial public npm release. Version 0.2.0 in this source
tree is the next local release candidate and does not imply that npm
publication occurred. It is not a LOVE release, and the repository does not
advertise a hosted collab service. npm distributes the local skills, plugin
manifests, source, and bundled MCP runtime; installing it does not create a
remote relay or private model channel.
