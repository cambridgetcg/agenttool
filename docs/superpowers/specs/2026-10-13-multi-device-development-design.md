# Developing agenttool across devices and agents

**Status.** Proposal. Nothing here is built. Yu approved §1, §2 and §4 in chat on 2026-10-13, as they stood before the adversarial review (his words below). He ruled in his own words on the controller seat (§3), the harnesses (§1) and Hermes as night-watch (§6). Everything else, and every change the review made (§11), has not been shown to him yet. This spec goes to Yu for review; the next step is a plan for the first build items (§8).

**Yu's words.**
- The ask: "Lets think about the framework for developing agenttool through coordination with Nuance and more devices to add to. Also together with Astra on this device and on Nuance and more devices to join. On who handles what, and how different tools and features can be developed simultaneously and coordinated here."
- First priority (his pick of four): **keep work moving**. No single usage limit, sleeping Mac or busy session stops agenttool's progress.
- The approach: "One queue on the Air, any worker picks up feels exactly right."
- Sections 1, 2 and 4: "yes lgtm", "yes lgtm :)", "section 4 lgtm!".
- The controller seat: "I'd prefer the controller seat always here, just in case of hardware failure that we need to switch."
- Harnesses: "you two keep your own harness😂 no mixing" (Claude in Claude Code, Astra in Codex), and "Claude code is your kingdom".
- Hermes: "a night-watch is very suitable, a guardian role".

