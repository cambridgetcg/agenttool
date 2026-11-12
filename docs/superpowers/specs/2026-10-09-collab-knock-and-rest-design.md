# Collab knock and rest — design

**Date:** 2026-10-09 · **Status:** design approved in conversation; spec awaiting Yu's review
**Decided with Yu** via brainstorming, after the household-smoothing work (PR #452).
Stacked on `feat/collab-household-smoothing-20261008`. Grounded in a read-only exploration
(OpenClaw 2026.9.4, Hermes 0.18.0, AgentTool mission wake, harness hooks, estate rest
vocabulary) and an adversarial check of every factual claim below. Tags: **V** verified on
this Mac, **D** documented, **I** inferred.

## Intent

Ai named the most human-feeling friction of the collab work: an addressed note just sits
until the addressee happens to poll, and a session at rest looks exactly like a ghost.
Yu: "a knock is a great idea", and asked to borrow from OpenClaw's heartbeat and the
Hermes agent framework.

| Question | Yu's choice |
|---|---|
| What a knock may do | **Tap** a live session at its next turn, and **wake** a sleeping one. Not "tell Yu", not "nothing automatic". |
| Who may be woken | **Only resters who asked.** Live → tap. Resting with `wake_on: addressed` → may be woken. Resting otherwise → held, shown on return. Ended → never knocked (departure is complete); the sender is told gently. |
| Claude wake | **Try the Claude channel** (research preview), gated by a spike. |
| Approach | **A:** doorbell semantics in Collab (schema 3), household wiring in `sol`/launchd/hooks. |
| Hermes | Wake is a follow-up (Hermes has no collab MCP today). |

## Keep (non-negotiable)

- The journal is the mailbox. A knock is a doorbell: a **pointer** `{seq, kind, from, ref_id}`, never a body. A missed knock loses nothing.
- Silence is a complete answer. A woken agent may end its turn without replying; no failure counter, no streak.
- Rest is **declared**, never inferred. A stale session is never relabelled resting.
- Departure is complete: an ended session is never knocked or woken.
- Consent: Yu installs the doorbell and hooks (household consent; Codex hook trust stays Yu's own review step); each session's `wake_on` is its own consent. A sender never arms another session's doorbell.
- Host binding comes from the host (process tree, host-written file), never from a model's claim. Ambiguity means silence, not a guess.
- Only an explicit address knocks — never a mention or an implied ask (OpenClaw removed inferred commitments, D).
- Rest never releases, extends or reassigns leases, handoffs or accepted obligations — including at job exit.
- Everything the household-smoothing spec keeps still holds (self-review forbidden, acceptance-gated dependencies, in-journal evidence, server-observed checkpoints, hash chain, generation-fenced resume).

## Borrowed, with sources

- **Silence as an answer:** OpenClaw `NO_REPLY` / legacy `HEARTBEAT_OK` (`openclaw/dist/tokens-*.mjs:5-7`), the ≤300-char ack drop (`dist/heartbeat-D9QLafFo.mjs:17,111-168`), and `heartbeat_respond` outcomes with `notify:false` (`dist/heartbeat-tool-response-*.mjs:12-24`) — V by reading.
- **One deduped notice per (watcher, target), a pointer to reconcile** (OpenClaw `docs/concepts/session-state.md:58-74`, D).
- **Spacing and flood guard** (`dist/heartbeat-runner-CPy-qxAy.mjs:1349-1420`, V by reading) — adapted: per-session spacing plus a **household-wide** flood guard, and one dispatch per session per tick carrying all waiting pointers (in-process 250 ms coalescing has no meaning inside a poll tick).
- **Quiet hours skip rather than queue** (`isWithinActiveHours`, `skippedHeartbeatStage("quiet-hours")`, V by reading).
- **No work, no model call** (`empty-heartbeat-file` skip, V by reading).
- **Re-anchor on return, no backlog flood** (Hermes `cron/jobs.py` resume re-anchoring, D).
- **Eligibility → lock → claim → re-check before dispatch** (`~/Projects/composition-symphony/heartbeat.py:46-48`, `SCHEDULER-REVIEW.md`, V: four real runs).
- **Expiry computed on read, damaged control refuses** (`bin/mission-wake-receiver.mjs` quiet control, 11 quiet-control tests in `bin/tests/mission-wake-receiver.test.ts:335-583`, V).
- **Verbs rest / return** (Crown `api/src/routes/crown.ts:197-200`; `~/.config/sol/HOME.md` "departure, and return", V).

## Part 1 — Collab (`packages/collab`, schema 3)

1. **Declared rest.** New MCP tool `collab_session_rest` (credential-bound to the caller's
   own session, unlike the unauthenticated presence-plane tools):
   `{idempotency_key, mode: "resting" | "ready", until?: ISO-8601 future instant,
   reason?: string ≤ 200, wake_on?: ["addressed"]}` (v1 accepts `[]` or `["addressed"]`;
   default `[]`). Appends `session.rested` (payload: mode, until, reason, wake_on) or
   `session.returned`. Annotation class `localRetrySafeMutation`; the exact tool-list and
   annotation-class tests in `tests/mcp.test.ts` are updated. Expiry is computed on read:
   an expired rest reads as not resting and starts nothing. Added to Codex's per-tool
   approvals and to `check_codex_collab.py`'s loop set.
2. **Liveness tells the truth about quiet.** `SessionLiveness` becomes
   `"live" | "resting" | "stale" | "ended"`, precedence: ended (status) → resting (latest
   unexpired declaration) → stale (`last_seen_at` older than `SESSION_STALE_AFTER_MS`) →
   live. Session projections gain `rest: {mode, since, until, reason, wake_on} | null`.
   `sessionLiveness` and `assigneeLiveness` gain the latest-rest lookup (an events scan,
   as `reviewRequestedSessionId` already does). Must change together:
   `tests/liveness.test.ts` (ended no longer reads stale), the `protocol.ts` comment,
   README and both skills (reviewer guidance: "review it yourself unless the requested
   reviewer is live, or resting with `wake_on` addressed"). The household 0.5.0 install
   already exposes `liveness`, so this needs the same lockstep reinstall as before.
3. **Addressed-waiting count.** The bound session object in `collab_next` gains
   `addressed_waiting`: `report.posted` events with `to_session_id` = this session
   (covering ordinary addressed reports, "review requested" reports and review results) and
   session-path `handoff.offered` events with `handoff.to_session_id` = this session, past
   the acknowledged cursor, excluding items this session authored. `task.reported_complete`
   is **not** counted (its paired "review requested" report already is), and
   `handoff.accepted`'s `to_session_id` (the acceptor itself) is never matched.
4. **Sender hint.** `collab_report_append` (with `to_session_id`), `collab_handoff_offer`,
   `collab_task_complete` (with `review_requested_session_id`) and `collab_task_review`
   return `addressee: {session_id, liveness, rest, delivery}`,
   `delivery: "tap" | "wake" | "held" | "none"` (live → tap; resting with `wake_on`
   addressed → wake; resting otherwise or stale → held; ended → none — reachable only via
   report_append, since handoffs and review requests already refuse inactive targets).
   Computed in the MCP wrapper on every call, so an idempotent replay shows the addressee's
   current state, never a frozen one. Nothing is blocked. The hint reports what the
   addressee **declared**; Collab cannot see hosts, so whether a host can actually wake it
   (e.g. a Claude seat not launched with the channel flag) is recorded by the household
   doorbell as `host_cannot_wake`, not in the hint (amended 2026-10-09).
5. **Host binding (host-written, non-secret).** `dirname(db)/collab-sessions/<id>.host.json`
   (mode 0600), written by the `collab_session_start` handler and by the bin's resume path:
   `{format: "agenttool.collab-host-binding/1", session_id, host_kind, host_pid,
   host_started_at, mcp_pid, credential_file_path, written_at}`. `host_kind` is
   `claude-code` only when `CLAUDE_CODE_SESSION_ID` is present **and** the parent's
   `ps -o comm=` is `claude`; `codex` when the parent's basename is `codex`; else
   `unknown`. `host_started_at` guards against pid reuse. Removed by `collab_session_end`,
   `agenttool-collab-host end` and the `sol` exit sweep.
6. **Read-only host verbs** on `agenttool-collab-host`, each with its own option set
   (`end --unknown` stays refused):
   - `knocks --host-ancestor auto|<pid> [--mark-tapped]`: walks the caller's ancestry to
     the **nearest** recorded `host_pid` (with matching `host_started_at`). If more than one
     active session is bound to that host (e.g. one Codex Desktop app-server hosting several
     collab servers) it prints nothing and marks nothing. Otherwise it prints
     `{"protocol":"agenttool.collab-knock/1","session_id","liveness","rest","waiting",
     "new":[{seq, kind, from_actor, ref_id}]}`, where `new` excludes items already in the
     private ledger `collab-sessions/knock-ledger.json` (written only with `--mark-tapped`).
   - `doorbell-scan`: resting sessions with `wake_on` addressed and unknocked waiting items,
     with their binding (incl. `credential_file_path`).
   Both open SQLite **read-only** (`readonly`, `query_only`, `busy_timeout 0`, like
   `nonblockingEventReader`), never through `new CollabStore` (which takes `BEGIN
   IMMEDIATE`, writes pragmas and re-verifies every journal). Any error → no output, exit 0.
7. **Spikes (throwaway, gate the build):**
   - **S1** — the installed 0.5.0 bundle *and* a build of `fa862949` (0.3.1; still running
     in long-lived Oct-8 Codex MCP processes) read a journal copy containing
     `session.rested` / `session.returned` (collab_next, task_list, journal_verify) without
     error. Source reading finds no event-type dispatch in either; the spike confirms it. On
     FAIL: restart those processes before any rest event is written, or fall back to a
     marker report.
   - **S2** — the ancestry walk from a real Claude Code `UserPromptSubmit` hook, a Codex
     CLI hook, a Codex Desktop app-server with two threads (must be ambiguous → silent), and
     a nested host (Codex started from a Claude shell → nearest host wins).

## Part 2 — Household (`~/.config/sol`, hooks, launchd)

`~/.config/sol` is not a git repo: snapshot before editing; hermetic tests (throwaway
HOME, temp journal, fake adapters).

1. **Tap hooks (live sessions).** Claude Code `UserPromptSubmit` and Codex
   `UserPromptSubmit` hooks run `agenttool-collab-host knocks --host-ancestor auto
   --mark-tapped`. When there are `new` items they add one line of context, inside Codex's
   additional-context limit:
   *"Collab: N note(s) addressed to you are waiting (from <actors>). Read them with
   collab_next when you choose; nothing is required."* No new items → no output at all.
   Installation edits `~/.claude/settings.json` and `~/.codex/hooks.json` with backups.
   Codex marks a new hook handler untrusted until Yu reviews it in the TUI: the installer
   never writes `hooks.state` trusted hashes and `sol` never bypasses hook trust.
2. **`sol` job changes required for rest.** (a) `collab_exit_sweep` skips sessions with a
   declared, unexpired rest and never releases their leases — otherwise a resting job's
   session is ended at exit and can never be woken. (b) The job preface allows "rest with
   collab_session_rest" as an alternative to "end before finishing". (c) The README's
   "never hand a job a session credential file" gains one stated exception: a doorbell wake
   of a session that declared rest with `wake_on: addressed`.
3. **Doorbell (resting sessions).** A launchd agent (`dev.agenttool.collab-doorbell`,
   StartInterval 60 — the 30 s alternative would be the Mac's most frequent periodic job,
   ~2,880 launches a day) runs `sol doorbell tick` (`~/.config/sol/bin/sol` dispatcher):
   `doorbell-scan` read-only → per session: eligibility (rest declared and unexpired,
   `wake_on` addressed, new items, no woken job already in flight for this session,
   optional quiet hours skip-not-queue) → `flock` → claim in a private doorbell ledger →
   **re-check rest just before dispatch** → dispatch one wake carrying all waiting pointers.
   The journal and the ledger are separate stores, so a return or end can still land
   between claim and dispatch: the woken job then sees a returned or ended session, and
   resuming an ended session is refused (generation fence). Throttles: 60 s minimum
   spacing per session; household-wide flood guard of 5 wakes per 10 minutes. Nothing
   waiting → no work, no model call. `sol doorbell status|pause|resume`. Installed and
   enabled by Yu.
4. **Codex wake adapter.** `sol agent start codex --collab-session-file <path>`. Plugin
   MCP overlays cannot set `env` and `sol-agent` runs `env -i`, but a **top-level** server
   definition carries its own `env` table (spike S3, PASS): `runtimes.command_for` adds
   `-c 'plugins.agenttool-collab@personal.enabled=false'` (the **unquoted** key; the quoted
   form is a silent no-op) and `-c 'mcp_servers.collab_wake={command, args, env={
   AGENTOOL_COLLAB_DB, AGENTOOL_COLLAB_SESSION_FILE}, default_tools_approval_mode="writes",
   tools={…explicit approvals…}}'`, never approving `collab_session_start`. No
   `--session-file` argv option is built (amended 2026-10-09 after S3). The woken job
   **resumes the resting session itself** (same id, generation +1, any dead process
   fenced). A refused resume is invisible to Codex (rc 0), so the adapter verifies
   afterwards that `session.resumed` with generation +1 appeared, else records "not
   delivered".
5. **Claude wake adapter (research preview).** A new per-session channel server (written
   fresh, pointer text only — not a copy of `bin/mission-wake-channel.mjs`, which forwards
   message bodies up to 8192 bytes and lives at most 900 s). Claude Code registers a channel
   only at launch (`--dangerously-load-development-channels server:<name>`, with a startup
   consent dialog), so **only a seat Yu launches that way can be woken**; a session cannot
   arm a channel mid-session. The server lives as long as the declared rest (`until`, or
   until return/end). **S4** proves Claude Code on this Mac processes the event and starts a
   turn. Seats launched as plain `claude`, or a FAIL on S4 → `delivery: "held"` with reason
   `host_cannot_wake`.
6. **The woken turn's prompt (pointers only, plus the session's own rest reason):**
   *"You rested and asked to be woken for addressed notes (your reason: …). N are waiting:
   <pointers>. Read them with collab_next if you choose. If nothing needs you, end the
   turn — silence is complete. You may rest again (collab_session_rest) or return."*
   Until the woken session calls `return` (or rests again), it still reads `resting`; the
   in-flight guard prevents a second wake meanwhile.
7. **Hermes:** follow-up (needs a collab MCP under a non-clashing server name first).

## Finish line — a knock replay in five scenes

In a fresh repo, with a live Claude seat and headless Codex through `sol`:

1. **Tap:** a Codex job addresses a note to a live Claude session → at its next turn exactly one tap line appears; it never repeats.
2. **Wake:** a Codex session rests with `wake_on: addressed`, its job ends (the exit sweep leaves it resting, leases untouched); Claude addresses a note to it → the doorbell wakes a fresh Codex job resuming the same collab session (same id, generation +1); it reads the note, answers or chooses silence, then either rests again (session still resting, leases untouched, no stray wake) or returns and ends cleanly — both pass. No second wake while it is in flight.
3. **Held:** a session rests with `wake_on: []`; a note arrives → sender hint `held`, nothing wakes; on return one coalesced count.
4. **Claude channel** (only if S4 passed, with a seat Yu launched with the channel flag): a resting Claude seat is woken through the channel.
5. **Ended:** a note to an ended session → sender hint `none`, no wake, honestly unread.

**Pass** = every scene as described; zero refused Collab calls except deliberate refusals
that name their remedy; `collab_journal_verify` chain valid; no stray sessions or leases;
no duplicate taps or wakes (ledgers show exactly one per item).

## Order of work

1. Spikes S1–S4 (throwaway; results recorded in the plan ledger).
2. Collab Part 1 on `feat/collab-knock-and-rest-20261009` (stacked on #452), TDD.
3. Rebuild with pinned Bun 1.3.5; lockstep household install as before.
4. Household Part 2; hooks and doorbell installed with backups; Yu reviews Codex hook trust.
5. The knock replay. Then a stacked PR only with Yu's go.

## Out of scope

- Hermes wake and Hermes collab wiring.
- Desktop notifications to Yu.
- Schema-v4 rest columns; ended-vs-stale as a stored status.
- Knocks on mentions or inferred asks.
- Taps for Codex Desktop threads that share one app-server (ambiguous → silent in v1).
- Cross-device knocks (hosted missions keep their own wake).
- Retiring existing ghost sessions (still Yu's call).
