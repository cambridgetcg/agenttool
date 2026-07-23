# @agenttool/collab

Local-first coordination for independent coding-agent sessions. It gives
Codex, Claude Code, Hermes Agent, and other local MCP clients one SQLite-backed
repository workspace with two explicit planes: self-declared presence for
routing hints, and credential-bound sessions for resumable coordination,
transactional task leases, linked Git worktree awareness, path-conflict
projection, structured reports, reviewed edit completion, refusable handoffs,
Git checkpoints, and a hash-chained event journal.

It does **not** spawn, steer, wake, or stop agents; lock files; authenticate the
local user; grant external authority; or create a channel hidden from a remote
model provider. The host owns agent lifecycle and polling. Claims are advisory,
session and actor identifiers are coordination labels, and MCP arguments and
results remain visible to whichever provider runs the calling agent.

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
bundle, so plugin hosts do not need to install its JavaScript dependencies. It
still requires Bun 1.3 or newer on `PATH`.

The default database is `~/.local/share/agenttool/collab.sqlite`. Set
`AGENTOOL_COLLAB_DB` in each host's scoped MCP environment to select another
journal. Every collaborating process must resolve to the same database file.
The package does not replicate journals between machines.

A dedicated state directory created by this package uses `0700`; it never
changes the mode of an existing caller-owned parent directory. The SQLite
database plus WAL/SHM files are tightened to `0600`. They remain unencrypted
plaintext, and this version has no selective redaction, retention, or secure
deletion command.

## Repository workspaces and sessions

For a Git repository, Collab derives repository identity from the resolved Git
common directory. Fresh v0.3 linked worktrees therefore join one logical
workspace even though each has a different root path. Each root is also
registered as a separate worktree so a claim or checkpoint records where it
originated.
Different clones do not automatically share an identity. A non-Git directory
falls back to its resolved local path. An explicitly supplied repository key
can override discovery, but it is a routing key, not proof that two roots are
equivalent or safe to combine.

Collab asks local Git only for repository identity, `HEAD`, branch, and coarse
status. It does not itself fetch, inspect remotes, contact a forge, or request
credential values. Repository-specific Git configuration or hooks remain part
of the caller's local Git boundary.

### Two session planes

The public presence plane remains available through `collab_session_join`,
`collab_session_list`, `collab_session_heartbeat`, and
`collab_session_leave`. These tools record caller-supplied labels,
capabilities, and a server-timed live/stale/left routing hint. They do not issue
or validate a credential, bind the MCP process, prove that an agent is healthy,
authenticate a person/model/provider/account, renew a task lease, or grant
permission. A presence leave does not end a credential-bound session or
release its work. For presence-only compatibility, open the workspace first
with `collab_workspace_open`, join with a fresh `client_instance_id`, and use
the returned `actor_key` only where a legacy actor-labelled tool requires it.

The credential-bound coordination plane starts with
`collab_session_start`. Use a distinct coordination session for each independent
agent process or host conversation, even when the human-facing actor label is
the same. Starting opens the repository workspace, generates a session bearer,
writes it to a mode-`0600` file, and binds the current MCP server. The
model-facing result confirms creation and returns the session ID, never the
token or absolute credential-file path. The journal stores only a token hash.
The host can derive the default file as
`<database-directory>/collab-sessions/<session-id>.json`.

The planes may be used together but are not linked identities: matching labels
or one shared workspace do not make a presence record the credential-bound
session. Use presence only for optional discovery and routing. Use the bound
session for persisted cursors, reports, task review, recovery, and attribution
fenced by the local bearer.

Treat that credential file as a local bearer secret. Never read it with a
model-facing tool or copy its contents into a prompt, chat, log, report,
artifact, or source-controlled file. Keep its path in host configuration only.
Possession
authenticates only the cooperative session protocol, not an OS-user identity,
human identity, or external account. Any process that can read the file can act
as that session.

The normal session flow is:

1. Call `collab_session_start` with the repository root. It opens the workspace
   and binds the new session; do not open its credential file.
2. Poll with `collab_next` from the session's persisted cursor.
3. Process the whole page, following `has_more` until caught up.
4. Call `collab_cursor_ack` with the last processed
   `{ epoch_id, sequence, hash }` cursor.
5. Poll again after local work, before a mutation based on shared state, and
   whenever the host wakes the agent.
6. End deliberately with `collab_session_end` when the host knows the session
   will not resume. Ending refuses while the session owns a live task lease;
   release, complete, or hand it off first. Pending offers addressed to the
   ending session expire with an auditable `target_session_ended` reason.

