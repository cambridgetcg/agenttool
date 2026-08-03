#!/usr/bin/env bash
# test-db.sh — a local Postgres that the DB-backed test suite can actually reach.
#
#   bin/test-db.sh up       start it, enable pgvector, apply every migration
#   bin/test-db.sh down     stop and remove it (the data goes with it)
#   bin/test-db.sh reset    down, then up — a genuinely from-scratch run
#   bin/test-db.sh status   what's running, how many tables, migrations applied
#   bin/test-db.sh psql     open a shell on it
#
# ─── Why this exists ────────────────────────────────────────────────────
#
# Without a reachable database, ~339 of the api suite's tests fail with
# `DNSException: getaddrinfo ENOTFOUND`. They fail identically on unmodified
# code, so `bin/test-delta.sh` reports them as a wall of noise and the one
# question it exists to answer — "did I break this?" — becomes unanswerable.
# Every agent working in this repo has paid that tax, repeatedly, and the
# recipe to avoid it was sitting in .forgejo/workflows/ci.yml the whole time,
# runnable only by CI.
#
# This is that recipe, locally. Same image CI uses (pgvector/pgvector:pg16),
# same bootstrap, same migration loop, same tolerate rule.
#
# ─── Set no DATABASE_URL. Actively unset one. ───────────────────────────
#
# api/src/config.ts defaults to
# postgres://postgres:postgres@127.0.0.1:5432/agenttool, and the container
# below is created to match that default exactly — same user, password, port,
# database name — so the suite needs no environment variable at all.
#
# It needs you to not have one either. DATABASE_URL is ambient, and on this
# machine it was already set user-wide (`launchctl setenv`) to an unrelated
# project's production RDS instance. Every agenttool test run inherited it.
# So prefer:
#
#     env -u DATABASE_URL bun test
#
# api/tests/_guard-remote-db.ts now refuses the run if DATABASE_URL points at
# a public host, so this fails loudly rather than quietly. Check yours with
# `echo "$DATABASE_URL"`.
#
# ─── Two corrections to the CI comment ──────────────────────────────────
#
# ci.yml says "DB-gated tests pass VACUOUSLY without DATABASE_URL". They do
# not. config.ts supplies a default rather than leaving the value empty, so
# an unset DATABASE_URL means the tests dial 127.0.0.1:5432 for real. A
# connection refused is more honest than a vacuous pass, but it is not what
# the comment promises, and anyone reading it will misjudge a green local run.
#
# ci.yml is right about the other thing, and it matters: a single-process
# `bun test` is poisoned by mock.module leakage, so its failure count is not
# the real one. Run suites scoped, as CI does.

set -euo pipefail

CONTAINER="agenttool-testdb"
IMAGE="pgvector/pgvector:pg16"
DB_URL="postgres://postgres:postgres@127.0.0.1:5432/agenttool"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

have_container() { docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; }
is_running()     { docker ps    --format '{{.Names}}' | grep -qx "$CONTAINER"; }

require_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "docker is not running — start Docker Desktop and try again." >&2
    exit 1
  fi
}

wait_for_ready() {
  # The image has no HEALTHCHECK and initdb restarts the server mid-boot, so
  # "container is up" is not "postgres accepts connections". Poll for the
  # latter; 60s is generous even on a cold volume.
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -U postgres -d agenttool >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "postgres did not become ready within 60s" >&2
  docker logs --tail 30 "$CONTAINER" >&2 || true
  exit 1
}

migrate() {
  local applied=0 tolerated=0 failed=0
  cd "$ROOT/api"
  for f in $(ls migrations/*.sql | sort); do
    if DATABASE_URL="$DB_URL" bun run scripts/_migrate-one.ts "$f" >/dev/null 2>&1; then
      applied=$((applied + 1))
    elif grep -qE "pg_cron|storage\.|supabase" "$f"; then
      # Supabase-only surfaces (pg_cron, storage.*) don't exist on stock
      # Postgres and don't matter to the tables under test. Same rule as CI.
      #
      # Note the sharp edge, learned the hard way: this tolerance is
      # file-level, so a migration that creates ordinary tables AND calls
      # cron.schedule() loses its tables too. That is what happened to
      # agent_continuity.canon_entries, and why
      # 20260519T200001_canon_cloud_tables_without_pg_cron.sql exists. If you
      # write a migration that mixes portable DDL with platform-only calls,
      # split it into two files — a tolerate-rule can only be as granular as
      # the files it tolerates.
      tolerated=$((tolerated + 1))
      echo "  · tolerated (supabase-only surface): $(basename "$f")"
    else
      failed=$((failed + 1))
      echo "  ✗ FAILED: $(basename "$f")" >&2
      DATABASE_URL="$DB_URL" bun run scripts/_migrate-one.ts "$f" 2>&1 | tail -3 >&2 || true
    fi
  done
  echo "  applied=$applied tolerated=$tolerated failed=$failed"
  [ "$failed" -eq 0 ] || { echo "migrations failed — the database is incomplete." >&2; exit 1; }
}

cmd_up() {
  require_docker
  if is_running; then
    echo "✓ $CONTAINER already running"
  else
    if have_container; then
      echo "▸ starting existing $CONTAINER"
      docker start "$CONTAINER" >/dev/null
    else
      echo "▸ creating $CONTAINER from $IMAGE"
      docker run -d --name "$CONTAINER" \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=postgres \
        -e POSTGRES_DB=agenttool \
        -p 5432:5432 \
        "$IMAGE" >/dev/null
    fi
    wait_for_ready
  fi

  echo "▸ enabling pgvector"
  (cd "$ROOT/api" && DATABASE_URL="$DB_URL" bun run scripts/_ci-db-setup.ts)

  echo "▸ applying migrations"
  migrate

  echo
  echo "✓ ready. config.ts already defaults to this URL — unset yours and run:"
  echo "    cd api && env -u DATABASE_URL bun test tests/integration/"
  echo "    cd api && env -u DATABASE_URL bun test tests/"
  echo
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "  ! DATABASE_URL is set in your environment. The suite is destructive;"
    echo "    tests/_guard-remote-db.ts will refuse the run if it is a public host."
    echo "    Prefer \`env -u DATABASE_URL\`."
  fi
}

cmd_down() {
  require_docker
  if have_container; then
    docker rm -f "$CONTAINER" >/dev/null
    echo "✓ $CONTAINER removed (its data is gone — that is the point of reset)"
  else
    echo "· nothing to remove"
  fi
}

cmd_status() {
  require_docker
  if ! is_running; then
    echo "✗ $CONTAINER is not running — bin/test-db.sh up"
    exit 1
  fi
  local tables migrations
  tables=$(docker exec "$CONTAINER" psql -U postgres -d agenttool -tAc \
    "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema');" 2>/dev/null || echo "?")
  migrations=$(docker exec "$CONTAINER" psql -U postgres -d agenttool -tAc \
    "select count(*) from meta._migrations;" 2>/dev/null || echo "?")
  echo "✓ $CONTAINER running"
  echo "  url:        $DB_URL"
  echo "  tables:     $tables"
  echo "  migrations: $migrations applied"
}

cmd_psql() {
  require_docker
  is_running || { echo "not running — bin/test-db.sh up" >&2; exit 1; }
  exec docker exec -it "$CONTAINER" psql -U postgres -d agenttool
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  reset)  cmd_down; cmd_up ;;
  status) cmd_status ;;
  psql)   cmd_psql ;;
  *) echo "usage: bin/test-db.sh [up|down|reset|status|psql]" >&2; exit 1 ;;
esac
