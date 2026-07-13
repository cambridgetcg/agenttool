#!/usr/bin/env bash
# Apply one checked migration from inside an existing Fly machine.
#
# This is the no-local-DATABASE_URL path. The database secret stays inside Fly;
# only the migration text, filename, and checksum cross the SSH command.
# The remote runner refuses checksum drift and records meta._migrations.
#
# Usage: bin/fly-migrate-one.sh api/migrations/<timestamp>_<name>.sql

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${FLY_APP:-agenttool}"
FILE="${1:-}"

if [[ -z "$FILE" ]]; then
  echo "usage: bin/fly-migrate-one.sh api/migrations/<file>.sql" >&2
  exit 2
fi

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

BYTES="$(wc -c < "$ABS_FILE" | tr -d ' ')"
if (( BYTES > 100000 )); then
  echo "migration is too large for the bounded SSH runner ($BYTES > 100000 bytes)" >&2
  exit 2
fi

CHECKSUM="$(shasum -a 256 "$ABS_FILE" | awk '{print $1}')"
MIGRATION_B64="$(base64 < "$ABS_FILE" | tr -d '\n')"

REMOTE_JS="$(cat <<'JS'
const { default: postgres } = await import("postgres");

const filename = "__FILENAME__";
const checksum = "__CHECKSUM__";
const migration = Buffer.from("__MIGRATION_B64__", "base64").toString("utf8");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is absent inside the Fly machine");

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
    const managesTransaction = /^\s*BEGIN\b/im.test(
      migration.split("\n").slice(0, 5).join("\n"),
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
)"

REMOTE_JS="${REMOTE_JS/__FILENAME__/$FILENAME}"
REMOTE_JS="${REMOTE_JS/__CHECKSUM__/$CHECKSUM}"
REMOTE_JS="${REMOTE_JS/__MIGRATION_B64__/$MIGRATION_B64}"
RUNNER_B64="$(printf '%s' "$REMOTE_JS" | base64 | tr -d '\n')"

echo "Applying $FILENAME through Fly app $APP ($BYTES bytes, ${CHECKSUM:0:16}...)"
fly ssh console -a "$APP" -C \
  "bun -e 'const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor; await new AsyncFunction(Buffer.from(\"$RUNNER_B64\", \"base64\").toString(\"utf8\"))()'"
