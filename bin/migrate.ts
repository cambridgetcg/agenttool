#!/usr/bin/env bun
/** Apply api/migrations/*.sql in order via postgres-js.
 *  Avoids needing psql installed locally.
 *
 *  Usage:
 *    DATABASE_URL=postgres://... bun bin/migrate.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("error: set DATABASE_URL first");
  process.exit(1);
}

const ROOT = join(import.meta.dir, "..");
const MIG_DIR = join(ROOT, "api", "migrations");

const files = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

console.log(`▸ migrating ${files.length} files against ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
console.log("");

const sql = postgres(DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 30,
  // Supabase requires SSL for direct connection
  ssl: DATABASE_URL.includes("supabase") ? "require" : false,
});

let applied = 0;
let skipped = 0;
let failed = 0;

try {
  for (const f of files) {
    const path = join(MIG_DIR, f);
    const content = readFileSync(path, "utf-8");
    process.stdout.write(`  ${f}  `);
    try {
      await sql.unsafe(content);
      console.log("✓");
      applied += 1;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // Idempotent migrations may "fail" if already applied — distinguish
      if (msg.includes("already exists")) {
        console.log("(already applied)");
        skipped += 1;
      } else {
        console.log(`✗  ${msg.slice(0, 200)}`);
        failed += 1;
      }
    }
  }

  console.log("");
  console.log(`applied=${applied}  skipped=${skipped}  failed=${failed}`);

  if (failed > 0) {
    process.exit(1);
  }

  // Verify schemas
  console.log("");
  console.log("▸ verifying schemas...");
  const rows = await sql`
    SELECT schema_name FROM information_schema.schemata
    WHERE schema_name IN ('tools','identity','agent_vault','agent_continuity','economy','memory','trace','strand','inbox','marketplace','org','federation')
    ORDER BY schema_name
  ` as Array<{ schema_name: string }>;
  for (const r of rows) console.log(`  ✓ ${r.schema_name}`);
  console.log(`  (${rows.length}/12 expected)`);
} finally {
  await sql.end();
}