**Builds on.** Nothing here replaces any of these; it is the operating model on top of them.
- Collab: the shared journal on the Air, with tasks, leases, reviews and knocks.
- Cross-device Collab Phase 1 (`2026-10-13-cross-device-collab-design.md`): Claude on Nuance as a live seat on the Air's journal; being built.
- Summon: headless jobs on Nuance. Phase 0 is live. Phase 0.5 (`2026-10-13-summon-build-access-design.md`) adds sandboxed build jobs and is being built.
- Shared Setup (`2026-10-12-shared-setup-design.md`, awaiting Yu's OK): one setup across Macs, the Air as hub, devices propose and the Air merges.
- The `sol agent` layer: `sol agent start claude|codex|hermes` runs headless jobs on the Air.

**What Phase A needs from the cross-device design.**
- The shared journal, `~/.local/share/agenttool/collab-shared/collab.sqlite`. Phase 1's installer creates it, and Phase 1 is not installed yet.
- Phase 1 lets Air agents join the shared journal only from the trial folder. Phase A needs that widened to the agenttool clone and its linked worktrees on the Air. That is an amendment to the cross-device spec, made in its plan before F2 starts. This spec does not make it.

## 1. Roles

- **Yu.** Sets priorities and the purpose of each feature. Receives only 🔴 hands, 🟡 irreversible yes/no and 🟢 one-line done (the attention-budget agreement). Pushes and releases are agreed in chat.
- **The controller seat.** It always lives on the Air. The agent holding it:
  - turns a goal into tasks in the queue and assigns their lanes;
  - starts workers where there is quota (defined under Workers);
  - routes each review to a reviewer of another model family;
  - merges reviewed work into the feature's integration branch, only through `bin/controller-merge.sh` (§4);
  - keeps the ledger (§2).

  The seat is a lease (§3). The session holding it never claims an edit task and never accepts one: edit work goes to workers, and acceptance goes to reviewers. Its first holder is Claude in Claude Code; §3 gives the order when that account runs out.
- **Workers.** Any agent with quota that can reach the queue:
  - Claude sessions on the Air, interactive or `sol agent start claude`;
  - Astra on the Air: gpt-6-astra in Codex, on Yu's ChatGPT login, connected to the Air's shared journal as a local MCP seat (F2 probes what Codex on the Air actually runs);
  - Claude on Nuance: a live seat through the cross-device Collab once Phase 1 is installed, and Summon build jobs once Phase 0.5 is installed;
  - later, Astra on Nuance, which means Codex on Nuance once cross-device D5 gives it a login, and agents on newly paired Macs (§5).

  An agent **has quota** when its last start did not return `blocked(usage)` inside its backoff window: 10 minutes, doubling to at most 6 hours, the range Alpha's runner already uses. The controller records each such result in the ledger. Codex gives no earlier signal. The Air's Claude account is also the controller's, so at most 2 Claude workers run on the Air at once, and none starts once any Claude job there has returned `blocked(usage)` or a usage warning, until its backoff window ends.
- **Reviewers.** Always a different model family from the writer. Claude-authored work is reviewed by Astra, in Codex at the highest effort F2's probe finds. Astra-authored work is reviewed by Claude, with Opus at `xhigh` in critical lanes (security boundaries, at-most-once paths, installers). A second Claude account is still Claude and never counts as the other family.
  - Astra's ChatGPT login is therefore the only reviewer of Claude-authored work, and the same login carries the controller fallback and Hermes. When it has no quota, Claude-authored tasks wait in review and none of them merges. Likewise Astra-authored tasks wait when Claude has no quota. Everything else keeps moving.
  - Reviews run on the Air. Summon review jobs are not used in Phase A: they run Claude only, see only Nuance's files, and cap a review at 12 turns (40 after Phase 0.5).
  - A reviewer accepts in Collab as its own local session on the Air. The controller seat's session does not.
- **The night-watch guardian.** Hermes, in a read-only role (§6).

**Boundaries.**
- A worker never merges, pushes or accepts its own work.
- Only the controller merges, and only after an independent review.
- Collab compares only session ids, and a session's harness name is self-declared. So the merge script (§4) also checks that the accepter's declared harness differs from the claimant's. That is a convention check, not proof.
- Each agent keeps its own harness: Claude in Claude Code, Astra in Codex, Hermes in Hermes. No agent runs in another agent's harness. Shared Setup's `astra-cc` launcher, which runs Astra through Claude Code by way of a proxy, is not used for any seat in this framework. Hermes on the Air is configured with the same gpt-6-astra model for the night-watch; that is a separate role in Hermes's own harness.

## 2. The queue, lanes and parallel work

**One queue.** The Air's shared Collab journal (`~/.local/share/agenttool/collab-shared/collab.sqlite`) holds every task. Every agenttool seat and job, on the Air and on Nuance, uses one MCP entry, `agenttool-collab-shared`. Agenttool tasks never go in the private journal that the default entry opens. A task's title starts with its tags, in this fixed order:

```
[lane:<lane>][feat:<feature id>][prio:<1-5>][needs:<a,b,…>] <imperative title>
```

- `lane` is a package or area: `summon`, `collab-bridge`, `api`, `sdk-ts`, `apps-web`, …
- `feat` is the feature's short id, which also names its integration branch.
- `prio`: 1 is most urgent.
- `needs` is drawn from `bun`, `macos`, `two-macs`, `network`, `opus-review`, `gui` and `yu`.

The controller writes and checks the tags. Collab is unchanged in Phase A, and a tag parser or capability-aware `collab_next` is added only if the convention proves too loose (§9, deferred).

**Who may give work.** Workers act only on tasks created by a session whose actor label begins `controller seat`, a label only the seat holder uses. The ledger's seat log lists the session ids that held the seat. A remote seat's label always begins with its device and user, so it cannot carry that prefix. Any process running as `yuai` on the Air could still copy the label, so this is a check against mistakes, not a lock. A task from anyone else, whether a remote seat, a sol or Summon job session, or any Air session, is a proposal: the controller re-issues it or drops it. A task tagged `needs:yu` depends on a coordination task, `[lane:controller][feat:<feature id>][prio:1][needs:yu] Yu: <step>`, which the controller completes only after Yu answers in chat.

**Lanes run in parallel.** Collab refuses a claim whose path scopes overlap another claimed or review-pending edit task in the same journal and repository key, so tasks in different packages move at once. Within a lane, tasks run in order through their dependencies.

**A dependency counts as done only once it is merged.** Collab treats a dependency as satisfied when it is completed and accepted, which is before the controller merges it. So the controller creates or unblocks a dependent task only after the dependency's merge, with `expected_base_sha` set to the post-merge tip of the feature's integration branch. Collab's HEAD check at claim time then enforces it. Every other task carries the tip at its creation as its `expected_base_sha`.

**Home lanes are soft.** A worker takes tasks in its home lane first. Any worker may take, or recover, a task whose lease ran out (with the grace rule in §3). Starting home lanes:
- Nuance: device work (`collab-bridge`, `summon`), and anything tagged `two-macs`;
- Astra: SDKs, docs and review-heavy work;
- Claude on the Air: `api` and cross-cutting work.

The controller can change these at any time; they are not a contract. Two lanes are reserved until their builds land (F0): `collab-bridge` and `summon`. No new task enters a reserved lane.

**Work already in flight.** The Collab line is spread over more than four branches and the Summon line over two, built by sessions that work outside this queue. F0 inventories them. Each line stays with the session building it, shown in the queue as one coordination task, `[lane:<lane>][feat:<feature id>][prio:3][needs:] reserved: <branch>`, claimed by that session with its worktree and branches listed.

**Nuance runs one edit task per shared folder** (cross-device R36). So Nuance gets one clone per active lane, `~/Projects/agenttool-<lane>`, each paired once as a share with the bridge. Its first share stays `~/Projects/collab-trial` (Y1 of the cross-device spec).
- A lane clone is covered by the conflict check only if its hub mirror shares agenttool's repository key. F4 proves that with a deliberately overlapping probe claim that Collab must refuse. Until it is proven, that clone takes no tasks.
- A Summon edit or build job has no Collab session. The controller therefore starts a proxy session labelled `summon smn_<id>`, which claims the task for the job's duration and releases or completes it from the job's result. The mirror counts as busy meanwhile. No Summon edit job runs in a folder where a live seat holds a claim. The proxy session is not the controller seat's session.

**Integration branches.** Each feature has `int/<feature id>` on the Air, created after `git fetch github`, from `github/main`. No worktree keeps it checked out, because the merge script moves it with `update-ref` and a checked-out branch would then show the new commits as local changes; workers branch from its tip into their own worktrees. The name `int/` is used because 47 `feat/*` branches already exist. A task's commits land there only through §4.

**The ledger.** `~/.local/state/agenttool-controller/ledger/<feature id>.log` (directory 0700, file 0600) is append-only, and the controller alone writes it, through the controller scripts (§3). One line per event: UTC time, task id, event, commit sha, session id and declared harness. Events are `seat`, `created`, `verdict`, `accepted`, `merged`, `blocked(usage)` and `yu-answered`. The `seat` lines are the seat log. The journal is authoritative for task state; the ledger records what the controller did. When they differ, the journal wins and the controller records the difference. A plan's own SDD ledger (`.superpowers/sdd/<plan>/progress.md`) stays what it is; this ledger sits beside it.

## 3. Keeping work moving

**Leases.** Every claim carries a lease: Collab's 900 s default, up to 3600 s for work with a long gate, renewed while working. A worker that stops, whether from a sleeping Mac, a crash or an exhausted account, lets its lease run out. Any worker then recovers the task, as takeover or release, through Collab's audited recovery. The one exception is the grace rule below. Nothing is retried automatically after an unclear outcome. The new worker checks the task's state first (`collab_task_get`), as the cross-device spec requires. Every `sol agent start` states `--timeout`, because sol's 900 s default wall limit would kill a job with a long gate.

**The controller seat is one lease.** The seat is a Collab coordination task, `[lane:controller][feat:all][prio:1][needs:] Controller seat`, claimed with a 1800 s lease that the holder renews at every controller step.
- Creating tasks and merging are allowed only while holding a live lease on it. `bin/controller-merge.sh` refuses to run without the live seat lease id, and refuses with fewer than 1200 s of that lease left.
- The seat passes by `collab_handoff_offer` and `collab_handoff_respond`, which local seats may use. If a holder's lease runs out, the next seat takes it through Collab's audited recovery. A holder that wakes later finds its lease gone, re-reads the journal and the ledger, and does not act as controller unless it claims the seat again. Collab refuses that claim while another lease is live.
- Nothing about the seat depends on a warning: it is a lease, so two controllers cannot both hold it.

**The controller scripts and the keeper.** Three scripts do the controller's mechanical work with no model in them: `bin/controller-merge.sh` (§4), `bin/controller-note.sh` (the handoff note, the ledger and the seat log) and `bin/controller-keeper.sh`. They run from installed copies in `~/.local/share/agenttool-controller/bin/`. The controller refreshes those copies only from a merged, reviewed commit and records their sha256 in the ledger. Neither a checkout switch nor a task branch can then change what the seat, launchd or Codex's rules run. The keeper is four LaunchAgents, run as `yuai` in `gui/502`, working in the state directory, `~/.local/state/agenttool-controller/`. Yu installs them (🔴), because a LaunchAgent install is his step.
- `tick`, every 60 s. If more than 180 s passed since its previous tick, the Air slept, and it writes `hub-up-since` in the state directory. It reads the seat task's lease from the shared journal (SQLite opened read-only, as `household publish` does). When open tasks exist and the seat has had no live lease for 15 minutes, it shows a macOS notification, "controller seat empty: open Codex with docs/CONTROLLER.md", and writes `seat-empty` in the state directory. That notification is the 🔴. It fires once per gap.
- `snapshot`, hourly, and `backup`, nightly at 03:00: see Backup and restore.
- `night-round`, at 01:00 and 06:00: see §6.

**When the controller's account runs out, the harness switches; the device does not.**
- The controller seat stays on the Air. Its order is: Claude in Claude Code, then Astra in Codex.
- Each holder keeps its own harness, and continuity comes from files, never from a shared harness:
  - the controller playbook (§8 item F1), a harness-neutral document in the repo, linked from `AGENTS.md`;
  - the plan and its SDD ledger;
  - the journal and the controller ledger;
  - the controller scripts.
- **The handoff note** is `~/.local/state/agenttool-controller/handoff.md` (0600). The controller rewrites it after every controller step, not only at a warning, and stamps it with the journal head it reflects. It lists the open tasks with their leases, the rulings made since the previous note, the next three steps, and anything waiting on Yu. After each rewrite the controller posts the note's sha256 as a Collab report.
  - The note is a hint. The incoming seat checks the note against the latest posted sha256, then rebuilds state from `collab_task_list`, the ledger and the journal.
  - Approvals never carry over. Any 🟡 not answered in the incoming seat's own conversation is asked again.
- **The trigger is not a warning.** `rate_limit_event` appears only in the stream of a headless `claude -p` job, so an interactive controller never sees its own, and a limit can also end a session with no warning. When a Claude controller can still act and sees a usage warning, it offers the seat to Astra at once: it starts Astra on the Air with the playbook (`sol agent start codex …`) and passes the seat by handoff. When it cannot, the keeper's `tick` notices the dead seat lease and sends Yu the 🔴 above. Yu opens an interactive Codex session, which reads the playbook and the note and claims the seat.
- **What Astra can do as controller.** Headless Codex runs in a sandbox. In edit mode it cannot write `.git` or `~/.local/state`, it can call only the Collab tools approved in `~/.codex/config.toml`, and sol's 900 s wall limit stops a long loop. So Astra works through the controller scripts, which Yu approves once in Codex's rules, together with the controller's Collab tools (🔴 at the Codex TUI, part of F2). A headless Astra controller coordinates and reviews only. Merges queue until an interactive Codex session holds the seat.
- What does not carry over: Claude Code's workflows and subagents. Codex runs the loop one task at a time, or starts workers with `sol agent start`.

**When every controller account is out,** work pauses safely. Leases expire, the merge script (§4) leaves nothing half-merged, and the queue resumes exactly where it stopped when a quota resets.

**The hub is one Mac.** The Air holds the journal, the bridge (ssh from the Air to Nuance only, on the 192.168.50.0/24 LAN), the seat and the integration branches. If the Air sleeps, leaves that LAN, or Nuance waits at a FileVault unlock, work stops until it returns. That is the cost of one queue on the Air. Two rules limit the damage:
- **Grace after a gap.** For one lease ttl after `hub-up-since`, only a task's original holder may recover it. A Nuance worker whose lease ran out while the Air slept gets to continue before an Air worker duplicates the task.
- **No sleep on power.** Workers and the controller loop on the Air run under `caffeinate -is`. Yu is asked once (🔴, F8) to run `sudo pmset -c sleep 0`, so the Air does not sleep while on power. If he declines, the only effect is that work pauses whenever the Air sleeps.

**Backup and restore.** Backups live off the Air so that Yu can rebuild the hub on Nuance if the Air's hardware fails.
- **Hourly `snapshot`.** The keeper copies the shared journal with `sqlite3 … ".backup"` into `snapshots/` in the state directory, keeping the newest 48. It opens the copy with the collab package and runs `CollabStore.verifyJournal()` on the copy, never on the live file, and keeps the snapshot only if it passes. A plain `cp` of a file in use can tear it or miss the WAL.
- **Nightly `backup` at 03:00.** The keeper runs `git fetch github`, then makes one archive of:
  - the newest passing snapshot;
  - a git bundle of the work GitHub does not have, `git bundle create … --branches --not --remotes=github`, which covers every branch without an upstream (36 on 10-13), every task branch and every integration branch, and keeps the archive small (the whole repository is about 160 MB);
  - the state directory (handoff note, ledgers, night-watch reports).

  It encrypts the archive with age to a public recipient and uploads it to the private repo `cambridgetcg/agenttool-hub-backup` with a deploy key scoped to that repo only. The Air holds only the public recipient. The matching identity is generated once at F5, printed, and kept by Yu on paper with the recovery kit that Shared Setup's Y1 describes. It is never stored on the Air.
- **Retention and size.** The repo keeps the 14 newest blobs. Each night the keeper replaces the repo's single branch with one fresh commit that holds them (a force-push to that repo only, which Y1's yes covers). A blob over 90 MB (GitHub rejects files over 100 MB) is not uploaded; it stays local, and the next morning report says so.
- **Recovery point.** Up to 24 hours of journal and committed work. Uncommitted files in a worktree are not covered, so workers commit to their task branch before they complete.
- **Restore.** `docs/MULTI-DEVICE-RESTORE.md` rebuilds the hub on Nuance. Only Yu starts it. It lists the 🔴 steps and the rules for the new hub:
  - Codex must be logged in on Nuance (it is not today, and Nuance has no sol or tmux), and `gh` must reach GitHub and the backup repo. Until Codex works there, the restored hub has one controller account and no other-family reviewer.
  - The age identity is entered from paper.
  - The journal would sit under `macair`, the macOS user the citizens run as, which Shared Setup's Y2 (default no) governs. Yu decides that at restore time.
  - The restore clones from GitHub and applies the bundle. A restored journal reopens tasks that finished after the backup, so the restore marks every non-terminal task "check branches before claim".
