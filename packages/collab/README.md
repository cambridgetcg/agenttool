# @agenttool/collab

Local-first coordination plus an optional cross-device release room for
independent coding-agent sessions. Codex, Claude Code, Hermes Agent, and other
MCP clients can use three deliberately distinct planes:

1. a SQLite-backed local workspace for credential-bound sessions,
   transactional task leases, reports, review, handoffs, Git checkpoints, and
   a hash-chained journal on one device;
2. the separately deployed Agent Correspondence protocol for signed,
   replayable facts across devices without choosing a winner; and
3. a repository-scoped relay release room for atomic cooperative leases around
   external operations and bounded provider observations.

Git carries file bytes and history. The local journal does not replicate
between devices, Correspondence claims remain advisory, and the release room
does not replace ordinary edit-task coordination.

It does **not** spawn, steer, wake, or stop agents; replicate Git; lock files;
authenticate the local user; grant external authority; or create a channel
hidden from a relay operator or remote model provider. The host owns agent
lifecycle and polling. Claims are cooperative coordination, session and actor
identifiers are bounded attribution labels, and MCP arguments and results
remain visible to whichever provider runs the calling agent.

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
run `dist/agenttool-collab-mcp.js`. The explicit
`agenttool-collab-enroll` command runs
`dist/agenttool-collab-enroll.js`. They are Bun-targeted standalone JavaScript
bundles, so plugin hosts do not need to install their JavaScript dependencies.
They still require Bun 1.3 or newer on `PATH`.

The default database is `~/.local/share/agenttool/collab.sqlite`. Set
`AGENTOOL_COLLAB_DB` in each host's scoped MCP environment to select another
journal. Every collaborating process must resolve to the same database file.
The package does not replicate that journal between machines. Cross-device
facts use Agent Correspondence; cross-device exclusion is limited to release
room operations.

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

## Cross-device release room

The v0.4 release room adds remote atomicity only for bounded external
operations such as a package release or production deploy. It does not
replicate local tasks, reports, checkpoints, or source. Use:

- the local journal for atomic same-device edit tasks;
- [Agent Correspondence](https://github.com/cambridgetcg/agenttool/blob/main/docs/AGENT-CORRESPONDENCE.md) for signed
  cross-device intent, progress, Git-addressed artifacts, disagreement,
  refusal, rest, handoff, and repair; and
- the release room immediately before an externally mutating operation.

The MCP server exposes release-room tools only when relay URL, project
profile, and active scoped credential metadata are configured. Installing or
starting the plugin never enrolls a device by itself. Local coordination
continues without the remote tools when no relay URL is set. A partially
configured or mismatched relay binding fails startup instead of silently
falling back to an uncoordinated surface.

### Project profile and enrollment

Commit a non-secret `.agenttool/project.json` conforming to
[`agenttool.project/1`](https://github.com/cambridgetcg/agenttool/blob/main/docs/specs/agenttool-project-1.schema.json). It
binds clones through a stable provider repository ID and records release
policy and deployment-surface metadata. A display name is not sufficient
identity. The profile must not contain credentials, local paths, or unrelated
provider account identifiers. Its required `deployments` object may be empty
when the project has no hosted surface; Vercel is enabled only alongside an
explicit Vercel surface and stable team/project binding. Each declared surface
binds provider, environment, and stable provider resource ID.

The host finds the nearest profile from the working directory. Set
`AGENTOOL_COLLAB_PROJECT_FILE` only to select one explicitly. Each device must
enroll deliberately; a matching Git remote or readable profile never enrolls
it automatically.

Run the explicit `agenttool-collab-enroll` host command. The source-tree entry
is `bin/agenttool-collab-enroll.ts`; releases bundle
`dist/agenttool-collab-enroll.js`. The wrapper validates the profile and uses an
existing project bearer for the one enrollment request. On first enrollment it
obtains a fresh repository-scoped `atc_` bearer (generated for Keychain or
pre-generated by a scoped environment wrapper); re-enrollment deliberately
reuses the existing device bearer and does not rotate it. The wrapper derives
the profile digest and canonical provider allowlist and sends only that
non-secret policy plus the token prefix and digest in the enrollment body. The
relay stores the policy on the enrolled device, so an `atc_` bearer used
through a custom client still cannot observe Vercel or another provider omitted
by the project-authorized enrollment.
Enrollment uses a deterministic request key plus device-version CAS. The
mode-`0600` metadata file preserves the exact hash-only pending request before
HTTP, so a lost response retries the same bytes instead of rolling credential
or policy state backward.
An exact retry can replay a receipt committed before a later policy change,
but it appends no new observation and enables nothing.
Neither bearer belongs in a model-facing tool result.

Without an explicit credential path or device ID, the wrapper uses a stable
repository-scoped `default.json` under the host state directory and stores the
generated UUID inside it, so an ambiguous first run and its retry meet the same
pending request. A private local per-credential enrollment lock spans metadata
read, HTTP, and the final fenced write. It prevents two local processes from
replacing each other's metadata; it is not a remote or cross-device lock.

```bash
agenttool-collab-enroll \
  --device-label "this-device" \
  --project-bearer-stdin
```

Provide the one-shot project bearer through
`AGENTOOL_COLLAB_PROJECT_BEARER` or the explicit
`--project-bearer-stdin` mode, never an argv value visible in a process
listing.

On macOS the raw scoped token is stored in Keychain by default. A mode-`0600`
metadata file stores the relay/repository/device binding and version, Keychain
reference, and any strict hash-only pending enrollment request—never either
raw bearer. Select it and the relay with:

```text
AGENTOOL_COLLAB_RELAY_CREDENTIAL_FILE=/host/private/metadata.json
AGENTOOL_COLLAB_RELAY_URL=https://relay.example
```

CI and non-macOS hosts may receive `AGENTOOL_COLLAB_RELAY_TOKEN` through a
named, process-scoped wrapper whose environment ends with the command. Never
export it from global shell startup.

Repository requests present the scoped bearer over TLS. The relay can read
stored coordination metadata, and authentication code sees the bearer long
enough to hash it. This boundary is server-readable transport security, not
end-to-end encryption or a private provider channel.

### Operation lease and observations

The remote slot key is exactly repository + operation + environment. One
claim also binds an exact target, source revision, and parameter digest. Begin
the action immediately before the external mutation; renew only that exact
action; complete it with bounded receipt references and provider evidence.
Because an exact idempotent mutation receipt can be historical, the official
client rejects an expired returned lease and immediately status-confirms the
same complete current slot fence before returning `claim`, `renew`, or `begin`
as actionable. Direct HTTP clients must do the same before using the lease.

For AgentTool, use the exact pairs `github-branch / repository`,
`github-pull-request / repository`, `github-merge / main`,
`npm-release / production`, and `production-deploy / production`; enabled
Vercel projects use `vercel-deploy / preview` or
`vercel-deploy / production`. Synonyms are different slots. Compute
`parameters_sha256` with exported `requestSha256(parameters)` over the same
agreed JSON object on every device.

If a claimed lease expires before execution, its history remains and the slot
may return to idle. If an executing lease expires, the slot fails closed to
`recovery_required` with an uncertain outcome. A cooperating device must
reconcile receipts and provider state before the slot can be reused.
Operation status is a read-only server-time effective scan: follow `next_after`
while `has_more` is true, then use the terminal page's `next_after: 0` to
restart the next polling cycle. That reset lets time-only expiry become
visible. Pages are current reads, not a cross-request database snapshot.
Status projects an expired claim as idle or an expired execution as
recovery-required without materializing lease/event state. The next fenced
mutation, including explicit recovery, persists that transition and its
server-attributed audit event. Read authentication does not update device
usage telemetry.

The MCP surface provides operation status/events,
claim/renew/begin/complete/release/recover, and provider observation
reads/writes. Recovery requires the current version/generation plus bounded
reason and optional receipt/evidence references; an uncertain disposition
keeps the slot closed. Every observation names its observing session and may
bind the related action; the MCP runtime derives a stable UUID for its process.
Exact mutation retries are idempotent; reusing an idempotency key with another
body fails. Provider checks, deployments,
webhooks, registry state, and receipts are evidence, not authority.
Receipt normalization is profile-bound: npm name, release key,
repository-relative path, and exact tag prefix/version must match. For deploy
receipts, the provider, environment, and resource ID come from caller-supplied
import context and are checked against the profile; they are not fields in the
receipt and therefore are not provider provenance. The v2 adapter accepts only
the bound Fly `agenttool` surface when the wrapper outcome is `succeeded` and
its API phase is exactly `deployed_verified`. It refuses skipped or unverified
API phases and every individual Cloudflare Pages or Vercel surface because the
receipt has only one aggregate `frontends` phase. Use separately corroborated
direct provider observations for those surfaces. Imported receipts and direct
observations are repository-scoped `device_observed` claims, not
provider-verified facts. Direct observations are more flexible because their
resource may be a check, run, or deployment ID; they do not prove
provider-project binding. No new Vercel observation is accepted while Vercel
is disabled; an exact historical receipt retry may still return without
appending state or enabling Vercel.

Do not send raw logs, diffs, source bodies, prompts, transcripts, command
output, environment dumps, credentials, or secret-bearing URLs. Prefer exact
revisions, stable resource IDs, bounded states, digests, and the fixed fields
of `agenttool.npm-release/1` and `agenttool-deploy-receipt/v2`. Strict schemas
provide no raw-payload fields and reject common credential patterns and
secret-bearing URL components; that is not a universal secret or log scanner.

See [Cross-device collaboration](https://github.com/cambridgetcg/agenttool/blob/main/docs/CROSS-DEVICE-COLLABORATION.md) for
the GitHub → checks/review → merge → protected npm OIDC workflow or deploy
wrapper → receipt → provider-observation flow. The normative HTTP and recovery
contract is [Collab Release Room
0.4](https://github.com/cambridgetcg/agenttool/blob/main/docs/specs/AGENTTOOL-COLLAB-RELEASE-ROOM-0.4.md).

### Two local session planes

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
its contents. A local session credential file limits cooperative attribution
to its bearer but does not encrypt the database or authenticate a human. The
remote scoped bearer authenticates one enrolled repository but does not make
relay state end-to-end encrypted. Addressed reports are routing, not
confidentiality. File modes and Keychain reduce accidental exposure within
their stated host boundaries but do not defeat malware, backups, debug logs, a
privileged local process, a relay operator, or a remote model provider
receiving tool calls. Use a separately secured channel or vault for private
material.

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

Neither configuration stores state inside the plugin installation. Processes
must select the same journal for local task atomicity. Separately enrolled
devices can share release-room operations and provider observations without
sharing that SQLite file; they still exchange source through Git and ordinary
cross-device facts through Agent Correspondence. Host environment forwarding
varies, so set Collab variables in each host's scoped MCP configuration and
verify both the opened workspace and repository binding rather than assuming
an outer shell variable was inherited.

Hermes uses the same bundled stdio MCP server as a configuration adapter; this
package does not patch Hermes core. Register the MCP server under the exact
name `agenttool` so Hermes exposes prefixed tools such as
`mcp_agenttool_collab_session_start` and
`mcp_agenttool_collab_session_join`. Install the packaged
`integrations/hermes/skills/coordinate-agent-work-hermes` adapter into the
selected Hermes profile. Its workflow keeps the credential-bound and
self-declared presence planes separate and never asks the model to read a
session credential file. Hermes Kanban remains Hermes's dispatcher; neither
the local journal nor the release room automatically mirrors it, spawns or
wakes agents, or infers external authority.

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
`dist/agenttool-collab-mcp.js` and `dist/agenttool-collab-enroll.js` are
release artifacts rather than install-time products. `prepack` rebuilds them
and runs the full package checks for maintainer packaging; a host installation
must not be relied on to rebuild either one.

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
[`docs/NPM-RELEASES.md`](https://github.com/cambridgetcg/agenttool/blob/main/docs/NPM-RELEASES.md).

Version 0.1.0 was the initial public npm release, version 0.2.0 remains a
historical public release, and version 0.3.0 was the immediately preceding
verified release. Protected trusted workflow run `30010457955` published
0.3.0 with SLSA provenance; independently downloaded npm and
[GitHub Release](https://github.com/cambridgetcg/agenttool/releases/tag/collab-v0.3.0)
tarballs were byte-identical
(`sha256:9c605ebe4cdc87eda1b0eede6bba0a6591a3dd62badd364463b01521401def7f`).

Version 0.4.0 adds the explicit enrollment client and remote release-room MCP
surface while preserving the 0.3 local protocol. Source, version metadata, an
archive, or a tag is not registry publication proof; verify the public registry
and protected release receipt. Installing the package does not deploy a relay
or hosted surface. The configured relay is a separately operated,
server-readable coordination service, not a VPN, end-to-end-encrypted chat,
private model channel, provider credential broker, or grant of release
authority.
