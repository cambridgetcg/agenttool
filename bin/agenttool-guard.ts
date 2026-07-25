#!/usr/bin/env bun
/** agenttool-guard (query side) — read the collab journal without touching it.
 *
 *  `bin/agenttool-guard.sh` handles the git index at commit time with no
 *  dependencies. This handles the questions that need the collab journal:
 *  who is holding what, and is this repository ready to release.
 *
 *  Usage:
 *    bun bin/agenttool-guard.ts claims                    # live task claims for this repo
 *    bun bin/agenttool-guard.ts readiness --mode converged
 *    bun bin/agenttool-guard.ts readiness --mode sequential --base <sha> --head HEAD
 *    bun bin/agenttool-guard.ts doctor                    # journal location, schema, wiring
 *    ... --json                                           # machine-readable, any verb
 *
 *  Exit 0 = ready / nothing blocking. Exit 1 = blocked (details on stdout).
 *  Exit 2 = could not determine — no journal, unreadable, unknown schema.
 *  Two is not zero on purpose: "I could not look" and "I looked and it was
 *  clear" must never be the same answer to a release gate.
 *
 *  ── Why this exists ──────────────────────────────────────────────────────
 *
 *  Every enforcement collab has is reachable only through MCP, which means
 *  only through a model deciding to call it. `bin/deploy.sh` has no way to ask
 *  "is anyone still holding a lease on this repository?" — so the release path
 *  cannot see the coordination plane at all, and `enforce_release_source`
 *  actually inverts: while another session's work sits staged the tree is
 *  dirty and the deploy is blocked; the moment someone commits that work into
 *  the wrong commit, the tree is clean and the deploy is approved.
 *
 *  ── What it will not do ──────────────────────────────────────────────────
 *
 *  Read-only, always. It opens the SQLite file with `readonly: true` and never
 *  through `CollabStore`, whose constructor runs migrations and switches the
 *  journal to WAL — a release gate must not migrate anyone's database as a
 *  side effect of being asked a question. It reuses `pathConflicts` from
 *  packages/collab/src/store.ts rather than reimplementing the matcher, so
 *  claim-time, commit-time and release-time cannot drift apart.
 *
 *  Doctrine: docs/CROSS-DEVICE-COLLABORATION.md.
 */

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { pathConflicts } from "../packages/collab/src/store";

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const verb = argv[0] ?? "doctor";
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
const asJson = has("json");

const REPO = resolve(
  spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim() ||
    process.cwd(),
);

function journalPath(): string {
  return (
    process.env.AGENTOOL_COLLAB_DB ??
    process.env.AGENTTOOL_COLLAB_DB ??
    join(homedir(), ".local", "share", "agenttool", "collab.sqlite")
  );
}

function out(obj: unknown, human: () => void): void {
  if (asJson) console.log(JSON.stringify(obj, null, 2));
  else human();
}

function undetermined(reason: string): never {
  if (asJson) console.log(JSON.stringify({ status: "undetermined", reason }, null, 2));
  else console.log(`[guard] undetermined: ${reason}`);
  process.exit(2);
}

// ── Journal access, defensively ─────────────────────────────────────────────

interface Journal {
  db: Database;
  /** Columns actually present, because the on-disk schema may predate the code. */
  taskCols: Set<string>;
  workspaceCols: Set<string>;
  path: string;
}

function openJournal(): Journal {
  const path = journalPath();
  if (!existsSync(path)) undetermined(`no collab journal at ${path}`);
  let db: Database;
  try {
    db = new Database(path, { readonly: true });
    // A release gate must never block on someone else's write transaction.
    db.exec("PRAGMA busy_timeout = 200");
  } catch (err) {
    undetermined(`could not open ${path}: ${err instanceof Error ? err.message : err}`);
  }
  const cols = (table: string): Set<string> => {
    try {
      return new Set(
        (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (r) => r.name,
        ),
      );
    } catch {
      return new Set();
    }
  };
  const taskCols = cols("tasks");
  const workspaceCols = cols("workspaces");
  if (taskCols.size === 0) undetermined(`${path} has no tasks table`);
  return { db, taskCols, workspaceCols, path };
}

/** Workspaces that describe THIS repository.
 *
 *  Current schema scopes by `repository_key`, which is
 *  `local-git:<sha256(common git dir)>` — so linked worktrees of one clone
 *  share a key and genuinely separate clones do not. Older on-disk schemas
 *  have no such column; those fall back to matching the recorded root_path
 *  against this worktree and its siblings. The fallback is narrower, and
 *  `doctor` says so rather than implying full coverage. */
