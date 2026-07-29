#!/usr/bin/env bash
# Compatibility entry point for creating or applying migrations.
#
# `new` creates an ISO-timestamped migration. Apply operations delegate to the
# checksum-journaled pending runner instead of replaying every SQL file.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_DIR="$ROOT/api/migrations"

usage() {
  cat <<'EOF'
usage:
  bin/migrate.sh new <descriptive_slug>
  bin/migrate.sh [--dry-run]

DATABASE_URL is transaction-pooled survey access, read from the environment or
the configured Keychain entry by the pending runner. Applying pending files
also requires session-pooled DATABASE_SESSION_URL or the dedicated
agenttool-database-session-url Keychain entry.

A positional postgres:// URL remains accepted only as backward-compatible
DATABASE_URL survey input. It is never printed and never satisfies the separate
session-pooled apply requirement. Before applying, the pending runner requires
the session endpoint to report the same complete migration inventory. Matching
inventories do not prove pool type or database identity; configure both scoped
URLs for the same intended database.
EOF
}

next_timestamp() {
  TS="$1" bun -e '
    const value = process.env.TS ?? "";
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
    if (!match) process.exit(2);
    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second) + 1,
    ));
    const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
    process.stdout.write(iso);
  '
}

new_migration() {
  local slug="${1:-}"
  if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9_]*$ ]]; then
    echo "error: migration slug must match [a-z0-9][a-z0-9_]*" >&2
    exit 2
  fi

  local timestamp path
  timestamp="$(date -u +%Y%m%dT%H%M%S)"
  path="$MIG_DIR/${timestamp}_${slug}.sql"
  while [ -e "$path" ]; do
    timestamp="$(next_timestamp "$timestamp")"
    path="$MIG_DIR/${timestamp}_${slug}.sql"
  done

  {
    printf '%s\n' "-- ${timestamp}_${slug}.sql — TODO: one-line description."
    printf '%s\n' "--"
    printf '%s\n' "-- Doctrine: docs/TODO.md"
    printf '%s\n' "-- Apply with the checksum-journaled runner: bin/migrate-pending.sh"
    printf '\n'
  } > "$path"

  echo "$path"
}

case "${1:-}" in
  new)
    [ "$#" -eq 2 ] || {
      usage >&2
      exit 2
    }
    new_migration "$2"
    ;;
  -h|--help)
    usage
    ;;
  ""|--dry-run)
    exec "$ROOT/bin/migrate-pending.sh" "$@"
    ;;
  postgres://*|postgresql://*)
    # Legacy callers passed the connection URI as argv. Keep the compatibility
    # survey path, but scope it to the child process and never echo or promote
    # it to DATABASE_SESSION_URL.
    database_url="$1"
    shift
    exec env DATABASE_URL="$database_url" "$ROOT/bin/migrate-pending.sh" "$@"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