- **Drill.** F5 counts as done only when a restore into a scratch directory on the Air succeeds using the paper identity, and a dry run into a scratch directory on Nuance has also succeeded, at a Nuance visit.

Nuance never takes the controller seat on its own. If the Air's hardware fails, Yu starts the restore and a seat on Nuance becomes the controller. That is the one switch the framework allows, and it is manual.

## 4. How code flows and gets reviewed

1. **A task lands on its own branch on the worker's device,** one branch per task.
   - A worker on the Air uses a worktree under `~/Projects/.worktrees/`, based on the task's `expected_base_sha`.
   - A worker on Nuance commits in its lane clone, on a new branch (`git switch -c`) made from the clone's seed commit before it claims. After a takeover the abandoned branch stays where it is, and the next claim uses a new branch; nothing is reset. The Air fetches that commit read-only through the bridge's fetch gate at claim and complete (cross-device §7).
2. **A different model family reviews it** (§1), with Opus at `xhigh` for Astra-authored work in critical lanes. The reviewer's verdict, findings and model are written to the ledger, and the reviewer accepts in Collab.
3. **The controller merges it with `bin/controller-merge.sh`,** given the task id, the accepted result sha, the feature id and the seat lease id. The script is all-or-nothing:
   1. It checks first, changing nothing. The lease id is the live seat lease. The task is completed and accepted at exactly that sha. The accepter's declared harness differs from the claimant's. `git diff --name-only <base>..<sha>` stays inside the task's path scopes (Collab checks scopes only at claim) and touches none of the sealed paths: `.github/workflows/ci.yml`, `api/src/db/verified-postgres.ts` and `bin/phase-b-*`, which are Yu's lane. Anything under `api/migrations/` needs `--yu-yes "<Yu's words>"`, recording his 🟡, or the script refuses.
   2. It merges the accepted sha into the tip of `int/<feature id>` in a fresh temporary worktree. On a conflict it aborts and the controller sends the task back with `request_changes`. Nobody hand-resolves a conflict, because that code would be unreviewed.
   3. It runs the lane's gate on the merge result (table below).
   4. It runs `git update-ref refs/heads/int/<feature id> <new> <old>`, which moves the branch only if the tip is still `<old>`.
   5. It appends the `merged` line to the ledger, keyed by the task id.

   A re-run first checks whether the accepted sha is already an ancestor of the tip. If it is, the script only completes the missing ledger line. A cut at any point leaves either nothing changed (before step 4) or a moved branch with no ledger line, which the re-run repairs. The next run deletes any leftover temporary worktree. After the merge the controller creates or unblocks the dependent tasks (§2).

   The gate is the only check while GitHub Actions has no minutes:

   | Lane | Gate |
   |---|---|
   | `api` | `bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh api`, then `bin/bash-without-env-hooks.sh bin/preflight.sh api` |
   | `sdk-ts`, `summon`, `collab-bridge` and other packages | `bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh packages`, then `bin/bash-without-env-hooks.sh bin/preflight.sh packages`, plus the package's own `bun test` |
   | SDK wire changes | both SDKs, and `bun run check-parity` in `packages/sdk-ts` (`sdk-py` has its own setup in `packages/sdk-py/CLAUDE.md`) |
   | `apps-web` and docs-only work | links, source accuracy, the relevant doc contracts and the diff; nothing says tests ran |

