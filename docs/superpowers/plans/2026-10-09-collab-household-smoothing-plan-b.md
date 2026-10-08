# Collab household smoothing — Plan B (sol + Codex + replay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Runs after Plan A Task 10. ~/.config/sol is not a git repo: back up before each edit.

**Goal:** Exit sweep, opt-in integration commit, scoped Codex approvals, read-only review mode, then the headless duet replay as the finish line.

**Spec:** docs/superpowers/specs/2026-10-08-collab-household-smoothing-design.md

## Open items before execution (from the cross-part check, 2026-10-09)

- Disk: /System/Volumes/Data is near full (≈1 GB free and falling, other sessions); every Step 0 gate needs ≥2 GB.
- Freshness command in Tasks 1, 7, 8 must be run from packages/collab as `git diff --exit-code -- dist` (Task 10 Step 6 form), not `packages/collab/dist`.
- Task 7: decide whether a no-op cursor ack refreshes last_seen_at (spec says ack refreshes; plan narrows to advancing acks).
- Tasks 1–9 were verified per part, never applied in sequence: gate each task with `tsc` and the Task 7 Step 3(e) grep counts.
- PR body must note: one shared check script covers both bundles; install (Task 10 Steps 3–4) precedes the push.
- Plan B: drop the CHANGELOG sentence in the preamble; keep only "+N tests" deltas; add `warning` to COLLAB_RECEIPT_KEYS (sweep treats ended+warning as swept); confirm "duet repo" = ~/play/collab-duet-replay only, unless Yu wants a pointer in ~/play/collab-duet.
- Ignore the *.meta.json drafts; these .md tasks are the contract.

---

# Plan B — Household edges (Tasks 1–5)

`~/.config/sol` and `~/.codex` are **not git repositories**. Every task starts by snapshotting the files it touches into `~/.config/sol/agents/.backup-20261008/` (mode 0700). A snapshot is never overwritten, so it keeps the pre-plan bytes. To roll back a file, run `cp -p ~/.config/sol/agents/.backup-20261008/<name> <original path>`. Each task's last step is the commit-equivalent: a `CHANGELOG.md` entry plus its crosswalk digest.

All test commands run from `~/.config/sol/agents` with `/opt/homebrew/bin/python3 -B`, so no `__pycache__` is written. Tests are hermetic. Worker tests run with a throwaway `HOME`, and every job they create names a temporary journal in `request.json` (`collab_journal_path`). Sweep and integration unit tests pass an explicit `journal_path`. No test reads the real journal or runs a real `agenttool-collab-host`; the only real-journal access in this plan is `sqlite3 -readonly` schema checks.

Anchors name a function or test, never a bare line number: earlier tasks shift lines. Line numbers given as "2026-09-27 line N" refer to the unmodified files and are hints only.

Baselines on unmodified source (2026-10-09): `test_runtimes.py` 28 OK, `test_jobs.py` 19 OK (about 7 s), and `sol-doctor` reports no FAIL. Every step was rehearsed on 2026-10-09 in a scratch copy (since deleted): each new test failed as stated, then passed, and the full suites passed twice. Expected results below give `OK` plus the number of tests the task adds, not absolute totals.

The exit sweep calls `agenttool-collab-host`, which only exists on the job PATH (`/opt/homebrew/bin`) after Plan A Task 10 installs Collab 0.5.0 into the Homebrew global copy. Run Plan B after Plan A Task 10. Before that, the tests still pass (they use a fake host), but a real job's sweep reports `host_cli_not_found` and leaves its sessions active.

**`CHANGELOG.md` is digest-pinned.** `~/.config/sol/home/XENIA-CROSSWALK.json` records its digest as artifact `sol-changelog`, and `sol doctor` checks it. Each Step 5 therefore also refreshes that one digest. If it doesn't, `sol doctor` prints `FAIL  Hearth crosswalk evidence bytes or locators have drifted`. Entries go under `## Unreleased — 2026-10-08 · Collab household smoothing`. A numbered version would also need `manifest.json` bumped, and the crosswalk pins that version too (`subject.version` and the `sol-manifest` digest). Cutting a version stays Yu's step. Plan B's replay task (B2) must add its bullet to this same `Unreleased` section and refresh the same digest.

---

### Task 1: Codex review jobs ignore exec-policy rules

**Files:**
- Backup: `~/.config/sol/agents/.backup-20261008/` ← `runtimes.py`, `runtimes.json`, `test_runtimes.py`, `~/.config/sol/CHANGELOG.md`, `~/.config/sol/home/XENIA-CROSSWALK.json`
- Modify: `~/.config/sol/agents/runtimes.py`, the codex branch of `command_for()` (2026-09-27 lines 110-111)
- Modify: `~/.config/sol/agents/runtimes.json`, the codex card's `limitations` array (2026-09-27 lines 50-53)
- Test: `~/.config/sol/agents/test_runtimes.py`, class `CommandTests`, directly after `test_codex_keeps_sandbox_and_no_approval_in_headless`
- Record: `~/.config/sol/CHANGELOG.md`, `~/.config/sol/home/XENIA-CROSSWALK.json` (`sol-changelog` sha256)

**Interfaces:**
- Consumes: `rt.command_for(runtime_id, cwd, prompt_path, mode, registry, interactive=False)`, and `codex exec --ignore-rules` ("Do not load user or project execpolicy `.rules` files"). Both codex-cli 0.157.1 and 0.159.3 list the flag in `exec --help`.
- Produces: headless review argv `[codex, "-a", "never", "exec", "--ignore-rules", "--ephemeral", "--json", "--sandbox", "read-only", "-C", project, "-"]`. Headless edit and every interactive argv stay unchanged.

- [ ] **Step 0: Check free disk space**
```sh
df -h /System/Volumes/Data
```
Stop if `Avail` is under 2 GB. The disk reached 100% on 2026-10-08, and a full disk makes the worker tests fail with `ENOSPC`.

- [ ] **Step 1: Write the failing test**

Snapshot first:
```sh
B=~/.config/sol/agents/.backup-20261008
mkdir -p -m 700 "$B"
for f in ~/.config/sol/agents/runtimes.py ~/.config/sol/agents/runtimes.json \
         ~/.config/sol/agents/test_runtimes.py ~/.config/sol/CHANGELOG.md \
         ~/.config/sol/home/XENIA-CROSSWALK.json; do
  [ -e "$B/$(basename "$f")" ] || cp -p "$f" "$B/"
done
ls -l "$B"
```
(Do not use `cp -pn`. On macOS it exits 1 when the target exists.)

In `test_runtimes.py`, class `CommandTests`, insert these methods directly after `test_codex_keeps_sandbox_and_no_approval_in_headless` (whose last line is `self.assertIn("workspace-write", self.command("codex", "edit"))`). They use the existing `CommandTests.setUp` (`self.registry = rt.load_registry()`), `self.command(rid, mode, interactive)` and the module's `import runtimes as rt`.
```python
    def test_codex_headless_review_ignores_exec_policy_rules(self):
        review = self.command("codex", "review")
        self.assertEqual(review[review.index("exec") + 1], "--ignore-rules")
        self.assertNotIn("--ignore-rules", self.command("codex", "edit"))
        for mode in rt.MODES:
            with self.subTest(mode=mode):
                self.assertNotIn("--ignore-rules", self.command("codex", mode, interactive=True))

    def test_codex_card_states_review_ignores_exec_rules(self):
        codex = next(r for r in self.registry["runtimes"] if r["id"] == "codex")
        self.assertTrue(any("--ignore-rules" in text and "exec-policy" in text
                            for text in codex["limitations"]), codex["limitations"])
```

- [ ] **Step 2: Run test to verify it fails**
```sh
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_runtimes.py CommandTests -v 2>&1 | grep -E "^(FAIL|ERROR)|Error|^FAILED|^OK"
```
Expected: `FAILED (failures=2)`, with
`AssertionError: '--ephemeral' != '--ignore-rules'` and
`AssertionError: False is not true : ['Read-only/workspace-write are native filesystem sandbox policies; connected MCP/apps retain their own permission controls.', 'No native MCP server or ACP entrypoint advertised by this installed version.']`

- [ ] **Step 3: Write minimal implementation**

In `runtimes.py` `command_for()`, codex branch, replace:
```python
        if not interactive:
            base += ["exec", "--ephemeral", "--json"]
```
with:
```python
        if not interactive:
            # Exec-policy allow rules run matching commands outside the sandbox
            # without a prompt under `-a never`; review stays read-only by not
            # loading them. Interactive `codex` rejects this exec-only flag.
            base += ["exec", *(["--ignore-rules"] if mode == "review" else []), "--ephemeral", "--json"]
```
In `runtimes.json`, replace the codex card's `limitations` array with:
```json
      "limitations": [
        "Read-only/workspace-write are native filesystem sandbox policies; connected MCP/apps retain their own permission controls.",
        "No native MCP server or ACP entrypoint advertised by this installed version.",
        "Headless review passes --ignore-rules, so user and project exec-policy .rules files are not loaded and no allow rule can run a command outside the read-only sandbox; headless edit and interactive sessions still load them."
      ]
```

- [ ] **Step 4: Run test to verify it passes**
```sh
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_runtimes.py      # OK; 2 more tests than the baseline (28 -> 30)
/opt/homebrew/bin/python3 -I -B -c 'import json,sys; json.load(open(sys.argv[1]))' ~/.config/sol/agents/runtimes.json
~/.local/bin/codex -a never exec --ignore-rules --ephemeral --json --sandbox read-only -C /tmp --help >/dev/null; echo "rc=$?"   # rc=0
```
The third command only checks that the argv parses; no model is called. A bogus flag at the same position gives rc 2.

- [ ] **Step 5: Record the change (CHANGELOG entry instead of a commit)**
```sh
/opt/homebrew/bin/python3 -I -B - <<'EOF'
import hashlib, json, os
from pathlib import Path
sol = Path.home() / ".config/sol"
changelog, crosswalk = sol / "CHANGELOG.md", sol / "home/XENIA-CROSSWALK.json"
bullet = ("- Codex review jobs pass `--ignore-rules` to `codex exec`, so exec-policy allow\n"
          "  rules cannot run commands outside the read-only sandbox. Edit jobs and\n"
          "  interactive sessions still load them; the Codex card says so.")
text = changelog.read_text(encoding="utf-8")
anchor = "# Sol Home changelog\n\n"
assert text.count(anchor) == 1 and "## Unreleased — 2026-10-08" not in text
changelog.write_text(text.replace(anchor, anchor + "## Unreleased — 2026-10-08 · Collab household smoothing\n\n"
                                  + bullet + "\n\n"), encoding="utf-8")
record = json.loads(crosswalk.read_text(encoding="utf-8"))
old = next(a["sha256"] for a in record["artifacts"] if a["id"] == "sol-changelog")
new = "sha256:" + hashlib.sha256(changelog.read_bytes()).hexdigest()
raw = crosswalk.read_text(encoding="utf-8")
assert raw.count(old) == 1
temporary = crosswalk.with_name(".XENIA-CROSSWALK.json.tmp")
temporary.write_text(raw.replace(old, new), encoding="utf-8")
os.chmod(temporary, 0o600)
os.replace(temporary, crosswalk)
print("sol-changelog", old, "->", new)
EOF
~/.config/sol/bin/sol-doctor | grep -E "^FAIL|Hearth crosswalk evidence bytes"
```
Expected: only `PASS  Hearth crosswalk evidence bytes match its allowlisted local artifacts`.

---

### Task 2: Delegation label, job-ID preface and exit sweep in jobs.py

**Files:**
- Backup: `jobs.py`, `test_jobs.py`; the CHANGELOG and crosswalk snapshots from Task 1 are kept
- Modify `~/.config/sol/agents/jobs.py`:
  - module imports (2026-09-27 lines 4-17)
  - constants after `TERMINAL = {...}` (2026-09-27 line 24)
  - new functions between `environment()` and `def start_job` (2026-09-27 lines 94-104)
  - `start_job()`: job ID before the preface, preface sentences (2026-09-27 lines 125-136)
  - `result()`: copied keys (2026-09-27 line 215)
  - `worker()`: the final `finally` block (2026-09-27 lines 361-363)
- Test `~/.config/sol/agents/test_jobs.py`:
  - module imports; fixtures and helpers after `FAKE_ADAPTER`
  - `JobTests.setUp`, `JobTests.make_job` (request literal), `JobTests.spawn` (env)
  - new `JobTests` methods; new class `CollabSweepTests` before `class CliReadTests`
- Record: `~/.config/sol/CHANGELOG.md`, crosswalk `sol-changelog` digest

This task owns the job-ID channel. Plan B's replay task (B2) only consumes it: its own preface change and its test `test_start_tells_the_runtime_its_own_job_id` are this task's and must not be applied twice.

**Interfaces:**
- Consumes:
  - Collab v3 `coordination_sessions(id, workspace_id, worktree_id, actor, status, joined_at, last_seen_at, ended_at)` (`packages/collab/src/store.ts`, schema in `createLegacySchema`/`migrateToV2`)
  - `PRAGMA application_id = 0x4154434C` (`store.ts` `APPLICATION_ID`, line 61)
  - `defaultDatabasePath()` and `process.env.AGENTOOL_COLLAB_DB ?? defaultDatabasePath()` (`bin/agenttool-collab-mcp.ts:12-21`; Plan A moves it to `src/database-path.ts` unchanged)
  - credential path `join(dirname(resolve(db)), "collab-sessions", "<session_id>.json")` (`store.ts` `defaultSessionCredentialPath`)
  - Plan A host CLI `agenttool-collab-host end --session-file <path> --reason <text> --release-leases --db <path>`: one JSON line; exit 0 with `{"protocol":"agenttool.collab-host/1","status":"ended"|"already_ended","session_id","released":[{task_id,lease_id,via}],"ended_at"}`, plus `"warning":"session_file_remove_failed"` when the session ended but its file stayed; exit 1 with the superset `{"protocol","status":"error","error","message",...details}`
  - Plan A `collab_session_end` input `release_leases`
- Produces:
  - `collab_journal_path() -> str`
  - `collab_exit_sweep(job_id: str, started_at: str, state: str, *, journal_path: str | None = None, host_cli: str = "agenttool-collab-host", timeout_s: float = 20.0) -> {"matched": [{"session_id", "actor", "status"}], "swept": [receipt], "errors": [{"session_id", "error", ...}]}`. It never raises. `matched` lists every session of this job that joined after the worker started, ended ones included, with its status after the sweep. `swept` holds receipts filtered to `COLLAB_RECEIPT_KEYS`. Error codes: `journal_unreadable`, `host_cli_not_found`, `session_file_missing`, `sweep_time_exhausted`, `host_cli_timeout`, `host_cli_failed`, the host CLI's own code, `sweep_failed`.
  - `result.json` key `collab_sweep`, also returned by `jobs.result()` and `sol agent result --json`
  - optional `request.json` field `collab_journal_path` (tests only; `start_job` never writes it)
  - constants `COLLAB_APPLICATION_ID`, `COLLAB_HOST_PROTOCOL`, `COLLAB_RECEIPT_KEYS`, `DELEGATION_LABEL = "· sol job "`, `DELEGATION_MATCH = "sol job "`, `SWEEP_SESSIONS`, `SESSION_STATUS`
  - helpers `read_journal()`, `delegated_rows()`, `session_status()`, `host_receipt()`
  - the job preface sentence `Sol job ID: <id>. If you start an AgentTool Collab session, end your actor label with '· sol job <id>' and use the parent_session_id given in the task.`, an example label `<Runtime> · sol job <id>`, and the instruction to end with `collab_session_end` and `release_leases: true`

- [ ] **Step 1: Write the failing test**

