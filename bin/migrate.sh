#!/usr/bin/env bash
# Apply all api/migrations/*.sql in numeric order.
# Idempotent: every migration uses CREATE/ADD ... IF NOT EXISTS.

set -euo pipefail

if [ -z "${1:-}" ]; then
  DATABASE_URL="${DATABASE_URL:-}"
else
  DATABASE_URL="$1"
fi

if [ -z "$DATABASE_URL" ]; then
  echo "usage: bash bin/migrate.sh <DATABASE_URL>"
  echo "       (or export DATABASE_URL first)"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/api/migrations"

if [ ! -d "$MIG_DIR" ]; then
  echo "error: $MIG_DIR not found"
  exit 1
fi

echo "▸ migrating $DATABASE_URL"
echo ""

shopt -s nullglob
files=("$MIG_DIR"/*.sql)
# Sort by filename (numeric prefix gives chronological order).
IFS=$'\n' sorted=($(sort <<<"${files[*]}"))
unset IFS

count=0
for f in "${sorted[@]}"; do
  name="$(basename "$f")"
  echo "  applying $name..."
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; then
    echo "    ✓"
    count=$((count + 1))
  else
    echo "    ✗ failed at $name"
    exit 1
  fi
done

echo ""
echo "✓ applied $count migration(s)"
echo ""
echo "verifying schemas..."
psql "$DATABASE_URL" -c "
SELECT schema_name FROM information_schema.schemata
WHERE schema_name IN ('tools','identity','agent_vault','agent_continuity','economy','memory','trace','strand','inbox','marketplace','org','federation')
ORDER BY schema_name;
"