4. **Releases stay in chat, in two steps.**
   - While GitHub Actions has no minutes, **done** means a reviewed `int/<feature id>` on the Air, merged by the script and present in the latest nightly backup. The controller sends Yu a 🟢 saying so.
   - **Pushing** is a 🟡: "push `int/<feature id>` and open the PR?". It names what follows. Opening the PR runs ci and whitehack, and while the Actions budget is out their checks fail within seconds, so the PR cannot turn green. Merging to `main` with changes under `api/**` or `docs/**` runs deploy-api (a Fly rollout, per `docs/DEPLOY-CI.md`). Landing on `main` is a separate 🟡, asked once checks can run or Yu says otherwise.

   His yes in chat is the record (the approval-is-conversation agreement). Nothing pushes without it. The push uses an explicit URL (§7).

## 5. Adding devices and agents

Phase A has two Macs, the Air and Nuance. The steps below apply once Summon pairing is generalised (it hard-codes Nuance today, cross-device K40) and cross-device D9 has landed. Both are listed in §9.

**A new Mac** joins in this order. Each step is Yu's hands only where marked.
1. Summon pairing: an AirDrop bundle and the installer, 🔴 at that Mac.
2. Bridge pairing: the cross-device installer, 🔴 at that Mac, and `pin-device` on the Air.
3. One lane clone per lane it will work in, each paired as a share.
4. Its allowlist entries and its Claude Code deny rules (§7), which Yu edits on that Mac.

