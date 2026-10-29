# @agenttool/collab

> **Compass:** Collaboration channels (`docs/COLLABORATION-CHANNELS.md` in the private source repository).
> **Type:** reference · **Purpose:** local coordination and upgrade boundaries.
> **Evidence:** `src/{store,mcp,repository,actor-default}.ts`; `tests/{session-fit,repository,migration-v2,mcp}.test.ts`.
> **Implements:** Local observation and coordination, not host lifecycle or remote delivery.
> **Code:** `src/{store,mcp,protocol,proposal,person-desk,ceremony,passkey,tty,version}.ts`.
> **Tests:** `tests/{events-wait,mcp,package,proposal-consent,person-desk,tty}.test.ts`.

**DEVELOPMENT BUILD: 0.5.1-dev.0, 36 MCP tools. Unreleased.** Collab 0.5.0
is released on GitHub only, as the
[`collab-v0.5.0` release](https://github.com/cambridgetcg/agenttool-collab/releases/tag/collab-v0.5.0)
of `cambridgetcg/agenttool-collab` (2026-10-10). On npm the recorded release is
still the 32-tool 0.4.0, which does not supply `collab_events_wait`. In
behaviour, this source is 0.5.0 plus the unreleased [host doorbell wait](#host-doorbell-wait-unreleased)
and its addressed mode with the Claude Code watcher, plus the unreleased
[session-fit changes](#session-fit-migration-unreleased) and the three unreleased
[proposal consent tools](#proposals-and-consent-unreleased) that bring 0.5.0's 33
tools to 36. The next npm candidate is
0.5.1 through the [public staged release path](https://docs.agenttool.dev/NPM-RELEASES.md#public-release-path-from-2026-10-12).
This source is not evidence of 0.5.1 publication or native-harness activation;
verify exact release receipts separately.

Local-first coordination for independent coding-agent sessions. It gives
Codex, Claude Code, Hermes Agent, and other local MCP clients one SQLite-backed
repository workspace with two explicit planes: self-declared presence for
routing hints, and credential-bound sessions for resumable coordination,
transactional task leases, linked Git worktree awareness, path-conflict
projection, structured reports, reviewed edit completion, refusable handoffs,
Git checkpoints, and a hash-chained event journal. Its 32nd local MCP tool is
a read-only view of an optional Zerone witness sidecar, so a participant can
distinguish an unwitnessed, pending, current, stale, or conflicting journal
without contacting a chain.

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

For a complete, single-root Git history with a supported remote, Collab routes
by the root commit plus canonical remote (`origin`, otherwise `github`). SSH,
SCP-style and HTTP(S) spellings of the same host/path share a case-insensitive
alias; credentials are omitted and non-default ports remain significant. New
clones join an existing journal only when discovery finds exactly one match.
Existing registrations and physical common-directory matches take precedence. Each
physical root keeps its own worktree ID and common-directory key for checkpoints
and old-client compatibility. These aliases are routing hints, not proof of
ownership or permission to combine work.

Missing/ambiguous remotes, shallow, unborn or multiple-root histories retain
local common-directory routing. Non-Git directories use their resolved path.
Explicit repository keys override portable discovery. Existing separate journals
are preserved, not merged: see the migration note below.

Collab reads local Git config, root ancestry, `HEAD`, branch and status. It never
fetches, invokes a transport/credential helper, or contacts a forge. A configured
remote can contain userinfo; it is discarded before hashing and is never returned
or journaled. Repository-specific Git configuration remains a local boundary.

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

The session's part of the ordinary loop (below) is:

1. Call `collab_session_start` with the repository root. It opens the workspace
   and binds the new session; do not open its credential file.
2. Poll with `collab_next` from the session's persisted cursor. Its optional
   `event_limit` accepts an integer from 1 through 50; omission uses the
   context-bounded MCP default of 10. A bound session does not take
   `after_sequence`: a value other than the acknowledged cursor's sequence is
   refused with `after_sequence_unsupported_in_bound_session`. Advance with
   `collab_cursor_ack`, or read from any position without acknowledging
   through `collab_events_since`.
3. Process that page, then call `collab_cursor_ack` with its exact
   `next_anchor` (`{ epoch_id, sequence, hash }`).
4. If `has_more` is true, poll again from the now-persisted cursor. A supplied
   `known_cursor` validates an anchor but does not select or acknowledge the
   next page.
5. Poll again after local work, before a mutation based on shared state, and
   whenever the host wakes the agent.
6. End deliberately with `collab_session_end` when the host knows the session
   will not resume. Pass `release_leases: true` and an optional
   `release_summary` to release every lease the session still holds in the
   same transaction. Without the flag, ending refuses while the session owns a
   live task lease and `session_has_active_leases` lists `task_ids` and
   `leases`. Pending offers addressed to the ending session expire with an
   auditable `target_session_ended` reason.

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
later page. `event_limit` bounds only the event page and its routed reports; it
does not truncate those snapshot-head projections. Direct
`CollabStore.nextForActor` and `CollabStore.nextForSession` calls retain their
50-event default for source-API compatibility.

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

The MCP server is request-driven. It does not push an interrupt into Codex,
Claude Code, Hermes or OpenClaw, keep a disconnected process alive, or schedule
polling. A host can explicitly wait while running; waking a suspended agent
remains host-owned. Tool arrival proves neither that a model read feedback nor
that it agreed, consented, or acted.

### Bounded anchored waiting (0.5.0)

Use `collab_events_wait` with the bound `workspace_id` and an exact
`after_anchor: { epoch_id, sequence, hash }` from a prior page or the session's
cursor. `event_limit` defaults to 10 and accepts 1–50. `wait_ms` defaults to
30,000, accepts 0–30,000, and zero reads immediately. The result is a
`JournalPage` in `structuredContent` and matching compact JSON text, without
`collab_next`'s task/report projections. Existing events return immediately;
an idle timeout returns a verified empty page, not an invented timeout event.

Continue from **`next_anchor`, never the later head**. Follow `has_more` with
another bounded call. Keep this observation position separate from the
session's processing cursor: only explicit `collab_cursor_ack` acknowledges
processed events. A courier must use its own session and durable delivery
cursor, never acknowledge a harness session on transport receipt.

Each poll authenticates the session, checks recovery and host/stored cursor
anchors, and reads/verifies the page in one short deferred SQLite snapshot.
A second short snapshot rechecks the session/cursors and observed head before
return. The dedicated read-only connection uses zero busy timeout; no
transaction remains open during the at-most-100-ms polling delay. Session end,
resume-generation fencing, cursor recovery, rollback, fork, or invalid returned
page fails explicitly. Verification covers the returned page and selected
anchors, not unreturned history; use `collab_journal_verify` for a full audit.

The page is capped at 256 KiB of UTF-8 JSON and the complete MCP tool result at
1 MiB, including both text and structured content. A page may contain fewer
than `event_limit` events. An oversized first event returns `event_too_large`
without advancing or skipping it; stop and select a separately authorized
larger-read workflow such as `collab_events_since`, whose output is not covered
by these wait caps. Do not reset or acknowledge past it just to clear the error.
After actually reading and processing it, an explicit acknowledgement can resume
waiting: persisted, host, and observation anchors have a separate **8 MiB per
anchor** validation ceiling on stored UTF-8 payload plus text metadata. SQLite
checks that size before loading the row; normal canonical JSON digest, epoch,
and cursor checks still apply. This is not an 8 MiB response or heap-memory cap.
An anchor above that ceiling fails explicitly with `event_anchor_too_large`,
even after a larger read and acknowledgement. Such synthetic/legacy data needs
operator reconciliation outside bounded waiting; never bypass verification,
auto-reset, or skip to a later anchor merely to silence the error.

MCP request cancellation and endpoint close interrupt waits and release timer
listeners. The bundled stdio entrypoint also shuts down on actual stdin EOF or
close, aborting pending waits and closing SQLite rather than waiting 30 seconds.
At most eight waits may be outstanding per endpoint. A read lock is
retried only within the requested deadline; a still-busy journal returns
`event_read_busy`, never a false empty success. The 30-second setting bounds
idle waiting, not an OS-level hard real-time guarantee for bounded synchronous
SQLite reads. Closing the store also closes its dedicated reader.

Waiting does **not** write `last_seen`, refresh presence, expire handoffs, renew
leases, acknowledge a cursor, or generate journal/heartbeat noise. Presence TTL
and witness sidecar changes are separate observations: inspect
`collab_session_list` or `collab_anchor_status` explicitly rather than expecting
an event wake. No observation authorizes task execution, a channel send, or a
chain transaction.

Direct Bun callers can use `CollabStore.eventsAfterAnchorForSession` with
host-held `{ session_id, session_token, generation, last_cursor?, workspace_id,
after_anchor, event_limit? }` for one immediate page. Keep the bearer outside
model-facing inputs. It uses the same count/byte bounds and performs no wait.

## The ordinary loop

Most sessions need only this loop. Each step names the tool and the field that
carries the next step.

1. **Start.** `collab_session_start` with `root_path`, an optional `actor` label, an
   optional free-text `role`, and, for a delegated child, `parent_session_id`.
2. **Poll and acknowledge.** `collab_next`, process the page, then
   `collab_cursor_ack` with its `next_anchor`. Reconcile new reports, reviews,
   handoffs, and lease changes; query history with `collab_report_list` when
   needed. Handle your own entries in `recovery_required` first.
3. **Split and claim.** Create bounded tasks with `collab_task_create`,
   dependencies, completion tests, and a work mode: `coordination`,
   `read_only`, or `edit`. Give edit tasks conservative repository-relative
   path scopes; new edit tasks require a non-empty scope and default to
   reviewed completion. Inspect both claimable and conflicted work:
   “claimable” accounts for active path leases, merely open or
   dependency-ready does not. Claim with `collab_task_claim` and the version
   just read, and begin edits only after the claim succeeds.
4. **Work.** A live credential-bound session keeps its leases through normal
   polling/acknowledgement/activity. Optional `collab_task_renew` needs no
   `expected_version`; legacy actor leases still need renewal before TTL expiry.
   Record compact `collab_task_progress`.
5. **Attach.** `collab_artifact_attach` each file, commit, test, data, or URL
   reference rather than raw output. A file artifact uses a
   repository-relative `uri` inside the task's path scopes and the `sha256` of
   the bytes written.
6. **Complete.** `collab_task_complete` with a summary, `confidence`,
   `confidence_basis`, `limits`, and `evidence_refs`, optionally naming
   `review_requested_session_id`. The server records the result checkpoint. An
   edit task remains `reported_complete` until a distinct session accepts it.
7. **Review.** Another session inspects the evidence and calls
   `collab_task_review` with `accept` or `request_changes`, a summary, and its
   own `confidence`, `confidence_basis`, and `limits`. A late reviewer concurs
   or disagrees by report.
8. **End.** `collab_session_end` with a `reason`, `release_leases: true`, and
   an optional `release_summary`.

Dependencies do not unlock from a pending reviewed completion. Legacy tasks and
tasks with a `reported` completion policy still complete on the worker's
report. Acceptance is a coordination decision only: it does not grant merge,
commit, publication, deployment, purchase, messaging, or other external
authority.

Task content mutations use optimistic `expected_version` checks; lease renewal
instead checks the current holder and lease ID and does not increment task
version. Both retain scoped idempotency keys. Reuse a key only for an exact retry. SQLite
`BEGIN IMMEDIATE` transactions make one claim win under local contention.

### Evidence references

Evidence references point inside the workspace journal and use one of four
prefixes: `artifact:` (for example `artifact:artifact_<id>` from
`collab_artifact_attach`), `event:`, `report:`, or `checkpoint:` followed by a
task's `base_checkpoint_digest` or `result_checkpoint_digest`. Each
`evidence_refs` schema describes them. `invalid_evidence_ref` and
`evidence_not_found` errors carry an `allowed_prefixes` field; send the
corrected mutation with a fresh idempotency key rather than dropping the
evidence. Attach a path, commit, or URL before citing it.

### Requesting and giving review

`collab_task_complete` accepts an optional `review_requested_session_id`: an
active session in the same workspace other than the reporter. The completion
report stays unaddressed, so every session still sees it; the request is stored
in the `task.reported_complete` event, projected on the task, and announced by
a separate `informs` report addressed to the requested session. It is a
request, not a reservation: any distinct session may still review, and others
should leave it to the requested reviewer while that session's `liveness` is
`live`. The server refuses a request that names the reporter
(`review_request_self`), a session that is not active in this workspace
(`review_requested_session_unavailable`), or a task that completes on report
(`review_request_not_applicable`).

`collab_task_review` accepts optional `confidence`
(`high|medium|low|unknown`), `confidence_basis`, and `limits`; the generated
review report stores them and otherwise keeps `unknown` and null. When the task
was already accepted, a distinct session's review returns
`task_not_pending_review` with `review_report_id`, `accepted_by_session_id`,
and a `remedy`, even if its version is stale. Concur or disagree with
`collab_report_append` using the same `task_id`, `relation: "supports"` or
`"challenges"`, and `target_report_id` set to `review_report_id`. Neither the
reporter nor the session that accepted the task receives that remedy; both get
only `review_status`, and `self_review_forbidden` still applies.

### Ending cleanly

`collab_session_end` accepts optional `release_leases: true` and
`release_summary`. In one transaction it releases each live lease the session
holds through the ordinary release path and each expired lease it still holds
through the audited recovery path (action `release`, with `release_summary`,
or else `reason`, as the note), then ends the session; the result lists them
in `released_leases`. A `release_summary` without `release_leases: true` is
refused with `invalid_release_summary`. Without the flag,
`session_has_active_leases` lists `task_ids`, `leases` (`task_id`,
`lease_id`, `expires_at`), and a `remedy` naming `release_leases`. Ending
stays available while cursor recovery is required.

The host-side `agenttool-collab-host` command ends a session whose process is
gone:

```bash
agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]
```

It resumes the session host-side (tolerating a stale generation or cursor),
performs the same end, removes the credential file, and prints one JSON line
without the credential: exit 0 with `status` `ended` or `already_ended`, or
exit 1 with `status: "error"`, an `error` code, and a `message`. With
`--release-leases`, `--reason` is also the release note. Without it, a session
that holds a live lease is refused with `session_has_active_leases` before
anything is resumed. An `ended` receipt carrying
`warning: "session_file_remove_failed"` means the session ended but the
credential file stayed; remove it by hand. `--db` defaults to the database the
MCP server would use, and the CLI never creates one (`journal_not_found`). It
is not an MCP tool.

### Host doorbell wait (unreleased)

This arrived after 0.5.0 and is in the 0.5.1-dev.0 development build only; no
released Collab archive contains it.

`agenttool-collab-host wait` lets a host wait between model turns, for
example as a background command whose exit wakes the agent, instead of
spending a turn on each 30-second `collab_events_wait`:

```bash
agenttool-collab-host wait (--session <id> | --session-file <path>) [--after-anchor <json>] [--wait-ms <ms>] [--include-own] [--addressed] [--db <path>]
```

`--session` resolves the default credential file beside the journal
(`collab-sessions/<id>.json`). Each poll is the same authenticated,
chain-verified read `collab_events_wait` uses, with the generation already in
the file: the command never resumes, acknowledges, refreshes `last_seen` or
writes, so it cannot fence the MCP process that owns the session. It waits
after `--after-anchor` (exact `{ epoch_id, sequence, hash }` JSON) or, by
default, after the session's acknowledged cursor, polling every 250 ms for up
to `--wait-ms` (default 600,000, maximum 3,600,000). Events attributed to the
waiting session are passed over unless `--include-own`; unattributed events
such as `workspace.opened` count as unread. With `--addressed`, other
sessions' events ring only when their routing fields name the waiting session
(`CollabStore.eventAddressesSession`): a report addressed to it or answering
one of its reports, a handoff offered to it or answering its offer, a review
requested of it, a verdict on its completion, or recovery of its expired
lease. Free text is never inspected, and the receipt adds
`skipped_unaddressed_events`.

It prints one JSON line without the credential and without any event type,
actor, entity or payload. Exit 0 with `status: "ready"` means at least one
such event follows `next_anchor`; `status: "idle"` means the deadline passed,
and `next_anchor` is where to re-arm (past any own events it skipped). Both
carry `after_anchor`, `head_sequence`, `skipped_own_events` and `waited_ms`.
`first_event_oversized: true` marks a ready receipt whose first unread event
exceeded the bounded page and could not be inspected. Read the events through
the session's MCP tools; the receipt is a doorbell, not a delivery. Errors
exit 1 with `status: "error"`: `session_auth_failed` after a resume or end,
`cursor_fork_detected`, `cursor_ahead`, `cursor_reset_required`, or
`event_read_busy` past the deadline. A listener that re-arms at least hourly
through `collab_next` or an acknowledgement stays `live` in the 6-hour view.

For Claude Code, `integrations/claude-code/collab-doorbell-watch.ts` loops this
wait and posts one content-free line into the starting session's own inbox
socket, by default only for addressed events. See
[its README](integrations/claude-code/README.md) for lifecycle and limits.

A host that relaunches the same agent thread for each round (for example
`codex exec resume <thread>`) should keep one coordination session for that
thread: start it in the first round, set `AGENTOOL_COLLAB_SESSION_FILE` to
its credential file for later rounds so the MCP process resumes it, and end
it after the final round. A one-off run ends its session before it exits, or
the host ends it with `agenttool-collab-host end` afterwards. Otherwise every
round leaves another active session behind.

### Delegation and lineage

A delegated agent is an independent process with its own session. The
delegator shares its session ID and keeps its credential to itself:
never pass your session file, its path, or `AGENTOOL_COLLAB_SESSION_FILE`,
because resuming it would advance the generation fence and fence the
delegator. A host may use a separate MCP process or a named `binding_key` on
the shared endpoint. The child calls `collab_session_start` with that key,
`parent_session_id` set to the delegator's session, and an explicit actor label.
Every subsequent child call, including wait, acknowledge and end, must carry
the same key. Omission always selects the original default binding; an unknown
explicit key refuses rather than falling back. Each slot owns a separate bearer,
generation and cursor. Keys are cooperative routing, not authenticated subagent
isolation: any caller of this endpoint can select a known slot. Hosts needing
separation should continue using separate processes. Parent end does not end children.
`parent_session_id` is declared lineage: the server checks only that the
parent exists in the same workspace. It is unauthenticated and shares no
authority, lease, or cursor. Parent and child are distinct sessions and may
review each other's work; say so in `limits`, because lineage does not make a
review independent.

### A host that cannot commit

A host that can write files but not `.git` delivers by artifact; integration
commits. It writes only inside the claimed path scopes, attaches each file
with its repository-relative `uri` and `sha256`, and completes with those
`artifact:` references. A separate integrator commits only when every
working-tree file still matches its artifact digest, and reports a mismatch
instead of committing.

A distinct reviewer then accepts as usual. If `HEAD` has moved since the
result checkpoint, the server inspects Git itself. It accepts only when `HEAD`
is exactly one commit on the result checkpoint's branch whose only parent is
the result checkpoint's `HEAD`, the worktree is clean, and every path that
commit changes lies inside the task's `path_scopes` and is byte-equal to the
newest `file` artifact the task attached for that `uri`. The `task.accepted`
event then records `checkpoint_basis: "host_commit_successor"`,
`host_commit_sha`, and `host_commit_artifact_ids`. Any other drift is refused
with `git_checkpoint_stale`: `host_commit_refusal` says why, and `remedy` names
both ways forward, such as a host commit or `request_changes` followed by a fresh
completion.
Only artifacts attached since the task's latest `request_changes` vouch for a
host commit. Never amend, reset or rewrite a shared branch to meet that
condition; if other commits already sit on it, use `request_changes`.

### Roles and liveness

`role` is free text. A session that only listens or reviews says so there, and
others avoid offering it handoffs or review requests it declines.
Coordination-session projections carry a derived `liveness`: `stale` once the
session has ended or when `last_seen_at` is more than 6 hours old, otherwise
`live`. Task projections carry `assignee_liveness` (null without an assignee),
and `collab_next` adds `recovery_required` (the caller's own expired leases
first). Every cursor acknowledgement refreshes `last_seen_at`, including one
that does not advance the cursor; so do `collab_next`, session mutations, a
cursor reset, resume, and end. A host that only uses `collab_events_wait` or
the host doorbell `wait` for over 6 hours reads as stale. This does not change session status. A session lease becomes recoverable only
when both its stored TTL deadline has passed and the holder is stale; no task
ownership transfers automatically. Activity while live retains the lease, but
once expired it requires explicit recovery even if its holder becomes live again.
Read-only waits never refresh liveness.
`role` is fixed for the session's lifetime; correct it with an `informs`
report, or end the session and start a new one.

### Conflict and lease boundary

Path claims are advisory across all registered worktrees in the repository
workspace. Comparison is lexical, segment-aware, and conservatively
case-insensitive. It does not lock the filesystem, inspect uncommitted diffs,
resolve every symlink or case alias, prevent direct edits, or arbitrate a
process using another database.

When a session is stale and its lease TTL has passed, the task reads as
`recovery_required`. Before taking
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

## Reports, relations, and handoff

Use `collab_report_append` to post structured reports independently of a task
lease. Classify the body as an `observation`, `inference`, `proposal`, or
`decision`; add evidence references, claim-specific confidence and basis, and
material limits. A decision also needs an authority scope and basis.

| Relation | `target_report_id` | Who may append | Use it to |
|---|---|---|---|
| `informs` | must be omitted | any session | add a new observation, inference, proposal, decision or request |
| `supports` | required | any session | agree with a report: answer a proposal, concur with a review |
| `challenges` | required | any session | disagree with evidence; on a completion report it blocks acceptance |
| `resolves` | required; must be a `challenges` report | any session | close a challenge with the evidence that settles it |
| `corrects` | required | only the target's author session | repair your own earlier report |
| `withdraws` | required | only the target's author session | retract your own earlier report |
| `supersedes` | required | only the target's author session | replace your own earlier report |

A related report must share its target's workspace and task scope (the same
`task_id`, or none for a workspace-level target), or the server returns
`report_task_mismatch`. A missing target returns `report_target_required`;
another session's attempt to correct, withdraw, or supersede returns
`report_author_mismatch`. Challenge a report rather than its author, and
preserve the earlier record. Corrections append history; they do not rewrite
it. `to_session_id` routes a report into that session's `collab_next` instead
of everyone's; `collab_report_list` still shows it. Addressing is routing, not
access control.
It narrows the reports list only: the `report.posted` event, body included,
still appears in every session's event page.

Acceptance records the independent reviewer's snapshot at that journal order.
A later correction or withdrawal remains visible but does not silently revoke
an already accepted task. Record a new explicit coordination decision or
reopen the task when later evidence should change acceptance. Before
acceptance, an active withdrawal, correction, or supersession of the completion
report requires a fresh completion; a withdrawn resolution no longer clears
its challenge.

Use compact, checkable content:

```text
outcome: <observation|inference|proposal|decision>: <result> | evidence: <artifact/event/report/checkpoint refs> | confidence: <high|medium|low|unknown + basis> | limits: <scope, gaps, unknowns> | next: <one optional authorised action or none>
```

A handoff is an offer, not a forced reassignment. Its task lease changes
session only after the named recipient accepts. Decline, pause, uncertainty,
and disagreement are valid outcomes and do not transfer private data or
authority.

### Proposals and consent (unreleased)

Some decisions need both the agents and a person: design direction, the
criteria for how to proceed and how far, conflicting context, and how shared
principles are read. Ordinary task work keeps the claim and review flow above.
Design: `docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md` in the
AgentTool source repository. Code: `src/{proposal,store,mcp}.ts`. Tests:
`tests/proposal-consent.test.ts`.

Open a proposal when the answer changes what others do next and nothing
already settles it: not the request, the code, an earlier agreement, or a
sensible default. A proposal spends the person's attention and holds the work
it names, so it carries one decision, criteria a reader can object to, the
smallest `extent` that lets the next step happen, and the conflicts it knows
of. Agents form their own reading before they read each other's answers,
because same-model agents tend to agree with each other. Agreement authorises
only the `extent`, and never more than the host, the repository's rules or the
person's other instructions allow. The session that carries out agreed work
records a `decision` report with that extent as its `authority_scope` and the
`proposal.agreed` event in its evidence. The agent-facing guidance is in
`skills/coordinate-agent-work/SKILL.md` ("Decide direction with a person").

`collab_proposal_open` posts an ordinary `proposal` report with fixed terms:
`criteria`, `extent` (what agreement would authorise and where it stops),
optional `known_conflicts`, `origin` (`ai` or `person_relayed`, self-declared),
`topic`, and a consultation deadline (`consult_seconds`, 600 to 604,800,
default 21,600). The report and terms are hashed into `proposal_sha256`, and
`collab_proposal_status` returns those exact `proposal_bytes`. Terms cannot be
corrected or superseded by a plain report (`proposal_terms_fixed`): withdraw the
proposal, or open a revision with `supersedes_report_id`. A proposal leaves the
table for good at its first withdrawal or supersession; the relation that
retired it cannot itself be withdrawn (`proposal_retired`).

At open, the server snapshots the live voices in the workspace. A voice is an
attested lineage group: a session and the children its own MCP process started
under its binding (`collab_session_start` with `binding_key` and its
`parent_session_id`). A `parent_session_id` named by any other process is
recorded but not followed, so a session cannot speak as someone else's voice.
The snapshot is routing for the `proposal.opened` event, which addresses every
snapshotted voice except the author's, and it decides early close. Anyone may
challenge at any time.

Other sessions answer with `collab_report_append`: `supports`, `challenges`,
and `resolves`. A challenge is a soft veto: it stands until its own voice
resolves or withdraws it; nobody else, the author included, can settle it.
`collab_proposal_status` computes the agents' position under `consent/v1`; no
session announces it:

| Position | When |
|---|---|
| `open` | before the deadline, no standing challenge, not yet consented |
| `challenged` | before the deadline, a challenge stands |
| `consented` | no standing challenge, at least one `supports` from a voice other than the author's, and the deadline has passed or every other snapshotted voice has supported; a lone voice consents only through its own explicit `supports` |
| `split` | the deadline passed with a standing challenge |
| `lapsed` | the deadline passed with no standing challenge and no qualifying `supports`; silence is not consent |
| `withdrawn` / `superseded` | the author withdrew it or opened a revision |

The deadline instant counts as closed. Confidence, extra supports, and the
origin do not change the position. The position is recomputed from the journal
on every read, so a later `resolves` or `supports` can move `split` or
`lapsed` to `consented`. Lists and the inbox name a proposal whose stored terms
fail their hash under `unreadable` instead of failing the whole read.

`collab_proposal_relay_rejection` records that a person rejected the exact
bytes named by `proposal_sha256`, as relayed by this session (`basis:
relayed_by_session`). A relayed rejection is forgeable, so it only pauses work.

The agents' position authorises nothing by itself. A session that starts
without an attested parent counts as its own voice, so one operator can still
start several voices; consent/v1 does not prevent that, and the person's own
act is what authorises work. Mixed servers do not share these guarantees: an
older server ignores the terms and would accept a plain correction of a proposal.

#### A person's acts and the person desk (unreleased)

A person agrees or rejects through `agenttool-collab-host person`, never
through MCP. Code: `src/{person-desk,ceremony,passkey,tty}.ts`. Tests:
`tests/{person-desk,tty}.test.ts`.

| Verb | What it does |
|---|---|
| `workspaces`, `voices --workspace <id>`, `proposals --workspace <id> [--proposal <id> \| --limit <n>]`, `inbox [--workspace <id>]`, `passkeys` | read; `inbox` without a workspace counts every workspace |
| `consent --proposal <id>` / `reject --proposal <id> --reason <text>` | show the exact act and proposal bytes on `/dev/tty` and record only on `yes` typed there (`basis: controlling_terminal`) |
| `ceremony --proposal <id> --act agree\|reject [--reason <text>] [--via <ssh-destination>] [--no-open]` | serve a one-time signing page on the passkey's origin (`http://localhost:17778` by default); Touch ID signs the act bytes and the desk records them (`basis: user_verified_passkey`) |
| `passkey-enroll --ceremony [--label <text>] [--no-open]` | serve a one-time page that creates the passkey, then show its fingerprint on `/dev/tty` and enrol it only on `yes` |
| `passkey-enroll --file <path>\|-`, `passkey-export --credential <id>`, `passkey-revoke --credential <id>` | enrol a passkey exported from another table, export one, or revoke one; enrol and revoke are confirmed on `/dev/tty` |
| `challenge --proposal <id> --act agree` or `--act reject --reason <text>`, then `consent`/`reject` with `--passkey-assertion <path>\|-` | the same passkey act in two steps, for a page the desk does not serve |
| `say --workspace <id> --body <text> [--proposal <id>] --idempotency-key <key>` | a desk note; about a proposal it is routed to the author session, or for a desk proposal to every consulted voice |
| `propose --workspace <id> --question <text> --criteria <text> --extent <text> [--known-conflicts <text>] [--topic <text>] [--consult-seconds <n>] --idempotency-key <key>` | a desk proposal (`origin: person_relayed`, author voice `person`), settled by every agent voice |
| `withdraw --workspace <id> --proposal <id> --reason <text> --idempotency-key <key>` | withdraw a proposal the desk opened |

A ceremony started at a terminal opens its page in the browser (macOS
`/usr/bin/open`; `--no-open` declines) and says on stderr when it closes. One
started by another program has no terminal, so that program opens the page;
YOUI opens its own window inside the click. Each page lasts three minutes and
accepts one post. An older page still open says it has expired rather than
posting into a newer ceremony.

Agreement needs the agents' position to be `consented`, the exact current
`proposal_sha256`, and the same position the person was shown; the challenge
and the terminal refuse before any prompt otherwise. A rejection may come at
any position. An authenticated rejection may follow a relayed one; nothing
else repeats. The latest person act decides `person.state`. `may_proceed` is
`true` only while that act agrees and the proposal is still on the table; it
authorises only the proposal's `extent`. A later challenge does not silently
revoke an agreement. `proposal.agreed` and `proposal.rejected` are addressed to
the author, or for a desk proposal to its consulted voices.

The passkey challenge is the SHA-256 of canonical act bytes naming the act, the
proposal hash, the reason, the agents' position, and the number of person acts
before it, so one assertion records one act once and goes stale if any of
those change. The store checks the client data type, challenge and origin, the
RP ID hash, user presence and user verification, the signature counter, and
the ES256 signature, then journals the assertion with the public key in the
event, so the act can be re-verified without this database.

The ceremony pages come from the installed desk, not from an application that
agents edit: the page that shows the bytes decides what Touch ID signs, and
the system prompt names only "localhost". Each page lives at a one-time path
with a per-ceremony nonce CSP, checks `Host` and `Origin`, accepts one post and
closes after three minutes. That moves trust to the desk's installed bytes; a
process running as the same user can still change those, and a process that can
write the journal could still rewrite it unless its head is witnessed elsewhere.

The terminal route is a speed bump, not a sandbox: a process that can allocate
a pseudo-terminal and type into it can answer. Desk notes, desk proposals and
their withdrawal are not authenticated as the person; they inform and
authorise nothing. An agent can place a report in the person's inbox with
`collab_report_append` and `to_person: true`; that is routing, not access
control. Actor labels beginning with `person:` are reserved for the desk.

#### One table per device

Each device keeps its own journal, its own agents' voices and its own person
desk. A person reaches another device's table through `agenttool-collab-host
person-remote`, an SSH forced command that reads a JSON argv from
`SSH_ORIGINAL_COMMAND`, never a shell line. It allows the read verbs, `say`,
`propose`, `withdraw`, `challenge`, and `consent`/`reject` with
`--passkey-assertion=-` only; it refuses enrolment, revocation, export,
ceremonies and `--db`. A ceremony with `--via <destination>` serves the page
on the person's own device and verifies at the remote table. To add a device:

1. Install the same desk bundle on it and compare its SHA-256 sums.
2. Point that device's agents' MCP configuration at the bundle.
3. Export the person's passkey on a device that has it (`person passkey-export`),
   copy the enrolment JSON over, and run `person passkey-enroll --file` at the
   new device's own terminal, comparing the fingerprint before typing `yes`.
4. On the new device, add one `authorized_keys` line for the person's
   desk key, for example
   `restrict,command="env AGENTOOL_COLLAB_DB=<journal> <bun> --no-env-file --config=/dev/null <bundle>/agenttool-collab-host.js person-remote" ssh-ed25519 AAAA… person-desk`.
5. Add the device to the person's interface (for example YOUI's table list).

Proposals do not cross devices: each table settles its own. Summaries can move
between journals with `@agenttool/collab-courier`, which carries no authority.

## Journal integrity and compatibility

### Session-fit migration (unreleased)

The `fr-collab-fit` changes keep the 33-tool surface and journal schema 3.
Old explicit actor labels, default bindings, renewal requests carrying
`expected_version`, presence APIs, event protocols and exact idempotency receipts
remain readable/usable. Renewal accepts a stale version but still rejects the
wrong holder, lease, generation or idempotency payload. Legacy actor leases
remain TTL-bound; a credential-bound lease lives while its holder is `live`
(active and seen within the existing six-hour window). `lease_expires_at` remains
the stored minimum deadline, not the full effective lifetime; inspect
`effective_status` and `assignee_liveness`. This is recorded activity, not proof
of a running process. Hosts should end departed sessions with `release_leases`.
Expiry is checked against the pre-refresh session row. An additive
`session_lease_lapses` table retains expired lease IDs across later polling,
acknowledgement, resume and unrelated activity; returning activity cannot revive
them. No claim is released or transferred until explicit recovery/end.

Back up the selected journal and upgrade all serving MCP processes together
before relying on new lease or cross-clone semantics. An older server can still
read/open the schema and existing roots, but uses its old expiry/discovery rules;
mixed old/new servers cannot offer the new coordination guarantees. No live
journal, host configuration or installed package is changed by this source PR.

`repository_aliases` and `repository_discovery` are additive routing metadata.
Discovery records `checked` or `unresolvable` once per worktree/fingerprint,
including missing roots, unusable remotes and ambiguous history. There is no
worktree-count refusal. A new local-Git clone surveys unexamined registrations
before inspecting its own portable key, within a 250 ms shared Git time budget
outside the write transaction. A timeout is cached as `unresolvable` only when
that root received the full budget slice. Rows or new clones cut short by a
partly consumed or exhausted shared deadline get no discovery/alias record and
stay pending. Later new clones continue the survey; an existing pending root
can retry its own discovery. Existing roots do not survey the backlog, and
cached roots do not walk their history again. The budget, monotonic clock and
Git runner are injectable for deterministic deadline regressions.

Original workspace IDs, physical keys, epochs, events, hashes and migration
receipts are unchanged. Only a new clone with no physical match can join a
unique portable match, including on first open after upgrade if discovery
finishes within budget. Multiple portable matches or incomplete discovery fall
back to local physical routing, never refuse an existing registration or merge
journals. The old physical-key partition refusal is retained. The first stored
alias is kept when remotes change/disappear or history becomes ambiguous; a
negative result stays local for that fingerprint. This is intentionally
conservative: it does not promise automatic regrouping after remote edits,
retries of full-slice timed-out discovery, or journal/database replication.
Already split repositories keep splitting on ambiguous portable matches until
an explicit reconciliation tool exists. Lower-casing remote paths also remains
a risk on case-sensitive hosts: distinct repositories sharing a root commit
could receive the same alias. Neither limitation is resolved by timeout handling.

Actor omission reads only `<CLAUDE_CONFIG_DIR or ~/.claude>/sessions/<PID>.json`.
PID selection is host-only: `AGENTOOL_COLLAB_CLAUDE_PID`, otherwise the direct
parent PID. The inherited messaging socket alone never selects an ancestor.
Its numeric basename must match the selected PID, and metadata's
`messagingSocketPath` must exactly equal `CLAUDE_CODE_MESSAGING_SOCKET`.
The file must be a regular file owned by this OS user, not a final-component
symlink, at most 64 KiB, and contain the matching numeric `pid` and a nonempty
display `name` of at most 200 characters. `procStart` must match the live process's
`ps -o lstart=` value in the C locale and UTC (bounded to one second), preventing
PID-reuse attribution. Missing/unsafe/malformed metadata or an unavailable process
returns `actor_required`; supply an explicit label rather than scanning other
sessions. No `.key`, transcript, `logPath`, credential, or sibling file is read.
Only the name is retained; later name changes do not rewrite attribution.

Named child bindings require an explicit `actor` and `parent_session_id` at start
and `binding_key` on every call. Existing hosts need no changes for the default slot. A host integrating
the library can restore separate host-resumed handles via `resumed_sessions`;
the CLI's existing `AGENTOOL_COLLAB_SESSION_FILE` resumes only the default slot.
Named-slot restoration across CLI restarts is not automatic: end children before
exit, or resume each independently through the existing host-held file mechanism.
Never pass bearers or their paths to a subagent. The older packaged skill adapters
describe the separate-process workflow, which remains supported; the MCP schemas
and this section specify the new opt-in multiplexing contract.

Coverage: `tests/session-fit.test.ts` (lease/liveness/renewal fencing, actor
metadata and child concurrency), `tests/repository.test.ts` (clone routing,
fallbacks and preserved partitions), and the existing migration, stdio, host,
waiting and journal tests. No chain/consensus behavior changes.

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

### Optional Zerone witness status

`collab_anchor_status` compares one workspace head with the local
`agenttool.collab-zerone-ledger/0.1` sidecar maintained by the separate
`@agenttool/collab-zerone` bridge. It returns `unanchored`, `anchor_pending`,
`anchored`, `anchor_stale`, or `anchor_conflict`. Before reporting an anchored
or stale state, it recomputes the full local journal from genesis and checks the
hash at the witnessed sequence. A missing, unreadable, malformed, or
all-failed sidecar reports honestly as `unanchored`; it never blocks ordinary
coordination. The bridge's memo protocol does not change these states:
entries for legacy `agenttool.collab-anchor/0.1` memos and salted-alias `0.2`
memos read alike. This tool never reads the bridge's alias salt and never
returns memo text or aliases.

The default sidecar is
`$XDG_DATA_HOME/agenttool/collab-zerone-anchors.json`, falling back to the
platform data directory. The host may set `AGENTOOL_COLLAB_ANCHOR_LEDGER`
before starting MCP; model-callable tool input cannot select a filesystem path,
and tool output does not expose one. Direct library callers that already hold
local filesystem authority may pass an explicit path to
`anchorStatusForWorkspace`. This read-only tool never contacts a chain, submits
or confirms a transaction, spends a fee, supplies a key or RPC, repairs
history, or turns a witness into truth, consent, identity, permission, or
authority. Treat `anchor_conflict` as a reason to stop and surface the evidence
to the host; reconciliation remains an explicit operator decision.

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

## Codex, Claude Code, Hermes Agent, and OpenClaw

The npm package root is the plugin root for Codex and Claude, so the same
`skills/coordinate-agent-work/SKILL.md` and 36-tool standalone MCP server ship
once:

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
`mcp_agenttool_collab_session_join`, plus the read-only
`mcp_agenttool_collab_anchor_status`. Install the packaged
`integrations/hermes/skills/coordinate-agent-work-hermes` adapter into the
selected Hermes profile. Its workflow keeps the credential-bound and
self-declared presence planes separate and never asks the model to read a
session credential file. Hermes Kanban remains Hermes's dispatcher; the local
Collab journal does not automatically mirror it, spawn or wake agents, or
infer external authority. Since 0.5.0 the adapter also names
`mcp_agenttool_collab_events_wait` for finite observation while running.

[The explicit OpenClaw example](integrations/openclaw/README.md) describes a
host-selected MCP connection, not an installed native plugin or verified idle
wake. Leave native persona, memory, channel receiver ownership, permissions and
lifecycle intact. A process retains one default binding and can opt into distinct
named child bindings; this does not create an authenticated fleet or native
subagent routing. Separate processes remain the isolation-oriented choice.

Across all four hosts the vocabulary is the same: inspect **status**, explicitly
**queue** a selected report in a separately configured private courier,
**receive** a bounded local event page, then **acknowledge** processing only when
it occurred. Queueing is not sending; transport receipt is not processing,
agreement, execution, or chain observation. Cross-device report/reply and
handoff-offer exchange belongs to that separate opt-in courier; Collab itself
replicates neither journals nor leases, reviews or task authority. See
Collaboration channels (`docs/COLLABORATION-CHANNELS.md` in the private source
repository) for its private
binding, disclosure, pause/revoke and recovery boundaries.

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
[`docs/NPM-RELEASES.md`](https://docs.agenttool.dev/NPM-RELEASES.md).

Version 0.4.0 is the recorded public witness-awareness release. The repository's
[NPM release receipts](https://docs.agenttool.dev/NPM-RELEASES.md) record its exact 303,376-byte
npm/GitHub artifact with SHA-256
`1a9c1830ec9326351a475596820780ad7f93c7dfe16a6f1a9eb74bc08edbdb51`.
This is a historical receipt, not a fresh registry or deployed-host check.

Version 0.5.0 is released on GitHub, not npm. The
[`collab-v0.5.0` GitHub Release](https://github.com/cambridgetcg/agenttool-collab/releases/tag/collab-v0.5.0)
on `cambridgetcg/agenttool-collab` (2026-10-10) carries the 390,363-byte
archive recorded in the [release receipts](https://docs.agenttool.dev/NPM-RELEASES.md),
built from source revision `bc71e87e`. The archive was prepared locally, not by
the protected workflow. Its bundled README still calls 0.5.0 a release
candidate, because that text was frozen at the tag. It keeps journal schema 3
and adds bounded anchored observation as the 33rd tool, review routing
(`review_requested_session_id`), review confidence, `release_leases` on session
end, the `agenttool-collab-host` bin, host-commit acceptance, and the bound
`collab_next` refusal of a differing `after_sequence`.

**DEVELOPMENT BUILD: 0.5.1-dev.0.** This main-branch source follows 0.5.0 and is
unreleased. It keeps journal schema 3, adds three proposal consent tools to
the 33 MCP tools of 0.5.0 (36 in all), and adds the
`agenttool-collab-host wait` host doorbell, its `--addressed` mode and the
Claude Code doorbell watcher. The MCP server reports `0.5.1-dev.0` in
`serverInfo` and at the start of its instructions, both read from
`src/version.ts`, so this build cannot announce itself as the 0.5.0 release.
The next npm candidate is 0.5.1 through the public staged release path. A
development version is not a release, and these source changes do not
themselves publish, upload, deploy, configure a native harness, activate a
Telegram channel or second device, or contact a chain.
Collab remains local plaintext software, not a hosted service, remote relay,
VPN, private model channel, chain client, anchoring bridge, or LOVE release.
Local pack inspection creates no release authority or public artifact.