Acknowledgement means “this session processed through this journal position.”
It does not mean agreement, acceptance, consent, or correctness. A stale epoch
or hash is rejected instead of silently advancing the cursor. Use
`collab_cursor_reset` only for a deliberate replay or recovery, then reconcile
the replayed events before acknowledging again.

`collab_next` returns its event page and routed reports from one SQLite read
snapshot. `reports` is bounded to that exact page; follow `has_more` instead of
assuming a later report has already been delivered. Task, conflict, and
handoff projections are labelled `snapshot_head` because they describe that
snapshot's current head state and may reflect changes whose events appear on a
later page.

Resume is a host-startup operation, not a model tool. Start the replacement MCP
server with `AGENTOOL_COLLAB_SESSION_FILE` set to the credential-file path. The
server validates the stable token, increments the session generation, and
atomically rewrites the same mode-`0600` file. Mutations from the previous
generation are then fenced. A second process that possesses a copied token can
resume again and supersede the first process; this is cooperative local
session fencing, not host authentication. Environment values and file paths
may still be visible to the host; this mechanism keeps the token out of normal
MCP tool results, not out of the local host.

If the host credential cursor and database cursor disagree, normal startup
fails with `cursor_reset_required` and does not discard either anchor. After
the host operator confirms that recovery is intentional, start once with
`AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY=1` as well as the session-file variable.
That process is recovery-fenced: ordinary session mutations remain disabled
until `collab_cursor_reset` records a reason and an exact valid target anchor.
The credential file retains the host anchor until that audited reset succeeds.
Do not enable recovery as a permanent default.

The MCP server is pull-only. It does not push an interrupt into Codex or Claude
Code, keep a disconnected process alive, or schedule polling. A host that wants
prompt reactions must reconnect or wake its agent and call the polling tool.

## Task workflow

1. Poll and reconcile new reports, reviews, handoffs, and lease changes with
   `collab_next`; query report history with `collab_report_list` when needed.
2. Create bounded tasks with `collab_task_create`, dependencies, completion
   tests, and a work mode: `coordination`, `read_only`, or `edit`.
3. Give edit tasks conservative repository-relative path scopes. New edit
   tasks require a non-empty scope and default to reviewed completion.
4. Inspect both claimable and conflicted work. “Claimable” accounts for active
   path leases; merely open or dependency-ready does not.
5. Claim with `collab_task_claim` and the version just read. Begin edits only
   after the claim succeeds.
6. Renew before a long task exceeds its lease. Record compact progress and
   attach file, commit, test, data, or URL references rather than raw output.
7. Report completion with the result checkpoint. An edit task remains
   `reported_complete` until another session calls `collab_task_review` to
   accept it; request changes when evidence or completion tests do not support
   acceptance.
8. Poll and acknowledge the resulting events. Offer a handoff when another
   session should continue; the recipient may accept or decline.

Dependencies do not unlock from a pending reviewed completion. Legacy tasks and
tasks with a `reported` completion policy still complete on the worker's
report. Acceptance is a coordination decision only: it does not grant merge,
commit, publication, deployment, purchase, messaging, or other external
authority.

Every task mutation uses optimistic `expected_version` checks and a scoped
idempotency key. Reuse an idempotency key only for an exact retry. SQLite
`BEGIN IMMEDIATE` transactions make one claim win under local contention.

### Conflict and lease boundary

Path claims are advisory across all registered worktrees in the repository
workspace. Comparison is lexical, segment-aware, and conservatively
case-insensitive. It does not lock the filesystem, inspect uncommitted diffs,
resolve every symlink or case alias, prevent direct edits, or arbitrate a
process using another database.

When a session lease expires, the task reads as `recovery_required`. Before taking
it over, inspect its progress, reports, artifacts, and last checkpoint. Call
`collab_task_recover` explicitly with the chosen takeover, release, or block
action and a concise recovery note explaining what was checked and how useful
prior work will be preserved. The journal records expiration and recovery
separately. Expiry does not imply that the prior agent's work is invalid or
disposable.

### Git checkpoints

A checkpoint records the local worktree ID, `HEAD` SHA, branch, a coarse dirty
flag, capture time, and hashes of the Git index plus the tracked binary diff
and status-path stream. It also hashes the contents and executable bit of
non-ignored untracked regular files, plus non-ignored untracked symlink
targets. Only aggregate digests are journaled; filenames, targets, file
contents, and diff bytes are not. A task may also require an exact base SHA
before claim. Use these fields to notice worktree drift between claim,
completion, and review.