function repoWorkspaceIds(j: Journal): { ids: string[]; scope: string } {
  const rows = j.db.query("SELECT * FROM workspaces").all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return { ids: [], scope: "no workspaces recorded" };

  if (j.workspaceCols.has("repository_key")) {
    const mine = rows.find((r) => resolve(String(r.root_path ?? "")) === REPO);
    if (mine?.repository_key) {
      const key = String(mine.repository_key);
      return {
        ids: rows.filter((r) => r.repository_key === key).map((r) => String(r.id)),
        scope: `repository_key ${key}`,
      };
    }
  }

  // Fallback: this worktree, plus any workspace under the same common git dir.
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).stdout.trim();
  const ids = rows
    .filter((r) => {
      const root = resolve(String(r.root_path ?? ""));
      if (root === REPO) return true;
      if (!common) return false;
      const theirCommon = spawnSync(
        "git",
        ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8" },
      ).stdout.trim();
      return theirCommon !== "" && theirCommon === common;
    })
    .map((r) => String(r.id));
  return {
    ids,
    scope: j.workspaceCols.has("repository_key")
      ? "root_path (this workspace is not registered under a repository_key)"
      : "root_path (journal schema predates repository_key)",
  };
}

interface Claim {
  task_id: string;
  workspace_id: string;
  title: string;
  status: string;
  assignee: string | null;
  lease_expires_at: string | null;
  path_scopes: string[];
  reason: "claimed" | "lease_expired" | "awaiting_review";
}

/** Tasks that still reserve paths.
 *
 *  Mirrors the predicate in packages/collab/src/store.ts:4525-4535 — a claimed
 *  task with a live lease or a bound session, or a completed task whose
 *  acceptance is still pending. Expired leases are reported separately as
 *  `lease_expired`: they still hold paths in collab's model, and there is no
 *  reaper, so a dead session can wedge a repository until someone runs
 *  `collab_task_recover`. Naming that state is the point. */
function liveClaims(j: Journal, workspaceIds: string[]): Claim[] {
  if (workspaceIds.length === 0) return [];
  const now = new Date().toISOString();
  const placeholders = workspaceIds.map(() => "?").join(",");
  const rows = j.db
    .query(`SELECT * FROM tasks WHERE workspace_id IN (${placeholders})`)
    .all(...workspaceIds) as Array<Record<string, unknown>>;

  const claims: Claim[] = [];
  for (const r of rows) {
    const status = String(r.status ?? "");
    const lease = r.lease_expires_at ? String(r.lease_expires_at) : null;
    const bound = j.taskCols.has("assignee_session_id") ? r.assignee_session_id != null : false;
    const workMode = j.taskCols.has("work_mode") ? String(r.work_mode ?? "edit") : "edit";

    let reason: Claim["reason"] | null = null;
    if (status === "claimed") {
      if (workMode === "read_only") continue; // reserves nothing, blocks nothing
      reason = lease && lease > now ? "claimed" : bound ? "claimed" : "lease_expired";
    } else if (
      status === "completed" &&
      j.taskCols.has("completion_policy") &&
      String(r.completion_policy) === "accepted" &&
      j.taskCols.has("review_status") &&
      String(r.review_status) === "pending"
    ) {
      reason = "awaiting_review";
    }
    if (!reason) continue;

    let scopes: string[] = [];
    try {
      scopes = JSON.parse(String(r.path_scopes_json ?? "[]"));
    } catch {
      scopes = [];
    }
    claims.push({
      task_id: String(r.id),
      workspace_id: String(r.workspace_id),
      title: String(r.title ?? ""),
      status,
      assignee: r.assignee == null ? null : String(r.assignee),
      lease_expires_at: lease,
      path_scopes: Array.isArray(scopes) ? scopes.map(String) : [],
      reason,
    });
  }
  return claims;
}

