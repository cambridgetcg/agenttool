# DEVELOPMENT.md

> *Protocol for contributing to agenttool without stepping on parallel sessions.*

This is a working document about how we build, not what we build. The
how-it-works docs (`SOUL.md`, `RUNTIME.md`, `MARKETPLACE.md`, …) are
elsewhere. This one is about coordination — keeping multiple sessions
(human, agent, branches, claude-code instances) productive without
collisions.

The protocol exists because we observed the failure mode: in a single
day (2026-05-08) sequential migration numbering caused **four
collisions** (0018, 0019, 0020, 0021) between parallel work. The fix is
mostly mechanical, partly social. Both layers below.

---

## 1 · Migrations — timestamp prefix is load-bearing

**Going forward, every new migration uses a timestamp prefix:**

```
YYYYMMDDTHHMMSS_descriptive_slug.sql
```

Example: `20260508T233045_add_foo_column.sql`

### Use the helper, not your wristwatch

```bash
bun api/scripts/new-migration.ts add-foo-column
# ✓ created 20260508T233045_add_foo_column.sql
```

The helper:
- Stamps **UTC** so it's stable across machines.
- **Auto-bumps** by 1 second if the file already exists (same-second
  collisions are extremely unlikely but the bump-loop makes the worst
  case still safe).
- Generates a stub with the standard header (Doctrine pointer + Apply
  command) so you don't have to remember the format.

### Why timestamps, not numbers

Two parallel sessions with sequential numbering inevitably claim the
same `0023`. With timestamps, two sessions claiming the next free slot
within the same second is functionally impossible (the dev workflow has
many seconds of latency between "I want to make a migration" and "I'm
ready to commit"). Coordination becomes implicit instead of explicit.

### Old migrations stay numeric

`0000_bootstrap.sql` through `0022_vault_agent_encrypted.sql` remain
exactly as they are. Renaming them would break commit-history archaeology
and diff diffability. The mixed convention works because lexicographic
sort gives the right apply order:

```
0000_bootstrap.sql
0001_memory.sql
…
0022_vault_agent_encrypted.sql
20260508T233045_add_foo_column.sql      ← '0' < '2' so '0xxx' sorts first
20260509T093000_next_thing.sql
```

`ls api/migrations/` and `find … | sort` both give chronological apply
order across the convention boundary. No tooling changes needed.

### Migration content rules (unchanged)

- **Additive + idempotent** by default: `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`. Re-running
  a migration against the live DB should be a no-op.
- **Header comment** with `Doctrine:` reference and an `Apply:`
  command. The helper's stub gives you both.
- **Apply locally before commit** via `bun api/scripts/_migrate-one.ts
  api/migrations/<file>`. The DATABASE_URL comes from env or the
  `agenttool-database-url` macOS keychain entry.

---

## 2 · Other parallel-session collision sources

Migrations were the loud failure. Quieter ones:

### Schema files (`api/src/db/schema/*.ts`)

Two sessions adding columns to the same table → merge conflict at
commit. Doesn't break correctness but creates churn.

**Pattern:** if you're modifying an existing schema file, check
`git status` and `git log -- <file>` first to see if it's hot. If it
is, either:
- Add your column at the **end** of the table definition (less likely
  to conflict with someone adding a column elsewhere), or
- Coordinate with the other session before starting (a 30-second
  Slack/sketch beats a 30-minute rebase).

### `package.json` and lockfiles

Two sessions adding deps simultaneously → lockfile churn. The
deterministic merge usually works but version drift can introduce
subtle bugs.

**Pattern:** when adding a dep, add it as a **separate small commit**
that does only that. Keeps the dep introduction reviewable, and
isolates lockfile churn from feature work.

### Doc files (`README.md`, `docs/ROADMAP.md`)

Two sessions updating the same section → conflict.

**Pattern:** prefer **additive** doc edits (append a bullet, add a row)
over rewrites when the doc is shared territory. Save rewrites for when
you genuinely need to restructure.

### Working-tree visibility

The `git status` output is the only signal another session is active in
the same worktree. **Always run `git status --short` before staging.**
Untracked or modified files you didn't write are someone else's
in-flight work — leave them alone unless you're explicitly coordinating.

---

## 3 · Pre-commit checklist

Five seconds, prevents 80% of "I committed someone else's WIP" pain:

1. **`git status --short`** — see everything in the working tree.
2. **`git add <specific paths>`** — never `git add .` or `git add -A`
   when the working tree might have parallel-session work. List the
   files you wrote, by name.
3. **`git diff --cached --stat`** — confirm the staged set matches what
   you intended. Surprise files = stop and look.
4. **Run tests for what you touched** — at minimum `bun test` in the
   relevant package.
5. **Commit with a descriptive subject** following the existing style:
   `<type>(<scope>): <imperative summary>`. Body explains *why*, not
   *what* (the diff already says what).

---

## 4 · When parallel sessions collide despite the protocol

Migration collision is now structurally prevented. For other
collisions:

- **Merge conflicts at `git pull`**: resolve preferring the change with
  more context (usually the more-recent commit). Re-run tests after.
- **Working-tree files modified by both sides**: stash yours, pull
  theirs, re-apply your stash, resolve.
- **A file you renamed that they also modified**: communicate. Renames
  are the worst-case for git's detection. Avoid renaming files in hot
  parallel territory.

When you find a structural pattern that keeps biting (like the migration
collision was), **fix the pattern, not the instance** — that's how this
document came into being.

---

## 5 · Conventions cheat sheet

| Domain | Convention |
|---|---|
| New migration | `bun api/scripts/new-migration.ts <slug>` → `YYYYMMDDTHHMMSS_slug.sql` |
| Apply migration | `bun api/scripts/_migrate-one.ts api/migrations/<file>` |
| Old migrations | Stay as `0000_…` through `0022_…`. Don't renumber. |
| Schema edits | Append at end-of-table; coordinate if hot |
| Dep addition | Separate small commit; lockfile included |
| Doc edits | Prefer additive; rewrites only when restructuring |
| Pre-commit | `git status --short` → `git add <paths>` → `git diff --cached --stat` → test → commit |
| Commit style | `<type>(<scope>): <imperative>` (see `git log` for examples) |

---

## 6 · This is a living document

If you hit a collision pattern not covered here, add a section. The
protocol gets stronger when the failure modes are written down.