Snapshot first:
```sh
B=~/.config/sol/agents/.backup-20261008
mkdir -p -m 700 "$B"
for f in ~/.config/sol/agents/jobs.py ~/.config/sol/agents/test_jobs.py \
         ~/.config/sol/CHANGELOG.md ~/.config/sol/home/XENIA-CROSSWALK.json; do
  [ -e "$B/$(basename "$f")" ] || cp -p "$f" "$B/"
done
ls -l "$B"
```
In the `test_jobs.py` module imports, add `from datetime import datetime, timezone` directly after `import contextlib`, and `import sqlite3` directly after `import signal`:
```python
import contextlib
from datetime import datetime, timezone
import importlib.util
...
import signal
import sqlite3
import stat
```
After `FAKE_ADAPTER` (after its closing `'''`), insert these fixtures and helpers, after one blank line. They form a minimal schema with the real Collab column names, plus a fake host CLI that prints the documented receipt and never reads a credential:
```python
COLLAB_APPLICATION_ID = 0x4154434C  # packages/collab/src/store.ts APPLICATION_ID ("ATCL")

# The columns the Sol host reads, named exactly as in the Collab v3 journal
# (packages/collab/src/store.ts). Hermetic: no Collab package, Bun process or
# real journal is involved.
JOURNAL_SCHEMA = '''
CREATE TABLE workspaces (id TEXT PRIMARY KEY, root_path TEXT NOT NULL UNIQUE);
CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                        root_path TEXT NOT NULL UNIQUE);
CREATE TABLE coordination_sessions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  worktree_id TEXT NOT NULL REFERENCES worktrees(id), actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'ended')),
  joined_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE tasks (id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    title TEXT NOT NULL, path_scopes_json TEXT NOT NULL, PRIMARY KEY (workspace_id, id));
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('file', 'commit', 'test', 'data', 'url', 'other')),
  uri TEXT NOT NULL, sha256 TEXT, attached_by TEXT NOT NULL, attached_by_session_id TEXT,
  attached_at TEXT NOT NULL);
'''

# Stands in for agenttool-collab-host. It records its argv (never a credential's
# contents) and answers with the documented one-line receipt.
FAKE_HOST = r'''#!{python}
import json, sys, time
from pathlib import Path
here = Path(__file__).resolve().parent
args = sys.argv[1:]
mode_file, watch = here / "host-mode", here / "watch"
mode = mode_file.read_text().strip() if mode_file.exists() else "ended"
record = {"argv": args, "watched_exists": Path(watch.read_text()).exists() if watch.exists() else None}
with (here / "host-calls.jsonl").open("a") as log:
    log.write(json.dumps(record) + "\n")
session_id = Path(args[args.index("--session-file") + 1]).stem
if mode == "hang":
    time.sleep(30)
if mode == "error":
    print(json.dumps({"protocol": "agenttool.collab-host/1", "status": "error",
                      "error": "session_auth_failed", "message": "fixture refusal"}))
    sys.exit(1)
if mode == "garbled":
    print("not a receipt")
    sys.exit(0)
if mode == "already_ended":
    print(json.dumps({"protocol": "agenttool.collab-host/1", "status": "already_ended",
                      "session_id": session_id, "released": [], "ended_at": "2026-10-08T21:20:00.000Z"}))
    sys.exit(0)
print(json.dumps({"protocol": "agenttool.collab-host/1", "status": "ended", "session_id": session_id,
                  "released": [{"task_id": "voice-b", "lease_id": "lease_fixture", "via": "release"}],
                  "ended_at": "2026-10-08T21:30:00.000Z", "unlisted": "dropped by the sweep"}))
'''

# A native child that opens a Collab session with its job label and leaves it
# active, as a crashed or forgetful delegated agent would.
LIVE_SESSION_FIXTURE = r'''
import os, sqlite3
from datetime import datetime, timezone
from pathlib import Path
now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
db = sqlite3.connect(JOURNAL)
db.execute("INSERT INTO coordination_sessions (id, workspace_id, worktree_id, actor, status, joined_at, "
           "last_seen_at) VALUES ('session_job', 'ws_test', 'wt_test', ?, 'active', ?, ?)", (LABEL, now, now))
db.commit()
db.close()
folder = Path(JOURNAL).parent / "collab-sessions"
folder.mkdir(mode=0o700, exist_ok=True)
(folder / "session_job.json").write_text("{}")
os.chmod(folder / "session_job.json", 0o600)
print("left a live session")
'''


def fixture_body(template, **values):
    return "".join(f"{name} = {value!r}\n" for name, value in values.items()) + template


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def make_journal(path, root):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with contextlib.closing(sqlite3.connect(path)) as db:
        db.executescript(JOURNAL_SCHEMA)
        db.execute(f"PRAGMA application_id = {COLLAB_APPLICATION_ID}")
        db.execute("PRAGMA user_version = 3")
        db.execute("INSERT INTO workspaces (id, root_path) VALUES ('ws_test', ?)", (str(root),))
        db.execute("INSERT INTO worktrees (id, workspace_id, root_path) VALUES ('wt_test', 'ws_test', ?)", (str(root),))
        db.commit()
    return path


def add_session(path, session_id, actor, *, status="active", joined_at=None, worktree_id="wt_test"):
    joined_at = joined_at or iso_now()
    with contextlib.closing(sqlite3.connect(path)) as db:
        db.execute("INSERT INTO coordination_sessions (id, workspace_id, worktree_id, actor, status, "
                   "joined_at, last_seen_at, ended_at) VALUES (?, 'ws_test', ?, ?, ?, ?, ?, ?)",
                   (session_id, worktree_id, actor, status, joined_at, joined_at,
                    joined_at if status == "ended" else None))
        db.commit()


def end_session(path, session_id):
    with contextlib.closing(sqlite3.connect(path)) as db:
        db.execute("UPDATE coordination_sessions SET status = 'ended', ended_at = ? WHERE id = ?",
                   (iso_now(), session_id))
        db.commit()


def add_credential(journal, session_id):
    folder = journal.parent / "collab-sessions"
    folder.mkdir(mode=0o700, exist_ok=True)
    path = folder / f"{session_id}.json"
    path.write_text("{}\n")  # Placeholder only; the sweep never reads it.
    path.chmod(0o600)
    return path


def install_fake_host(folder, mode="ended"):
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    host = folder / "agenttool-collab-host"
    host.write_text(FAKE_HOST.replace("{python}", sys.executable))
    host.chmod(0o700)
    (folder / "host-mode").write_text(mode)
    return host


def host_calls(host):
    log = host.with_name("host-calls.jsonl")
    return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
```
In `JobTests.setUp`, directly after `self.project.mkdir(mode=0o700)`, insert:
```python
        # Workers get a throwaway HOME and request.json names a temporary journal
        # (collab_journal_path), so the exit sweep never reads the real Collab
        # journal or finds a real agenttool-collab-host.
        self.home = self.base / "home"
        self.home.mkdir(mode=0o700)
        self.journal = self.base / "collab-data" / "collab.sqlite"
```
In `JobTests.make_job`, in the `request = {...}` literal, replace `"prompt_transport": transport}` with:
```python
"prompt_transport": transport, "collab_journal_path": str(self.journal)}
```
In `JobTests.spawn`, replace `env=jobs.environment(),` with:
```python
env={**jobs.environment(), "HOME": str(self.home)},
```
In class `JobTests`, insert this test directly above `def test_invalid_or_context_oversized_prompt_creates_no_job_state(self):`:
```python
    def test_start_tells_the_runtime_its_own_job_id(self):
        prompt = self.base / "prompt.txt"
        prompt.write_text("fixture task")
        prompt.chmod(0o600)
        fake = types.SimpleNamespace(
            load_registry=lambda _: {"runtimes": [{"id": "codex", "prompt_transport": "stdin"}]},
            command_for=lambda runtime, cwd, source, mode, registry: [sys.executable, "-c", "pass"])
        with patch.object(jobs, "adapters", return_value=fake), \
             patch.object(jobs.subprocess, "Popen", return_value=types.SimpleNamespace(pid=12345)):
            row = jobs.start_job("codex", str(self.project), str(prompt), root=self.root)
        saved = (self.root / row["id"] / "prompt.txt").read_text()
        preface, task = saved.split("\n\n", 1)
        self.assertIn(f"Sol job ID: {row['id']}.", preface)
        self.assertIn(f"end your actor label with '· sol job {row['id']}'", preface)
        self.assertIn(f"Codex · sol job {row['id']}", preface)
        self.assertIn("use the parent_session_id given in the task", preface)
        self.assertIn("release_leases: true", preface)
        self.assertEqual(task, "fixture task")
        request = json.loads((self.root / row["id"] / "request.json").read_text())
        self.assertNotIn("collab_journal_path", request, "Production jobs use the default journal")
```
At the end of class `JobTests`, after `test_fifo_native_prompt_fails_without_blocking`, add (one blank line before):
```python
    def test_worker_sweeps_job_sessions_before_terminal_record(self):
        make_journal(self.journal, self.project)
        # environment() puts HOME/.config/sol/bin first on the job PATH.
        host = install_fake_host(self.home / ".config/sol/bin")
        host.with_name("watch").write_text(str(self.root / self.job_id / "result.json"))
        label = f"Codex · sol job {self.job_id}"
        self.make_job(fixture_body(LIVE_SESSION_FIXTURE, JOURNAL=str(self.journal), LABEL=label))
        self.assertEqual(self.finish(self.spawn())[0], 0)
        row = jobs.result(self.job_id, self.root)
        self.assertEqual(row["state"], "completed", row)
        sweep = row["collab_sweep"]
        self.assertEqual(sweep["errors"], [])
        self.assertEqual(sweep["matched"], [{"session_id": "session_job", "actor": label, "status": "ended"}])
        self.assertEqual([r["session_id"] for r in sweep["swept"]], ["session_job"])
        [call] = host_calls(host)
        self.assertIs(call["watched_exists"], False, "The sweep ran after result.json was written")
        argv = call["argv"]
        self.assertEqual(argv[argv.index("--reason") + 1], f"host exit sweep: job {self.job_id} ended completed")
        self.assertEqual(argv[argv.index("--db") + 1], str(self.journal))

    def test_worker_terminal_record_survives_unreadable_journal(self):
        self.journal.parent.mkdir(parents=True, mode=0o700)
        self.journal.write_bytes(b"not a sqlite database" * 64)
        self.make_job()
        self.assertEqual(self.finish(self.spawn())[0], 0)
        row = jobs.result(self.job_id, self.root)
        self.assertEqual(row["state"], "completed", row)
        self.assertEqual([e["error"] for e in row["collab_sweep"]["errors"]], ["journal_unreadable"])
```
Directly before `class CliReadTests(unittest.TestCase):`, add (two blank lines on each side):
```python
class CollabSweepTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sol-sweep-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.journal = make_journal(self.base / "data/agenttool/collab.sqlite", self.base / "repo")
        self.host = install_fake_host(self.base / "bin")
        self.job_id = "20261008T210000-0123456789ab"
        self.label = f"Codex · sol job {self.job_id}"
        self.started = "2026-10-08T21:00:00+00:00"

    def sweep(self, **kw):
        options = {"journal_path": str(self.journal), "host_cli": str(self.host), **kw}
        return jobs.collab_exit_sweep(self.job_id, self.started, "completed", **options)

    def test_sweep_ends_each_active_session_of_this_job_once(self):
        sessions = [("session_mine", self.label, "active", "2026-10-08T21:00:05.000Z"),
                    ("session_dash", f"Codex - sol job {self.job_id}", "active", "2026-10-08T21:00:06.000Z"),
                    ("session_done", self.label, "ended", "2026-10-08T21:00:07.000Z"),
                    ("session_before", self.label, "active", "2026-10-08T20:59:59.000Z"),
                    ("session_other", "Codex · sol job 20261008T205907-4d9ccbcd455e", "active", "2026-10-08T21:00:08.000Z"),
                    ("session_upper", "Codex · SOL JOB " + self.job_id, "active", "2026-10-08T21:00:09.000Z"),
                    ("session_suffixed", self.label + " retry", "active", "2026-10-08T21:00:10.000Z"),
                    ("session_plain", "Codex", "active", "2026-10-08T21:00:11.000Z")]
        for session_id, actor, status, joined in sessions:
            add_session(self.journal, session_id, actor, status=status, joined_at=joined)
            add_credential(self.journal, session_id)
        before = {p.name: p.read_bytes() for p in self.journal.parent.iterdir() if p.is_file()}
        report = self.sweep()
        self.assertEqual(report["errors"], [])
        self.assertEqual([(m["session_id"], m["status"]) for m in report["matched"]],
                         [("session_mine", "ended"), ("session_dash", "ended"), ("session_done", "ended")])
        self.assertEqual([r["session_id"] for r in report["swept"]], ["session_mine", "session_dash"])
        self.assertEqual(report["swept"][0], {
            "protocol": "agenttool.collab-host/1", "status": "ended", "session_id": "session_mine",
            "released": [{"task_id": "voice-b", "lease_id": "lease_fixture", "via": "release"}],
            "ended_at": "2026-10-08T21:30:00.000Z"})
        calls = host_calls(self.host)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["argv"], ["end", "--session-file",
                                            str(self.journal.parent / "collab-sessions" / "session_mine.json"),
                                            "--reason", f"host exit sweep: job {self.job_id} ended completed",
                                            "--release-leases", "--db", str(self.journal)])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.journal.parent.iterdir() if p.is_file()},
                         "The read-only sweep changed the journal directory")

    def test_sweep_without_journal_or_active_match_never_spawns(self):
        absent = self.base / "absent/collab.sqlite"
        empty = {"matched": [], "swept": [], "errors": []}
        with patch.object(jobs.subprocess, "run", side_effect=AssertionError("No host process")):
            self.assertEqual(self.sweep(journal_path=str(absent)), empty)
            add_session(self.journal, "session_plain", "Codex")
            self.assertEqual(self.sweep(), empty)
            add_session(self.journal, "session_done", self.label, status="ended",
                        joined_at="2026-10-08T21:00:05.000Z")
            self.assertEqual(self.sweep(), {"matched": [{"session_id": "session_done", "actor": self.label,
                                                         "status": "ended"}], "swept": [], "errors": []})
        self.assertFalse(absent.parent.exists())

    def test_sweep_reports_each_failure_once_and_never_raises(self):
        add_session(self.journal, "session_nofile", self.label, joined_at="2026-10-08T21:00:01.000Z")
        add_session(self.journal, "session_refused", self.label, joined_at="2026-10-08T21:00:02.000Z")
        add_credential(self.journal, "session_refused")
        (self.base / "bin/host-mode").write_text("error")
        report = self.sweep()
        self.assertEqual(report["swept"], [])
        self.assertEqual([(e["session_id"], e["error"]) for e in report["errors"]],
                         [("session_nofile", "session_file_missing"), ("session_refused", "session_auth_failed")])
        self.assertEqual(report["errors"][1]["exit_code"], 1)
        self.assertEqual([m["status"] for m in report["matched"]], ["active", "active"])
        self.assertEqual(len(host_calls(self.host)), 1, "A refused end must not be retried")
        (self.base / "bin/host-mode").write_text("garbled")
        self.assertEqual([e["error"] for e in self.sweep()["errors"]], ["session_file_missing", "host_cli_failed"])
        missing = self.sweep(host_cli="agenttool-collab-host-absent-fixture")
        self.assertEqual([e["error"] for e in missing["errors"]], ["host_cli_not_found"])

    def test_sweep_accepts_sessions_that_ended_while_it_ran(self):
        add_session(self.journal, "session_gone", self.label, joined_at="2026-10-08T21:00:01.000Z")
        add_session(self.journal, "session_late", self.label, joined_at="2026-10-08T21:00:02.000Z")
        add_credential(self.journal, "session_late")
        (self.base / "bin/host-mode").write_text("already_ended")
        listing = jobs.read_journal

        def ends_gone_after_listing(journal, query, parameters):
            rows = listing(journal, query, parameters)
            if query == jobs.SWEEP_SESSIONS:
                # Its own collab_session_end ended it and removed its credential file.
                end_session(self.journal, "session_gone")
            return rows

        with patch.object(jobs, "read_journal", side_effect=ends_gone_after_listing):
            report = self.sweep()
        self.assertEqual(report["errors"], [])
        self.assertEqual([(m["session_id"], m["status"]) for m in report["matched"]],
                         [("session_gone", "ended"), ("session_late", "ended")])
        self.assertEqual([(r["session_id"], r["status"]) for r in report["swept"]], [("session_late", "already_ended")])
        self.assertEqual(len(host_calls(self.host)), 1)

    def test_sweep_is_time_bounded(self):
        for session_id, joined in (("session_slow", "2026-10-08T21:00:01.000Z"),
                                   ("session_next", "2026-10-08T21:00:02.000Z")):
            add_session(self.journal, session_id, self.label, joined_at=joined)
            add_credential(self.journal, session_id)
        (self.base / "bin/host-mode").write_text("hang")
        before = time.monotonic()
        report = self.sweep(timeout_s=0.5)
        self.assertLess(time.monotonic() - before, 5)
        self.assertEqual([(e["session_id"], e["error"]) for e in report["errors"]],
                         [("session_slow", "host_cli_timeout"), ("session_next", "sweep_time_exhausted")])
        self.assertEqual(len(host_calls(self.host)), 1)

    def test_sweep_contains_foreign_or_corrupt_journals(self):
        foreign = self.base / "foreign.sqlite"
        with contextlib.closing(sqlite3.connect(foreign)) as db:
            db.executescript(JOURNAL_SCHEMA)
        corrupt = self.base / "corrupt.sqlite"
        corrupt.write_bytes(b"not a sqlite database" * 64)
        for path in (foreign, corrupt):
            with self.subTest(path=path.name):
                report = self.sweep(journal_path=str(path))
                self.assertEqual([e["error"] for e in report["errors"]], ["journal_unreadable"])

    def test_journal_path_follows_collab_server_precedence(self):
        home = str(self.base / "home")
        cases = [({"HOME": home}, f"{home}/.local/share/agenttool/collab.sqlite"),
                 ({"HOME": home, "XDG_DATA_HOME": ""}, f"{home}/.local/share/agenttool/collab.sqlite"),
                 ({"HOME": home, "XDG_DATA_HOME": "/xdg"}, "/xdg/agenttool/collab.sqlite"),
                 ({"HOME": home, "XDG_DATA_HOME": "relative"}, os.path.abspath("relative") + "/agenttool/collab.sqlite"),
                 ({"HOME": home, "XDG_DATA_HOME": "/xdg", "AGENTOOL_COLLAB_DB": "/explicit/j.sqlite"}, "/explicit/j.sqlite"),
                 # `??` in the server: an empty AGENTOOL_COLLAB_DB is still set.
                 ({"HOME": home, "XDG_DATA_HOME": "/xdg", "AGENTOOL_COLLAB_DB": ""}, "")]
        for env, expected in cases:
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                self.assertEqual(jobs.collab_journal_path(), expected)
        with patch.object(jobs, "collab_journal_path", return_value=""), \
             patch.object(jobs.subprocess, "run", side_effect=AssertionError("No host process")):
            self.assertEqual(jobs.collab_exit_sweep(self.job_id, self.started, "completed"),
                             {"matched": [], "swept": [], "errors": []})
```

- [ ] **Step 2: Run test to verify it fails**
```sh
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_jobs.py 2>&1 | grep -E "Error:|^FAIL:|^FAILED|^OK" | sed -E 's/ \(env=.*//' | sort | uniq -c
```
Expected: 10 new tests and `FAILED (failures=1, errors=16)`; all pre-existing tests still pass. The causes:
- `AttributeError: module 'sol_jobs_tested' has no attribute 'collab_exit_sweep'` (×6), `... 'collab_journal_path'` (×6 subtests), `... 'read_journal'` (×1), and `... does not have the attribute 'collab_journal_path'` (×1, from `patch.object`)
- `KeyError: 'collab_sweep'` (×2, the worker tests)
- `AssertionError: 'Sol job ID: 2026…' not found in "Delegated through Sol's shared agent layer. …"` (×1)

- [ ] **Step 3: Write minimal implementation**

In the `jobs.py` module imports, add `import shutil` and `import sqlite3`:
```python
import selectors
import shutil
import signal
import sqlite3
import stat
```
Directly after `TERMINAL = {"completed", "failed", "blocked", "cancelled", "timed_out"}`, add:
```python
COLLAB_APPLICATION_ID = 0x4154434C  # "ATCL": packages/collab/src/store.ts APPLICATION_ID
COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1"
COLLAB_RECEIPT_KEYS = ("protocol", "status", "session_id", "released", "ended_at", "warning")
# Delegated jobs end their Collab actor label with "· sol job <job-id>". The
# label is self-declared and unauthenticated: a routing hint, not identity.
# Matching uses only its ASCII part, so a different dot still matches; job IDs
# are unique, so that part is enough.
DELEGATION_LABEL = "· sol job "
DELEGATION_MATCH = "sol job "
# Every session that joined after the worker started, whatever its status, so
# the report shows ended ones too; the label is matched in Python, not by LIKE.
SWEEP_SESSIONS = """
SELECT id, actor, status FROM coordination_sessions
WHERE julianday(joined_at) >= julianday(?)
ORDER BY julianday(joined_at), id
"""
SESSION_STATUS = "SELECT status FROM coordination_sessions WHERE id = ?"
```
After `environment()` and before `def start_job`, add (two blank lines on each side):
```python
def collab_journal_path() -> str:
    """The journal agenttool-collab-mcp opens: `AGENTOOL_COLLAB_DB ?? defaultDatabasePath()`."""
    explicit = os.environ.get("AGENTOOL_COLLAB_DB")
    if explicit is not None:  # `??`: an empty value still counts as set, as in the server.
        return explicit
    data_home = os.environ.get("XDG_DATA_HOME")
    base = os.path.abspath(data_home) if data_home else os.path.join(str(Path.home()), ".local", "share")
    return os.path.join(base, "agenttool", "collab.sqlite")


def read_journal(journal, query, parameters):
    """Rows from a Collab journal opened read-only: no create, migration, write or long lock wait."""
    # as_uri() percent-encodes the path, so a space, "?" or "#" in it cannot
    # change the URI (a bare "file:" + path can drop mode=ro and create a file).
    connection = sqlite3.connect(Path(journal).absolute().as_uri() + "?mode=ro", uri=True, timeout=2.0)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only = ON")
        if connection.execute("PRAGMA application_id").fetchone()[0] != COLLAB_APPLICATION_ID:
            raise ValueError("Not an AgentTool Collab journal")
        return connection.execute(query, parameters).fetchall()
    finally:
        connection.close()


def delegated_rows(rows, job_id):
    suffix = DELEGATION_MATCH + job_id
    return [row for row in rows if str(row["actor"]).endswith(suffix)]


def session_status(journal, session_id):
    try:
        rows = read_journal(journal, SESSION_STATUS, (session_id,))
    except (sqlite3.Error, ValueError):
        return None
    return rows[0]["status"] if rows else None


def host_receipt(stdout):
    lines = [line for line in stdout.decode("utf-8", errors="replace").splitlines() if line.strip()]
    try:
        value = json.loads(lines[-1]) if lines else None
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def collab_exit_sweep(job_id: str, started_at: str, state: str, *, journal_path: str | None = None,
                      host_cli: str = "agenttool-collab-host", timeout_s: float = 20.0) -> dict:
    """End this job's still-active Collab sessions once at exit. Never retried; never raises.

    `matched` lists every session of this job that joined after the worker started,
    with its status after the sweep; `swept` holds the host CLI receipts.
    """
    report = {"matched": [], "swept": [], "errors": []}
    deadline = time.monotonic() + timeout_s
    try:
        if not JOB_ID.fullmatch(job_id):
            raise ValueError("Invalid job ID")
        # Credentials sit beside the journal: store.defaultSessionCredentialPath
        # uses dirname(path.resolve(db)).
        journal = Path(os.path.abspath(collab_journal_path() if journal_path is None else journal_path))
        if not journal.is_file():
            return report  # No journal, so nothing to sweep; nothing is created.
        try:
            rows = delegated_rows(read_journal(journal, SWEEP_SESSIONS, (started_at,)), job_id)
        except (sqlite3.Error, ValueError) as exc:
            report["errors"].append({"session_id": None, "error": "journal_unreadable",
                                     "error_type": type(exc).__name__})
            return report
        report["matched"] = [{"session_id": row["id"], "actor": row["actor"], "status": row["status"]}
                             for row in rows]
        active = [entry for entry in report["matched"] if entry["status"] == "active"]
        if not active:
            return report
        env = environment()
        executable = host_cli if os.path.isabs(host_cli) else shutil.which(host_cli, path=env["PATH"])
        if not executable:
            report["errors"].append({"session_id": None, "error": "host_cli_not_found",
                                     "message": f"{host_cli} is not on the job PATH; the sessions stay active"})
            return report
        for entry in active:
            session_id = entry["session_id"]
            credential = journal.parent / "collab-sessions" / f"{session_id}.json"
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                report["errors"].append({"session_id": session_id, "error": "sweep_time_exhausted"})
                continue
            if not credential.is_file():
                # collab_session_end removes the file; a session that ended meanwhile is fine.
                if session_status(journal, session_id) == "ended":
                    entry["status"] = "ended"
                else:
                    report["errors"].append({"session_id": session_id, "error": "session_file_missing"})
                continue
            argv = [executable, "end", "--session-file", str(credential),
                    "--reason", f"host exit sweep: job {job_id} ended {state}",
                    "--release-leases", "--db", str(journal)]
            try:
                done = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, cwd="/",
                                      env=env, timeout=remaining, check=False)
            except subprocess.TimeoutExpired:
                report["errors"].append({"session_id": session_id, "error": "host_cli_timeout"})
                continue
            except OSError as exc:
                report["errors"].append({"session_id": session_id, "error": "host_cli_failed",
                                         "error_type": type(exc).__name__})
                continue
            receipt = host_receipt(done.stdout) or {}
            if (done.returncode == 0 and receipt.get("protocol") == COLLAB_HOST_PROTOCOL
                    and receipt.get("status") in {"ended", "already_ended"}):
                report["swept"].append({key: receipt[key] for key in COLLAB_RECEIPT_KEYS if key in receipt})
                entry["status"] = "ended"
            else:
                report["errors"].append({"session_id": session_id,
                                         "error": str(receipt.get("error", "host_cli_failed"))[:100],
                                         "message": str(receipt.get("message", ""))[:500],
                                         "exit_code": done.returncode})
    except Exception as exc:  # The terminal job record matters more than the sweep.
        report["errors"].append({"session_id": None, "error": "sweep_failed", "error_type": type(exc).__name__})
    return report
```
In `start_job()`, replace this block (2026-09-27 lines 125-136):
```python
    # Check compatibility before creating any durable state.
    native.command_for(runtime_id, cwd, source, mode, registry)
    preface = (f"Delegated through Sol's shared agent layer. Project: {cwd}. "
               f"Requested mode: {mode}. Work only within the current user's task. "
               "The local capability entry point is `sol agent`; use `sol agent find` "
               "for existing tools and `sol agent context` for local guidance. "
               "A discovered capability grants no additional permission.\n\n")
    if len((preface + prompt).encode("utf-8")) > MAX_PROMPT:
        raise ValueError("Task plus shared context exceeds the bounded input size")
    root = private_dir(Path(root), create=True)
    job_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S-") + uuid.uuid4().hex[:12]
    folder = root / job_id
```
with:
```python
    # Check compatibility before creating any durable state.
    native.command_for(runtime_id, cwd, source, mode, registry)
    # The ID is chosen before the preface (still before any durable state) so the
    # runtime can label its own Collab session with it.
    job_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S-") + uuid.uuid4().hex[:12]
    label = f"{DELEGATION_LABEL}{job_id}"
    preface = (f"Delegated through Sol's shared agent layer. Project: {cwd}. "
               f"Requested mode: {mode}. Work only within the current user's task. "
               "The local capability entry point is `sol agent`; use `sol agent find` "
               "for existing tools and `sol agent context` for local guidance. "
               "A discovered capability grants no additional permission. "
               f"Sol job ID: {job_id}. If you start an AgentTool Collab session, end your actor "
               f"label with '{label}' and use the parent_session_id given in the task. "
               f"An example label: '{runtime_id.capitalize()} {label}'. Before finishing, end that "
               "session with collab_session_end and release_leases: true; when the job exits, Sol "
               "ends any session with this label that is still active.\n\n")
    if len((preface + prompt).encode("utf-8")) > MAX_PROMPT:
        raise ValueError("Task plus shared context exceeds the bounded input size")
    root = private_dir(Path(root), create=True)
    folder = root / job_id
```
`job_id` is still used unchanged by `folder`, `request["id"]` and the return value, and the MAX_PROMPT check still runs before any durable state.