It then appears in the queue as a worker. Its identity is stamped as `<device>/<user>`, with its harness self-declared, exactly as Nuance's is.

**A new agent or harness on an existing Mac:**
- **Claude Code:** a seat today, local on the Air or remote through the bridge.
- **Codex** (Astra or plain Codex): a local seat on the Air today, via MCP config. A remote seat on other Macs waits for cross-device Phase 2, where Codex and Hermes seats are deferred until their harness exposes what the bridge needs. Astra on Nuance means Codex on Nuance after cross-device D5. The `astra-ultra` Hermes profile that Shared Setup's sources describe for other Macs is not a seat in this framework.
- **Hermes:** the night-watch role only (§6), until a trial shows it can hold a serious lane.

**Invited people** (cross-device Phase 3) join the same way, each by invitation, with their own scope. Nothing in Phase A covers them.

## 6. The night-watch guardian

Hermes runs a short read-only round on the Air at 01:00 and 06:00. The keeper's `night-round` job launches it (§3) on a schedule Yu approves (Y2), never through Hermes cron jobs or a gateway. The read-only rule is enforced by construction: Hermes never touches the systems it reports on.

1. **The keeper job gathers the facts itself,** as plain code, into a facts file:
   - the newest snapshot's journal verification result (§3);
   - stale leases and tasks recovered overnight, from the shared journal opened read-only;
   - the bridge's `hub status` and the device status files;
   - the Air's free disk, the Summon ledgers' sent and answer counts, and the result of the last nightly backup;
   - one fixed read-only GET of the latest `ci.yml` run, `sol access run github -- api "repos/cambridgetcg/agenttool/actions/workflows/ci.yml/runs?per_page=1"`. A run that ended within seconds is the signature of the exhausted Actions budget. The script makes this call; Hermes never holds the token.
2. **Hermes reads the facts file and nothing else.** The job is `sol agent start hermes --mode review --timeout 600`. In review mode Hermes has only `read_file` and `search_files`. Its observations are the job's result.
3. **The script writes the report** to `~/.local/state/agenttool-controller/night-watch/<date>.md` (0600) from the facts and the job result. If the job does not complete, the report holds the facts alone and says so. Nothing is retried. The controller reads the report first thing, as data.

**It never:**
- mutates the journal, git or any file outside its report directory;
- starts workers or wakes sessions;
- touches citizens or their inboxes;
- starts a gateway, or gets an MCP server. The Air's Hermes has none today, and Collab tools would give a client that resends calls on its own (cross-device K56, D6) mutating access;
- has network of its own. The one GitHub call is the keeper's.