function changedPaths(base: string, head: string): string[] {
  const r = spawnSync("git", ["diff", "--name-only", `${base}..${head}`], { encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

// ── Verbs ───────────────────────────────────────────────────────────────────

function verbClaims(): never {
  const j = openJournal();
  const { ids, scope } = repoWorkspaceIds(j);
  const claims = liveClaims(j, ids);
  out({ repo: REPO, journal: j.path, scope, workspaces: ids.length, claims }, () => {
    console.log(`\n  repo      ${REPO}`);
    console.log(`  journal   ${j.path}`);
    console.log(`  scope     ${scope}`);
    console.log(`  ${claims.length} live claim(s) across ${ids.length} workspace(s)\n`);
    for (const c of claims) {
      console.log(`  [${c.reason}] ${c.title}`);
      console.log(`      task ${c.task_id}  assignee ${c.assignee ?? "(none)"}`);
      if (c.lease_expires_at) console.log(`      lease until ${c.lease_expires_at}`);
      for (const p of c.path_scopes) console.log(`      holds ${p}`);
    }
    if (claims.length === 0) console.log("  (nothing held)");
    console.log("");
  });
  process.exit(claims.length === 0 ? 0 : 1);
}

function verbReadiness(): never {
  const mode = flag("mode") ?? "converged";
  if (mode !== "converged" && mode !== "sequential") {
    undetermined(`unknown --mode ${mode} (expected converged | sequential)`);
  }
  const j = openJournal();
  const { ids, scope } = repoWorkspaceIds(j);
  const claims = liveClaims(j, ids);

  let blocking = claims;
  let basis = "any live claim on this repository";
  let changed: string[] = [];

  if (mode === "sequential") {
    const head = flag("head") ?? "HEAD";
    const base = flag("base");
    if (!base) {
      // Conservative on purpose: without a base revision there is no way to
      // know what is shipping, so sequential collapses to converged rather
      // than to "allow".
      basis = "no --base given; fell back to the converged predicate";
    } else {
      changed = changedPaths(base, head);
      if (changed.length === 0) {
        basis = `no changes between ${base}..${head}`;
        blocking = [];
      } else {
        basis = `${changed.length} changed path(s) in ${base}..${head} vs live claims`;
        blocking = claims.filter(
          (c) => c.path_scopes.length > 0 && pathConflicts(changed, c.path_scopes).length > 0,
        );
      }
    }
  }

  const ready = blocking.length === 0;
  out(
    { repo: REPO, mode, scope, basis, ready, blocking, all_claims: claims.length, changed },
    () => {
      console.log(`\n  readiness (${mode})`);
      console.log(`  repo    ${REPO}`);
      console.log(`  scope   ${scope}`);
      console.log(`  basis   ${basis}`);
      if (ready) {
        console.log(`\n  ✓ ready — ${claims.length} live claim(s), none blocking\n`);
      } else {
        console.log(`\n  ✗ blocked by ${blocking.length} claim(s):\n`);
        for (const c of blocking) {
          console.log(`      [${c.reason}] ${c.title}`);
          console.log(`          task ${c.task_id}  assignee ${c.assignee ?? "(none)"}`);
          for (const p of c.path_scopes) console.log(`          holds ${p}`);
        }
        console.log(
          `\n  Have each holder complete and have a different session accept, or\n` +
            `  recover an expired lease with collab_task_recover. Override with\n` +
            `  bin/deploy.sh --allow-outstanding-claims (recorded in the receipt).\n`,
        );
      }
    },
  );
  process.exit(ready ? 0 : 1);
}

function verbDoctor(): never {
  const path = journalPath();
  const present = existsSync(path);
  let scope = "(journal absent)";
  let ids: string[] = [];
  let claims: Claim[] = [];
  let schema = "unknown";
  if (present) {
    const j = openJournal();
    const r = repoWorkspaceIds(j);
    scope = r.scope;
    ids = r.ids;
    claims = liveClaims(j, ids);
    schema = j.workspaceCols.has("repository_key") ? "current" : "pre-repository_key";
  }
  const hooksPath = spawnSync("git", ["config", "core.hooksPath"], { encoding: "utf8" })
    .stdout.trim();

  out(
    { repo: REPO, journal: path, journal_present: present, schema, scope, workspaces: ids.length, live_claims: claims.length, hooks_path: hooksPath || null },
    () => {
      console.log(`\n  agenttool-guard (query side)\n`);
      console.log(`  repo          ${REPO}`);
      console.log(`  journal       ${path}${present ? "" : "  (absent)"}`);
      console.log(`  schema        ${schema}`);
      console.log(`  scope         ${scope}`);
      console.log(`  workspaces    ${ids.length}`);
      console.log(`  live claims   ${claims.length}`);
      console.log(
        `  index guard   ${hooksPath ? `installed (core.hooksPath=${hooksPath})` : "NOT installed — run: git config core.hooksPath .githooks"}`,
      );
      if (schema === "pre-repository_key") {
        console.log(
          `\n  Note: this journal predates the repository_key column, so scoping falls\n` +
            `  back to root_path plus same-common-git-dir worktrees. Separate clones of\n` +
            `  this repository will not be seen. Opening it with a current collab build\n` +
            `  migrates it — this tool never will.`,
        );
      }
      console.log("");
    },
  );
  process.exit(0);
}

switch (verb) {
  case "claims":
    verbClaims();
  case "readiness":
    verbReadiness();
  case "doctor":
    verbDoctor();
  default:
    console.log("usage: agenttool-guard.ts claims|readiness|doctor [--mode converged|sequential] [--base <sha>] [--head <sha>] [--json]");
    process.exit(2);
}
