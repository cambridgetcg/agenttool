# @agenttool/collab

Local-first coordination for parallel coding agents. It gives Codex, Claude,
and local agents a shared task board with transactional claims, renewable
leases, path-scope conflict checks, explicit handoffs, artifact references,
decisions, and a hash-chained event journal.

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

1. Call `collab_workspace_open` with the repository root and an actor name.
2. Call `collab_next` at the beginning of a turn.
3. Create bounded tasks with repository-relative `path_scopes`.
4. Claim before editing; pass the returned task `version` and `lease_id` to
   later mutations.
5. Renew before a long task exceeds its lease.
6. Attach file/commit/test references, then complete with a concise summary.
   Completion is the reporting actor's outcome, not coordinator review or
   acceptance; verify it separately before describing it as accepted.
7. For a directed transfer, offer a handoff. The coordination lease changes
   assignee only after the named recipient accepts; decline is a valid response.

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

## Codex and Claude Code plugins

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
Claude Code, and direct local clients can coordinate through the same database.
Use `AGENTOOL_COLLAB_DB` when those clients should use a different journal.
Environment forwarding is host policy: some hosts filter the parent shell, so
prefixing the outer CLI command does not universally pass this variable to its
MCP child. When isolation matters, put `AGENTOOL_COLLAB_DB` in that host's
scoped MCP `env` configuration and verify the resulting workspace directly.

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

Version 0.1.0 is the first public npm release. It is not a LOVE release, and
the repository does not advertise a hosted collab service. npm distributes the
local skill, plugin manifests, source, and bundled MCP runtime; installing it
does not create a remote relay or private model channel. Registry availability
and downloaded integrity remain independently verifiable release facts.