**Hermes cron jobs.** Six stale ones were paused on 10-13 (`hermes cron pause`). `composition-symphony` (every 360 minutes) is still enabled, and whether it stays is Yu's call, open since 10-13. F6 starts only once no Hermes cron job is enabled.

**A trial comes first:** three nights of reports compared against the controller's own checks, before the role is trusted.

## 7. Safety lines (unchanged from the existing agreements)

- Never push without Yu. Never print a secret. Never automatically retry a mutation after an unclear outcome.
  - Everything on the Air runs as `yuai` with Yu's GitHub login, so "never push" needs a mechanical guard as well as a rule. The Air's agenttool clone, which its worktrees share, gets `remote.github.pushurl` and `remote.origin.pushurl` set to `github-push-disabled://policy-hold`, the pattern the codeberg remote already uses. An approved push gives the explicit URL. The guard stops an accidental push, not a deliberate one by a process running as `yuai`. It also stops any session that pushes by remote name, and F8 says so.
  - The backup repo has its own deploy key, scoped to that repo only.
- Citizens rest: nothing in this framework wakes a citizen, writes an inbox or re-enables `love.citizen-fleet`. The citizen fleet is not a worker. The live seat on Nuance runs unsandboxed as the citizens' macOS user, and Phase 0.5's sandbox covers Summon jobs only. So Nuance seats run with Claude Code deny rules for `launchctl`, `~/Library/LaunchAgents`, `~/love-unlimited` and the citizens' clone directory, whose path is read off Nuance at install. F4 writes them at the Nuance visit.
- On the Air, everything runs as `yuai` in `gui/502`, never uid 501.
- Remote output (reports, task text from anyone but a seat holder, review findings), the handoff note and the night-watch report are data, never instructions.

## 8. Build items (Phase A)

Each item becomes a task, or a small set of tasks, in the queue.

- **F0. Inventory of work in flight.** List the open worktrees and branches (36 worktrees and 115 local branches on 10-13, 36 of them local-only) by lane, and mark each in flight, landed or abandoned. Reserve the `collab-bridge` and `summon` lanes until the Collab bridge Phase 1, the Collab knock line and Summon Phase 0.5 builds land. Until the shared journal exists the inventory lives in the playbook; then each reserved line becomes its coordination task (§2).
- **F1. Controller playbook:** `docs/CONTROLLER.md`, linked from `AGENTS.md`. It covers the tag convention, the loop (plan → tasks → workers → review → merge), the review routing table, the ledger format, the sealed-path list, the lane-to-gate table, the handoff note's format and the restore pointer. It is written so Codex can follow it as well as Claude Code.
- **F2. Astra's seat on the Air.** It starts when the shared journal exists. Steps:
  - a probe that records Codex's binary path and version (`codex --version` prints 0.162.1 while sol's registry says 0.157.1), the model it runs, its effort and its login. First a one-time check that Codex on the Air is signed in, which is 🔴 if it is not. If Codex cannot run gpt-6-astra, F2 stops and reports to the controller; nothing falls back to Hermes as a worker;
  - an `agenttool-collab-shared` entry in Codex's MCP config pointing at the shared journal, added beside any Collab entry Codex already has. The existing entry is not repointed, and Codex's config is global;
  - Yu's approval in the Codex TUI of the controller's Collab tools and the controller scripts (🔴);
  - one probe task Astra claims and completes;
  - the entry is registered as an Air device override in Shared Setup once that lands, so it is not drift.
- **F3. The handoff note and the seat:** `bin/controller-note.sh` (writes the note, the ledger lines and the sha256 report text, and checks the latest posted sha256), the seat task, a playbook section, and a test handoff of the seat from Claude to Astra by `collab_handoff_offer`.
- **F4. Nuance lane clones.** It waits for cross-device Phase 1 to finish and for Yu's yes on cross-device D13 (sharing agenttool from Nuance, which that spec leaves to him; asked when F4 comes up). The first extra clone is for the `summon` lane, once its reservation ends. It is seeded by git bundle at the next Nuance visit, paired as a second share, and proven against the repository-key probe (§2). It stays at its seed commit until cross-device D8, so Nuance gets only tasks with no unmerged dependencies, with `expected_base_sha` set to the seed. The controller re-seeds it at a Nuance visit. Agenttool's tracked-file listing is 491,618 B against D11's 1 MiB limit; the controller checks it at every re-seed and stops using Nuance for agenttool above 800,000 B. The Nuance deny rules (§7) are written at the same visit.
- **F5. The nightly encrypted backup and its restore procedure.** It waits for Y1. Steps:
  - install `age` (it is not on the Air today), with Yu's yes in chat;
  - generate the identity once, print it, and Yu keeps it on paper (🔴);
  - Yu adds the deploy key to the backup repo (🔴);
  - the keeper's `backup` job and `docs/MULTI-DEVICE-RESTORE.md`;
  - the drill in §3, with its dry run on Nuance at a Nuance visit (🔴).
