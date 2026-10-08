# Collab household smoothing — design

**Date:** 2026-10-08 · **Status:** design approved in conversation; spec awaiting Yu's review
**Decided with Yu** via brainstorming after the first cross-harness Collab trial
(`~/play/collab-duet`, workspace `ws_2261c3032677f0995800a2eb`). Every factual claim
below about code was checked by an adversarial read of `origin/main` 61f7e66a,
the installed 0.3.1 copies, `~/.config/sol` and the journal (read-only).

## Intent

Yu's words: "Let's keep what you like and think of how we can make it a smoother
experience for agents." Choices he made during the session:

| Question | Yu's choice |
|---|---|
| For whom first | Both, household first: Codex, Claude Code and Hermes sessions on this Mac, often delegated headless through `sol agent`. Fixes should also read clearly to a stranger. |
| Finish line | Replay the duet headless (see [Finish line](#finish-line)). |
| Approach | A + thin C: Collab "words and defaults" within schema 3, plus a thin `sol agent` shepherd for the edges Collab cannot reach. Schema v4 ideas wait. |
| Codex approvals | Keep the per-tool scoping; add only the lease-lifecycle tools. |
| sol review mode | Make it truly read-only (`--ignore-rules`). |
| Replay's Claude seat | A live Claude session plays it; headless Claude through `sol` stays as is. |

Assumptions (not stated by Yu): the fixes land inside the unpublished 0.5.0 release
candidate on `origin/main` through a normal PR, so no version bump is needed; npm
publication stays Yu's step.

## Keep (non-negotiable)

- `self_review_forbidden`; dependencies unlock only on acceptance by a distinct session.
- Evidence refs point inside the journal; server-observed git checkpoints on claim and completion.
- Hash-chained journal and `collab_journal_verify`.
- Append-only reports; `challenges` stands on equal footing with `supports`.
- Explicit boundary fields (`identity_boundary`, `authority_boundary`, `checkpoint_boundary`).
- Idempotency keys; recovery requires a note; no silent takeover.
- Resume transfers a session (generation fence). A credential never moves between processes.
- Bound `collab_next` ignores a caller-supplied `actor` (tested contract, `tests/mcp.test.ts:429-441`).

## What the trial and the read-only investigation found

Sources: the duet journal; Codex job logs `20261008T205907-4d9ccbcd455e`,
`20261008T210147-c5e426220993`, `20261008T211836-e2c661a52d6a`; `origin/main`
61f7e66a; installed 0.3.1 (byte-identical Homebrew and Codex plugin copies);
a read-only aggregate of `~/.local/share/agenttool/collab.sqlite`.

| ID | Friction | Status on origin/main |
|---|---|---|
| F1 | One of four `invalid_evidence_ref` sites ("Unsupported evidence reference kind", `store.ts:5070`) omits the allowed prefixes; `evidence_refs` schemas have no description; checkpoint digests are not exposed, so `checkpoint:` refs are effectively undiscoverable. | open |
| F2 | No way to request a reviewer; a seated reviewer got `task_not_pending_review` (details only `{review_status}`) and its concurring verdict was recorded nowhere. | open |
| F3 | Report targeting rules are undocumented. `supports`/`challenges` can already answer a proposal within the same task scope. | open (docs) |
| F4 | `collab_task_review` hardcodes confidence `unknown`, basis and limits null (9 of 9 review reports). | open |
| F6 | Bound `collab_next` silently drops `after_sequence`. | open (one defect; per-page ack stays by design) |
| F7 | A headless Codex lease stranded: `release`/`block` unapproved, then `session_end` refused (`session_has_active_leases`). | open; host config cause, Collab amplifies |
| F8 | Sessions never end on host exit: 10 "active" sessions (8 ghosts 07-28→09-13); `financial-fp5-workload-20260913` holds an expired lease reserving 5 scopes; 2 reviews pending 27–30 days. Expired leases do not block `session_end`, so a session can end and leave them `recovery_required`. | open |
| F9 | Headless Codex refuses unapproved collab tools under `-a never`. | partly addressed 2026-10-08 |
| F10 | Codex `workspace-write` protects `.git` recursively by design; a headless Codex can write files but never commit. | outside Collab |
| F11 | `sol` passes a minimal environment; handing a job a session file would fence the parent anyway. `parent_session_id` exists (checked for existence and same workspace only) and is unused (0 of 21 sessions). | outside Collab |
| NEW | `sol` review mode does not pass `--ignore-rules`; 259 exec-policy allow rules (incl. `git push origin main`, `gh api`, `npm install`) run outside the sandbox without prompting. | outside Collab |
| NEW | Headless Claude through `sol`: "Not logged in · Please run /login" (2026-10-08 probe, both modes). | outside Collab; not addressed here |
| NEW | `~/Projects/agenttool` sets a repo-local `core.hooksPath` (its own `.git/hooks`, no `pre-commit`), so the global doorman hook does not run there. | outside Collab; flagged to Yu |

Already true, no change needed: the pure reads (`collab_task_get`, `task_list`,
`report_list`, `events_since`, `journal_verify`, `session_list`, `workspace_status`,
plus 0.5.0's `events_wait`, `anchor_status`) are annotated read-only and asserted by
`tests/mcp.test.ts:186-260`. F5 (immutable role) and F12 (no listener mode) are
deferred to v4.

## Compatibility constraints

- Two 0.3.1 copies (Homebrew for Claude Code, Codex plugin cache) share one SQLite
  journal at `SCHEMA_VERSION` 3. CHECK constraints (`coordination_sessions.status`,
  `reports.relation`, `reports.kind`, `reports.confidence`, task and review enums) and
  `validateV2Shape`'s exact column sets mean any new status, relation or column needs a
  migration and a lockstep upgrade. **This design adds none.**
- Every change is an optional parameter on an existing tool, a derived output field,
  error text, a schema description, documentation, an event-payload field, or a
  host-side CLI. New optional parameters enter the idempotency request only when
  supplied, so `request_hash` stays identical across old and new copies.
- Idempotent replays return the stored `response_json`; replays of mutations first run
  before the upgrade lack the new derived fields.
- **This design adds no MCP tool.** Installing `origin/main` 0.5.0 over the household
  0.3.1 copies does add `collab_events_wait` and `collab_anchor_status` (31→33 tools);
  both are read-only and need an approval decision for headless Codex (Part 2 item 4).
- `collab-courier` accepts only `serverInfo.version` 0.4.0 or 0.5.0 (`binding.ts:27`)
  and requires an exact match (`importer.ts:65`). Landing inside the unpublished
  0.5.0 RC avoids a courier change; a later bump would need the courier enum, README,
  tests and collab tests that pin 0.5.0 updated together.

## Part 1 — Collab words and defaults (`packages/collab`)

1. **Evidence refs.** Every `invalid_evidence_ref` site (missing separator, empty ID,
   unsupported kind, non-string; `store.ts:5031, 5037, 5070, 5625`) and
   `evidence_not_found` share one message listing `artifact:`, `event:`, `report:`,
   `checkpoint:` with an example, and return an `allowed_prefixes` field in the error
   payload (MCP `failure()` flattens details to the top level). Every `evidence_refs`
   schema gets a `.describe()` with the same text. `taskFromRow` and the stored-response
   hydration path add derived `base_checkpoint_digest` and `result_checkpoint_digest`.
2. **Review confidence.** `collab_task_review` accepts optional `confidence`
   (`high|medium|low|unknown`), `confidence_basis`, `limits`; the generated review
   report stores them. Absent values keep `unknown`/null.
3. **Late reviewer.** When a task is already accepted, a distinct session's review
   returns `task_not_pending_review` with `review_report_id` (from the `task.accepted`
   payload) and `accepted_by_session_id`, and a message naming the remedy:
   `collab_report_append` with `relation: "supports"` or `"challenges"` targeting that
   report. The pending-review check moves ahead of `requireVersion`, so a late reviewer
   holding the pre-acceptance version sees this instead of `version_conflict`. The
   remedy is offered only when `review_status = "accepted"` and never to the reporter.
4. **Requested reviewer.** `collab_task_complete` accepts optional
   `review_requested_session_id` (an active session in the workspace, distinct from the
   reporter). The completion report stays unaddressed, so every session still sees it.
   The id is stored in the `task.reported_complete` event payload, projected on the task
   as `review_requested_session_id`, and a separate `informs` report addressed to that
   session says a review is requested. A request, not a reservation: any distinct session
   may still review, and the skill asks others to leave it to the requested reviewer for
   a while.
5. **Clean exit.** `collab_session_end` accepts optional `release_leases: true` and
   `release_summary`. Inside one transaction (with the v2 write-guard nonce that
   `mutateAsSession` inserts, `store.ts:4326-4348`) it releases each **live** lease the
   session holds through the existing release path (`task.released`), and each
   **expired** lease it still holds through the recovery path with action `release` and
   `release_summary` as the note. Then it ends. Without the flag,
   `session_has_active_leases` keeps `task_ids` and adds
   `leases: [{task_id, lease_id, expires_at}]` and the flag's name. Allowed while
   `cursor_recovery_required` is set, as `session_end` already is.
6. **No silent ignores.** In a bound session, `collab_next` refuses an `after_sequence`
   that differs from the acknowledged cursor's sequence, with a message: advance with
   `collab_cursor_ack`; read from any position without acknowledging with
   `collab_events_since` (`after_sequence`/`after_anchor`). An `after_sequence` equal to
   the current cursor is tolerated. The bound-actor override stays as it is.
7. **Staleness as a view.** Coordination-session projections gain derived
   `liveness: "live" | "stale"` (stale when `last_seen_at` is older than 6 hours;
   one constant). Task projections gain `assignee_liveness`. `collab_next` adds a
   `recovery_required` list (the caller's own expired leases first, then others').
   Only `collab_next`, session mutations, ack/reset, resume and end refresh
   `last_seen_at`; a host that only uses `collab_events_wait` for over 6 hours shows as
   stale. No status change, no auto-expiry, no new column.
8. **Skill and README.** Restructure `skills/coordinate-agent-work/SKILL.md` (250 lines)
   and the README around the ordinary loop: start → `next`/ack → claim → work → attach →
   complete (evidence prefixes; optional requested reviewer) → review (with confidence;
   late reviewers concur by report) → `session_end` with `release_leases`. Add a
   relation-targeting table; delegation with `parent_session_id` as declared lineage
   (unauthenticated; never pass a session file); listener etiquette by `role` text; and
   "a host that cannot commit delivers by artifact; integration commits." Mirror in the
   Hermes variant and `agents/openai.yaml`. Keep the terms `tests/package.test.ts:78-130`
   requires, or update those tests deliberately.
9. **Host CLI.** New bin `agenttool-collab-host` (not an MCP tool):
   `end --session-file <path> --reason <text> [--release-leases]`. It resumes host-side
   with `allow_cursor_recovery: true` (tolerating a stale generation in the file),
   calls the item-5 end, removes the credential file, and prints a JSON receipt without
   the credential. `session_auth_failed` on an already-ended session yields an
   `already_ended` receipt. Needs its own bundle, check script, `package.json` bin entry,
   and install into both household copies.

Each item gets a failing test first (`bun test` in `packages/collab`), including today's
untested paths: proposals answered by `supports`/`challenges`, `task_not_pending_review`,
every `invalid_evidence_ref` site, `parent_session_mismatch`, holder self-recovery.

## Part 2 — Household edges (`~/.config/sol`, Codex config)

`~/.config/sol` is not a git repository: snapshot each file before editing; run
`test_jobs.py` / `test_runtimes.py` with an injectable journal path and a throwaway
`HOME`, never the real journal.

1. **Delegation convention.** A delegated job starts its own Collab session with
   `parent_session_id` set to the delegator's session and an actor label ending in
   `· sol job <job-id>`. Documented in the skill and `~/.config/sol/agents/README.md`.
   The label is self-declared and unauthenticated.
2. **Exit sweep.** In the `jobs.py` worker `finally`, before `result.json` is written
   (`jobs.py:361-363`), time-bounded and exception-contained so it can never prevent the
   terminal record: query `coordination_sessions` read-only (not the presence table
   `sessions`) for `status = 'active' AND actor LIKE '%· sol job <id>' AND
   julianday(joined_at) >= julianday(<worker started_at>)`. Derive the journal and
   `collab-sessions/` paths as the MCP server does (`AGENTOOL_COLLAB_DB`, then
   `XDG_DATA_HOME`, then `~/.local/share`). For each session, run
   `agenttool-collab-host end --release-leases --reason "host exit sweep: job <id> ended
   <state>"` and put the receipt in the job result. Failures are reported, never retried.
   Jobs whose supervisor was killed record no terminal state and are not swept; the
   staleness view surfaces their sessions.
3. **Integration commit (opt-in).** `sol agent start --integrate-commit` (new flag,
   `start_job` parameter and `request.json` field, README section). After an edit-mode
   job, `sol` reads the `file` artifacts attached by that job's sessions whose `uri` lies
   inside the task's `path_scopes`. Each working-tree file's SHA-256 must equal its
   artifact. If all match and nothing else is staged: `git add -- <paths>`, then
   `git commit --only --author="<runtime> <runtime@sol.local>" -- <paths>`, committer
   from the host's git config, never `--no-verify`, message `<task-id>: <task title>`
   plus a body naming job, session and digests. Whatever pre-commit hook git resolves for
   that repository runs. Any mismatch or other staged change: no commit, reported. Never
   pushes.
4. **Codex approvals.** In `~/.codex/config.toml`, add
   `[plugins."agenttool-collab@personal".mcp_servers.agenttool-collab.tools.<name>]`
   blocks with `approval_mode = "approve"` for `collab_task_renew`,
   `collab_task_progress`, `collab_task_release`, `collab_task_block`,
   `collab_task_unblock`, and update the comment above them. Recover, cursor reset,
   handoff, decision and presence keep prompting. Decide separately whether the two
   read-only 0.5.0 tools (`collab_events_wait`, `collab_anchor_status`) need approval.
5. **Review mode read-only.** `runtimes.py` adds `--ignore-rules` after `exec` in the
   headless Codex argv when `mode == "review"` and not interactive. Interactive `codex`
   rejects the flag, so `sol agent open codex` is unchanged. `test_runtimes.py` asserts
   present in headless review, absent in edit and interactive; the codex card's
   `limitations` in `runtimes.json` says review mode ignores exec-policy rules.

## Finish line

Replay the duet in a fresh repo `~/play/collab-duet-replay`, with a live Claude
session in one seat and headless Codex through `sol agent start codex --mode edit
--integrate-commit` in the other:

1. Claude creates `voice-a` and `voice-b` (B depends on A), writes A, completes it.
2. The Codex job starts a child session (`parent_session_id` = Claude's), reviews A,
   claims B, writes and attaches it, completes with `review_requested_session_id` =
   Claude's session, and ends with `release_leases`.
3. The exit sweep finds nothing to clean; the integration commit lands `voice-b.md`.
4. Claude reviews B (its routed request appears in `collab_next`), then ends its session.

**Pass** = all of: both tasks accepted by a distinct session; every replay session
`ended` (read-only journal check); no live or expired lease held by a replay session;
`collab_journal_verify` → `chain_valid`; zero refused Collab calls in the job logs and
the live session, except deliberate refusals whose message names their own remedy.

## Order of work

1. Collab Part 1 on `feat/collab-household-smoothing-20261008` from `origin/main`, PR.
2. Build the branch and install it into both household copies together (no schema bump).
3. `sol` Part 2 items 1–3 and 5; Codex config item 4.
4. Replay. Record the result in the PR and in the duet repo.

## Out of scope (schema v4 and other)

- Reviewer reservation, proposal adopt/close states, session expiry status, editable
  role, listener mode (F5, F12).
- Hermes on Collab: no collab MCP configured, and the documented server name
  `agenttool` collides with the public API MCP already registered under that name.
- Retiring the existing 8 ghost sessions, the stranded agenttool lease and the two
  pending reviews. The staleness view will surface them; Yu decides.
- `sol` runtime card drift (records Codex 0.157.1; 0.159.3 runs), headless Claude login,
  the Desktop kap loop that switches the active gh account, and the agenttool repo's
  `core.hooksPath` override.