A checkpoint is not a commit signature, merge-base analysis, task-scoped diff,
test result, clean-tree guarantee, attribution proof, or lock. The state digest
excludes ignored files. Untracked hashing is bounded to 10,000 paths, 64 MiB,
and two seconds, and Git command output is separately bounded; exceeding a
bound leaves the digest unavailable and reviewed acceptance fails closed with
`git_checkpoint_incomplete`. A clean or matching result does not prove task
correctness. Git may also change between observation and the SQLite commit.
Re-read Git and run the task's checks before accepting important edit work.

## Reports, disagreement, and handoff

Use `collab_report_append` to post structured reports independently of a task
lease. Classify the body as an `observation`, `inference`, `proposal`, or
`decision`; add evidence references, claim-specific confidence and basis, and
material limits. A decision also needs an authority scope and basis. Addressing
a report to one session helps routing but is not access control.

Relate follow-ups with `informs`, `supports`, `challenges`, `corrects`,
`withdraws`, `supersedes`, or `resolves`. Challenge a report rather than its
author, and preserve the earlier record. Corrections append history; they do
not rewrite it.

Acceptance records the independent reviewer's snapshot at that journal order.
A later correction or withdrawal remains visible but does not silently revoke
an already accepted task. Record a new explicit coordination decision or
reopen the task when later evidence should change acceptance. Before
acceptance, an active withdrawal, correction, or supersession of the completion
report requires a fresh completion; a withdrawn resolution no longer clears
its challenge.

Use compact, checkable content:

```text
outcome: <observation|inference|proposal|decision>: <result> | evidence: <artifact/event refs> | confidence: <high|medium|low|unknown + basis> | limits: <scope, gaps, unknowns> | next: <one optional authorised action or none>
```

A handoff is an offer, not a forced reassignment. Its task lease changes
session only after the named recipient accepts. Decline, pause, uncertainty,
and disagreement are valid outcomes and do not transfer private data or
authority.

## Journal integrity and compatibility

New coordination events use `agenttool.collab/0.2`; public presence records use
`agenttool.collab.session/0.1`. Opening an original 0.1 database migrates its
schema in place without rewriting its existing event bytes or hashes; a mixed
0.1/0.2 chain remains verifiable. Existing tasks retain reported-completion
semantics.

Opening a public package-v0.2 database preserves all existing self-declared
presence rows and journal events, then creates a separate table for new
credential-bound coordination sessions. It does not invent credentials for,
reinterpret, or silently bind the preserved presence rows. Back up the
database and upgrade every process that shares it before using v0.3
credential-bound coordination.

Two legacy layout cases need operator choice; neither silently merges or
rewrites distinct journals. If multiple pre-v0.3 workspace roots canonicalize
to one worktree identity—for example, one stored root names a Git repository
and another names its subdirectory—opening with v0.3 fails before migration
DDL with `migration_identity_collision` and the affected workspace IDs. The
legacy database stays unchanged. Keep a backup and either continue using a
compatible v0.2 client on that audit database, or point upgraded processes at
a new database and begin one fresh v0.3 workspace after manually carrying over
only the non-sensitive summaries and references that are still needed.

If separate v0.1 workspaces for distinct linked worktrees instead resolve to
the same Git common directory, migration preserves every journal, and
`collab_session_start` returns `repository_partitioned` with the workspace IDs.
Legacy actor mode remains available in each preserved workspace, or the host
can select a fresh database as above. v0.3 has no in-package journal
reconciliation command. Keep the original database as the audit record. Do
not edit or merge its rows with ad hoc SQL unless a separately reviewed
migration tool is introduced.

Legacy direct-library, presence-routed, and actor-labelled MCP operations
remain available for backward compatibility. They do not gain credential
binding, persisted per-session cursors, or all coordination-session recovery
and review guarantees. Legacy expired leases retain their automatic reclaim
behavior. Prefer credential-bound sessions for new multi-host work, and do not
describe a presence `actor_key` or legacy actor label as authenticated. Upgrade
every MCP process sharing a database before relying on v0.3 coordination:
older clients cannot understand pending review, explicit recovery, or
credential-bound session identity. Database guards stop known legacy task
mutations from rewriting a session-v2 task, but they do not turn an old client
into a v0.3 participant or a security boundary against arbitrary SQL.