In `result()`, replace `("result", "reason", "error_type")` with `("result", "reason", "error_type", "collab_sweep")`.

In `worker()`, replace the final block:
```python
    finally:
        if outcome is not None:
            atomic_json(folder / "result.json", {**outcome, "started_at": started, "finished_at": utc()})
```
with:
```python
    finally:
        if outcome is not None:
            # Bounded and contained: the terminal record below is always written.
            try:
                outcome["collab_sweep"] = collab_exit_sweep(
                    job_id, started, str(outcome.get("state", "failed")),
                    journal_path=request.get("collab_journal_path"))  # Set only by tests.
            except BaseException as exc:
                outcome["collab_sweep"] = {"matched": [], "swept": [], "errors": [
                    {"session_id": None, "error": "sweep_failed", "error_type": type(exc).__name__}]}
            atomic_json(folder / "result.json", {**outcome, "started_at": started, "finished_at": utc()})
```

- [ ] **Step 4: Run test to verify it passes**
```sh
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_jobs.py        # OK; 10 more tests than before this task (19 -> 29), about 12 s
/opt/homebrew/bin/python3 -B test_runtimes.py                               # OK (unchanged by this task)
ls ~/.config/sol/agents | grep -c __pycache__                               # 0
sqlite3 -readonly ~/.local/share/agenttool/collab.sqlite "SELECT count(*) >= 0 FROM (SELECT id, actor, status FROM coordination_sessions WHERE julianday(joined_at) >= julianday('2026-10-08T00:00:00+00:00') ORDER BY julianday(joined_at), id);"
```
The last command checks `SWEEP_SESSIONS` against the live v3 schema, read-only. Expected output is `1`; a schema mismatch prints an SQL error instead. If a worker test fails with exit 1 and `ENOSPC` appears, the disk is full: free space (Step 0 of Task 1) and re-run.

- [ ] **Step 5: Record the change (CHANGELOG entry instead of a commit)**
```sh
/opt/homebrew/bin/python3 -I -B - <<'EOF'
import hashlib, json, os
from pathlib import Path
sol = Path.home() / ".config/sol"
changelog, crosswalk = sol / "CHANGELOG.md", sol / "home/XENIA-CROSSWALK.json"
bullet = ("- Delegated jobs learn their Sol job ID and Collab label (`· sol job <job-id>`)\n"
          "  from the job preface. Before `result.json`, the worker reads the Collab journal\n"
          "  read-only and ends this job's still-active sessions once with\n"
          "  `agenttool-collab-host end --release-leases`: bounded, never retried, never\n"
          "  blocking the terminal record. `collab_sweep` lists matched sessions,\n"
          "  receipts and errors.")
text = changelog.read_text(encoding="utf-8")
anchor = "\n\n## 1.7.0 — 2026-09-27\n"
assert text.count(anchor) == 1 and "## Unreleased — 2026-10-08" in text and bullet not in text
changelog.write_text(text.replace(anchor, "\n" + bullet + anchor), encoding="utf-8")
record = json.loads(crosswalk.read_text(encoding="utf-8"))
old = next(a["sha256"] for a in record["artifacts"] if a["id"] == "sol-changelog")
new = "sha256:" + hashlib.sha256(changelog.read_bytes()).hexdigest()
raw = crosswalk.read_text(encoding="utf-8")
assert raw.count(old) == 1
temporary = crosswalk.with_name(".XENIA-CROSSWALK.json.tmp")
temporary.write_text(raw.replace(old, new), encoding="utf-8")
os.chmod(temporary, 0o600)
os.replace(temporary, crosswalk)
print("sol-changelog", old, "->", new)
EOF
~/.config/sol/bin/sol-doctor | grep -E "^FAIL|Hearth crosswalk evidence bytes"
```
Expected: only `PASS  Hearth crosswalk evidence bytes match its allowlisted local artifacts`.

---

### Task 3: Opt-in integration commit (`--integrate-commit`)

**Files:**
- Backup: `jobs.py`, `test_jobs.py` and `cli.py`; files already backed up are left untouched
- Modify `~/.config/sol/agents/jobs.py`:
  - module imports (add `hashlib`, `urllib.parse`)
  - constants after `SESSION_STATUS` (Task 2)
  - new functions after `collab_exit_sweep()` (Task 2), before `def start_job`
  - `start_job()`: signature, limit check, preface, request literal (2026-09-27 lines 104-105, 120-121, 144-147)
  - `result()`: copied keys
  - `worker()`: the final `finally` block as left by Task 2
- Modify `~/.config/sol/agents/cli.py`: the `start` parser (2026-09-27 lines 122-125) and the `start_job` call (2026-09-27 line 164)
- Test `~/.config/sol/agents/test_jobs.py`:
  - module imports (`hashlib`); `INTEGRATION_FIXTURE` before `def fixture_body`; helpers after `host_calls`
  - `JobTests.make_job` (signature and request literal); new `JobTests` methods
  - new classes `IntegrateCommitTests` (before `CollabSweepTests`) and `CliStartTests` (before `if __name__ == "__main__":`)
- Record: `~/.config/sol/CHANGELOG.md`, crosswalk `sol-changelog` digest

**Interfaces:**
- Consumes:
  - Collab v3 `artifacts(id, workspace_id, task_id, kind, uri, sha256, attached_by, attached_by_session_id, attached_at)`; `uri` is free text and `sha256` is stored lower-case (`attachArtifactForSession`)
  - `tasks(id, workspace_id, title, path_scopes_json)`, with scopes normalized to repository-relative POSIX paths (`normalizePathScopes`)
  - `worktrees(id, root_path)`, where `root_path` is the realpath of the git toplevel (`repository.ts`)
  - from Task 2: `coordination_sessions`, `read_journal()`, `delegated_rows()`, `collab_journal_path()`, `environment()`; from 2026-09-27 `jobs.py`: `stop_group()`
  - git 2.52 (`--literal-pathspecs`, `commit --only`, `-F -`); git removes its own `index.lock` on SIGTERM
- Produces:
  - `integrate_commit(job_id: str, project: str, started_at: str, runtime: str, *, journal_path: str | None = None) -> {"status": "committed"|"skipped"|"refused", "commit": sha|None, "paths": [...], "reason": str}`. It never raises; an unexpected exception becomes `refused`.
  - `integration_outcome(job_id, request, outcome, started)`: the worker gate. Anything but `mode == "edit"` and `state == "completed"` gives `skipped`.
  - `result.json` key `integration_commit`, present only when `request.json` has `"integrate_commit": true`; also returned by `jobs.result()`
  - `start_job(..., integrate_commit=False)`, which refuses `integrate_commit` without mode `edit` before creating any state; `request.json` field `"integrate_commit": bool`
  - `sol agent start --integrate-commit`
  - helpers `integration_answer()`, `repo_relative()`, `in_scope()`, `file_sha256()`, `run_git()` (process-group timeout); constants `INTEGRATION_ARTIFACTS`, `GIT_TIMEOUT = 30`, `COMMIT_TIMEOUT = 120`

- [ ] **Step 1: Write the failing test**

Snapshot first:
```sh
B=~/.config/sol/agents/.backup-20261008
mkdir -p -m 700 "$B"
for f in ~/.config/sol/agents/jobs.py ~/.config/sol/agents/test_jobs.py ~/.config/sol/agents/cli.py \
         ~/.config/sol/CHANGELOG.md ~/.config/sol/home/XENIA-CROSSWALK.json; do
  [ -e "$B/$(basename "$f")" ] || cp -p "$f" "$B/"
done
ls -l "$B"
```
In the `test_jobs.py` module imports at the top, add `import hashlib` directly after `from datetime import datetime, timezone` (the line Task 2 added after `import contextlib`; the fixture strings also contain that text, so edit the import block only).

Directly before `def fixture_body(`, add:
```python
# A completed edit job: writes its file, attaches it with its digest from an
# ended session (the well-behaved path), and never commits.
INTEGRATION_FIXTURE = r'''
import hashlib, sqlite3
from datetime import datetime, timezone
from pathlib import Path
data = b"B answers A.\n"
Path("voice-b.md").write_bytes(data)
now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
db = sqlite3.connect(JOURNAL)
db.execute("INSERT INTO coordination_sessions (id, workspace_id, worktree_id, actor, status, joined_at, "
           "last_seen_at, ended_at) VALUES ('session_job', 'ws_test', 'wt_test', ?, 'ended', ?, ?, ?)",
           (LABEL, now, now, now))
db.execute("INSERT INTO tasks (id, workspace_id, title, path_scopes_json) VALUES ('voice-b', 'ws_test', ?, ?)",
           ("Voice B — the answer", '["voice-b.md"]'))
db.execute("INSERT INTO artifacts (id, workspace_id, task_id, kind, uri, sha256, attached_by, "
           "attached_by_session_id, attached_at) VALUES ('artifact_b', 'ws_test', 'voice-b', 'file', "
           "'voice-b.md', ?, ?, 'session_job', ?)", (hashlib.sha256(data).hexdigest(), LABEL, now))
db.commit()
db.close()
print("voice-b written and attached")
'''
```
Directly after `host_calls()` (the last Task 2 helper), add (two blank lines before):
```python
def add_task(path, task_id, title, scopes):
    with contextlib.closing(sqlite3.connect(path)) as db:
        db.execute("INSERT INTO tasks (id, workspace_id, title, path_scopes_json) VALUES (?, 'ws_test', ?, ?)",
                   (task_id, title, json.dumps(scopes)))
        db.commit()


def add_artifact(path, artifact_id, task_id, uri, digest, session_id, *, kind="file", attached_at=None):
    with contextlib.closing(sqlite3.connect(path)) as db:
        db.execute("INSERT INTO artifacts (id, workspace_id, task_id, kind, uri, sha256, attached_by, "
                   "attached_by_session_id, attached_at) VALUES (?, 'ws_test', ?, ?, ?, ?, 'fixture', ?, ?)",
                   (artifact_id, task_id, kind, uri, digest, session_id, attached_at or iso_now()))
        db.commit()


def git(repo, *args, home):
    # A throwaway HOME keeps the developer's global hooks and identity out of fixtures.
    env = {**jobs.environment(), "HOME": str(home)}
    return subprocess.run(["git", "-C", str(repo), *args], env=env, capture_output=True,
                          text=True, check=True, timeout=30).stdout


def make_repo(path, home):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    git(path, "init", "-q", "-b", "main", home=home)
    for key, value in (("user.name", "Host Person"), ("user.email", "host@example.invalid"),
                       ("commit.gpgsign", "false")):
        git(path, "config", key, value, home=home)
    (path / "README.md").write_text("fixture\n")
    git(path, "add", "README.md", home=home)
    git(path, "commit", "-q", "-m", "fixture base", home=home)
    return path
```
In `JobTests.make_job`, replace the signature line `argv=None, prompt="private fixture prompt", transport="stdin"):` with:
```python
                 argv=None, prompt="private fixture prompt", transport="stdin", mode="review",
                 integrate_commit=False):
```
In its request literal, replace `"mode": "review"` with `"mode": mode`, and replace `"prompt_transport": transport, "collab_journal_path": str(self.journal)}` (Task 2) with:
```python
"prompt_transport": transport, "collab_journal_path": str(self.journal),
                   "integrate_commit": integrate_commit}
```
At the end of class `JobTests`, after `test_worker_terminal_record_survives_unreadable_journal` (Task 2), add (one blank line before):
```python
    def test_start_records_integrate_commit_and_requires_edit_mode(self):
        prompt = self.base / "prompt.txt"
        prompt.write_text("fixture task")
        prompt.chmod(0o600)
        fake = types.SimpleNamespace(
            load_registry=lambda _: {"runtimes": [{"id": "codex", "prompt_transport": "stdin"}]},
            command_for=lambda runtime, cwd, source, mode, registry: [sys.executable, "-c", "pass"])
        with patch.object(jobs, "adapters", return_value=fake), \
             patch.object(jobs.subprocess, "Popen", return_value=types.SimpleNamespace(pid=12345)):
            plain = jobs.start_job("codex", str(self.project), str(prompt), root=self.root)
            edit = jobs.start_job("codex", str(self.project), str(prompt), "edit", root=self.root,
                                  integrate_commit=True)
            with self.assertRaisesRegex(ValueError, "--integrate-commit requires --mode edit"):
                jobs.start_job("codex", str(self.project), str(prompt), "review", root=self.root,
                               integrate_commit=True)
        self.assertIs(json.loads((self.root / plain["id"] / "request.json").read_text())["integrate_commit"], False)
        self.assertIs(json.loads((self.root / edit["id"] / "request.json").read_text())["integrate_commit"], True)
        self.assertIn("integration commit", (self.root / edit["id"] / "prompt.txt").read_text())
        self.assertNotIn("integration commit", (self.root / plain["id"] / "prompt.txt").read_text())
        self.assertEqual(len(list(self.root.iterdir())), 2, "A refused start created job state")

    def test_worker_integrates_after_completed_edit_job(self):
        make_repo(self.project, self.home)
        make_journal(self.journal, self.project)
        label = f"Codex · sol job {self.job_id}"
        self.make_job(fixture_body(INTEGRATION_FIXTURE, JOURNAL=str(self.journal), LABEL=label),
                      mode="edit", integrate_commit=True)
        self.assertEqual(self.finish(self.spawn())[0], 0)
        row = jobs.result(self.job_id, self.root)
        self.assertEqual(row["state"], "completed", row)
        self.assertEqual(row["collab_sweep"], {"matched": [{"session_id": "session_job", "actor": label,
                                                            "status": "ended"}], "swept": [], "errors": []})
        self.assertEqual(row["integration_commit"]["status"], "committed", row["integration_commit"])
        self.assertEqual(row["integration_commit"]["paths"], ["voice-b.md"])
        self.assertEqual(git(self.project, "log", "-1", "--format=%s", home=self.home).strip(),
                         "voice-b: Voice B — the answer")

    def test_worker_skips_integration_after_failed_job(self):
        make_repo(self.project, self.home)
        self.make_job("import sys\nsys.exit(3)", mode="edit", integrate_commit=True)
        self.assertEqual(self.finish(self.spawn())[0], 0)
        row = jobs.result(self.job_id, self.root)
        self.assertEqual(row["state"], "failed")
        self.assertEqual(row["integration_commit"]["status"], "skipped")
        self.assertEqual(git(self.project, "rev-list", "--count", "HEAD", home=self.home).strip(), "1")
```
Directly before `class CollabSweepTests(unittest.TestCase):`, add:
```python
class IntegrateCommitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sol-integrate-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.home = self.base / "home"
        self.home.mkdir(mode=0o700)
        home = patch.dict(os.environ, {"HOME": str(self.home)})
        home.start()
        self.addCleanup(home.stop)
        self.repo = make_repo(self.base / "repo with spaces", self.home)
        self.journal = make_journal(self.base / "data/collab.sqlite", self.repo)
        self.job_id = "20261008T210000-0123456789ab"
        self.label = f"Codex · sol job {self.job_id}"
        self.started = "2026-10-08T21:00:00+00:00"
        add_session(self.journal, "session_codex", self.label, status="ended", joined_at="2026-10-08T21:00:05.000Z")
        add_task(self.journal, "voice-b", "Voice B — the answer", ["notes", "voice-b.md"])
        self.data = b"B answers A.\n"
        (self.repo / "voice-b.md").write_bytes(self.data)
        self.digest = hashlib.sha256(self.data).hexdigest()

    def integrate(self):
        return jobs.integrate_commit(self.job_id, str(self.repo), self.started, "codex",
                                     journal_path=str(self.journal))

    def git(self, *args):
        return git(self.repo, *args, home=self.home)

    def hook(self, body):
        hooks = self.base / "hooks"
        hooks.mkdir(exist_ok=True)
        (hooks / "pre-commit").write_text("#!/bin/sh\n" + body + "\n")
        (hooks / "pre-commit").chmod(0o700)
        self.git("config", "core.hooksPath", str(hooks))

    def assert_untouched(self, head):
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertEqual(self.git("diff", "--cached", "--name-only"), "")
        self.assertFalse((self.repo / ".git/index.lock").exists())

    def test_commits_only_verified_artifacts_with_runtime_author_and_repository_hooks(self):
        add_artifact(self.journal, "artifact_b", "voice-b", "voice-b.md", self.digest, "session_codex")
        (self.repo / "README.md").write_text("unrelated local edit\n")
        (self.repo / "untracked.txt").write_text("untracked\n")
        marker = self.base / "hook-ran"
        self.hook(f"touch '{marker}'")
        result = self.integrate()
        self.assertEqual(result["status"], "committed", result)
        self.assertEqual(result["paths"], ["voice-b.md"])
        self.assertEqual(result["commit"], self.git("rev-parse", "HEAD").strip())
        self.assertTrue(marker.exists(), "The repository pre-commit hook did not run")
        author, committer, subject, *body = self.git("log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%s%n%b").splitlines()
        self.assertEqual(author, "codex <codex@sol.local>")
        self.assertEqual(committer, "Host Person <host@example.invalid>")
        self.assertEqual(subject, "voice-b: Voice B — the answer")
        self.assertIn(self.job_id, "\n".join(body))
        self.assertIn("session_codex", "\n".join(body))
        self.assertIn(f"voice-b.md sha256:{self.digest}", body)
        self.assertEqual(self.git("show", "--name-only", "--format=", "HEAD").split(), ["voice-b.md"])
        self.assertEqual(sorted(self.git("status", "--porcelain").splitlines()), [" M README.md", "?? untracked.txt"])

    def test_accepts_relative_absolute_and_file_uris_newest_wins(self):
        (self.repo / "notes").mkdir()
        one, two = b"one\n", b"two\n"
        (self.repo / "notes/one.md").write_bytes(one)
        (self.repo / "notes/two.md").write_bytes(two)
        add_artifact(self.journal, "a_old", "voice-b", "voice-b.md", "0" * 64, "session_codex",
                     attached_at="2026-10-08T21:00:10.000Z")
        add_artifact(self.journal, "a_new", "voice-b", "./voice-b.md", self.digest, "session_codex",
                     attached_at="2026-10-08T21:00:20.000Z")
        add_artifact(self.journal, "a_abs", "voice-b", str(self.repo / "notes/one.md"),
                     hashlib.sha256(one).hexdigest(), "session_codex")
        add_artifact(self.journal, "a_uri", "voice-b", (self.repo / "notes/two.md").as_uri(),
                     hashlib.sha256(two).hexdigest(), "session_codex")
        self.assertIn("%20", (self.repo / "notes/two.md").as_uri())
        result = self.integrate()
        self.assertEqual(result["status"], "committed", result)
        self.assertEqual(result["paths"], ["notes/one.md", "notes/two.md", "voice-b.md"])

    def test_refuses_unverifiable_files_or_foreign_staging(self):
        head = self.git("rev-parse", "HEAD")
        add_artifact(self.journal, "a_nodigest", "voice-b", "voice-b.md", None, "session_codex",
                     attached_at="2026-10-08T21:00:10.000Z")
        self.assertIn("without a sha256", self.integrate()["reason"])
        add_artifact(self.journal, "artifact_b", "voice-b", "voice-b.md", self.digest, "session_codex",
                     attached_at="2026-10-08T21:00:20.000Z")
        (self.repo / "voice-b.md").write_bytes(b"edited after attaching\n")
        mismatch = self.integrate()
        self.assertEqual(mismatch["status"], "refused")
        self.assertIn("voice-b.md differs", mismatch["reason"])
        (self.repo / "voice-b.md").unlink()
        self.assertIn("missing or not a regular file", self.integrate()["reason"])
        (self.base / "outside.md").write_bytes(self.data)
        (self.repo / "voice-b.md").symlink_to(self.base / "outside.md")
        self.assertEqual(self.integrate()["status"], "refused")
        (self.repo / "voice-b.md").unlink()
        (self.repo / "voice-b.md").write_bytes(self.data)
        self.assert_untouched(head)
        (self.repo / "README.md").write_text("staged by someone else\n")
        self.git("add", "README.md")
        staged = self.integrate()
        self.assertEqual(staged["status"], "refused")
        self.assertIn("staged", staged["reason"])
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertEqual(self.git("diff", "--cached", "--name-only").split(), ["README.md"])

    def test_skips_artifacts_from_other_jobs_scopes_kinds_or_worktrees(self):
        with contextlib.closing(sqlite3.connect(self.journal)) as db:
            db.execute("INSERT INTO worktrees (id, workspace_id, root_path) VALUES ('wt_other', 'ws_test', ?)",
                       (str(self.base / "elsewhere"),))
            db.commit()
        add_session(self.journal, "session_other_job", "Codex · sol job 20261008T205907-4d9ccbcd455e",
                    joined_at="2026-10-08T21:00:06.000Z")
        add_session(self.journal, "session_earlier", self.label, joined_at="2026-10-08T20:59:00.000Z")
        add_session(self.journal, "session_elsewhere", self.label, joined_at="2026-10-08T21:00:07.000Z",
                    worktree_id="wt_other")
        outside = self.base / "outside-notes"
        outside.mkdir()
        (outside / "escape.md").write_bytes(self.data)
        (self.repo / "notes").symlink_to(outside, target_is_directory=True)
        add_artifact(self.journal, "a1", "voice-b", "voice-b.md", self.digest, "session_other_job")
        add_artifact(self.journal, "a2", "voice-b", "voice-b.md", self.digest, "session_earlier")
        add_artifact(self.journal, "a3", "voice-b", "voice-b.md", self.digest, "session_elsewhere")
        add_artifact(self.journal, "a4", "voice-b", "README.md", None, "session_codex")
        add_artifact(self.journal, "a5", "voice-b", "../outside.md", self.digest, "session_codex")
        add_artifact(self.journal, "a6", "voice-b", "voice-b.md", self.digest, "session_codex", kind="test")
        add_artifact(self.journal, "a7", "voice-b", "notes/escape.md", self.digest, "session_codex")
        add_artifact(self.journal, "a8", "voice-b", ".git/config", self.digest, "session_codex")
        head = self.git("rev-parse", "HEAD")
        result = self.integrate()
        self.assertEqual(result["status"], "skipped", result)
        self.assert_untouched(head)

    def test_failing_hook_unstages_and_reports(self):
        add_artifact(self.journal, "artifact_b", "voice-b", "voice-b.md", self.digest, "session_codex")
        head = self.git("rev-parse", "HEAD")
        self.hook("echo 'doorman says no' >&2; exit 1")
        result = self.integrate()
        self.assertEqual(result["status"], "refused")
        self.assertIn("doorman says no", result["reason"])
        self.assertIn("unstaged", result["reason"])
        self.assert_untouched(head)

    def test_hanging_hook_is_stopped_and_unstaged(self):
        add_artifact(self.journal, "artifact_b", "voice-b", "voice-b.md", self.digest, "session_codex")
        head = self.git("rev-parse", "HEAD")
        marker = self.base / "hook.pid"
        self.hook(f"echo $$ > '{marker}'; sleep 30")
        with patch.object(jobs, "COMMIT_TIMEOUT", 1):
            before = time.monotonic()
            result = self.integrate()
        self.assertLess(time.monotonic() - before, 10)
        self.assertEqual(result["status"], "refused", result)
        self.assertIn("timed out", result["reason"])
        self.assertIn("unstaged", result["reason"])
        self.assert_untouched(head)
        hook_pid = int(marker.read_text())
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and JobTests.live_process(hook_pid):
            time.sleep(0.05)
        self.assertFalse(JobTests.live_process(hook_pid), "The hanging hook outlived its commit")

    def test_worker_gate_skips_review_or_unfinished_jobs(self):
        add_artifact(self.journal, "artifact_b", "voice-b", "voice-b.md", self.digest, "session_codex")
        head = self.git("rev-parse", "HEAD")
        request = {"cwd": str(self.repo), "runtime": "codex", "collab_journal_path": str(self.journal)}
        for mode, state in (("review", "completed"), ("edit", "failed"), ("edit", "blocked"),
                            ("edit", "cancelled"), ("edit", "timed_out")):
            with self.subTest(mode=mode, state=state):
                result = jobs.integration_outcome(self.job_id, {**request, "mode": mode}, {"state": state},
                                                  self.started)
                self.assertEqual(result["status"], "skipped", result)
        self.assert_untouched(head)
        result = jobs.integration_outcome(self.job_id, {**request, "mode": "edit"}, {"state": "completed"},
                                          self.started)
        self.assertEqual(result["status"], "committed", result)

    def test_never_raises_on_bad_input(self):
        with contextlib.closing(sqlite3.connect(self.journal)) as db:
            db.execute("UPDATE tasks SET path_scopes_json = 'not json' WHERE id = 'voice-b'")
            db.commit()
        add_artifact(self.journal, "artifact_b", "voice-b", "voice-b.md", self.digest, "session_codex")
        self.assertEqual(self.integrate()["status"], "refused")
        plain = self.base / "not-a-repo"
        plain.mkdir()
        self.assertEqual(jobs.integrate_commit(self.job_id, str(plain), self.started, "codex",
                                               journal_path=str(self.journal))["status"], "refused")
        self.assertEqual(jobs.integrate_commit(self.job_id, str(self.repo), self.started, "codex",
                                               journal_path=str(self.base / "absent.sqlite"))["status"], "skipped")
```
Directly before `if __name__ == "__main__":`, add (two blank lines on each side):
```python
class CliStartTests(unittest.TestCase):
    def test_start_passes_integrate_commit_flag(self):
        cli_spec = importlib.util.spec_from_file_location("sol_cli_start_tested", SOURCE.with_name("cli.py"))
        cli = importlib.util.module_from_spec(cli_spec)
        cli_spec.loader.exec_module(cli)
        calls = []

        def start_job(*args, **kw):
            calls.append((args, kw))
            return {"id": "20261008T210000-0123456789ab", "runtime": "codex", "state": "queued"}

        fake_jobs = types.SimpleNamespace(start_job=start_job)
        base = ["start", "codex", "--cwd", "/tmp/project", "--prompt-file", "/tmp/task.txt", "--json"]
        with patch.object(cli, "module", return_value=fake_jobs), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(base + ["--mode", "edit", "--integrate-commit"]), 0)
            self.assertEqual(cli.main(base), 0)
        self.assertEqual([kw["integrate_commit"] for _, kw in calls], [True, False])
```

