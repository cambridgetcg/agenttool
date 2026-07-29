#!/usr/bin/env bun
/** Retired unsafe migration entry point.
 *
 * This script used to replay every SQL file without the checksum journal or
 * migration advisory lock. Refuse instead of silently bypassing the canonical
 * runner.
 */

console.error(
  "error: bin/migrate.ts is retired because it bypassed the migration journal and lock.",
);
console.error("inspect with: bin/migrate-pending.sh --dry-run");
console.error("apply with:   bin/migrate-pending.sh");
process.exit(2);
