#!/usr/bin/env bash
# _apply-ring1-migrations.sh — apply the four Ring-1 / persist-identity
# migrations in order, with a pre-flight check on the riskiest one
# (T170000 adds a CHECK on identity.identities.status that would fail
# if any existing row has a status value outside {active, revoked}).
#
# Usage:
#   DATABASE_URL="postgresql://…" bash api/scripts/_apply-ring1-migrations.sh
#
# Or with the documented keychain entry:
#   DATABASE_URL=$(bin/agenttool-secret get agenttool-database-url) \
#     bash api/scripts/_apply-ring1-migrations.sh
#
# Doctrine: docs/RING-1.md + docs/PATTERN-PERSIST-IDENTITY.md.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set." >&2
  echo "Either export it or run via:" >&2
  echo "  DATABASE_URL=\$(bin/agenttool-secret get agenttool-database-url) bash $0" >&2
  exit 1
fi

REPO="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$REPO/api"

# ── Pre-flight: T170000 ─────────────────────────────────────────────────
# The memorial-status migration adds CHECK status IN ('active','revoked','memorial').
# If any existing row has a different value, the migration will fail.
echo "==> Pre-flight: identity.identities.status distinct values"
bun -e '
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
try {
  const rows = await sql`SELECT status, COUNT(*)::int AS n FROM identity.identities GROUP BY status ORDER BY n DESC`;
  for (const r of rows) console.log(`  ${r.status}: ${r.n}`);
  const allowed = new Set(["active", "revoked", "memorial"]);
  const violators = rows.filter((r: any) => !allowed.has(r.status));
  if (violators.length > 0) {
    console.error("\nFAIL: status values outside {active, revoked, memorial}:");
    for (const v of violators) console.error(`  ${v.status}: ${v.n}`);
    console.error("\nT170000 would fail. Either update those rows OR widen the CHECK.");
    process.exit(2);
  }
  console.log("  OK — all rows are in {active, revoked, memorial}");
} finally {
  await sql.end();
}
'
echo ""

# ── Apply migrations in order ───────────────────────────────────────────
for migration in \
  api/migrations/20260512T160000_unknown_kin_dimensions.sql \
  api/migrations/20260512T170000_memorial_status.sql \
  api/migrations/20260512T180000_stripe_events_status.sql \
  api/migrations/20260512T190000_llm_requests.sql
do
  if [ ! -f "$REPO/$migration" ]; then
    echo "MISSING: $migration"
    exit 1
  fi
  echo "==> Applying: $(basename "$migration")"
  DATABASE_URL="$DATABASE_URL" bun "$REPO/api/scripts/_migrate-one.ts" "$REPO/$migration"
  echo ""
done

# ── Verify ───────────────────────────────────────────────────────────────
echo "==> Verifying new schema is reachable"
bun -e '
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
try {
  // 1. identity_universals enum extensions visible
  const checks = await sql`
    SELECT conname FROM pg_constraint
    WHERE conname IN (
      "identities_signing_scheme_known",
      "identities_cardinality_kind_known",
      "identities_persistence_kind_known",
      "identities_temporal_scale_known",
      "identities_embodiment_kind_known",
      "identities_status_known"
    )
    ORDER BY conname
  `.catch(() => null);
  // Note: column names quoted as identifiers in JS template — switch to string literals.
  const rows = await sql.unsafe(`
    SELECT conname FROM pg_constraint
    WHERE conname IN (
      '"'"'identities_signing_scheme_known'"'"',
      '"'"'identities_cardinality_kind_known'"'"',
      '"'"'identities_persistence_kind_known'"'"',
      '"'"'identities_temporal_scale_known'"'"',
      '"'"'identities_embodiment_kind_known'"'"',
      '"'"'identities_status_known'"'"',
      '"'"'stripe_events_status_check'"'"',
      '"'"'llm_requests_status_check'"'"'
    )
    ORDER BY conname
  `);
  console.log("CHECK constraints landed:");
  for (const r of rows) console.log(`  ${r.conname}`);

  // 2. llm_requests table reachable
  const lr = await sql`SELECT COUNT(*)::int AS n FROM agent_runtime.llm_requests`;
  console.log(`agent_runtime.llm_requests row count: ${lr[0].n}`);
} finally {
  await sql.end();
}
'

echo ""
echo "==> All four Ring-1 / persist-identity migrations applied."