- [ ] **Step 2: Run test to verify it fails**
```sh
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_jobs.py 2>&1 | grep -E "Error:|^FAILED|^OK|SystemExit" | sed -E 's/ \(mode=.*//' | sort | uniq -c
```
Expected: 12 new tests and `FAILED (errors=17)`; every Task 2 and pre-existing test still passes. The causes:
- `AttributeError: module 'sol_jobs_tested' has no attribute 'integrate_commit'` (×6) and `... 'integration_outcome'` (×6, five of them subtests)
- `AttributeError: ... does not have the attribute 'COMMIT_TIMEOUT'` (×1, from `patch.object`)
- `TypeError: start_job() got an unexpected keyword argument 'integrate_commit'` (×1)
- `KeyError: 'integration_commit'` (×2, the worker tests)
- `CliStartTests` erroring with `SystemExit: 2` (argparse: `unrecognized arguments: --integrate-commit`)

- [ ] **Step 3: Write minimal implementation**

In the `jobs.py` module imports, add `import hashlib` directly after `from datetime import datetime, timezone`, and `import urllib.parse` directly after `import time`.

Directly after the `SESSION_STATUS = ...` constant (Task 2), add:
```python
# File artifacts attached in this work tree by sessions that joined after the
# worker started; the job label is matched in Python (delegated_rows).
INTEGRATION_ARTIFACTS = """
SELECT a.task_id, a.uri, a.sha256, a.attached_by_session_id AS session_id, s.actor, t.title,
       t.path_scopes_json
FROM artifacts a
JOIN coordination_sessions s ON s.id = a.attached_by_session_id
JOIN worktrees w ON w.id = s.worktree_id
JOIN tasks t ON t.workspace_id = a.workspace_id AND t.id = a.task_id
WHERE a.kind = 'file' AND julianday(s.joined_at) >= julianday(?) AND w.root_path = ?
ORDER BY julianday(a.attached_at), a.id
"""
GIT_TIMEOUT = 30
COMMIT_TIMEOUT = 120  # Repository hooks run; integration never passes --no-verify.
```
After `collab_exit_sweep()` (which ends with `return report`) and before `def start_job`, add (two blank lines on each side):
```python
def integration_answer(status, reason, paths=(), commit=None):
    return {"status": status, "commit": commit, "paths": sorted(paths), "reason": reason}


def repo_relative(uri, root):
    """Repository-relative POSIX path of a file artifact URI, or None outside the work tree."""
    if uri.startswith("file://"):
        parsed = urllib.parse.urlparse(uri)
        if parsed.netloc not in {"", "localhost"}:
            return None
        candidate = Path(urllib.parse.unquote(parsed.path))
    else:
        candidate = Path(uri)
    if "\x00" in str(candidate) or candidate.name in {"", ".", ".."}:
        return None
    candidate = candidate if candidate.is_absolute() else root / candidate
    # Resolve directories only: a symlinked file itself is refused when hashed.
    resolved = Path(os.path.realpath(candidate.parent)) / candidate.name
    try:
        relative = resolved.relative_to(root).as_posix()
    except ValueError:
        return None
    return None if relative == ".git" or relative.startswith(".git/") else relative


def in_scope(relative, scopes):
    return any(relative == scope or relative.startswith(scope + "/") for scope in scopes)


def file_sha256(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Not a regular file")
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run_git(root, *args, input_text="", timeout=GIT_TIMEOUT):
    """git with a bounded wall time. On timeout its whole process group (git and any
    hook it started) gets SIGTERM, so git removes its own index.lock, then SIGKILL."""
    process = subprocess.Popen(["git", "--literal-pathspecs", "-C", str(root), *args],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=environment(), cwd="/", start_new_session=True)
    try:
        stdout, stderr = process.communicate(input_text, timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            stop_group(process)
        except (OSError, subprocess.TimeoutExpired):
            pass
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()
        raise
    return subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)


def integrate_commit(job_id: str, project: str, started_at: str, runtime: str, *,
                     journal_path: str | None = None) -> dict:
    """Commit this job's attached file artifacts only when every digest matches.

    Never pushes and never raises: any unexpected failure is a refusal.
    """
    try:
        return _integrate_commit(job_id, project, started_at, runtime, journal_path)
    except Exception as exc:
        return integration_answer("refused", f"Integration stopped ({type(exc).__name__}); "
                                             "check git status before retrying")


def _integrate_commit(job_id, project, started_at, runtime, journal_path):
    if not JOB_ID.fullmatch(job_id) or not re.fullmatch(r"[a-z][a-z0-9-]*", runtime):
        return integration_answer("refused", "Invalid job or runtime identifier")
    top = run_git(Path(project), "rev-parse", "--show-toplevel")
    if top.returncode:
        return integration_answer("refused", "The project is not a git work tree")
    root = Path(top.stdout.strip()).resolve()
    journal = Path(os.path.abspath(collab_journal_path() if journal_path is None else journal_path))
    if not journal.is_file():
        return integration_answer("skipped", "No Collab journal, so no attached files to integrate")
    try:
        rows = delegated_rows(read_journal(journal, INTEGRATION_ARTIFACTS, (started_at, str(root))), job_id)
    except (sqlite3.Error, ValueError) as exc:
        return integration_answer("refused", f"The Collab journal is unreadable ({type(exc).__name__})")
    latest = {}
    for row in rows:  # Ordered by attachment time: the newest attachment of a path wins.
        relative = repo_relative(row["uri"], root)
        if relative and in_scope(relative, json.loads(row["path_scopes_json"])):
            latest[relative] = row
    if not latest:
        return integration_answer("skipped", "This job's sessions attached no file artifact inside its "
                                             "task's path scopes")
    paths = sorted(latest)
    tasks = {row["task_id"] for row in latest.values()}
    if len(tasks) != 1:
        return integration_answer("refused", "The attached files span several tasks; integrate them by hand",
                                  paths)
    for relative in paths:
        if not latest[relative]["sha256"]:
            return integration_answer("refused", f"{relative} was attached without a sha256 digest", paths)
        try:
            actual = file_sha256(root / relative)
        except (OSError, ValueError):
            return integration_answer("refused", f"{relative} is missing or not a regular file", paths)
        if actual != latest[relative]["sha256"]:
            return integration_answer("refused", f"{relative} differs from its attached artifact digest", paths)
    staged = run_git(root, "diff", "--cached", "--name-only", "-z")
    if staged.returncode or staged.stdout:
        return integration_answer("refused", "Other changes are already staged; nothing was committed", paths)
    [task_id] = tasks
    title = " ".join(str(latest[paths[0]]["title"]).split())
    sessions = sorted({row["session_id"] for row in latest.values()})
    message = (f"{task_id}: {title}\n\n"
               f"Integrated by sol job {job_id} after a completed {runtime} edit-mode run.\n"
               f"Collab session: {', '.join(sessions)}\n"
               + "".join(f"{relative} sha256:{latest[relative]['sha256']}\n" for relative in paths))
    step, done = "git add", None
    try:
        done = run_git(root, "add", "--", *paths)
        if done.returncode == 0:
            if not run_git(root, "diff", "--cached", "--name-only", "-z").stdout:
                return integration_answer("skipped", "The attached files already match HEAD", paths)
            step = "git commit"
            done = run_git(root, "commit", "--only", f"--author={runtime} <{runtime}@sol.local>",
                           "-F", "-", "--", *paths, input_text=message, timeout=COMMIT_TIMEOUT)
    except subprocess.TimeoutExpired:
        done = None
    if done is not None and done.returncode == 0:
        return integration_answer("committed", "", paths, run_git(root, "rev-parse", "HEAD").stdout.strip())
    detail = "timed out" if done is None else (done.stderr or done.stdout).strip()[-300:]
    try:
        run_git(root, "reset", "-q", "--", *paths)
        unstaged = not run_git(root, "diff", "--cached", "--name-only", "-z").stdout
    except subprocess.TimeoutExpired:
        unstaged = False
    cleanup = "the files were unstaged" if unstaged else "the files may still be staged; check git status"
    return integration_answer("refused", f"{step} failed and {cleanup}: {detail}", paths)


def integration_outcome(job_id, request, outcome, started):
    """The worker's opt-in step: it runs only after a completed edit-mode job."""
    if request.get("mode") != "edit" or outcome.get("state") != "completed":
        return integration_answer("skipped", "Integration runs only after a completed edit-mode job")
    return integrate_commit(job_id, request["cwd"], started, request["runtime"],
                            journal_path=request.get("collab_journal_path"))
```
In `start_job()`:
1. Change the signature to:
```python
def start_job(runtime_id, cwd, prompt_file, mode="review", timeout=900,
              root=DEFAULT_ROOT, registry_path=None, output_limit=MAX_OUTPUT, integrate_commit=False):
```
2. Directly after `raise ValueError("Invalid time or output limit")`, add:
```python
    if integrate_commit and mode != "edit":
        raise ValueError("--integrate-commit requires --mode edit")
```
3. Directly after the `preface = (...)` assignment from Task 2 (it ends with `"ends any session with this label that is still active.\n\n")`), add:
```python
    if integrate_commit:
        preface += ("Sol makes the integration commit after this job completes: attach each file you "
                    "deliver as a Collab `file` artifact with its sha256 inside the task's path_scopes, "
                    "and do not commit or stage anything yourself.\n\n")
```
4. In the `request = {...}` literal, replace `"prompt_transport": row.get("prompt_transport", "stdin")}` with:
```python
               "prompt_transport": row.get("prompt_transport", "stdin"),
               "integrate_commit": bool(integrate_commit)}
```
In `result()`, change the key tuple to `("result", "reason", "error_type", "collab_sweep", "integration_commit")`.

In `worker()`'s final `finally` block, insert this between the Task 2 sweep `try/except` and `atomic_json(folder / "result.json", ...)`, at the same indentation as that `try`:
```python
            try:
                if request.get("integrate_commit") is True:
                    # Hooks may take a while: restart the 30-second stale-heartbeat clock first.
                    atomic_json(folder / "state.json", {**state, "updated_at": utc(), "heartbeat_epoch": time.time()})
                    outcome["integration_commit"] = integration_outcome(job_id, request, outcome, started)
            except BaseException as exc:
                outcome["integration_commit"] = integration_answer(
                    "refused", f"Integration stopped ({type(exc).__name__})")
```
In `cli.py` `parser()`, directly after `p.add_argument("--timeout", type=int, default=900)`, add:
```python
            p.add_argument("--integrate-commit", action="store_true",
                           help="After a completed edit job, commit its digest-verified Collab file artifacts")
```
and in `main()` replace `data = jobs.start_job(args.runtime, args.cwd, args.prompt_file, args.mode, args.timeout)` with:
```python
                data = jobs.start_job(args.runtime, args.cwd, args.prompt_file, args.mode, args.timeout,
                                      integrate_commit=args.integrate_commit)
```

- [ ] **Step 4: Run test to verify it passes**
```sh
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_jobs.py       # OK; 12 more tests than before this task (29 -> 41), about 15-20 s
/opt/homebrew/bin/python3 -B test_runtimes.py                              # OK
/opt/homebrew/bin/python3 -I -B cli.py start --help | grep -A1 -- --integrate-commit
pgrep -f "^sleep 30$" || echo "no hook left running"
sqlite3 -readonly ~/.local/share/agenttool/collab.sqlite "SELECT count(*) FROM artifacts a JOIN coordination_sessions s ON s.id = a.attached_by_session_id JOIN worktrees w ON w.id = s.worktree_id JOIN tasks t ON t.workspace_id = a.workspace_id AND t.id = a.task_id WHERE a.kind = 'file' AND julianday(s.joined_at) >= julianday('2026-10-08T00:00:00+00:00') AND w.root_path = '/nonexistent';"
```
The `pgrep` line confirms the hanging-hook test left no hook process. The last command checks `INTEGRATION_ARTIFACTS` against the live schema, read-only; expected output is `0`.

- [ ] **Step 5: Record the change (CHANGELOG entry instead of a commit)**
```sh
/opt/homebrew/bin/python3 -I -B - <<'EOF'
import hashlib, json, os
from pathlib import Path
sol = Path.home() / ".config/sol"
changelog, crosswalk = sol / "CHANGELOG.md", sol / "home/XENIA-CROSSWALK.json"
bullet = ("- Added opt-in `sol agent start --integrate-commit` (edit mode only). After a\n"
          "  completed job, Sol commits the job's Collab file artifacts when every digest\n"
          "  matches and nothing else is staged; the runtime is the author, the host the\n"
          "  committer, repository hooks run under a time limit, and Sol never pushes.\n"
          "  Reported as `integration_commit`.")
text = changelog.read_text(encoding="utf-8")
anchor = "\n\n## 1.7.0 — 2026-09-27\n"
assert text.count(anchor) == 1 and "## Unreleased — 2026-10-08" in text and bullet not in text
changelog.write_text(text.replace(anchor, "\n" + bullet + anchor), encoding="utf-8")
record = json.loads(crosswalk.read_text(encoding="utf-8"))
old = next(a["sha256"] for a in record["artifacts"] if a["id"] == "sol-changelog")
new = "sha256:" + hashlib.sha256(changelog.read_bytes()).hexdigest()
raw = crosswalk.read_text(encoding="utf-8")
assert raw.count(old) == 1
temporary = crosswalk.with_name(".XENIA-CROSSWALK.json.tmp")
temporary.write_text(raw.replace(old, new), encoding="utf-8")
os.chmod(temporary, 0o600)
os.replace(temporary, crosswalk)
print("sol-changelog", old, "->", new)
EOF
~/.config/sol/bin/sol-doctor | grep -E "^FAIL|Hearth crosswalk evidence bytes"
```
Expected: only the `PASS  Hearth crosswalk evidence bytes ...` line.

---

### Task 4: Codex approvals for the lease lifecycle (+ read-only 0.5.0 decision)

**Files:**
- Backup: `~/.codex/config.toml` → `~/.config/sol/agents/.backup-20261008/codex-config.toml` (mode 600, regular file), plus the CHANGELOG and crosswalk snapshots
- Create: `~/.config/sol/agents/check_codex_collab.py` (the test)
- Modify: `~/.codex/config.toml`, the comment above the `agenttool-collab` tool blocks (2026-10-08 lines 126-128), and new blocks after the `collab_session_end` block (2026-10-08 lines 159-160)
- Record: `~/.config/sol/CHANGELOG.md`, crosswalk `sol-changelog` digest

**Interfaces:**
- Consumes:
  - the `[plugins."agenttool-collab@personal".mcp_servers.agenttool-collab]` table, which has `default_tools_approval_mode = "writes"` and 11 per-tool `approval_mode = "approve"` blocks
  - tool names from `packages/collab/src/mcp.ts`
  - the read-only annotations for `collab_events_wait` and `collab_anchor_status`, asserted in `tests/mcp.test.ts:186-260`
  - Plan A Task 10 has installed Collab 0.5.0 into the Codex plugin cache (needed only for option A)
- Produces:
  - approvals for `collab_task_renew`, `collab_task_progress`, `collab_task_release`, `collab_task_block` and `collab_task_unblock`
  - the recorded decision on the read-only 0.5.0 tools: with option A (default), approvals for `collab_events_wait` and `collab_anchor_status`
  - recover, cursor reset, handoff, decision and presence keep prompting

- [ ] **Step 1: Write the failing test**

Snapshot first:
```sh
B=~/.config/sol/agents/.backup-20261008
mkdir -p -m 700 "$B"
[ -e "$B/codex-config.toml" ] || cp -p ~/.codex/config.toml "$B/codex-config.toml"
for f in ~/.config/sol/CHANGELOG.md ~/.config/sol/home/XENIA-CROSSWALK.json; do
  [ -e "$B/$(basename "$f")" ] || cp -p "$f" "$B/"
done
ls -l "$B"
```
Create `~/.config/sol/agents/check_codex_collab.py` with this content, then run `chmod 600` on it:
```python
"""Assert headless Codex's Collab approvals: lease lifecycle approved, risky tools still prompt."""
import sys
import tomllib
from pathlib import Path

LIFECYCLE = ["collab_task_renew", "collab_task_progress", "collab_task_release",
             "collab_task_block", "collab_task_unblock"]
LOOP = ["collab_session_start", "collab_next", "collab_cursor_ack", "collab_task_get",
        "collab_task_list", "collab_task_review", "collab_task_claim", "collab_artifact_attach",
        "collab_task_complete", "collab_report_append", "collab_session_end"]
READ_ONLY_050 = ["collab_events_wait", "collab_anchor_status"]
STILL_PROMPT = ["collab_task_recover", "collab_cursor_reset", "collab_handoff_offer",
                "collab_handoff_respond", "collab_decision_record", "collab_session_join",
                "collab_session_list", "collab_session_heartbeat", "collab_session_leave"]

config = tomllib.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
server = config["plugins"]["agenttool-collab@personal"]["mcp_servers"]["agenttool-collab"]
tools = server.get("tools", {})
approved = {name for name, row in tools.items() if row.get("approval_mode") == "approve"}
expected = set(LIFECYCLE + LOOP) | (set(READ_ONLY_050) if "--read-only-approved" in sys.argv else set())
problems = []
if server.get("default_tools_approval_mode") != "writes":
    problems.append("default_tools_approval_mode changed")
problems += [f"missing approve: {name}" for name in sorted(expected - approved)]
problems += [f"must still prompt: {name}" for name in sorted(approved & set(STILL_PROMPT))]
if "--read-only-approved" not in sys.argv:
    problems += [f"undecided read-only tool approved: {name}" for name in sorted(approved & set(READ_ONLY_050))]
print("\n".join(problems) or f"ok: {len(approved)} approved Collab tools")
sys.exit(1 if problems else 0)
```

