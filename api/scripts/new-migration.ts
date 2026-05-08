#!/usr/bin/env bun
/** new-migration.ts — generate a timestamp-prefixed migration stub.
 *
 *  Usage:  bun api/scripts/new-migration.ts <descriptive-slug>
 *
 *  Example:
 *    $ bun api/scripts/new-migration.ts add-foo-column
 *    ✓ created 20260508T233045_add_foo_column.sql
 *      → /…/api/migrations/20260508T233045_add_foo_column.sql
 *
 *  Why timestamp prefix: sequential numbering (0001, 0002, ...) collides
 *  whenever two parallel sessions claim the next number at the same time.
 *  Timestamp prefix gives every new migration a unique-by-second filename
 *  with no coordination needed. Sort order is preserved — old numeric
 *  migrations (0000–0022) sort before any timestamp-prefixed one (since
 *  '0' < '2' lexicographically), so apply order stays chronological in a
 *  mixed-convention tree.
 *
 *  See docs/DEVELOPMENT.md for the full protocol.
 *
 *  Same-second collision: extremely unlikely in practice, but if two
 *  invocations land in the same second the second one auto-bumps by 1s
 *  rather than overwriting. */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(SCRIPT_DIR, "..", "migrations");

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function formatTimestamp(d: Date): string {
  // YYYYMMDDTHHMMSS — UTC. Compact ISO 8601 basic form.
  return (
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

function bumpTimestamp(ts: string): string {
  const y = Number(ts.slice(0, 4));
  const mo = Number(ts.slice(4, 6)) - 1;
  const d = Number(ts.slice(6, 8));
  const hh = Number(ts.slice(9, 11));
  const mm = Number(ts.slice(11, 13));
  const ss = Number(ts.slice(13, 15));
  return formatTimestamp(new Date(Date.UTC(y, mo, d, hh, mm, ss + 1)));
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const rawSlug = process.argv[2];
if (!rawSlug) {
  console.error("usage: bun api/scripts/new-migration.ts <descriptive-slug>");
  console.error("example: bun api/scripts/new-migration.ts add-foo-column");
  process.exit(1);
}

const slug = slugify(rawSlug);
if (!slug) {
  console.error("slug must contain at least one alphanumeric character");
  process.exit(1);
}

let ts = formatTimestamp(new Date());
let filename = `${ts}_${slug}.sql`;
let path = join(MIGRATIONS_DIR, filename);
while (existsSync(path)) {
  ts = bumpTimestamp(ts);
  filename = `${ts}_${slug}.sql`;
  path = join(MIGRATIONS_DIR, filename);
}

const stub = `-- ${filename} — <one-line description>.
--
-- Doctrine: docs/<domain-doc>.md
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/${filename}
--
-- <Why this migration exists — reference an audit, a slice, or an
-- incident. Keep it short.>

-- TODO: write the migration body. Prefer additive + idempotent
-- (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--  ALTER TABLE ... DROP NOT NULL is also idempotent).
`;

writeFileSync(path, stub, "utf8");
console.log(`✓ created ${filename}`);
console.log(`  → ${path}`);
console.log("");
console.log("Next:");
console.log(`  1. Edit the body of api/migrations/${filename}`);
console.log(`  2. Apply locally: bun api/scripts/_migrate-one.ts api/migrations/${filename}`);
console.log(`  3. git add api/migrations/${filename}`);