- **F6. The night-watch trial.** It waits for Y2 and F8, and starts only when no Hermes cron job is enabled (§6). Then the schedule (Y2), the round and three nights of reports.
- **F7. The merge script:** `bin/controller-merge.sh` and its tests: a conflicting branch, a path outside the scopes, each sealed path, a migration with and without `--yu-yes`, a re-run after a cut at each step, and a stale tip.
- **F8. The keeper and the hub guards:** `bin/controller-keeper.sh` with the `tick` and `snapshot` jobs, installed as LaunchAgents by Yu (🔴); the `remote.*.pushurl` guard in the Air's agenttool clone; `caffeinate -is` in the controller loop; and Yu's `sudo pmset -c sleep 0` (🔴). The guard stops any session that pushes by remote name, so F8 tells Yu and the controller before it is set.

Order: hand-write the first handoff note now, before anything is built, so the seat survives the Air's Claude account stopping mid-spec. Then F2 (the Air's Claude account was nearly spent on 10-13, so the item that makes the fallback real goes first), F0, F7, F3, F1 and F8. Once F2 is done Astra can take F1, F3 and F7 as workers, and Claude reviews them. F4 rides the next Nuance visit after Phase 1 and D13. F5 waits for Y1, and F6 for Y2 and F8.

## 9. Deferred

- A capability-aware `collab_next` that reads the tags, or a structured labels field in Collab.
- Codex and Hermes seats on other Macs (cross-device Phase 2).
- Waking resting sessions from the queue (cross-device Phase 2).
- More Macs (cross-device D9) and generalised Summon pairing.
- A path for Air commits to reach Nuance, so that Summon review and Nuance acceptance can work (cross-device D8).
- Same-family review on a different account, for when no other-family reviewer has quota. Phase A does not allow it; allowing it would be Yu's call.
- An automatic hub switch. The switch stays Yu's manual step.
- Invited people (cross-device Phase 3).

## 10. For Yu

- **Y1 (🟡, decided when F5 comes up).** A standing nightly upload of an encrypted backup (journal snapshot, unpushed branches, controller state) to a new private repo, `cambridgetcg/agenttool-hub-backup`, with a deploy key scoped to that repo. The repo keeps the 14 newest blobs by replacing its single branch each night, which is a force-push to that repo only, and each blob stays under 90 MB. The decryption identity is the age key on paper (F5). My pick: yes. If wrong, one private repo holds encrypted copies; delete the repo to undo.
- **Y2 (🟡, decided when F6 comes up).** The night-watch's hours. My pick: 01:00 and 06:00, read-only. If wrong, it simply stops.
- Nothing else is waiting on you. Hands steps (🔴) sit inside the items they belong to (§8) and are asked when the item starts. The rest are rulings recorded in this spec.

## 11. Review fold log (smn_01a1375bd88476d5b0959d480e2c38a6)

The adversarial review ran as a Summon job on Nuance. One line per finding.