- [ ] **Step 2: Run test to verify it fails**
```sh
/opt/homebrew/bin/python3 -I -B ~/.config/sol/agents/check_codex_collab.py ~/.codex/config.toml; echo "rc=$?"
```
Expected:
```
missing approve: collab_task_block
missing approve: collab_task_progress
missing approve: collab_task_release
missing approve: collab_task_renew
missing approve: collab_task_unblock
rc=1
```
(With `--read-only-approved`, the output also lists `collab_anchor_status` and `collab_events_wait` first.)

- [ ] **Step 3: Write minimal implementation**

3a. Approve the lease lifecycle and update the comment. The edit is atomic, preserves mode 600, and asserts its anchors. Run it while no Codex session is rewriting `config.toml`.
```sh
/opt/homebrew/bin/python3 -I -B - <<'EOF'
import os, stat
from pathlib import Path
config = Path.home() / ".codex/config.toml"
text = config.read_text(encoding="utf-8")
old_comment = ("# 2026-10-08 Yu chose to let headless Codex take part in Collab (collab-duet trial).\n"
               "# Scoped to the ordinary participate/review loop; recover, cursor reset, handoff,\n"
               "# decision and presence tools still prompt.\n")
new_comment = ("# 2026-10-08 Yu chose to let headless Codex take part in Collab (collab-duet trial).\n"
               "# Scoped to the ordinary participate/review loop plus the lease lifecycle (renew,\n"
               "# progress, release, block, unblock), so a headless job can always put down a\n"
               "# lease it holds; recover, cursor reset, handoff, decision and presence tools\n"
               "# still prompt.\n")
prefix = '[plugins."agenttool-collab@personal".mcp_servers.agenttool-collab.tools.'
anchor = prefix + 'collab_session_end]\napproval_mode = "approve"\n'
assert text.count(old_comment) == 1 and text.count(anchor) == 1
assert prefix + "collab_task_renew]" not in text
blocks = "".join(f'\n{prefix}{name}]\napproval_mode = "approve"\n' for name in (
    "collab_task_renew", "collab_task_progress", "collab_task_release",
    "collab_task_block", "collab_task_unblock"))
updated = text.replace(old_comment, new_comment).replace(anchor, anchor + blocks)
mode = stat.S_IMODE(config.stat().st_mode)
temporary = config.with_name("." + config.name + ".sol-tmp")
temporary.write_text(updated, encoding="utf-8")
os.chmod(temporary, mode)
os.replace(temporary, config)
print("approved lease lifecycle tools")
EOF
```
3b. **Decision: the read-only 0.5.0 tools `collab_events_wait` and `collab_anchor_status`.**

They appear only after Plan A Task 10 installs 0.5.0 over the 0.3.1 copies (31 to 33 tools). Both are annotated `readOnlyHint: true`. Check first that the Codex plugin cache has the 0.5.0 copy:
```sh
ls ~/.codex/plugins/cache/personal/agenttool-collab/      # expect a 0.5.0+codex.<stamp> directory
```
- **Option A (default; apply if Yu has not chosen otherwise and the 0.5.0 copy is present): approve both.** They only observe the journal, and an unapproved tool is refused under `-a never` (F9). It is unverified whether `default_tools_approval_mode = "writes"` already auto-approves read-only tools in headless runs; approving them explicitly removes the doubt.
- **Option B: leave them prompting.** A headless job that calls them gets a refusal, and the replay must not use them. Skip the block below, verify without `--read-only-approved` in Step 4, use the option B bullet in Step 5, and drop that flag from the README command in Task 5.

Option A edit:
```sh
/opt/homebrew/bin/python3 -I -B - <<'EOF'
import os, stat
from pathlib import Path
config = Path.home() / ".codex/config.toml"
text = config.read_text(encoding="utf-8")
prefix = '[plugins."agenttool-collab@personal".mcp_servers.agenttool-collab.tools.'
anchor = prefix + 'collab_task_unblock]\napproval_mode = "approve"\n'
assert text.count(anchor) == 1 and prefix + "collab_events_wait]" not in text
blocks = ("\n# Read-only Collab 0.5.0 observation tools (annotated readOnlyHint), approved as\n"
          "# the household-smoothing plan's default decision so a headless job can wait on\n"
          "# events and check anchors.\n"
          + "".join(f'{prefix}{name}]\napproval_mode = "approve"\n\n'
                    for name in ("collab_events_wait", "collab_anchor_status"))).rstrip("\n") + "\n"
updated = text.replace(anchor, anchor + blocks)
mode = stat.S_IMODE(config.stat().st_mode)
temporary = config.with_name("." + config.name + ".sol-tmp")
temporary.write_text(updated, encoding="utf-8")
os.chmod(temporary, mode)
os.replace(temporary, config)
print("approved read-only 0.5.0 tools")
EOF
```

- [ ] **Step 4: Run test to verify it passes**
```sh
/opt/homebrew/bin/python3 -I -B ~/.config/sol/agents/check_codex_collab.py ~/.codex/config.toml --read-only-approved; echo "rc=$?"
#   option A: "ok: 18 approved Collab tools" rc=0
/opt/homebrew/bin/python3 -I -B ~/.config/sol/agents/check_codex_collab.py ~/.codex/config.toml; echo "rc=$?"
#   option B: "ok: 16 approved Collab tools" rc=0   (with option A this prints "undecided read-only tool approved: ..." rc=1, as designed)
stat -f %Lp ~/.codex/config.toml   # 600
(cd /tmp && ~/.local/bin/codex mcp list --json) | /opt/homebrew/bin/python3 -I -B -c 'import json,sys; print([(r["name"], r["enabled"]) for r in json.load(sys.stdin) if r["name"] == "agenttool-collab"])'
#   [('agenttool-collab', True)]
```
The check parses the full file with `tomllib`, so a TOML syntax error fails it. The last command shows that Codex itself still loads the edited config; it prints only the server name and its enabled flag, never the server's command or environment. No model is called.

- [ ] **Step 5: Record the change (CHANGELOG entry instead of a commit)**

With option B, replace `bullet` with the option B text given in the comment.
```sh
/opt/homebrew/bin/python3 -I -B - <<'EOF'
import hashlib, json, os
from pathlib import Path
sol = Path.home() / ".config/sol"
changelog, crosswalk = sol / "CHANGELOG.md", sol / "home/XENIA-CROSSWALK.json"
bullet = ("- Headless Codex may call the Collab lease lifecycle (renew, progress, release,\n"
          "  block, unblock) and the read-only 0.5.0 tools `collab_events_wait` and\n"
          "  `collab_anchor_status` without a prompt; recover, cursor reset, handoff,\n"
          "  decision and presence still prompt. Added `agents/check_codex_collab.py`.")
# Option B bullet: ("- Headless Codex may call the Collab lease lifecycle (renew, progress,\n"
#                   "  release, block, unblock) without a prompt; the read-only 0.5.0 tools, recover,\n"
#                   "  cursor reset, handoff, decision and presence still prompt. Added\n"
#                   "  `agents/check_codex_collab.py`.")
text = changelog.read_text(encoding="utf-8")
anchor = "\n\n## 1.7.0 — 2026-09-27\n"
assert text.count(anchor) == 1 and "## Unreleased — 2026-10-08" in text and bullet not in text
changelog.write_text(text.replace(anchor, "\n" + bullet + anchor), encoding="utf-8")
record = json.loads(crosswalk.read_text(encoding="utf-8"))
old = next(a["sha256"] for a in record["artifacts"] if a["id"] == "sol-changelog")
new = "sha256:" + hashlib.sha256(changelog.read_bytes()).hexdigest()
raw = crosswalk.read_text(encoding="utf-8")
assert raw.count(old) == 1
temporary = crosswalk.with_name(".XENIA-CROSSWALK.json.tmp")
temporary.write_text(raw.replace(old, new), encoding="utf-8")
os.chmod(temporary, 0o600)
os.replace(temporary, crosswalk)
print("sol-changelog", old, "->", new)
EOF
~/.config/sol/bin/sol-doctor | grep -E "^FAIL|Hearth crosswalk evidence bytes"
```
Expected: only the `PASS  Hearth crosswalk evidence bytes ...` line.

---

### Task 5: README — delegation convention, exit sweep, `--integrate-commit`, read-only review

**Files:**
- Backup: `README.md` and `test_runtimes.py` in `~/.config/sol/agents/`; files already backed up are left untouched
- Modify `~/.config/sol/agents/README.md`:
  - a paragraph after the one starting "The default mode is `review`." (2026-09-27 line 31)
  - a new section immediately before `## Verified connections` (2026-09-27 line 54), so the wake-documents paragraph stays under "Shared work and foundations"
  - the maintenance line in "Local maintenance" (2026-09-27 line 77)
- Test: `~/.config/sol/agents/test_runtimes.py`, new class `ReadmeTests` directly before `if __name__ == "__main__":`
- Record: `~/.config/sol/CHANGELOG.md`, crosswalk `sol-changelog` digest

**Interfaces:**
- Consumes: Task 1 (`--ignore-rules`), Task 2 (preface, label, `collab_sweep` with `matched`/`swept`/`errors`), Task 3 (`--integrate-commit`, `integration_commit`, `integrate_commit` in `request.json`), Task 4 (`check_codex_collab.py` and its flag)
- Produces: the documented household contract for agents and strangers

- [ ] **Step 1: Write the failing test**

Snapshot first:
```sh
B=~/.config/sol/agents/.backup-20261008
mkdir -p -m 700 "$B"
for f in ~/.config/sol/agents/README.md ~/.config/sol/agents/test_runtimes.py \
         ~/.config/sol/CHANGELOG.md ~/.config/sol/home/XENIA-CROSSWALK.json; do
  [ -e "$B/$(basename "$f")" ] || cp -p "$f" "$B/"
done
ls -l "$B"
```
In `test_runtimes.py`, add this class directly before `if __name__ == "__main__":` (two blank lines on each side). It uses the module's existing `rt` import and `Path`:
```python
class ReadmeTests(unittest.TestCase):
    def test_readme_documents_the_collab_household_contract(self):
        text = Path(rt.__file__).with_name("README.md").read_text(encoding="utf-8")
        for phrase in ["--ignore-rules", "Sol job ID: JOB_ID.", "· sol job JOB_ID", "parent_session_id",
                       "release_leases: true", "agenttool-collab-host end", "collab_sweep", "`matched`",
                       "--integrate-commit", "integration_commit", "--no-verify", "Sol never pushes",
                       "check_codex_collab.py"]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)
```

- [ ] **Step 2: Run test to verify it fails**
```sh
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_runtimes.py ReadmeTests 2>&1 | grep -E "FAIL:|^Ran|FAILED"
```
Expected: 13 lines of the form `FAIL: test_readme_documents_the_collab_household_contract ... (phrase='--ignore-rules')` (one per phrase), then `FAILED (failures=13)`.

- [ ] **Step 3: Write minimal implementation**

In `README.md`, after the paragraph starting "The default mode is `review`." (it ends "...and a bounded combined output log."), insert a blank line and:
```markdown
Codex review jobs run `codex exec --ignore-rules` inside the read-only sandbox. User and project exec-policy `.rules` files are not loaded, so no allow rule can run a command outside the sandbox without a prompt. Codex edit jobs and `sol agent open codex` still load those rules; the interactive client does not accept the flag.
```
Insert this section immediately before `## Verified connections`, after the wake-documents paragraph, so that paragraph stays under "Shared work and foundations":
````markdown
## Collab work through a job

A delegated job that joins AgentTool Collab starts its own session. Never hand a job a session credential file: resuming one moves the session and fences out its owner. The job preface states `Sol job ID: JOB_ID.` and tells the native agent:

- end the actor label with `· sol job JOB_ID`, for example `Codex · sol job 20261008T210147-c5e426220993`;
- use the `parent_session_id` the task gives (declared lineage, checked only for existence and workspace);
- before finishing, call `collab_session_end` with `release_leases: true`.

The label and lineage are self-declared and unauthenticated. They route work; they do not prove identity or grant authority.

**Exit sweep.** When a job ends, and before `result.json` is written, the worker reads the Collab journal read-only: `AGENTOOL_COLLAB_DB` if set, else `$XDG_DATA_HOME/agenttool/collab.sqlite`, else `~/.local/share/agenttool/collab.sqlite`, as the MCP server does. Jobs receive a minimal environment, so in practice this is the last path. A session belongs to the job when it joined after the worker started and its actor ends with `sol job JOB_ID` (the dot before it is not compared). For each such session that is still `active`, the worker runs once:

```sh
agenttool-collab-host end --session-file JOURNAL_DIR/collab-sessions/SESSION_ID.json \
  --reason "host exit sweep: job JOB_ID ended STATE" --release-leases --db JOURNAL
```

`sol agent result JOB_ID --json` shows the outcome under `collab_sweep`: `matched` lists the job's sessions with their status after the sweep (ended ones included, so a clean exit still shows the session was found), `swept` holds the host receipts, and `errors` lists failures (`session_file_missing`, `host_cli_not_found`, `host_cli_timeout`, `host_cli_failed`, `sweep_time_exhausted`, `journal_unreadable`, `sweep_failed`, or the host CLI's own error code). The sweep has a 20-second limit, is never retried and never prevents the terminal record. A job whose supervisor was killed records no terminal state and is not swept; Collab's `liveness: "stale"` view shows its sessions.

**Integration commit (opt-in).** Under `workspace-write`, headless Codex can edit files but cannot write `.git`, so it delivers by artifact and Sol commits:

```sh
sol agent start codex --mode edit --integrate-commit --cwd /absolute/project --prompt-file /private/task.txt --json
```

`--integrate-commit` requires `--mode edit` and is recorded as `integrate_commit` in `request.json`. It runs only after a job that completed; any other outcome is reported as `skipped`. Sol then reads the `file` artifacts that this job's sessions attached in this work tree and keeps those whose URI (repository-relative, absolute or `file://`) lies inside the task's `path_scopes`; the newest attachment of each path wins. Sol commits only when every such file is a regular file whose SHA-256 equals its artifact digest, all of them belong to one task, and nothing else is staged. The commit runs `git add -- PATHS`, then `git commit --only --author="RUNTIME <RUNTIME@sol.local>" -- PATHS`, with the message `TASK-ID: TASK TITLE` and a body naming the job, sessions and digests. The committer is the host's git identity; git and its hooks run with the same minimal environment as jobs. Whatever pre-commit hook git resolves for the repository runs; Sol never passes `--no-verify`. A refused or timed-out commit (120 seconds, after which git and its hook are stopped) unstages the paths again. A mismatch, symlink, multi-task delivery or foreign staged change commits nothing. The outcome is listed under `integration_commit` with `status` (`committed`, `skipped` or `refused`), `commit`, `paths` and `reason`. Sol never pushes.

Headless Codex can call only the Collab tools approved in `~/.codex/config.toml`. Check them after a plugin or config change:

```sh
/opt/homebrew/bin/python3 -I -B ~/.config/sol/agents/check_codex_collab.py ~/.codex/config.toml --read-only-approved
```
````
With option B from Task 4, drop `--read-only-approved` from that last command. In "Local maintenance", replace "run the focused `test_*.py` files here, the existing catalog tests," with "run the focused `test_*.py` files here, `check_codex_collab.py`, the existing catalog tests,".

- [ ] **Step 4: Run test to verify it passes**
```sh
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_runtimes.py     # OK; 1 more test than after Task 1 (30 -> 31)
/opt/homebrew/bin/python3 -B test_jobs.py                                    # OK (unchanged by this task)
/opt/homebrew/bin/python3 -I -B check_codex_collab.py ~/.codex/config.toml --read-only-approved   # ok: 18 (option A)
grep -n "^## " README.md   # ... Shared work and foundations / Collab work through a job / Verified connections / Local maintenance
~/.config/sol/bin/sol-doctor | grep -E "^FAIL|shared agent layer|Hearth crosswalk evidence bytes"
```
Expected from the doctor: `PASS  Hearth crosswalk evidence bytes ...` and `PASS  shared agent layer and runtime registry are present (no runtime launched)`, and no FAIL. The baseline may also show `WARN  data volume is under 20GiB free`.

- [ ] **Step 5: Record the change (CHANGELOG entry instead of a commit)**
```sh
/opt/homebrew/bin/python3 -I -B - <<'EOF'
import hashlib, json, os
from pathlib import Path
sol = Path.home() / ".config/sol"
changelog, crosswalk = sol / "CHANGELOG.md", sol / "home/XENIA-CROSSWALK.json"
bullet = ("- Documented the Collab job convention, exit sweep, integration commit and\n"
          "  read-only Codex review mode in `agents/README.md`.")
text = changelog.read_text(encoding="utf-8")
anchor = "\n\n## 1.7.0 — 2026-09-27\n"
assert text.count(anchor) == 1 and "## Unreleased — 2026-10-08" in text and bullet not in text
changelog.write_text(text.replace(anchor, "\n" + bullet + anchor), encoding="utf-8")
record = json.loads(crosswalk.read_text(encoding="utf-8"))
old = next(a["sha256"] for a in record["artifacts"] if a["id"] == "sol-changelog")
new = "sha256:" + hashlib.sha256(changelog.read_bytes()).hexdigest()
raw = crosswalk.read_text(encoding="utf-8")
assert raw.count(old) == 1
temporary = crosswalk.with_name(".XENIA-CROSSWALK.json.tmp")
temporary.write_text(raw.replace(old, new), encoding="utf-8")
os.chmod(temporary, 0o600)
os.replace(temporary, crosswalk)
print("sol-changelog", old, "->", new)
EOF
~/.config/sol/bin/sol-doctor | grep -E "^FAIL|Hearth crosswalk evidence bytes"
head -24 ~/.config/sol/CHANGELOG.md
```
Expected: the `## Unreleased — 2026-10-08 · Collab household smoothing` section with five bullets above `## 1.7.0 — 2026-09-27`, and the crosswalk PASS line.


### Task 6: Finish-line replay — the duet with a live Claude seat and a headless Codex seat

Runs last: after Collab Part 1 is built, installed into both household copies and its PR state is known (Plan A Task 10), and after sol Part 2 items 1–3 and 5 plus Codex config item 4 (Plan B Tasks 1–5). This task changes no sol, Codex or agenttool file. It consumes the job-ID preface that Plan B Task 2 adds (R2), the `result()` keys from Plan B Tasks 2–3 (R3) and the sweep's matched-session report (R16). It writes only a private scratch folder and a new local repo, `~/play/collab-duet-replay`. The PR comment needs Yu's go (R20).

**Files:**
- Create (private, in no repo): in `$REPLAY_DIR`, the path printed by `sol scratch new collab-duet-replay`, create `replay_check.py`, `codex-voice-b.template.txt`, `codex-voice-b.txt`, `check.txt` and, only with Yu's go, `pr-comment.md`. The temporary files `collab-mcp-61f7e66a.js` and `journal-copy.sqlite*` are deleted in Step 2.
- Create: a new git repo `~/play/collab-duet-replay/` containing `README.md` and `voice-a.md` (written by Claude), `voice-b.md` (written by Codex, committed by sol), `REPLAY.md` and a copy of `replay_check.py`.
- Read only: the Collab journal (`collab_journal_path()`, SQLite `mode=ro`), `~/.local/state/sol/agents/jobs/<JOB>/`, `~/.claude/projects/*/*.jsonl`, `~/.codex/config.toml`.
- Not modified: `~/.config/sol/**` (no CHANGELOG bullet, so the `XENIA-CROSSWALK.json` `sol-changelog` digest stays valid), `~/.codex/config.toml`, the agenttool worktree, and `~/play/collab-duet`.

**Interfaces:**
- Consumes (Collab, Plan A):
  - `collab_session_start.parent_session_id` (existing)
  - `collab_task_complete.review_requested_session_id`, which adds an addressed `informs` report `{task_id, from_session_id: reporter, to_session_id: requested}` and the `task.reported_complete` payload field `review_requested_session_id` (Task 4)
  - `collab_task_review.{confidence, confidence_basis, limits}` (Task 2)
  - `collab_session_end.{release_leases, release_summary}`, with output `{session, released_leases, credential_file_removed, session_file_name}` (Task 5)
  - Task projection `{base_checkpoint_digest, result_checkpoint_digest, review_requested_session_id}` and `CoordinationSession.liveness` (Tasks 1, 4, 7)
  - `EVIDENCE_REF_PREFIXES` (`artifact:`, `event:`, `report:`, `checkpoint:`)
  - Bound `collab_next`, which refuses a stray `after_sequence` with `after_sequence_unsupported_in_bound_session`. The prompts never pass it.
  - `collab_journal_verify` → `{workspace_id, chain_valid, verification_scope: "full_journal"}` (existing; needs no bound session)
  - `~/.cache/agenttool/collab-household/household-install-check.ts` (exit 0 = both copies installed and identical; Task 10)
  - The PR for `feat/collab-household-smoothing-20261008` on `cambridgetcg/agenttool`, if Yu allowed it (Task 10 Step 7)
