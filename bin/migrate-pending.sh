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
#   bin/migrate-pending.sh --help           # print this contract
#   bin/migrate-pending.sh --maintenance-quiesced
#                                            # assert an exclusive cutover
#
# Safe properties:
#   - Order is alphabetical (= timestamp order for YYYYMMDDTHHMMSS files)
#   - Each apply goes through _migrate-one.ts (checksum verification +
#     journal recording)
#   - Quiescence-required files refuse before the first apply unless the
#     operator explicitly asserts an exclusive maintenance boundary
#   - Halts on first failure; no partial state silently swallowed
#   - Idempotent: re-running after a successful pass is a no-op

set -euo pipefail

usage() {
  cat <<'EOF'
usage:
  bin/migrate-pending.sh
  bin/migrate-pending.sh --dry-run
  bin/migrate-pending.sh --maintenance-quiesced
  bin/migrate-pending.sh --dry-run --maintenance-quiesced
  bin/migrate-pending.sh --help

With no arguments, applies every pending checksum-journaled migration.
--dry-run inspects the journal and lists pending files without applying them.
--maintenance-quiesced asserts that the operator established the exclusive
cutover required by api/migrations/quiescence-required.txt. It permits those
files; it does not inspect or prove machine, writer, worker, or ingress state.
EOF
}

# Parse the complete argv before resolving DATABASE_URL. Unknown or extra
# arguments must never turn a typo (especially `--help`) into a live apply.
DRY_RUN=0
MAINTENANCE_QUIESCED=0
if [ "$#" -gt 2 ]; then
  echo "error: expected at most two supported options" >&2
  usage >&2
  exit 2
fi
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      if [ "$DRY_RUN" = 1 ]; then
        echo "error: duplicate argument: --dry-run" >&2
        usage >&2
        exit 2
      fi
      DRY_RUN=1
      ;;
    --maintenance-quiesced)
      if [ "$MAINTENANCE_QUIESCED" = 1 ]; then
        echo "error: duplicate argument: --maintenance-quiesced" >&2
        usage >&2
        exit 2
      fi
      MAINTENANCE_QUIESCED=1
      ;;
    -h|--help)
      if [ "$#" = 1 ]; then
        usage
        exit 0
      fi
      echo "error: --help cannot be combined with other arguments" >&2
      usage >&2
      exit 2
      ;;
    *)
      echo "error: unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

QUIESCENCE_REQUIRED_EXIT=42
QUIESCENCE_REQUIRED_FILE="$REPO_ROOT/api/migrations/quiescence-required.txt"
if [ ! -s "$QUIESCENCE_REQUIRED_FILE" ]; then
  echo "✗ missing quiescence policy manifest: $QUIESCENCE_REQUIRED_FILE" >&2
  exit 1
fi
if ! LC_ALL=C sort -cu "$QUIESCENCE_REQUIRED_FILE" 2>/dev/null; then
  echo "✗ quiescence policy manifest must be sorted and contain no duplicates" >&2
  exit 1
fi
while IFS= read -r migration || [ -n "$migration" ]; do
  if [[ ! "$migration" =~ ^[0-9]{8}T[0-9]{6}_[a-z0-9_]+\.sql$ ]]; then
    echo "✗ invalid quiescence policy entry: $migration" >&2
    exit 1
  fi
  if [ ! -f "$REPO_ROOT/api/migrations/$migration" ]; then
    echo "✗ quiescence policy entry has no migration file: $migration" >&2
    exit 1
  fi
done < "$QUIESCENCE_REQUIRED_FILE"

# ── Resolve DATABASE_URL ──────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  if command -v security >/dev/null 2>&1; then
    DATABASE_URL="$(security find-generic-password -s agenttool-database-url -a macair -w 2>/dev/null || true)"
  fi
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL not set in env or keychain (agenttool-database-url, account=macair)" >&2
  echo "  Set with: security add-generic-password -U -s agenttool-database-url -a macair -w" >&2
  exit 1
fi
export DATABASE_URL

# ── Compute pending: files − meta._migrations rows ─────────────────────
PENDING_FILE="$(mktemp -t agenttool-pending.XXXXXX)"
QUIESCENCE_PENDING_FILE="$(mktemp -t agenttool-quiescence-pending.XXXXXX)"
trap 'rm -f "$PENDING_FILE" "$QUIESCENCE_PENDING_FILE"' EXIT