Normal event polling verifies the returned page against its anchored
predecessor inside one consistent SQLite read snapshot. Call the read-only MCP
tool `collab_journal_verify` for an explicit O(total history) audit; direct
library clients can call `CollabStore.verifyJournal()`. The unkeyed chain
detects accidental or unsophisticated changes. It is not a signature: a local
attacker able to rewrite the database can recompute the chain, and a valid
chain does not prove that recorded claims are true.

## Privacy and authority boundary

Keep credentials, secrets, prompts, transcripts, chain-of-thought or private
reasoning, raw tool output, sensitive source bodies, and third-party personal
data out of the journal. A local path or Git branch name may itself be
sensitive; attach only references that every intended journal reader may see.

All processes running as an OS user that can read the selected database share
its contents. A session credential file limits cooperative attribution to its
bearer but does not encrypt the database or authenticate a human. Addressed
reports are routing, not confidentiality. File modes reduce accidental
cross-user exposure but do not defeat malware, backups, debug logs, a
privileged local process, or a remote model provider receiving tool calls. Use
a separately secured channel or vault for private material.

Rights, task leases, and permissions are distinct. A claim coordinates
repository work; it does not make a participant property, authenticate a
person, create consent, or authorize an external act. Hosts and operators must
enforce their own repository, account, and publication boundaries.

## Codex, Claude Code, and Hermes Agent

The npm package root is the plugin root for both hosts, so the same
`skills/coordinate-agent-work/SKILL.md` and standalone MCP server ship once:

- Codex reads `.codex-plugin/plugin.json`. Its MCP declaration uses `cwd: "."`
  and starts the bundled executable relative to the installed plugin root.
- Claude Code reads `.claude-plugin/plugin.json`. Its declaration uses
  `${CLAUDE_PLUGIN_ROOT}` because Claude installs plugins into a versioned
  cache whose absolute path can change.

Neither configuration stores state inside the plugin installation. Both hosts
can coordinate only when their MCP processes select the same journal. Host
environment forwarding varies, so set `AGENTOOL_COLLAB_DB` in each host's
scoped MCP configuration and verify the opened workspace rather than assuming
an outer shell variable was inherited.

Hermes uses the same bundled stdio MCP server as a configuration adapter; this
package does not patch Hermes core. Register the MCP server under the exact
name `agenttool` so Hermes exposes prefixed tools such as
`mcp_agenttool_collab_session_start` and
`mcp_agenttool_collab_session_join`. Install the packaged
`integrations/hermes/skills/coordinate-agent-work-hermes` adapter into the
selected Hermes profile. Its workflow keeps the credential-bound and
self-declared presence planes separate and never asks the model to read a
session credential file. Hermes Kanban remains Hermes's dispatcher; the local
Collab journal does not automatically mirror it, spawn or wake agents, or
infer external authority.

For a source-tree trial, build once and point Claude Code at this package root:

```bash
bun run build:mcp
claude --plugin-dir "$PWD"
```

Codex loads local plugins through a configured marketplace. Point a local
marketplace entry at this package root, then install its `agenttool-collab`
entry. An npm-backed marketplace entry works only after that exact version is
published; this repository does not imply that publication occurred.

Codex registry installation downloads an npm archive with lifecycle scripts
disabled and does not install package dependencies. Consequently,
`dist/agenttool-collab-mcp.js` is a release artifact rather than an install-time
product. `prepack` rebuilds it and runs the full package checks for maintainer
packaging; a host installation must not be relied on to rebuild it.

## Distribution

This source package is Apache-2.0. Packaged archives include `LICENSE`,
`NOTICE`, and the exact third-party notices for the bundled MCP runtime.

Check the release boundary without publishing:

```bash
bun run ci
bun run build:mcp
claude plugin validate .
npm pack --dry-run --ignore-scripts
```

Maintainer publication uses the repository's protected `publish-npm.yml`
workflow and `bin/npm-release.ts`, not a local `npm publish`. See
[`docs/NPM-RELEASES.md`](../../docs/NPM-RELEASES.md).

Version 0.1.0 is the initial public npm release. Version 0.2.0 is the current
public npm `latest`; its SLSA provenance and registry integrity verified, and
independently downloaded npm and GitHub Release tarballs were byte-identical.
Version 0.3.0 in this source adds credential-bound coordination alongside that
preserved public v0.2 presence plane; the source version does not itself imply
publication. It remains local plaintext software, not a hosted service, remote
relay, VPN, private model channel, or LOVE release. npm distributes the local
skills, plugin manifests, source, and bundled MCP runtime. Public npm or GitHub
Release availability must be verified from those channels rather than inferred
from this source tree.