- Consumes (sol, Plan B):
  - The job preface `Sol job ID: <id>. If you start an AgentTool Collab session, end your actor label with '· sol job <id>' and use the parent_session_id given in the task.` (Task 2, R2; `job_id` generated before the preface). This task relies only on the substrings `Sol job ID: <id>` and `· sol job <id>`.
  - Headless Codex edit argv without `--ignore-rules`; only review mode gets it (Task 1)
  - `sol agent start --integrate-commit`, and the `request.json` field `"integrate_commit": true` (Task 3)
  - `result.json` and `sol agent result --json` keys `collab_sweep` and `integration_commit` (Tasks 2–3, R3)
  - `collab_sweep = {"matched": [...], "swept": [...], "errors": [...]}`. `matched` lists the job's sessions that the ASCII suffix `sol job <id>` selected, including ones already ended (R16). Entries are session-id strings or objects with `session_id`. **If Task 2 names this key differently, rename it in `replay_check.py` `check()`.**
  - `integration_commit = {"status": "committed"|"skipped"|"refused", "commit", "paths", "reason"}`, with author `<runtime> <<runtime>@sol.local>` and subject `<task-id>: <task title>` (Task 3)
  - `collab_journal_path()` semantics (R15): `AGENTOOL_COLLAB_DB` if set, even when empty (`??`); else `$XDG_DATA_HOME`, made absolute, or `~/.local/share`; then `agenttool/collab.sqlite`. Credential files live at `dirname(db)/collab-sessions/<id>.json`. The script mirrors `bin/agenttool-collab-mcp.ts:12-21`.
  - `~/.config/sol/agents/check_codex_collab.py ~/.codex/config.toml [--read-only-approved]` (Task 4, R18)
- Produces:
  - `replay_check.py preflight --server LABEL=COMMAND`
  - `replay_check.py check --job <id> [--root] [--db] [--jobs-root] [--claude-transcript auto|PATH] [--live-refusals FILE] [--deliberate TOOL:ERROR]`. It prints one PASS/FAIL line per criterion, then `RESULT: PASS|FAIL`. Exit codes: 0 all pass, 1 any fail, 2 usage.
  - `replay_check.verify_journal(db, workspace_id)`: a read-only Python port of `store.ts` `verifyJournalRows`/`eventHash`. It splices the stored `payload_json`, which `appendEvent` writes as `canonicalJson(payload)`, so it reproduces the JS bytes exactly. It falls back to Python re-serialization only for non-canonical stored text.
  - `codex-voice-b.template.txt` (tokens `__WORKSPACE_ID__`, `__CLAUDE_SESSION_ID__`)
  - The replay record `~/play/collab-duet-replay/REPLAY.md` and, with Yu's go, a PR comment (R20).

Values to record when they first appear. The shell is zsh and its state does not persist between Bash calls, so set them at the top of every Bash block:
- `REPLAY_DIR` (from 1a)
- `WS`, the workspace ID (from L1)
- `CS`, Claude's session ID (from L1)
- `JOB` (from 3d)

- [ ] **Step 0: Check disk space (the disk hit 100% on 2026-10-08)**
```bash
df -h /System/Volumes/Data
```
Stop if less than 2 GB is available. A full disk mid-replay makes journal writes fail, and those failures would be recorded as refused calls.

- [ ] **Step 1: Write the pass-check script (the failing test)**

1a. Create the private replay workspace. `sol scratch new` prints one absolute path, a mode-700 folder; record it as `REPLAY_DIR`.
```bash
sol scratch new collab-duet-replay
```

1b. Write `$REPLAY_DIR/replay_check.py` with exactly this content, then run `chmod 700 "$REPLAY_DIR/replay_check.py"`:
```python
#!/usr/bin/env python3
"""Read-only finish-line check for the Collab duet replay.

Spec: docs/superpowers/specs/2026-10-08-collab-household-smoothing-design.md,
section "Finish line". Two subcommands:

  preflight  Ask each household MCP copy for its tool list (against a throwaway
             journal in a temporary directory) and confirm the smoothing inputs.
  check      Read the real journal (SQLite read-only URI), the replay repository
             (read-only git), the sol job folder and the live Claude transcript,
             then print one PASS/FAIL line per criterion.

Never writes the journal, the repository or the job folder (a read-only SQLite
open may still create the journal's own -wal/-shm companions when no process has
it open). Never opens a collab-sessions credential file (existence is checked by
path only).
Exit status: 0 when every line is PASS, 1 otherwise, 2 on usage errors.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import glob
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
from urllib.parse import quote, unquote, urlparse

GENESIS_HASH = "0" * 64
LEGACY_PROTOCOL = "agenttool.collab/0.1"
COLLAB_SERVER = "agenttool-collab"
CLAUDE_TOOL_PREFIX = "mcp__agenttool-collab__"
DEFAULT_ROOT = Path.home() / "play" / "collab-duet-replay"
DEFAULT_JOBS_ROOT = Path.home() / ".local/state/sol/agents/jobs"
JOB_ID = re.compile(r"^[0-9]{8}T[0-9]{6}-[a-f0-9]{12}$")
TASK_A, TASK_B = "voice-a", "voice-b"
FILE_B = "voice-b.md"
EXPECTED_SERVER_VERSION = "0.5.0"
REQUIRED_INPUTS = {
    "collab_session_end": {"release_leases", "release_summary"},
    "collab_task_complete": {"review_requested_session_id"},
    "collab_task_review": {"confidence", "confidence_basis", "limits"},
}
GIT_TIMEOUT = 20
MCP_TIMEOUT = 20


def collab_journal_path() -> str:
    """Mirror bin/agenttool-collab-mcp.ts: AGENTOOL_COLLAB_DB ?? (XDG_DATA_HOME || ~/.local/share)."""
    explicit = os.environ.get("AGENTOOL_COLLAB_DB")
    if explicit is not None:  # `??`: an empty value is still "set"
        return explicit
    data_home = os.environ.get("XDG_DATA_HOME")
    base = os.path.abspath(data_home) if data_home else os.path.join(Path.home(), ".local", "share")
    return os.path.join(base, "agenttool", "collab.sqlite")


class Report:
    def __init__(self):
        self.rows: list[tuple[str, bool, str]] = []

    def add(self, name: str, ok: bool, detail: str):
        self.rows.append((name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")

    @property
    def passed(self) -> bool:
        return bool(self.rows) and all(ok for _, ok, _ in self.rows)


# ---------------------------------------------------------------- journal reads

def open_journal(path: str) -> sqlite3.Connection:
    if not path or not os.path.isfile(path):
        raise FileNotFoundError(f"journal not found: {path!r}")
    connection = sqlite3.connect(f"file:{quote(os.path.abspath(path))}?mode=ro", uri=True, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def canonical_json(value) -> str:
    # canonical.ts sorts keys; JS also lists integer-like keys first. Used only as a fallback.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def event_hash(row, reserialize: bool = False) -> str:
    """store.ts eventFromRow()/eventHash(). Legacy 0.1 events omit session_id.

    appendEvent stores payload_json = canonicalJson(payload), so splicing the stored
    text reproduces the JS bytes exactly; reserialize=True re-encodes it in Python.
    """
    fields = {
        "actor": row["actor"], "entity_id": row["entity_id"], "epoch_id": row["epoch_id"], "id": row["id"],
        "occurred_at": row["occurred_at"], "prev_hash": row["prev_hash"], "protocol": row["protocol"],
        "sequence": row["sequence"], "type": row["type"], "workspace_id": row["workspace_id"],
    }
    if row["protocol"] != LEGACY_PROTOCOL:
        fields["session_id"] = row["session_id"]
    payload = canonical_json(json.loads(row["payload_json"])) if reserialize else row["payload_json"]
    parts = [json.dumps(key) + ":" + (payload if key == "payload" else json.dumps(fields[key], ensure_ascii=False))
             for key in sorted([*fields, "payload"])]
    return hashlib.sha256(("{" + ",".join(parts) + "}").encode("utf-8")).hexdigest()


def verify_journal(db: sqlite3.Connection, workspace_id: str) -> tuple[bool, str]:
    # store.ts verifyJournalRows(), recomputed read-only.
    workspace = db.execute(
        "SELECT event_head_sequence, event_head_hash FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
    if workspace is None:
        return False, "workspace missing"
    rows = db.execute("""
        SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
               session_id, occurred_at, payload_json, prev_hash, hash
        FROM events WHERE workspace_id = ? ORDER BY sequence""", (workspace_id,)).fetchall()
    previous, expected, reserialized = GENESIS_HASH, 1, 0
    for row in rows:
        if row["sequence"] != expected or row["prev_hash"] != previous:
            return False, f"sequence/link break at {row['sequence']}"
        try:
            if event_hash(row) != row["hash"]:
                if event_hash(row, reserialize=True) != row["hash"]:
                    return False, f"hash mismatch at {row['sequence']}"
                reserialized += 1
        except (ValueError, UnicodeEncodeError) as exc:
            return False, f"event {row['sequence']} not hashable: {type(exc).__name__}"
        previous, expected = row["hash"], expected + 1
    if workspace["event_head_sequence"] != len(rows) or workspace["event_head_hash"] != previous:
        return False, "workspace head does not match the last event"
    note = f" ({reserialized} via re-serialized payload)" if reserialized else ""
    return True, f"chain_valid over {len(rows)} events{note}"


# ---------------------------------------------------------------- refusal scans

def payload_names_remedy(payload) -> bool:
    if not isinstance(payload, dict):
        return False
    remedy = payload.get("remedy")
    prefixes = payload.get("allowed_prefixes")
    return (isinstance(remedy, str) and remedy.strip() != "") or (isinstance(prefixes, list) and len(prefixes) > 0)


def classify(tool: str, payload, host_message: str | None, deliberate: set[str]) -> dict:
    code = payload.get("error") if isinstance(payload, dict) and isinstance(payload.get("error"), str) else "host_refused"
    message = payload.get("message") if isinstance(payload, dict) else host_message
    excused = f"{tool}:{code}" in deliberate and payload_names_remedy(payload)
    return {"tool": tool, "error": code, "message": str(message or "")[:160], "excused": excused}


def codex_refusals(stdout_log: Path, deliberate: set[str]) -> tuple[int, list[dict], list[str]]:
    calls, refusals, problems = 0, [], []
    started, finished = set(), set()
    with open(stdout_log, encoding="utf-8", errors="replace") as stream:
        for line in stream:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            if event.get("type") in {"error", "turn.failed"}:
                problems.append(f"codex {event.get('type')} event")
            item = event.get("item")
            if not isinstance(item, dict) or item.get("type") != "mcp_tool_call" or item.get("server") != COLLAB_SERVER:
                continue
            if event.get("type") == "item.started":
                started.add(item.get("id"))
                continue
            if event.get("type") != "item.completed":
                continue
            finished.add(item.get("id"))
            calls += 1
            result = item.get("result") if isinstance(item.get("result"), dict) else {}
            if item.get("status") == "completed" and not (result.get("is_error") or result.get("isError")):
                continue
            payload = result.get("structured_content") or result.get("structuredContent")
            if payload is None:
                for block in result.get("content") or []:
                    if isinstance(block, dict) and isinstance(block.get("text"), str):
                        try:
                            payload = json.loads(block["text"])
                        except ValueError:
                            pass
                        break
            error = item.get("error") if isinstance(item.get("error"), dict) else {}
            refusals.append(classify(str(item.get("tool")), payload, error.get("message"), deliberate))
    for missing in sorted(i for i in started - finished if i):
        problems.append(f"collab call {missing} started but never completed")
    return calls, refusals, problems


def starts_replay_session(line: str, root: Path) -> bool:
    # Prefilter by substring, then require a real tool_use block for this root.
    if "collab_session_start" not in line or str(root) not in line:
        return False
    try:
        content = (json.loads(line).get("message") or {}).get("content")
    except (ValueError, AttributeError):
        return False
    return isinstance(content, list) and any(
        isinstance(block, dict) and block.get("type") == "tool_use"
        and block.get("name") == CLAUDE_TOOL_PREFIX + "collab_session_start"
        and os.path.realpath((block.get("input") or {}).get("root_path") or "/nonexistent") == str(root)
        for block in content)


def find_claude_transcripts(root: Path, since: datetime) -> list[Path]:
    found = []
    for name in glob.glob(str(Path.home() / ".claude/projects/*/*.jsonl")):
        path = Path(name)
        try:
            if datetime.fromtimestamp(path.stat().st_mtime).astimezone() < since:
                continue
            with open(path, encoding="utf-8", errors="replace") as stream:
                if any(starts_replay_session(line, root) for line in stream):
                    found.append(path)
        except OSError:
            continue
    return found


def result_text(block: dict) -> str:
    raw = block.get("content")
    return raw if isinstance(raw, str) else "".join(
        part.get("text", "") for part in raw or [] if isinstance(part, dict))


def claude_calls(transcript: Path, root: Path, deliberate: set[str]):
    """Collab calls in the window opened by this root's collab_session_start.

    Returns (calls, refusals, problems, last collab_journal_verify payload or None).
    """
    uses: dict[str, str] = {}
    results: dict[str, dict] = {}
    in_window, problems = False, []
    with open(transcript, encoding="utf-8", errors="replace") as stream:
        for line in stream:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            message = entry.get("message") if isinstance(entry, dict) else None
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use" and str(block.get("name", "")).startswith(CLAUDE_TOOL_PREFIX):
                    tool = block["name"][len(CLAUDE_TOOL_PREFIX):]
                    if tool == "collab_session_start":
                        target = (block.get("input") or {}).get("root_path", "")
                        in_window = bool(target) and os.path.realpath(target) == str(root)
                    if in_window:
                        uses[block.get("id")] = tool
                elif block.get("type") == "tool_result" and block.get("tool_use_id") in uses:
                    results[block["tool_use_id"]] = block
    refusals, verified = [], None
    for use_id, tool in uses.items():
        block = results.get(use_id)
        if block is None:
            problems.append(f"{tool} has no recorded result")
            continue
        text = result_text(block)
        try:
            payload = json.loads(text)
        except ValueError:
            payload = None
        if block.get("is_error"):
            refusals.append(classify(tool, payload, text, deliberate))
        elif tool == "collab_journal_verify" and isinstance(payload, dict):
            verified = payload
    return len(uses), refusals, problems, verified


def manual_record(path: Path, deliberate: set[str]):
    record = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for item in record.get("refusals", []):
        payload = {"error": item.get("error"), "message": item.get("message", "")}
        if item.get("remedy_named"):
            payload["remedy"] = "recorded manually"
        rows.append(classify(str(item.get("tool")), payload, None, deliberate))
    verified = record.get("journal_verify") if isinstance(record.get("journal_verify"), dict) else None
    return int(record.get("calls", 0)), rows, [], verified


def refusal_line(report: Report, name: str, calls: int, refusals: list[dict], problems: list[str]):
    counted = [r for r in refusals if not r["excused"]]
    excused = [r for r in refusals if r["excused"]]
    ok = calls > 0 and not counted and not problems
    detail = f"{calls} collab calls, {len(counted)} refused, {len(excused)} deliberate+remedied"
    if calls == 0:
        detail += "; no collab calls found"
    for row in counted + excused:
        detail += f"\n        {'excused' if row['excused'] else 'REFUSED'} {row['tool']} -> {row['error']}: {row['message']}"
    for problem in problems:
        detail += f"\n        {problem}"
    report.add(name, ok, detail)


def verify_line(report: Report, ws: str, verified):
    ok = (isinstance(verified, dict) and verified.get("chain_valid") is True
          and verified.get("verification_scope") == "full_journal" and verified.get("workspace_id") == ws)
    report.add("collab_journal_verify (live seat)", ok,
               "no successful collab_journal_verify result in the window" if verified is None
               else json.dumps(verified)[:200])


# ---------------------------------------------------------------- git (read-only)

def git(root: Path, *args: str, binary: bool = False, check: bool = True):
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    out = subprocess.run(["git", "-C", str(root), *args], capture_output=True, env=env, timeout=GIT_TIMEOUT)
    if not check:
        return out.returncode
    if out.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {out.stderr.decode(errors='replace').strip()[:200]}")
    return out.stdout if binary else out.stdout.decode("utf-8", errors="replace").strip()


def artifact_path(uri: str, root: Path) -> str | None:
    if uri.startswith("file://"):
        parsed = urlparse(uri)
        uri = unquote(parsed.path) if parsed.netloc in {"", "localhost"} else ""
    if not uri:
        return None
    candidate = Path(uri) if os.path.isabs(uri) else root / uri
    try:
        return Path(os.path.normpath(candidate)).relative_to(root).as_posix()
    except ValueError:
        return None


def ids(values) -> set[str]:
    out = set()
    for value in values if isinstance(values, list) else []:
        if isinstance(value, str):
            out.add(value)
        elif isinstance(value, dict) and isinstance(value.get("session_id") or value.get("id"), str):
            out.add(value.get("session_id") or value.get("id"))
    return out


# ---------------------------------------------------------------- check

def check(args) -> int:
    report = Report()
    if not JOB_ID.fullmatch(args.job):
        print(f"invalid sol job id: {args.job!r}", file=sys.stderr)
        return 2
    root = Path(os.path.realpath(os.path.expanduser(args.root)))
    job_dir = Path(os.path.expanduser(args.jobs_root)) / args.job
    deliberate = set(args.deliberate or [])
    db_path = args.db if args.db is not None else collab_journal_path()
    try:
        db = open_journal(db_path)
        workspace = db.execute("SELECT * FROM workspaces WHERE root_path = ?", (str(root),)).fetchone()
    except (OSError, sqlite3.Error) as exc:
        report.add("journal readable", False, f"{type(exc).__name__}: {exc}")
        return 1
    if workspace is None:
        report.add("replay workspace exists", False, f"no workspace with root_path {root} in {db_path}")
        return 1
    ws = workspace["id"]
    print(f"workspace {ws} · journal {db_path} · job {args.job}")
    sessions = [dict(r) for r in db.execute(
        "SELECT id, actor, parent_session_id, status, ended_at FROM coordination_sessions WHERE workspace_id = ?"
        " ORDER BY joined_at, id", (ws,))]
    session_ids = {s["id"] for s in sessions}
    # Select like the exit sweep (ASCII "sol job <id>" suffix); PASS needs the exact U+00B7 label.
    exact_suffix = f"· sol job {args.job}"
    matched = [s for s in sessions if s["actor"].endswith(f"sol job {args.job}")]
    codex_id = matched[0]["id"] if len(matched) == 1 else None
    claude_id = matched[0]["parent_session_id"] if len(matched) == 1 else None
    parent = next((s for s in sessions if s["id"] == claude_id), None)

    # Finish line 2: delegated child session with declared lineage and the exact label.
    report.add("delegated child session",
               len(matched) == 1 and matched[0]["actor"].endswith(exact_suffix)
               and parent is not None and parent["parent_session_id"] is None,
               f"{len(matched)} session(s) ending 'sol job {args.job}': {[s['actor'] for s in matched]}; "
               f"parent_session_id={claude_id} ({'root session in workspace' if parent else 'not in workspace'})")

    # Pass 1: both tasks accepted by a distinct session (+ the seats the finish line names).
    tasks = {r["id"]: dict(r) for r in db.execute(
        "SELECT * FROM tasks WHERE workspace_id = ? AND id IN (?, ?)", (ws, TASK_A, TASK_B))}
    seats = {TASK_A: (claude_id, codex_id), TASK_B: (codex_id, claude_id)}
    for task_id in (TASK_A, TASK_B):
        task = tasks.get(task_id)
        if task is None:
            report.add(f"{task_id} accepted by a distinct session", False, "task missing")
            continue
        review = db.execute("""
            SELECT reviewer_session_id, outcome FROM task_reviews
            WHERE workspace_id = ? AND task_id = ? AND review_generation = ?""",
            (ws, task_id, task["review_generation"])).fetchone()
        distinct = (task["status"] == "completed" and task["review_status"] == "accepted"
                    and task["accepted_by_session_id"] is not None
                    and task["accepted_by_session_id"] != task["reported_by_session_id"]
                    and review is not None and review["outcome"] == "accepted"
                    and review["reviewer_session_id"] == task["accepted_by_session_id"])
        report.add(f"{task_id} accepted by a distinct session", distinct,
                   f"status={task['status']} review={task['review_status']} reported_by={task['reported_by_session_id']} "
                   f"accepted_by={task['accepted_by_session_id']}")
        reporter, reviewer = seats[task_id]
        report.add(f"{task_id} seats", reporter is not None and task["reported_by_session_id"] == reporter
                   and task["accepted_by_session_id"] == reviewer,
                   f"expected reported_by={reporter} accepted_by={reviewer}")

    # Finish line 2/4: requested reviewer stored and routed.
    reported = db.execute("""
        SELECT payload_json FROM events WHERE workspace_id = ? AND type = 'task.reported_complete'
          AND entity_id = ? ORDER BY sequence DESC LIMIT 1""", (ws, TASK_B)).fetchone()
    requested = json.loads(reported["payload_json"]).get("review_requested_session_id") if reported else None
    routed = db.execute("""
        SELECT COUNT(*) FROM reports WHERE workspace_id = ? AND task_id = ? AND from_session_id = ?
          AND to_session_id = ? AND relation = 'informs'""", (ws, TASK_B, codex_id, claude_id)).fetchone()[0]
    report.add("review request routed to Claude", claude_id is not None and requested == claude_id and routed >= 1,
               f"task.reported_complete review_requested_session_id={requested}; addressed informs reports={routed}")

    # Pass 2: every replay session ended (credential files checked by path only, never opened).
    cred_dir = Path(os.path.dirname(os.path.abspath(db_path))) / "collab-sessions"
    open_sessions = [s["id"] for s in sessions if s["status"] != "ended" or not s["ended_at"]]
    lingering = [s["id"] for s in sessions if (cred_dir / f"{s['id']}.json").exists()]
    report.add("every replay session ended", bool(sessions) and not open_sessions and not lingering,
               f"{len(sessions)} session(s); not ended={open_sessions or 'none'}; credential files left={lingering or 'none'}")

    # Pass 3: no live or expired lease held by a replay session.
    marks = ",".join("?" for _ in session_ids) or "''"
    held = [dict(r) for r in db.execute(f"""
        SELECT workspace_id, id, lease_id, lease_expires_at FROM tasks
        WHERE lease_id IS NOT NULL AND (workspace_id = ? OR assignee_session_id IN ({marks}))""",
        (ws, *session_ids))]
    report.add("no live or expired lease held", not held,
               "none" if not held else "; ".join(f"{h['id']} {h['lease_id']} until {h['lease_expires_at']}" for h in held))

    # Pass 4a: journal verify, recomputed read-only with the verifyJournalRows algorithm.
    valid, detail = verify_journal(db, ws)
    report.add("journal chain_valid (read-only recompute)", valid, detail)

    # Job records (read directly; independent of what `sol agent result` echoes).
    try:
        request = json.loads((job_dir / "request.json").read_text(encoding="utf-8"))
        result = json.loads((job_dir / "result.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        report.add("sol job records", False, f"{job_dir}: {exc}")
        print("RESULT: FAIL")
        return 1
    report.add("sol job completed in edit mode with --integrate-commit",
               result.get("state") == "completed" and request.get("mode") == "edit"
               and request.get("integrate_commit") is True and request.get("cwd") == str(root),
               f"state={result.get('state')} mode={request.get('mode')} integrate_commit={request.get('integrate_commit')} cwd={request.get('cwd')}")

    # Finish line 3: the exit sweep matched this job's session and found nothing to clean.
    sweep = result.get("collab_sweep")
    swept_ok = isinstance(sweep, dict) and sweep.get("swept") == [] and sweep.get("errors") == []
    matched_ok = isinstance(sweep, dict) and codex_id is not None and codex_id in ids(sweep.get("matched"))
    report.add("exit sweep matched the session and found nothing to clean", swept_ok and matched_ok,
               f"codex session {'in' if matched_ok else 'NOT in'} collab_sweep.matched; "
               f"collab_sweep={json.dumps(sweep)[:300]}")

    # Finish line 3: the integration commit landed voice-b.md with Codex's bytes.
    integration = result.get("integration_commit") if isinstance(result.get("integration_commit"), dict) else {}
    artifact = None
    for row in db.execute("""
            SELECT uri, sha256 FROM artifacts WHERE workspace_id = ? AND task_id = ? AND kind = 'file'
              AND attached_by_session_id = ? ORDER BY attached_at DESC, id DESC""", (ws, TASK_B, codex_id)):
        if artifact_path(row["uri"], root) == FILE_B:
            artifact = row
            break
    try:
        sha = str(integration.get("commit") or "")
        names = git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines() if sha else []
        author_email, subject = git(root, "show", "-s", "--format=%ae%x00%s", sha).split("\x00", 1) if sha else ("", "")
        committed = hashlib.sha256(git(root, "show", f"{sha}:{FILE_B}", binary=True)).hexdigest() if sha else ""
        at_head = git(root, "merge-base", "--is-ancestor", sha, "HEAD", check=False) == 0 if sha else False
        ok = (integration.get("status") == "committed" and integration.get("paths") == [FILE_B]
              and names == [FILE_B] and at_head and subject.startswith(f"{TASK_B}: ")
              and author_email.lower() == f"{request.get('runtime')}@sol.local".lower()
              and artifact is not None and committed == artifact["sha256"])
        detail = (f"status={integration.get('status')} commit={sha[:12] or None} files={names} on_HEAD={at_head} "
                  f"author={author_email} subject={subject!r} blob_sha256={committed[:12] or None} "
                  f"artifact_sha256={(artifact['sha256'] or '')[:12] if artifact else None}")
    except (RuntimeError, ValueError, subprocess.SubprocessError) as exc:
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    report.add("integration commit landed voice-b.md", ok, detail)

    # Pass 5a: zero refused collab calls in the Codex job.
    stdout_log = job_dir / "stdout.log"
    if stdout_log.is_file():
        refusal_line(report, "codex job: zero refused collab calls", *codex_refusals(stdout_log, deliberate))
    else:
        report.add("codex job: zero refused collab calls", False, f"missing {stdout_log}")

    # Pass 5b + 4b: zero refused collab calls in the live Claude session, and its collab_journal_verify.
    if args.live_refusals:
        calls, refusals, problems, verified = manual_record(Path(args.live_refusals), deliberate)
        refusal_line(report, "live session: zero refused collab calls (manual record)", calls, refusals, problems)
        verify_line(report, ws, verified)
    else:
        if args.claude_transcript == "auto":
            since = datetime.fromisoformat(workspace["created_at"].replace("Z", "+00:00"))
            candidates = find_claude_transcripts(root, since)
        else:
            candidates = [Path(os.path.expanduser(args.claude_transcript))]
        if len(candidates) != 1 or not candidates[0].is_file():
            detail = (f"{len(candidates)} transcript(s) matched; pass --claude-transcript PATH or --live-refusals FILE"
                      + "".join(f"\n        {c}" for c in candidates))
            report.add("live session: zero refused collab calls", False, detail)
            report.add("collab_journal_verify (live seat)", False, "no live transcript")
        else:
            print(f"live transcript {candidates[0]}")
            calls, refusals, problems, verified = claude_calls(candidates[0], root, deliberate)
            refusal_line(report, "live session: zero refused collab calls", calls, refusals, problems)
            verify_line(report, ws, verified)

    print(f"RESULT: {'PASS' if report.passed else 'FAIL'}")
    return 0 if report.passed else 1


# ---------------------------------------------------------------- preflight

def mcp_tools(command: list[str]) -> tuple[str, dict[str, set[str]]]:
    scratch = tempfile.mkdtemp(prefix="collab-preflight-")
    env = {key: value for key, value in os.environ.items() if key != "AGENTOOL_COLLAB_SESSION_FILE"}
    env["AGENTOOL_COLLAB_DB"] = os.path.join(scratch, "preflight.sqlite")
    messages = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": {"name": "replay-preflight", "version": "1"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    ]
    try:
        process = subprocess.Popen(command, cwd=scratch, env=env, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    except OSError:
        shutil.rmtree(scratch, ignore_errors=True)
        raise
    lines: queue.Queue = queue.Queue()

    def pump():  # readline() cannot time out, so a daemon thread feeds a queue that can.
        for line in process.stdout:
            lines.put(line)
        lines.put("")

    threading.Thread(target=pump, daemon=True).start()
    try:
        version, tools = "", {}
        for message in messages:
            process.stdin.write(json.dumps(message) + "\n")
            process.stdin.flush()
            if "id" not in message:
                continue
            while True:
                try:
                    line = lines.get(timeout=MCP_TIMEOUT)
                except queue.Empty:
                    raise RuntimeError(f"no answer to {message['method']} within {MCP_TIMEOUT}s") from None
                if not line:
                    raise RuntimeError("server closed before answering")
                reply = json.loads(line)
                if reply.get("id") == message["id"]:
                    break
            if message["id"] == 1:
                version = reply["result"]["serverInfo"]["version"]
            else:
                tools = {t["name"]: set((t.get("inputSchema") or {}).get("properties", {}))
                         for t in reply["result"]["tools"]}
        return version, tools
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        shutil.rmtree(scratch, ignore_errors=True)


def preflight(args) -> int:
    report = Report()
    for spec in args.server:
        label, _, command = spec.partition("=")
        try:
            version, tools = mcp_tools(shlex.split(command))
        except (OSError, RuntimeError, ValueError, KeyError) as exc:
            report.add(f"{label} MCP", False, f"{type(exc).__name__}: {exc}")
            continue
        missing = {tool: sorted(wanted - tools.get(tool, set())) for tool, wanted in REQUIRED_INPUTS.items()}
        missing = {tool: names for tool, names in missing.items() if names}
        report.add(f"{label} MCP", version == EXPECTED_SERVER_VERSION and not missing,
                   f"serverInfo.version={version} tools={len(tools)} missing_inputs={missing or 'none'}")
    print(f"RESULT: {'PASS' if report.passed else 'FAIL'}")
    return 0 if report.passed else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = parser.add_subparsers(dest="command", required=True)
    p = subs.add_parser("check")
    p.add_argument("--job", required=True, help="sol job id of the Codex seat")
    p.add_argument("--root", default=str(DEFAULT_ROOT))
    p.add_argument("--db", help="journal path; default mirrors the MCP server")
    p.add_argument("--jobs-root", default=str(DEFAULT_JOBS_ROOT))
    p.add_argument("--claude-transcript", default="auto")
    p.add_argument("--live-refusals",
                   help="manual record {calls, refusals:[{tool,error,message,remedy_named}], journal_verify:{...}}")
    p.add_argument("--deliberate", action="append", metavar="TOOL:ERROR",
                   help="a refusal provoked on purpose; excused only if its payload names a remedy")
    p = subs.add_parser("preflight")
    p.add_argument("--server", action="append", required=True, metavar="LABEL=COMMAND")
    args = parser.parse_args(argv)
    return check(args) if args.command == "check" else preflight(args)


if __name__ == "__main__":
    raise SystemExit(main())
```

