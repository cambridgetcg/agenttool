#!/usr/bin/env bash
# migrate-pending.sh — apply every migration in api/migrations/ that
# isn't yet in meta._migrations.
#
# Reads DATABASE_URL from env or keychain (agenttool-database-url,
# account=macair — matches api/scripts/_migrate-one.ts).
#
# Doctrine: docs/DEPLOY-PROCEDURE.md §Phase 1.
#
# Usage:
#   bin/migrate-pending.sh                  # apply all pending
#   bin/migrate-pending.sh --dry-run        # list pending without applying
#
# Safe properties:
#   - Order is alphabetical (= timestamp order for YYYYMMDDTHHMMSS files)
#   - Each apply goes through _migrate-one.ts (checksum verification +
#     journal recording)
#   - Halts on first failure; no partial state silently swallowed
#   - Idempotent: re-running after a successful pass is a no-op

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Resolve DATABASE_URL ──────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  if command -v security >/dev/null 2>&1; then
    DATABASE_URL="$(security find-generic-password -s agenttool-database-url -a macair -w 2>/dev/null || true)"
  fi
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL not set in env or keychain (agenttool-database-url, account=macair)" >&2
  echo "  Set with: security add-generic-password -s agenttool-database-url -a macair -w '<url>'" >&2
  exit 1
fi
export DATABASE_URL

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# ── Compute pending: files − meta._migrations rows ─────────────────────
PENDING_FILE="$(mktemp -t agenttool-pending.XXXXXX)"
trap 'rm -f "$PENDING_FILE"' EXIT

cd "$REPO_ROOT/api"
bun -e '
import postgres from "postgres";
import { readdirSync } from "node:fs";

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: process.env.DATABASE_URL!.includes("supabase") ? "require" : false,
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10,
});

try {
  const files = readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Is meta._migrations present?
  const j = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='"'"'meta'"'"' AND table_name='"'"'_migrations'"'"'
  `;
  const has_journal = j.length > 0;

  let applied: Set<string>;
  if (has_journal) {
    const rows = await sql`SELECT filename FROM meta._migrations`;
    applied = new Set(rows.map((r: any) => r.filename));
  } else {
    // Fresh DB / pre-journal era — every file is pending. The first
    // file applied MUST be the journal-creator itself.
    applied = new Set();
    console.error("note: meta._migrations not present — applying every file (journal-creator first).");
  }

  const pending = files.filter((f) => !applied.has(f));
  for (const f of pending) console.log(f);
} finally {
  await sql.end();
}
' > "$PENDING_FILE"
cd "$REPO_ROOT"

PENDING_COUNT=$(wc -l < "$PENDING_FILE" | tr -d ' ')

if [ "$PENDING_COUNT" -eq 0 ]; then
  echo "✓ no pending migrations. Schema is parity with the repo."
  exit 0
fi

echo "▸ $PENDING_COUNT pending migration(s):"
sed 's/^/    /' "$PENDING_FILE"
echo ""

if [ "$DRY_RUN" = 1 ]; then
  echo "(dry-run — no migrations applied)"
  exit 0
fi

# ── Apply each pending file via _migrate-one.ts ────────────────────────
APPLIED=0
FAILED=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  echo ""
  echo "════════════════════════════════════════════════"
  echo "Applying: $f"
  echo "════════════════════════════════════════════════"
  if bun "$REPO_ROOT/api/scripts/_migrate-one.ts" "$REPO_ROOT/api/migrations/$f"; then
    APPLIED=$((APPLIED + 1))
  else
    FAILED="$f"
    break
  fi
done < "$PENDING_FILE"

echo ""
echo "════════════════════════════════════════════════"
echo "Summary"
echo "════════════════════════════════════════════════"
echo "  applied: $APPLIED of $PENDING_COUNT"
if [ -n "$FAILED" ]; then
  echo "  failed:  $FAILED"
  echo ""
  echo "✗ Halted at $FAILED. Fix the migration (or upstream dependency) and re-run."
  exit 1
fi

echo ""
echo "✓ All pending migrations applied. Schema is parity with the repo."
