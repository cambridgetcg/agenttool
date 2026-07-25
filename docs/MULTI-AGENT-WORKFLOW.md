# MULTI-AGENT-WORKFLOW

> *Several agent sessions, one repository, one correct deploy.*

> **Compass:** [CROSS-DEVICE-COLLABORATION](CROSS-DEVICE-COLLABORATION.md) (the three planes) · [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (the six phases) · [AGENTS.md](../AGENTS.md) (the handbook) · `packages/collab/skills/coordinate-agent-work/SKILL.md` (the agent-facing instruction)
>
> **Code:** `bin/agenttool-guard.sh` · `bin/agenttool-guard.ts` · `.githooks/` · `bin/deploy.sh` §`enforce_no_outstanding_claims`

---

## The situation this is for

Claude Code, Codex, and Hermes sessions work this repository at the same time,
sometimes on correlated modules. They may share one working tree, and they
cannot see each other.

**What already worked.** `@agenttool/collab` reserves paths properly: a task
declares `path_scopes`, `collab_task_claim` throws `path_scope_conflict` on
overlap, and the conflict query joins across every workspace sharing a
`repository_key` — so linked worktrees of one clone are covered, and the
refusal is fail-closed (`packages/collab/src/store.ts:5027`, `:4522-4535`).
Dependencies sequence work: a dependent task cannot be claimed until its
dependency is completed *and* peer-accepted (`:5017`).

**What did not.** On 2026-07-24 23:33:25 two sessions shared this tree. Session
A staged 17 files. Session B ran `git commit` with a populated index and took
all 17 into its own feature commit, under its own message. Nobody noticed until
A read `git show --stat`.

Neither session had declared a task, so none of the enforcement above ran. It
could not have: the coordination plane reserves *declared paths* in a database
at *claim time*, and the damage happened to *actual files* in a *shared index*
at *commit time*, with no code from this repository in the process's path.

Three consequences follow, and the rest of this document is about them.

1. Coordination that requires an agent to first suspect it is not alone will
   not fire, because discovering you are not alone is the thing coordination
   would have told you.
2. The release gate could not see the coordination plane at all. Worse, it
   inverted: while A's work sat staged the tree was dirty and
   `enforce_release_source` blocked the deploy — punishing the deployer. The
   moment B's commit drained the index, the tree was clean, the gate approved,
   and Phase 5 verified every machine carried the contaminated source.
3. The journal on this machine has recorded **zero** coordination sessions,
   ever. The primitives are correct and were not used. That is the actual
   failure, and no amount of further protocol fixes it.

---

## Install, once per machine

```bash
git -C /path/to/agenttool config core.hooksPath .githooks
bun bin/agenttool-guard.ts doctor      # journal, schema, whether the guard is live
bin/agenttool-guard.sh doctor          # identity, ledger, who owns what is staged
```

`core.hooksPath` is written to the shared `.git/config`, so every linked
worktree of this clone picks it up. A worktree checked out at a revision
without `.githooks/` silently runs no hook — old trees degrade to the previous
behaviour rather than erroring.

---

## The floor — no collab required

Two hooks, and nothing to remember:

```bash
git add <your paths>      # post-index-change records who staged what
git commit -m "..."       # pre-commit refuses if the staged set holds another live session's files
```

The guard is deliberately weak, and each weakness is load-bearing:

- **It ignores dead owners.** A crashed session must never wedge the
  repository. This is the opposite of collab's fail-closed task lease, on
  purpose — the guard exists to prevent loss, not to reserve.
- **It never fires solo.** A pre-commit hook that refuses a legitimate commit
  even once gets uninstalled the same day, and after that the residual risk is
  silently 100%. `bin/tests/agenttool-guard.test.ts` spends more assertions on
  *not* firing than on firing.
- **It is a no-op during rebase, merge, cherry-pick and revert.** Replayed
  history is written by git on behalf of other authors; ownership is
  meaningless there and a refusal would strand the operation.
- **It records only newly staged paths.** `post-index-change` is not a
  `git add` hook — it also fires on `git status --porcelain`, which
  `packages/collab/src/repository.ts:118` runs on every collab verb. If the
  ledger recorded "the caller owns everything staged", the collab MCP server
  would take ownership of your work just by being polled.
- **It does not lock files and grants no authority.** It answers one question
  at one moment and refuses one commit. `AGENTTOOL_GUARD=off` and
  `--no-verify` both work; `post-commit` runs under `--no-verify` too, so the
  bypass leaves a line in `.git/agenttool-guard-audit.log`. Making a bypass
  expensive teaches people to script around it; making it visible does not.

When it fires:

```
✗ agenttool-guard: this commit would take 17 file(s) staged by another live session.
      api/src/services/economy/escrow.ts
          staged by claude:56495 at 2026-07-24T23:14:07Z
      ...
  Commit only your own paths:
      git commit -m "..." -- <your paths>
```

That remedy leaves their files staged for them. Verified in test.

---

## The declared layer — required for correlated modules

The guard catches the collision. It does not stop two agents editing the same
module into incompatible shapes, and it cannot cover `git commit -a`, which
stages foreign *modified* files that were never `git add`ed and so have no
recorded owner. For that, declare the work:

```
collab_session_start   { root_path: "<repo>", actor: "<name>" }
collab_task_create     { work_mode: "edit",
                         path_scopes: ["api/src/services/economy", "api/tests/doctrine"],
                         dependencies: [] }
collab_task_claim      { task_id, expected_version }     # throws path_scope_conflict on overlap
... edit ...
git add <your paths>
git commit -m "..." -- <your paths>
collab_task_complete   { task_id, summary, evidence_refs: ["<sha>"] }
```

Then a **different** bound session reviews:

```
collab_task_review     { task_id, outcome: "accept" }
```

Acceptance is the convergence event: an `accepted`-policy task keeps its path
reservation through review, and drops it only here
(`packages/collab/src/store.ts:4517-4519`). Self-review is refused
(`:3299-3304`).

---

## Mode A — converged: everyone finishes, then one release

1. Every session runs the declared layer above on disjoint scopes. Overlap is
   refused at claim time, not discovered at merge time.
2. Each session commits with an explicit pathspec, pushes its branch, opens a
   PR. Branch protection is `strict: true`, so the second PR touching a
   correlated module must rebase — the later author owns the resolution, in
   their own tree.
3. Every task completes and is accepted by another session.
4. The release operator, in one tree at `github/main`:

```bash
bun bin/agenttool-guard.ts readiness --mode converged
bash bin/deploy.sh
```

`deploy.sh` runs that check itself (`enforce_no_outstanding_claims`) and
refuses while **any** task under this repository is claimed, holds an expired
lease, or is completed-but-unaccepted.

## Mode B — sequential: agents release in turn

Declare the order in the data rather than in conversation:

```
collab_task_create { ..., dependencies: ["<A.task_id>"] }
```

B's *claim* is refused until A is completed and accepted
(`store.ts:5017`). Ordering needs no new mechanism.

Then each agent releases only what it shipped:

```bash
bash bin/deploy.sh --since <last-deployed-sha>
```

`--since` scopes the refusal to the paths actually changing: the diff from that
revision to `HEAD` is matched against live claims with the same `pathConflicts`
matcher collab uses at claim time (`store.ts:5468`), so one matcher serves
claim-time, commit-time and release-time and the three cannot drift. An agent
working an untouched module does not block the release. **Without `--since`,
sequential mode falls back to the converged predicate** — conservative on
purpose, because with no base revision there is no way to know what is
shipping.

---

## Failure branches

| Branch | What happens | What you do |
|---|---|---|
| **Conflicting paths at claim** | `path_scope_conflict`, naming the holder and the overlapping pairs | Narrow your scope, or declare `dependencies: [<their task>]` and wait. Do not re-claim wider. |
| **Conflicting paths at commit** | `pre-commit` exits 1, foreign paths and owners printed, index untouched | `git commit -m "..." -- <your paths>` |
| **Expired lease** | `readiness` reports it as `lease_expired` and blocks. There is no reaper — expiry is a read-time predicate, so a dead session's claim sits there until someone acts | `collab_task_recover { disposition: "release" \| "takeover", recovery_note }`. Inspect progress and artifacts first; never delete the row. |
| **Abandoned session, no task declared** | The ledger owner fails a liveness check, so the guard ignores it and the commit proceeds | Nothing. |
| **Failed preflight/CI** | Phase 2 aborts before any external mutation | Fix it. Do not `--skip-preflight`. |
| **Ambiguous deploy** | The `EXIT` trap writes `failed_or_uncertain`; the device mutex releases by inode check | Re-run `bin/deploy.sh`; Phase 5 per-machine provenance is the arbiter. |
| **Guard degraded** (no bun, unreadable journal) | `readiness` exits 2 — "could not determine". `deploy.sh` allows only the never-used-collab case and blocks every other undetermined result | Report it. Do not reach for `--no-verify`. |

`bin/deploy.sh --allow-outstanding-claims` exists and prints an unmissable
override banner. Exit 2 is not exit 0 anywhere in this path: *"I could not
look"* and *"I looked and it was clear"* must never be the same answer to a
release gate.

---

## Known limits, stated rather than implied

- **The guard is per-index.** Linked worktrees have separate indexes and
  separate ledgers, which is correct — they cannot collide. Separate *clones*
  share nothing, and the journal's `repository_key` covers them only if both
  clones use the same collab database.
- **The relay is not deployed.** `/v1/collab/*` returns 404, so the cross-device
  release room is not available on this instance today. Everything above works
  device-locally.
- **Two hosts run an older collab bundle.** The `repository_key` join that makes
  path exclusivity cross-workspace is not in every installed binary — check
  before relying on it across worktrees.
- **The journal on this machine may predate the code.** `bun bin/agenttool-guard.ts doctor`
  prints the schema it found. The guard reads it read-only and will never
  migrate it as a side effect of being asked a question.
- **None of this is a lock.** Collab does not lock files; the guard refuses one
  commit; the release gate refuses one deploy. Every one of them is
  overridable, and every override is recorded.

---

> *The primitives were right. Nothing made anyone reach for them, and the one
> place the damage lands had no code of ours in it.*

— 2026-07-25. Free to evolve.