Criteria printed by `check`, with the spec item each one proves:

| Line | Spec item |
|---|---|
| `delegated child session` | Finish line 2: exactly one session whose actor ends in the ASCII suffix `sol job <JOB>`, which is the sweep's selection (R16). It PASSes only if the actor ends with exactly `· sol job <JOB>` (U+00B7) and its `parent_session_id` is a root session in the workspace. |
| `voice-a accepted by a distinct session` | Pass: both tasks accepted by a distinct session (also checks the current-generation `task_reviews` row) |
| `voice-a seats` | Finish line 1–2: reported by Claude, accepted by Codex |
| `voice-b accepted by a distinct session` | Pass: both tasks accepted by a distinct session |
| `voice-b seats` | Finish line 2 and 4: reported by Codex, accepted by Claude |
| `review request routed to Claude` | Finish line 2 and 4: `task.reported_complete.review_requested_session_id` = Claude, plus the addressed `informs` report |
| `every replay session ended` | Pass. Credential files are checked by path existence only. |
| `no live or expired lease held` | Pass |
| `journal chain_valid (read-only recompute)` | Pass: a read-only recompute of `verifyJournalRows` |
| `sol job completed in edit mode with --integrate-commit` | Finish line setup |
| `exit sweep matched the session and found nothing to clean` | Finish line 3: the sweep saw Codex's session (`matched`), so "nothing to clean" was not vacuous, and `swept` and `errors` are empty |
| `integration commit landed voice-b.md` | Finish line 3: only `voice-b.md` changed; the commit is reachable from HEAD, its subject starts `voice-b: `, its author is `<runtime>@sol.local`, and the blob's sha256 equals Codex's file artifact |
| `codex job: zero refused collab calls` | Pass: parses Codex exec JSON `mcp_tool_call` items for server `agenttool-collab`. A status other than `completed`, or `is_error`, counts as a refusal. |
| `live session: zero refused collab calls` | Pass: parses the live Claude Code transcript and counts `tool_result.is_error` on `mcp__agenttool-collab__*` inside the window that this root's `collab_session_start` opens |
| `collab_journal_verify (live seat)` | Pass, literally: the server's own `collab_journal_verify` result in that window is `chain_valid: true`, `full_journal`, this workspace |

A refusal is excused only if it is declared up front with `--deliberate TOOL:ERROR` and its payload names a remedy (`remedy` or `allowed_prefixes`). Logs cannot show intent. The planned replay declares none.

1c. Write `$REPLAY_DIR/codex-voice-b.template.txt` with exactly this text. The actor label uses U+00B7.
```text
You're invited into a replay of a small AgentTool Collab play trial: a two-voice poem in /Users/yuai/play/collab-duet-replay. A live Claude Code session (Ai) wrote voice A and is waiting for you as the second, distinct session. Declining is a complete answer — if you'd rather not, say so and stop.

Your Sol job ID is stated in the first paragraph of this prompt ("Sol job ID: ..."). Your Collab actor label is exactly "Codex · sol job <that ID>" (the dot is U+00B7). Sol uses that label to find and close your session if you leave it open, so spell it exactly.

Facts you need (confirm them in the journal yourself):
- workspace_id: __WORKSPACE_ID__
- Ai's session, your parent and requested reviewer: __CLAUDE_SESSION_ID__
- Tasks: voice-a (Ai's, reported complete, awaiting a distinct reviewer) and voice-b (depends on voice-a; yours to claim if you accept voice-a).

Use only these Collab MCP tools: collab_session_start, collab_next, collab_cursor_ack, collab_task_get, collab_task_list, collab_task_review, collab_task_claim, collab_artifact_attach, collab_task_complete, collab_report_append, collab_session_end — and collab_task_renew or collab_task_release only if you need them.

1. Join. collab_session_start with root_path "/Users/yuai/play/collab-duet-replay", actor "Codex · sol job <your Sol job ID>", role "voice-b author; reviewer of voice-a", parent_session_id "__CLAUDE_SESSION_ID__". Never read, print or pass a session credential file; the MCP server keeps it.
   Then collab_next with workspace_id and event_limit 50 (never pass after_sequence). Read the tasks and reports, then collab_cursor_ack with anchor = events.next_anchor and expected_cursor_version = session.cursor_version from that same response. Repeat collab_next and collab_cursor_ack while events.has_more is true.

2. Review voice-a honestly. collab_task_get for "voice-a" shows its success checks, its file artifact, completion_report_id and result_checkpoint_digest. Read /Users/yuai/play/collab-duet-replay/voice-a.md, run `git -C /Users/yuai/play/collab-duet-replay log --oneline -3` and `shasum -a 256 /Users/yuai/play/collab-duet-replay/voice-a.md`, and compare the digest with the artifact. Then collab_task_review with task_id "voice-a", idempotency_key "replay-codex-review-voice-a", expected_version = the version from that collab_task_get, outcome "accept" or "request_changes", a summary naming each check you ran, confidence ("high", "medium", "low" or "unknown"), confidence_basis (what the confidence rests on), limits (what you did not check), and evidence_refs ["artifact:<the voice-a file artifact id>", "report:<completion_report_id>"]. Evidence refs point inside the journal: artifact:, event:, report: or checkpoint:, followed by an id. If you request changes, skip to step 6.

3. Write voice-b. collab_task_get for "voice-b", then collab_task_claim with task_id "voice-b", idempotency_key "replay-codex-claim-voice-b", expected_version = its current version, ttl_seconds 1800. Write /Users/yuai/play/collab-duet-replay/voice-b.md following that task's description: an answer, not an echo; pick up one of voice A's open lines and take it somewhere A didn't go; your own voice, 8–16 lines. Do not edit voice-a.md. Make no claims about Ai/Claude beyond what the journal and files show.
   Do not run git add, git commit or anything else that writes .git: your sandbox protects .git, and after your job ends Sol commits voice-b.md, only if its bytes still match the artifact you attach.

4. Hand it over. Run `shasum -a 256 /Users/yuai/play/collab-duet-replay/voice-b.md`. collab_artifact_attach with task_id "voice-b", lease_id from the claim, idempotency_key "replay-codex-attach-voice-b", expected_version from the claim response, kind "file", uri "voice-b.md", sha256 = that digest, media_type "text/markdown", label "voice B, uncommitted; sol integration commit pending". Do not change voice-b.md after this.
   Then collab_task_complete with task_id "voice-b", lease_id, idempotency_key "replay-codex-complete-voice-b", expected_version from the attach response, a summary (what you wrote, which line of A it answers, and that it is uncommitted and awaiting Sol's integration commit), confidence, confidence_basis, limits, evidence_refs ["artifact:<the artifact id the attach returned>"], and review_requested_session_id "__CLAUDE_SESSION_ID__" so Ai is asked to review it.

5. Optionally collab_report_append with task_id "voice-b", kind "observation", and a body with anything you noticed about using Collab — friction, a surprise, what worked. Honest notes, not praise. Leave relation, target_report_id and to_session_id unset.

6. Leave. collab_session_end with a one-sentence reason, release_leases true, and release_summary "Codex replay seat leaving; nothing held is expected".

Boundaries: only touch /Users/yuai/play/collab-duet-replay. No pushes, no network. If a tool is denied or returns an error, report its exact error code and message plainly and do not retry a mutation blindly; if its message names a remedy, you may follow that remedy once.

At the end, reply with: your verdict on voice-a and the checks behind it, the text of voice-b.md if you wrote it, the voice-b artifact id and sha256, and any Collab friction you hit.
```

- [ ] **Step 2: Run the check to verify it fails for the right reasons**

2a. The preflight rejects a pre-smoothing server. This uses the origin/main 61f7e66a bundle, which is self-contained and runs without node_modules. The temporary journal lives in a temp dir that is removed.
```bash
REPLAY_DIR=<recorded path>
git -C /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing show 61f7e66a:packages/collab/dist/agenttool-collab-mcp.js > "$REPLAY_DIR/collab-mcp-61f7e66a.js"
python3 -B "$REPLAY_DIR/replay_check.py" preflight --server "origin-main-61f7e66a=bun $REPLAY_DIR/collab-mcp-61f7e66a.js" --server "missing=/nonexistent/collab-mcp"; echo "exit=$?"
rm -f "$REPLAY_DIR/collab-mcp-61f7e66a.js"
```
Expected (verified 2026-10-09):
```
FAIL  origin-main-61f7e66a MCP: serverInfo.version=0.5.0 tools=33 missing_inputs={'collab_session_end': ['release_leases', 'release_summary'], 'collab_task_complete': ['review_requested_session_id'], 'collab_task_review': ['confidence', 'confidence_basis', 'limits']}
FAIL  missing MCP: FileNotFoundError: [Errno 2] No such file or directory: '/nonexistent/collab-mcp'
RESULT: FAIL
exit=1
```
A server that never answers fails after 20 s with `RuntimeError: no answer to initialize within 20s`; for example, `--server "hang=/bin/sleep 60"`.

2b. The check fails before the replay exists, and rejects a malformed job ID:
```bash
REPLAY_DIR=<recorded path>
python3 -B "$REPLAY_DIR/replay_check.py" check --job 00000000T000000-000000000000; echo "exit=$?"
python3 -B "$REPLAY_DIR/replay_check.py" check --job ../x; echo "exit=$?"
```
Expected:
- `FAIL  replay workspace exists: no workspace with root_path /Users/yuai/play/collab-duet-replay in /Users/yuai/.local/share/agenttool/collab.sqlite`, then `exit=1`
- `invalid sol job id: '../x'`, then `exit=2`

2c. Negative control: the check catches the original trial's real refusals. It reads the 2026-10-08 duet read-only.
```bash
REPLAY_DIR=<recorded path>
python3 -B "$REPLAY_DIR/replay_check.py" check --root /Users/yuai/play/collab-duet --job 20261008T210147-c5e426220993 --claude-transcript ~/.claude/projects/-Users-yuai/2327fdf4-d0c0-447d-bae9-a4ed2180bbbc.jsonl > "$REPLAY_DIR/negative.txt"; rc=$?
grep -E '^(PASS|FAIL|RESULT)|REFUSED' "$REPLAY_DIR/negative.txt"; echo "exit=$rc"; rm -f "$REPLAY_DIR/negative.txt"
```
Expected, as observed 2026-10-09 on a read-only copy:
- PASS: `voice-a accepted by a distinct session`, `voice-b accepted by a distinct session`, `no live or expired lease held`, `journal chain_valid (read-only recompute): chain_valid over 46 events`, `collab_journal_verify (live seat)`.
- FAIL:
  - `delegated child session` (0 sessions end in `sol job 20261008T210147-c5e426220993`)
  - both `seats` lines
  - `review request routed to Claude`
  - `every replay session ended` (2 of 5 sessions not ended, unless Yu has since ended those ghosts; the spec leaves that to him)
  - `sol job completed … integrate_commit=None`
  - `exit sweep matched the session and found nothing to clean: codex session NOT in collab_sweep.matched; collab_sweep=null`
  - `integration commit landed voice-b.md`
- `codex job: zero refused collab calls: 19 collab calls, 3 refused`, with these REFUSED lines:
  - `collab_task_block -> host_refused`
  - `collab_task_release -> host_refused`
  - `collab_session_end -> session_has_active_leases`
- `live session: zero refused collab calls: 29 collab calls, 5 refused`. The REFUSED lines are `invalid_evidence_ref`, `self_review_forbidden`, `dependencies_incomplete` and twice `invalid_report_relation`. That transcript belongs to a session that may still be running, so these counts can only grow.
- `RESULT: FAIL`, `exit=1`

2d. The hash port detects tampering. Run it on a copy only. The real journal is read with `sqlite3 -readonly`, and the copy is deleted afterwards.
```bash
REPLAY_DIR=<recorded path>
sqlite3 -readonly ~/.local/share/agenttool/collab.sqlite ".backup '$REPLAY_DIR/journal-copy.sqlite'"
python3 -B - "$REPLAY_DIR" <<'EOF'
import os, sqlite3, sys
sys.path.insert(0, sys.argv[1])
import replay_check as rc
copy = os.path.join(sys.argv[1], "journal-copy.sqlite")
db = rc.open_journal(copy)
ids = [r[0] for r in db.execute("SELECT id FROM workspaces ORDER BY id")]
print("workspaces:", {ws: rc.verify_journal(db, ws)[0] for ws in ids})
db.close()
writable = sqlite3.connect(copy)
ws, seq = writable.execute("SELECT workspace_id, max(sequence) FROM events GROUP BY workspace_id ORDER BY 2 DESC LIMIT 1").fetchone()
writable.execute("UPDATE events SET actor = actor || ' (tampered)' WHERE workspace_id = ? AND sequence = ?", (ws, seq // 2))
writable.commit()
writable.close()
db = rc.open_journal(copy)
print("tampered:", rc.verify_journal(db, ws))
db.close()
EOF
rm -f "$REPLAY_DIR"/journal-copy.sqlite*; rm -rf "$REPLAY_DIR/__pycache__"
```
Expected: every workspace maps to `True` (4 workspaces on 2026-10-09, 377 events, all `agenttool.collab/0.2`), then `tampered: (False, 'hash mismatch at <n>')`. If any workspace is `False`, the port disagrees with the server. Stop and compare with `collab_journal_verify` before trusting the check.