cd "$REPO_ROOT/api"
bun -e '
import { createHash } from "node:crypto";
import postgres from "postgres";
import { readdirSync } from "node:fs";

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: process.env.DATABASE_URL!.includes("supabase") ? "require" : false,
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10,
});

try {
  const journalMigration = "20260509T170000_meta_migrations.sql";
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
  let orderedFiles = files;
  if (has_journal) {
    const rows = await sql`SELECT filename, checksum FROM meta._migrations`;
    const filesOnDisk = new Set(files);
    for (const row of rows) {
      const filename = String(row.filename);
      if (!filesOnDisk.has(filename)) {
        throw new Error(
          `migration source missing for journaled file: ${filename}`,
        );
      }
      const bytes = await Bun.file(`migrations/${filename}`).arrayBuffer();
      const actual = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
      if (actual !== row.checksum) {
        throw new Error(
          `migration checksum drift: ${filename} (journal ${String(row.checksum).slice(0, 16)}..., repo ${actual.slice(0, 16)}...)`,
        );
      }
    }
    applied = new Set(rows.map((r: any) => r.filename));
  } else {
    if (!files.includes(journalMigration)) {
      throw new Error(`journal migration is missing: ${journalMigration}`);
    }
    // The journal has no schema dependency on the numbered migrations. Apply
    // it first so every later file is recorded in the transaction that applies it.
    orderedFiles = [journalMigration, ...files.filter((f) => f !== journalMigration)];
    applied = new Set();
    console.error("note: meta._migrations not present — applying every file (journal-creator first).");
  }

  const pending = orderedFiles.filter((f) => !applied.has(f));
  for (const f of pending) console.log(f);
} finally {
  await sql.end();
}
' > "$PENDING_FILE"
cd "$REPO_ROOT"

PENDING_COUNT=$(wc -l < "$PENDING_FILE" | tr -d ' ')
if grep -Fxf "$QUIESCENCE_REQUIRED_FILE" "$PENDING_FILE" \
  > "$QUIESCENCE_PENDING_FILE"; then
  :
else
  GREP_STATUS=$?
  if [ "$GREP_STATUS" -ne 1 ]; then
    echo "✗ failed to compare pending migrations with the quiescence policy" >&2
    exit 1
  fi
fi
QUIESCENCE_PENDING_COUNT=$(
  wc -l < "$QUIESCENCE_PENDING_FILE" | tr -d ' '
)

if [ "$PENDING_COUNT" -eq 0 ]; then
  echo "✓ migration inventory clean: no repo files pending; every journaled filename has source; checksums match. This does not prove database schema parity or detect out-of-band DDL."
  exit 0
fi

echo "▸ $PENDING_COUNT pending migration(s):"
sed 's/^/    /' "$PENDING_FILE"
echo ""

if [ "$QUIESCENCE_PENDING_COUNT" -gt 0 ]; then
  echo "✗ $QUIESCENCE_PENDING_COUNT pending migration(s) require an exclusive maintenance cutover:"
  sed 's/^/    /' "$QUIESCENCE_PENDING_FILE"
  echo ""
  if [ "$MAINTENANCE_QUIESCED" = 0 ]; then
    echo "Refusing before the first migration."
    echo "After stopping old API writers, webhook ingress, and workers so they cannot restart,"
    echo "re-run with --maintenance-quiesced as an operator assertion."
    echo "That assertion permits the files; it does not prove the maintenance boundary."
    exit "$QUIESCENCE_REQUIRED_EXIT"
  fi
  echo "⚠ --maintenance-quiesced is an operator assertion, not a machine-state check."
  echo ""
fi

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
  MIGRATION_ARGS=(
    "$REPO_ROOT/api/scripts/_migrate-one.ts"
    "$REPO_ROOT/api/migrations/$f"
  )
  if [ "$MAINTENANCE_QUIESCED" = 1 ]; then
    MIGRATION_ARGS+=("--pending-runner-maintenance-quiesced")
  fi
  # Keep the assertion child-scoped. In ordinary mode, strip any ambient copy
  # instead of passing a false-looking value that future code could misread.
  if (
    unset AGENTTOOL_PENDING_RUNNER_MAINTENANCE_QUIESCED
    if [ "$MAINTENANCE_QUIESCED" = 1 ]; then
      export AGENTTOOL_PENDING_RUNNER_MAINTENANCE_QUIESCED=1
    fi
    bun "${MIGRATION_ARGS[@]}"
  ); then
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
echo "✓ migration inventory clean: no repo files pending; every journaled filename has source; checksums match. This does not prove database schema parity or detect out-of-band DDL."