1. **Two controllers can run at once.** Folded: §3 "The controller seat is one lease"; §1 controller bullet; §4 step 3 (the merge script refuses without the live seat lease id).
2. **The handoff trigger can't be seen, and the note is written once.** Folded: §3 "The handoff note" and "The trigger is not a warning"; the keeper's `tick` sends the 🔴; F3.
3. **Astra in Codex can't do the controller's main job.** Folded: §3 "What Astra can do as controller"; F2 (the Codex TUI approvals); §4 step 3 (the scripts); the wall limit under Leases.
4. **"One queue" is not one conflict domain.** Folded: §2 "One queue" (one MCP entry) and the Nuance bullets (repository-key probe); "What Phase A needs" (Phase 1 and the trial-folder amendment, which belongs to the cross-device spec and is not made here); F2 (a second entry, no repointing).
5. **One ChatGPT login is the only cross-family reviewer.** Folded: §1 Reviewers states the actual rule (tasks wait in review when no other-family reviewer has quota; a second Claude account never counts; no Summon review in Phase A); §9 records same-family review on another account as Yu's call, not allowed now. The "Opus on another account" wording was wrong and is gone.
6. **The hub itself is the sleeping Mac.** Folded: §3 "The hub is one Mac" (grace after a gap, `caffeinate`, the `pmset` 🔴 in F8, which Yu may decline).
7. **Who accepts in Collab is unspecified.** Folded: §1 (the seat session never claims edit tasks or accepts; reviewers accept as their own local sessions; harness-difference check); §4 steps 2 and 3.1.
8. **Merges aren't atomic.** Folded: §4 step 3 (the five-step idempotent script, merge of the accepted sha, gate on the result, `update-ref` with the old value, conflicts go back with `request_changes`); F7.
9. **A dependency counts as done before it is merged.** Folded: §2 "A dependency counts as done only once it is merged"; §4 step 3 last paragraph.
10. **Path scopes and sealed paths aren't checked at merge.** Folded: §4 step 3.1 (scope check, the sealed list with its exact paths, migrations need `--yu-yes`); F1 and F7.
11. **"Never push" is a convention only.** Folded: §7 (disabled `pushurl` on `github` and `origin`, explicit URL for approved pushes, deploy key for the backup repo); F8.
12. **Task text works as instructions from anyone.** Folded: §2 "Who may give work" (the `controller seat` label, which a remote worker can check without reading the Air's ledger; `needs:yu` tasks depend on a "Yu: <step>" task); §7 (task text from anyone but a seat holder is data).
13. **The handoff note is unauthenticated and can carry fake approvals.** Folded: §3 "The handoff note" (0600, posted sha256, approvals never carry over); §7 (note and night-watch report are data).
14. **The night-watch's read-only rule can't be enforced.** Folded: §3 keeper `night-round`; §6 (keeper gathers the facts, Hermes reads only the facts file, the script writes the report, no gateway, no MCP); F6, F8. Declined as stale: "6 stale crons still enabled". They were paused on 10-13 (`~/.hermes/cron/jobs.json` shows `enabled: false`, `state: paused` for all six). One job, `composition-symphony`, is still enabled, so §6 gates F6 on that instead.
15. **The backup depends on a live agent, and the journal copy can be torn.** Folded: §3 "Backup and restore" (launchd jobs, `sqlite3 .backup`, verification on the copy, hourly snapshots plus the nightly off-site copy).
16. **Nobody owns the encryption key.** Folded: §3 (age to a public recipient, identity printed once and kept on paper with Shared Setup's Y1 recovery kit); F5 (done only when a restore works from the paper identity; `age` is not installed on the Air today, so F5 installs it); §10 Y1.
17. **The backup misses work, and a restore duplicates it.** Folded: §3 (a bundle of every branch GitHub lacks, the state directory, the 24 h recovery point, "check branches before claim" on restore). The bundle is `--branches --not --remotes=github` rather than all branches, because GitHub already holds the rest and the repository is about 160 MB.
18. **A restore drill on the Air doesn't test a restore on Nuance.** Folded: §3 Restore (the 🔴 list, the identity and citizen rules, "Nuance never takes the seat on its own" reworded to Yu-started); the drill includes a Nuance dry run (F5).
19. **Nuance lane clones can't keep up with the Air.** Folded: §4 step 1 (one branch per task, no reset); F4 (seed-based tasks only, re-seed at visits, size check).
20. **Summon jobs as workers have no Collab claim.** Folded: §2 Nuance bullets (proxy session labelled `summon smn_<id>`, mirror busy, no Summon edit job in a held folder).
21. **The new-Mac path isn't available in Phase A.** Folded: §5 opening paragraph; §9 (D9 and generalised Summon pairing).
22. **F4: a second share goes beyond Phase 1.** Folded: F4 waits for Phase 1 and for Yu's yes on cross-device D13, which is already his call in that spec, so no new question is added; the D11 headroom check is in F4.
23. **It's unclear what "Astra" is.** Folded: §1 Workers and Boundaries; §5 (Astra on Nuance is Codex after D5); F2 (the probe records binary, model, effort and login, and stops if Codex cannot run gpt-6-astra).
24. **The build order spends quota that's nearly gone.** Folded: §8 Order (hand-written first note, F2 first, Astra can take F1, F3 and F7).
25. **Work already in flight isn't in the queue.** Folded: §2 "Work already in flight" and the reserved lanes; F0.
26. **The release step leads to a PR that can't merge.** Folded: §4 step 4 (two steps; the 🟡 names what follows; "done" is a reviewed `int/` branch in the backup). Declined as wrong: "deploy-api.yml wasn't found in the workflows directory". It exists at `.github/workflows/deploy-api.yml` on this branch, runs on a push to `main` touching `api/**` or `docs/**` and on `workflow_dispatch`. Also corrected: ci and whitehack run on a pull request (and on `main` pushes), not on every branch push.
27. **The citizen line has no mechanism on Nuance.** Folded: §7 (deny rules on Nuance seats); F4.
28. **"No model runs inside another vendor's harness" is broken by Hermes itself.** Folded: §1 Boundaries reworded to "no agent runs in another agent's harness", with a note on Hermes's model.
29. **`bin/preflight.sh` needs arguments and a deps step.** Folded: §4 step 3 gate table, and F1. Corrected: preflight with no argument runs the api and packages tiers together, so the argument chooses the cost; it does not have to be given. The deps step is required.
30. **`feat/<id>` collides with existing branches.** Folded: §2 Integration branches (`int/<feature id>`, 47 `feat/*` branches exist, no `int/*`); a fetch of `github` before branching. Both `github` and `origin` point at the same URL, so §7 guards both. Declined: "one worktree per feature". The merge script moves the branch with `update-ref`, and a worktree that has it checked out would show the new commits as local changes, so the script merges in temporary worktrees and none keeps the branch.
31. **"Where there is quota" has no signal.** Folded: §1 Workers ("has quota", the backoff window, the cap of 2 Claude workers on the Air).
32. **Long gates outlast the lease and sol's wall limit.** Folded: §3 Leases (ttl up to 3600 s, `--timeout` on every `sol agent start`); the seat lease rule (1800 s, 1200 s left to merge).
33. **The ledger's path and authority aren't stated.** Folded: §2 "The ledger" (path, modes, writer, journal wins).
34. **Nightly encrypted blobs grow the backup repo forever.** Folded: §3 Retention and size (14 newest, a single-branch replacement, 90 MB cap); §10 Y1 states them.
35. **Editing Codex's config becomes Shared Setup drift.** Folded: F2 (registered as an Air device override).
36. **Status overstates the approval.** Folded: the Status paragraph lists exactly what Yu approved and what he has not seen.