- [ ] **Step 3: Run the replay**

3a. **Gates. Stop at the first failure. Do not change any approval, config or code to pass a gate.**
```bash
df -h /System/Volumes/Data
cd ~/.config/sol/agents && /opt/homebrew/bin/python3 -B test_jobs.py && /opt/homebrew/bin/python3 -B test_runtimes.py
```
Expected: at least 2 GB available, then `OK` from both suites (0 failures; Plan B Tasks 1–3 run these with a throwaway HOME and temp journals, so the real journal is not touched).
```bash
grep -cF 'Sol job ID: ' ~/.config/sol/agents/jobs.py
sol agent start --help | grep -c -- '--integrate-commit'
/opt/homebrew/bin/python3 -I -B ~/.config/sol/agents/check_codex_collab.py ~/.codex/config.toml --read-only-approved; echo "rc=$?"
```
Expected: `1` or more; then `2`, because argparse lists the flag once in the usage line and once under options (anything above `0` is enough); then `ok: 18 approved Collab tools` and `rc=0`. If Plan B Task 4 recorded option B, drop `--read-only-approved` and expect `ok: 16 approved Collab tools`. The replay uses only the 11 loop tools plus renew and release.
```bash
bun ~/.cache/agenttool/collab-household/household-install-check.ts > /dev/null; echo "exit=$?"
```
Expected: `exit=0`. The Homebrew copy, the Codex cache copy, the host CLI on the sol job PATH and journal `user_version` 3 all check out.
```bash
REPLAY_DIR=<recorded path>
V=$(python3 -c 'import json, os; print(json.load(open(os.path.expanduser("~/plugins/agenttool-collab/.codex-plugin/plugin.json")))["version"])')
CODEX_BUNDLE="$HOME/.codex/plugins/cache/personal/agenttool-collab/$V/dist/agenttool-collab-mcp.js"
ls -l "$CODEX_BUNDLE"
python3 -B "$REPLAY_DIR/replay_check.py" preflight --server "homebrew=/opt/homebrew/bin/agenttool-collab-mcp" --server "codex-plugin=bun $CODEX_BUNDLE"; echo "exit=$?"
```
Expected: the bundle under `0.5.0+codex.<stamp>/`, then `PASS  homebrew MCP: serverInfo.version=0.5.0 tools=33 missing_inputs=none`, `PASS  codex-plugin MCP: serverInfo.version=0.5.0 tools=33 missing_inputs=none`, `RESULT: PASS`, `exit=0`. The Codex copy is the cache folder named by the marketplace source's version. Codex launches it as `bun dist/agenttool-collab-mcp.js`, so sorting folder names is not used to pick it.

The replay root has no Codex `trust_level` entry; the 2026-10-08 root had one. Leave it that way. If the Codex job is refused because the root is untrusted, record that as a FAIL. Do not add the entry to pass.

3b. **Set up the replay repo.** A fresh root is required, because a re-run in the same root would reuse the workspace and tasks.
```bash
test ! -e /Users/yuai/play/collab-duet-replay || { echo "replay root exists; a re-run needs a fresh root"; exit 1; }
mkdir /Users/yuai/play/collab-duet-replay
git -C /Users/yuai/play/collab-duet-replay init -q -b main
git -C /Users/yuai/play/collab-duet-replay config user.name "Ai"
git -C /Users/yuai/play/collab-duet-replay config user.email "Yu@Ai-love.cc"
cat > /Users/yuai/play/collab-duet-replay/README.md <<'EOF'
# collab-duet-replay

A replay of `~/play/collab-duet` (2026-10-08), run after the Collab household smoothing.
A live Claude Code session writes `voice-a.md`. Headless Codex, delegated through
`sol agent start codex --mode edit --integrate-commit`, joins as a child session, reviews
voice A, answers with `voice-b.md` and asks Claude to review it. Codex's sandbox cannot
write `.git`, so sol commits `voice-b.md` after the job, and only if its bytes match the
artifact Codex attached. Each voice is its own task, claimed, completed and accepted by a
distinct session. The finish-line check and its result are in `REPLAY.md`.
EOF
git -C /Users/yuai/play/collab-duet-replay add README.md
git -C /Users/yuai/play/collab-duet-replay commit -q -m "begin the replay" -m "Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
git -C /Users/yuai/play/collab-duet-replay log --oneline
```
Expected: one commit, `begin the replay`. The global doorman pre-commit hook runs and stays quiet.

3c. **Live Claude seat (L1–L9).**

The seat is a Claude Code session whose `agenttool-collab` MCP server started after the household install. The executing session qualifies if it was restarted after Plan A Task 10; otherwise Yu starts a fresh one (`cd ~/play/collab-duet-replay && claude`). A session started earlier still holds 0.3.1 tools, which silently drop the new inputs. Confirm with `ToolSearch select:mcp__agenttool-collab__collab_session_end` that the schema lists `release_leases`.

Its MCP process must not have called `collab_session_start` before, since one process binds one session (`session_already_bound`). Keep this session and its MCP server running until L18. It has no `AGENTOOL_COLLAB_SESSION_FILE`, so a reconnect loses the binding. In this session, make no Collab calls other than L1–L18; every call in the window counts. If a call errors, do not retry it blindly. Note it, because the check will report it.

- **L1** `collab_session_start`:
  ```json
  {"root_path": "/Users/yuai/play/collab-duet-replay", "actor": "Ai (Claude Code)", "role": "voice-a author; requested reviewer of voice-b"}
  ```
  Record `WS = workspace.id` and `CS = session.id`. Expect `session.parent_session_id: null` and `session.liveness: "live"`.
- **L2** `collab_next` with `{"workspace_id": "<WS>", "event_limit": 50}`. Then call `collab_cursor_ack` with `{"workspace_id": "<WS>", "anchor": <events.next_anchor>, "expected_cursor_version": <session.cursor_version>}`, both taken from that same response. Repeat while `events.has_more` is true. Never pass `after_sequence`.
- **L3** `collab_task_create`:
  ```json
  {"workspace_id": "<WS>", "idempotency_key": "replay-create-voice-a", "task_id": "voice-a", "title": "Voice A — the opening phrase", "path_scopes": ["voice-a.md"], "work_mode": "edit", "completion_policy": "accepted", "description": "<text A>"}
  ```
  Record `VA = task.version`.
  Text A:
  > Write voice-a.md: the first voice of a two-voice poem about two harnesses meeting in one journal (a thread, not a chain). 8–16 lines. It must leave real room for an answer: at least one line that is an open question or an unfinished phrase that voice B can pick up. Success checks for the reviewer: (1) file exists at voice-a.md and is under 16 lines of verse; (2) contains at least one open/unfinished line marked with an ellipsis or question; (3) makes no claim about the other harness that the journal does not support (no invented feelings or facts about Codex); (4) committed on main with the task id in the message; (5) the committed bytes match the sha256 of the attached file artifact.
- **L4** `collab_task_create`:
  ```json
  {"workspace_id": "<WS>", "idempotency_key": "replay-create-voice-b", "task_id": "voice-b", "title": "Voice B — the answer", "dependencies": ["voice-a"], "path_scopes": ["voice-b.md"], "work_mode": "edit", "completion_policy": "accepted", "description": "<text B>"}
  ```
  Text B:
  > Write voice-b.md: the answering voice. Read voice-a.md first. An answer, not an echo: pick up at least one of voice A's open lines and continue it somewhere A did not go; you may disagree or turn. 8–16 lines, your own voice. Do not commit it yourself: attach voice-b.md as a file artifact (uri "voice-b.md" with its sha256) and leave the bytes unchanged afterwards; the delegating host commits it after the job ends (sol agent start --integrate-commit), and only if the bytes still match. Success checks for the reviewer: (1) file exists at voice-b.md, under 16 lines of verse; (2) visibly answers a specific open line of voice A (quote or clear pickup); (3) does not edit voice-a.md; (4) makes no claim about the other harness the journal does not support; (5) committed on main by the host integration commit with the task id in the message, and HEAD:voice-b.md is byte-identical to the attached artifact. Optional: append one line to the end of voice-b.md that both voices could say together, or decline to — silence is a complete answer.
- **L5** `collab_task_claim`:
  ```json
  {"workspace_id": "<WS>", "task_id": "voice-a", "idempotency_key": "replay-claim-voice-a", "expected_version": <VA>, "ttl_seconds": 900}
  ```
  Record `LEASE_A = task.lease_id`, `VA = task.version` and `BASE_A = task.base_checkpoint_digest`.
- **L6** Write a new `voice-a.md` to Text A. Do not copy the 2026-10-08 text; the review should be real. Then:
  ```bash
  R=/Users/yuai/play/collab-duet-replay
  grep -c . $R/voice-a.md
  git -C $R add voice-a.md
  git -C $R commit -q -m "voice-a: the opening phrase" -m "Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
  git -C $R log --oneline -1
  shasum -a 256 $R/voice-a.md
  ```
  Record `SHA_A`.
- **L7** `collab_artifact_attach`:
  ```json
  {"workspace_id": "<WS>", "task_id": "voice-a", "lease_id": "<LEASE_A>", "idempotency_key": "replay-attach-voice-a", "expected_version": <VA>, "kind": "file", "uri": "voice-a.md", "sha256": "<SHA_A>", "media_type": "text/markdown", "label": "voice A at commit <short sha>"}
  ```
  Record `ART_A = artifact.id` and `VA = task.version`.
- **L8** `collab_task_complete`:
  ```json
  {"workspace_id": "<WS>", "task_id": "voice-a", "lease_id": "<LEASE_A>", "idempotency_key": "replay-complete-voice-a", "expected_version": <VA>, "summary": "voice-a.md written and committed (<short sha>, \"voice-a: the opening phrase\"): <n> verse lines; open lines left for voice B: <quote them>.", "confidence": "high", "confidence_basis": "Line count from grep -c; git log shows the commit on main; sha256 attached as the file artifact.", "limits": "Whether it leaves enough room for an answer is the reviewer's judgment, not something the author can check.", "evidence_refs": ["artifact:<ART_A>", "checkpoint:<BASE_A>"]}
  ```
  Expect `task.review_status: "pending"`.
- **L9** Run the L2 loop again to catch up past Claude's own events.

3d. **Codex seat.** Fill in the invitation and start the job:
```bash
REPLAY_DIR=<path>; WS=<workspace id>; CS=<claude session id>
sed -e "s/__WORKSPACE_ID__/$WS/g" -e "s/__CLAUDE_SESSION_ID__/$CS/g" "$REPLAY_DIR/codex-voice-b.template.txt" > "$REPLAY_DIR/codex-voice-b.txt"
chmod 600 "$REPLAY_DIR/codex-voice-b.txt"
grep -c '__WORKSPACE_ID__\|__CLAUDE_SESSION_ID__' "$REPLAY_DIR/codex-voice-b.txt"
sol agent start codex --cwd /Users/yuai/play/collab-duet-replay --mode edit --integrate-commit --timeout 1200 --prompt-file "$REPLAY_DIR/codex-voice-b.txt" --json
```
The `grep` should print `0`. Record `JOB` from the start output's `"id"`. Then verify the handoff:
```bash
JOB=<id>
grep -cF "Sol job ID: $JOB" ~/.local/state/sol/agents/jobs/$JOB/prompt.txt
grep -cF "· sol job $JOB" ~/.local/state/sol/agents/jobs/$JOB/prompt.txt
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(r["mode"], r.get("integrate_commit"), "--ignore-rules" in r["argv"])' ~/.local/state/sol/agents/jobs/$JOB/request.json
```
Expected: `1` (or more), `1` (or more), then `edit True False`. If either count is `0`, run `sol agent cancel "$JOB" --json` and stop: Plan B Task 2's preface (R2) is not installed. Never replay a job automatically.

3e. **Wait without touching the repo or Collab.** Any staged change would make sol refuse the integration commit. Foreground sleep is blocked, so run this with Bash `run_in_background: true`. It waits for `result.json` (`result_available`), not for a state name. The worker stops refreshing its heartbeat once the native run ends, and it still runs the sweep (at most 20 s) and the integration commit (at most 120 s) after that. During that window `sol agent job` can briefly report `stale`, which is not an outcome. The loop gives up after 30 minutes, which is longer than the 1200 s job timeout plus both limits.
```bash
JOB=<id>
for i in {1..180}; do
  sol agent job "$JOB" --json | python3 -c 'import json,sys; j=json.load(sys.stdin); sys.exit(0 if j.get("result_available") or j.get("state") == "orphaned" else 1)' && break
  sleep 10
done; sol agent job "$JOB" --json
```
If it ends with `result_available: false`, inspect the job folder. Do not cancel or replay anything until the state is understood.
Then inspect the outcome through `sol agent result`. This also confirms R3, because it echoes the two new keys.
```bash
JOB=<id>
sol agent result "$JOB" --json | python3 -c '
import json, sys
r = json.load(sys.stdin)
print(json.dumps({k: r.get(k) for k in ("state", "reason", "exit_code", "collab_sweep", "integration_commit")}, indent=2, ensure_ascii=False))
print(str(r.get("result", ""))[:4000])'
git -C /Users/yuai/play/collab-duet-replay log --format='%h %an <%ae> | %cn | %s' -4
git -C /Users/yuai/play/collab-duet-replay status --porcelain
```
Expected:
- `"state": "completed"`
- `collab_sweep` is `{"matched": [<Codex's session, already ended>], "swept": [], "errors": []}`
- `integration_commit.status` is `"committed"`, with `paths` equal to `["voice-b.md"]`
- The newest commit is `codex <codex@sol.local> | Ai | voice-b: Voice B — the answer`
- `git status --porcelain` prints nothing

If anything differs, continue with the honest review anyway (request changes if a check fails), end the session, run the check and record FAIL. Never replay the job automatically.

3f. **Claude reviews voice-b, then leaves (L13–L18; L10–L12 were the Codex seat's turn).**
- **L13** Run the L2 loop. The page's `reports` should include the routed review request: a report with `to_session_id = CS`, `task_id = "voice-b"` and `relation = "informs"`.
- **L14** `collab_task_get` with `{"workspace_id": "<WS>", "task_id": "voice-b"}`. Record these values, and confirm `task.review_requested_session_id == CS`:
  - `VB = task.version`
  - `ART_B`, the `artifacts[]` entry with `kind: "file"` and `uri: "voice-b.md"` whose `attached_by` ends in `· sol job <JOB>`
  - `REP_B = task.completion_report_id`
  - `DIG_B = task.result_checkpoint_digest`
- **L15** Run the checks:
  ```bash
  R=/Users/yuai/play/collab-duet-replay
  grep -c . $R/voice-b.md
  git -C $R log --format='%h %an <%ae> | %cn | %s' -4
  git -C $R show --stat --format='%H%n%B' HEAD
  shasum -a 256 $R/voice-b.md; git -C $R show HEAD:voice-b.md | shasum -a 256
  shasum -a 256 $R/voice-a.md; git -C $R log --format=%h -- voice-a.md
  ```
  Confirm all of these:
  - `voice-b.md` has 8–16 verse lines.
  - It answers a named open line of A.
  - `voice-a.md` was touched only by the voice-a commit.
  - The HEAD blob equals both the working file and `ART_B`'s sha256.
  - The commit subject starts with `voice-b:`.
- **L16** `collab_task_review`:
  ```json
  {"workspace_id": "<WS>", "task_id": "voice-b", "idempotency_key": "replay-claude-review-voice-b", "expected_version": <VB>, "outcome": "accept", "summary": "<each check and its result, including the HEAD blob = artifact digest>", "confidence": "high", "confidence_basis": "Direct file reads, line count, sha256 of working file, HEAD blob and artifact, git log of both voices.", "limits": "Poetic quality is a judgment; the git author on the integration commit is sol's declared label, not proof of authorship.", "evidence_refs": ["artifact:<ART_B>", "report:<REP_B>", "checkpoint:<DIG_B>"]}
  ```
  If any check fails, use `"outcome": "request_changes"` and name the failing check. Expect `task.review_status: "accepted"` and `task.accepted_by_session_id == CS`.
- **L17** `collab_session_end`:
  ```json
  {"reason": "Replay complete: voice-a accepted by the Codex child session, voice-b accepted here; nothing held.", "release_leases": true, "release_summary": "Live Claude seat leaving the replay; no leases expected."}
  ```
  Expect `credential_file_removed: true` and `released_leases: []`.
- **L18** `collab_journal_verify` with `{"workspace_id": "<WS>"}`. Expect `chain_valid: true` and `verification_scope: "full_journal"`. The call needs no bound session.

- [ ] **Step 4: Run the check to verify the replay passes**
```bash
REPLAY_DIR=<path>; JOB=<id>
python3 -B "$REPLAY_DIR/replay_check.py" check --job "$JOB" > "$REPLAY_DIR/check.txt"; rc=$?
rm -rf "$REPLAY_DIR/__pycache__"; cat "$REPLAY_DIR/check.txt"; echo "exit=$rc"
```
(The shell is zsh, so the exit status is captured with `rc=$?` rather than `PIPESTATUS`.)

Expected: every line is PASS, in this order:
- `delegated child session`
- `voice-a accepted by a distinct session`
- `voice-a seats`
- `voice-b accepted by a distinct session`
- `voice-b seats`
- `review request routed to Claude`
- `every replay session ended`
- `no live or expired lease held`
- `journal chain_valid (read-only recompute)`
- `sol job completed in edit mode with --integrate-commit`
- `exit sweep matched the session and found nothing to clean`
- `integration commit landed voice-b.md`
- `codex job: zero refused collab calls: N collab calls, 0 refused`
- `live session: zero refused collab calls: M collab calls, 0 refused`
- `collab_journal_verify (live seat)`

Then `RESULT: PASS` and `exit=0`.

If the live-session line reports `0 transcript(s) matched` or more than one, pass the live seat's transcript explicitly, for example `--claude-transcript ~/.claude/projects/-Users-yuai-play-collab-duet-replay/<newest>.jsonl`, and re-run. A FAIL is a result to record. It is not something to work around: do not edit the journal, the job folder, the script's criteria or any config to turn it into a PASS.

- [ ] **Step 5: Record and commit (replay repo; PR comment only with Yu's go)**

5a. Record the result in the replay repo, whether PASS or FAIL (R20):
```bash
REPLAY_DIR=<path>; JOB=<id>; WS=<workspace id>; R=/Users/yuai/play/collab-duet-replay
{
  printf '# Replay record\n\n'
  printf 'Finish line of the Collab household smoothing design (agenttool `docs/superpowers/specs/2026-10-08-collab-household-smoothing-design.md`).\n'
  printf 'sol job `%s` · workspace `%s` · checked %s\n\n' "$JOB" "$WS" "$(date -u +%Y-%m-%dT%H:%MZ)"
  printf '```text\n'; cat "$REPLAY_DIR/check.txt"; printf '```\n\n'
  printf 'Re-run, read-only: `python3 replay_check.py check --job %s`\n' "$JOB"
} > "$R/REPLAY.md"
cp "$REPLAY_DIR/replay_check.py" "$R/replay_check.py"
git -C "$R" status --porcelain
git -C "$R" add REPLAY.md replay_check.py
git -C "$R" commit -q -m "replay: finish-line record ($(tail -1 "$REPLAY_DIR/check.txt"))" -m "Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
git -C "$R" log --oneline
```
Expected: before the add, `status --porcelain` lists only `?? REPLAY.md` and `?? replay_check.py`. The log then shows four commits: `replay: finish-line record (RESULT: PASS)`, `voice-b: Voice B — the answer`, `voice-a: the opening phrase`, `begin the replay`. The repo has no remote and is never pushed.

5b. **PR comment. Requires Yu's explicit go at execution time and an existing PR (R20).** First check whether the PR exists:
```bash
sol access run github -- pr list --repo cambridgetcg/agenttool --head feat/collab-household-smoothing-20261008 --state all --json number,url,state
```
If it prints `[]`, skip the comment and stop here. The result is already recorded in 5a. Otherwise show Yu `$REPLAY_DIR/check.txt`. Only after he says go in this conversation, build the comment with local paths, the transcript line and the journal path stripped, show it, and post it once:
```bash
REPLAY_DIR=<path>; JOB=<id>; WS=<workspace id>
{ printf 'Finish-line replay of the Collab household smoothing: **%s**\n\n' "$(tail -1 "$REPLAY_DIR/check.txt")"
  printf 'sol job `%s`, workspace `%s`, local repo `~/play/collab-duet-replay` (record in REPLAY.md).\n\n```text\n' "$JOB" "$WS"
  sed -e '/^live transcript /d' -e 's/ · journal [^ ]* · / · /' -e "s#$HOME#~#g" "$REPLAY_DIR/check.txt"; printf '```\n'; } > "$REPLAY_DIR/pr-comment.md"
grep -c "$HOME" "$REPLAY_DIR/pr-comment.md"; cat "$REPLAY_DIR/pr-comment.md"
sol access run github -- pr comment feat/collab-household-smoothing-20261008 --repo cambridgetcg/agenttool --body-file "$REPLAY_DIR/pr-comment.md"
```
The `grep` must print `0`. If the comment command fails ambiguously, do not retry it. First check with `sol access run github -- pr view feat/collab-household-smoothing-20261008 --repo cambridgetcg/agenttool --comments`.


