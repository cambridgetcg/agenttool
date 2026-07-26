#!/usr/bin/env bash
# Apply one checked migration from inside an existing Fly machine.
#
# This is the no-local-DATABASE_URL path. The database secret stays inside Fly;
# only the migration text, filename, and checksum cross the SSH command.
# The remote runner refuses checksum drift and records meta._migrations.
# Quiescence-listed files refuse before checksum encoding or any Fly call.
#
# Usage: bin/fly-migrate-one.sh api/migrations/<timestamp>_<name>.sql

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${FLY_APP:-agenttool}"
QUIESCENCE_REQUIRED_EXIT=42
QUIESCENCE_REQUIRED_FILE="$REPO_ROOT/api/migrations/quiescence-required.txt"

if [ "$#" -ne 1 ]; then
  echo "usage: bin/fly-migrate-one.sh api/migrations/<file>.sql" >&2
  exit 2
fi
FILE="$1"

case "$FILE" in
  /*) ABS_FILE="$FILE" ;;
  *) ABS_FILE="$REPO_ROOT/$FILE" ;;
esac

FILENAME="$(basename "$ABS_FILE")"
if [[ ! "$FILENAME" =~ ^[0-9]{8}T[0-9]{6}_[a-z0-9_]+\.sql$ ]]; then
  echo "refusing unexpected migration filename: $FILENAME" >&2
  exit 2
fi
if [[ "$ABS_FILE" != "$REPO_ROOT/api/migrations/$FILENAME" || ! -f "$ABS_FILE" ]]; then
  echo "migration must be a real file under api/migrations: $FILE" >&2
  exit 2
fi

if [ ! -s "$QUIESCENCE_REQUIRED_FILE" ] ||
  ! LC_ALL=C sort -cu "$QUIESCENCE_REQUIRED_FILE" 2>/dev/null; then
  echo "quiescence policy manifest is missing or invalid: $QUIESCENCE_REQUIRED_FILE" >&2
  exit 1
fi
while IFS= read -r policy_filename || [ -n "$policy_filename" ]; do
  if [[ ! "$policy_filename" =~ ^[0-9]{8}T[0-9]{6}_[a-z0-9_]+\.sql$ ]] ||
    [ ! -f "$REPO_ROOT/api/migrations/$policy_filename" ]; then
    echo "quiescence policy manifest is invalid: $QUIESCENCE_REQUIRED_FILE" >&2
    exit 1
  fi
done < "$QUIESCENCE_REQUIRED_FILE"
if grep -Fqx "$FILENAME" "$QUIESCENCE_REQUIRED_FILE"; then
  echo "protected migration refuses the Fly one-file runner: $FILENAME" >&2
  echo "inspect the complete inventory with bin/migrate-pending.sh --dry-run," >&2
  echo "establish the reviewed exclusive cutover, then use" >&2
  echo "bin/migrate-pending.sh --maintenance-quiesced." >&2
  exit "$QUIESCENCE_REQUIRED_EXIT"
fi

BYTES="$(wc -c < "$ABS_FILE" | tr -d ' ')"
if (( BYTES > 100000 )); then
  echo "migration is too large for the bounded SSH runner ($BYTES > 100000 bytes)" >&2
  exit 2
fi

CHECKSUM="$(shasum -a 256 "$ABS_FILE" | awk '{print $1}')"
MIGRATION_B64="$(base64 < "$ABS_FILE" | tr -d '\n')"

REMOTE_JS=""
# Avoid a quoted command substitution here. macOS Bash 3.2 reparses template
# backticks inside that shape and can fail at runtime even though `bash -n`
# accepts the file.
IFS= read -r -d '' REMOTE_JS <<'JS' || true
const { default: postgres } = await import("postgres");

const filename = "__FILENAME__";
const checksum = "__CHECKSUM__";
const migration = Buffer.from("__MIGRATION_B64__", "base64").toString("utf8");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is absent inside the Fly machine");

// Keep this scanner aligned with api/scripts/_migrate-one.ts. Migration
// headers may be longer than a handful of lines, while a later PL/pgSQL
// BEGIN must not disable the runner's outer transaction.
function firstExecutableSql(text) {
  let rest = text.replace(/^\uFEFF/, "");
  while (true) {
    rest = rest.trimStart();
    if (rest.startsWith("--")) {
      const newline = rest.indexOf("\n");
      rest = newline === -1 ? "" : rest.slice(newline + 1);
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      if (end === -1) return rest;
      rest = rest.slice(end + 2);
      continue;
    }
    return rest;
  }
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 5,
});

try {
  await sql.unsafe("SET lock_timeout = '10s'");
  await sql.unsafe("SET statement_timeout = '30s'");
  await sql.unsafe("SELECT pg_advisory_lock(hashtext('agenttool:migrations'))");
  await sql.unsafe("SET statement_timeout = '2min'");
  const rows = await sql`
    SELECT checksum FROM meta._migrations WHERE filename = ${filename}
  `;
  if (rows.length > 0) {
    if (rows[0].checksum !== checksum) {
      throw new Error(`checksum mismatch for already-applied ${filename}`);
    }
    console.log(`${filename}: already applied (checksum match)`);
  } else {
    const noTransaction = /^--\s*@no-transaction\b/m.test(migration);
    const managesTransaction = /^BEGIN(?:\s+(?:WORK|TRANSACTION))?\s*;?/i.test(
      firstExecutableSql(migration),
    );
    const wrap = !noTransaction && !managesTransaction;
    if (wrap) {
      await sql.begin(async (tx) => {
        await tx.unsafe(migration);
        await tx`
          INSERT INTO meta._migrations (filename, checksum)
          VALUES (${filename}, ${checksum})
        `;
      });
    } else {
      console.log(
        `${filename}: atomic migration+journal transaction unavailable ` +
        `(file manages its own transaction or uses @no-transaction)`,
      );
      await sql.unsafe(migration);
      await sql`
        INSERT INTO meta._migrations (filename, checksum)
        VALUES (${filename}, ${checksum})
      `;
    }
    console.log(`${filename}: applied and recorded`);
  }
} finally {
  try {
    await sql.unsafe("SELECT pg_advisory_unlock(hashtext('agenttool:migrations'))");
  } catch {
    // Closing the session releases advisory locks even if explicit unlock fails.
  }
  await sql.end({ timeout: 5 });
}
JS

REMOTE_JS="${REMOTE_JS/__FILENAME__/$FILENAME}"
REMOTE_JS="${REMOTE_JS/__CHECKSUM__/$CHECKSUM}"
REMOTE_JS="${REMOTE_JS/__MIGRATION_B64__/$MIGRATION_B64}"
RUNNER_B64="$(printf '%s' "$REMOTE_JS" | base64 | tr -d '\n')"

echo "Applying $FILENAME through Fly app $APP ($BYTES bytes, ${CHECKSUM:0:16}...)"
fly ssh console -a "$APP" -C \
  "bun -e 'const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor; await new AsyncFunction(Buffer.from(\"$RUNNER_B64\", \"base64\").toString(\"utf8\"))()'"
