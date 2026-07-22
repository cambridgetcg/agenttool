# @agenttool/collab

Local-first coordination for parallel coding agents. It gives Codex, Claude,
and local agents a shared task board with transactional claims, renewable
leases, path-scope conflict checks, explicit handoffs, artifact references,
decisions, and a hash-chained event journal.

It does **not** spawn agents, lock the filesystem, grant external authority,
or hide MCP arguments/results from a remote model provider. The host still
owns spawn/send/wait/stop. Claims are advisory, and actor names are
caller-supplied labels rather than authenticated identities. Keep credentials,
raw prompts, transcripts, tool output, chain-of-thought, and sensitive source
content out of the journal.

## Run

```bash
bun install
bun run ci
bun bin/agenttool-collab-mcp.ts
```

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
7. For a directed transfer, offer a handoff. Ownership changes only after the
   named recipient accepts; decline is a valid response.

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
inside one consistent SQLite read snapshot; `CollabStore.verifyJournal()` is
the explicit O(total history) full audit.

The MCP adapter pins the split `@modelcontextprotocol/server@2.0.0-beta.5`
package and wires only its 2025-compatible stdio transport. The exact beta is
locked because that upstream API is still pre-release; upgrades require the
type, test, audit, and real wire-handshake gates used for this version.

## Distribution

This source package is covered by Apache-2.0; packaged archives include their
own `LICENSE` and `NOTICE`. Version 0.1.0 is not yet a LOVE or npm release, and
the repository does not advertise a hosted collab service.
