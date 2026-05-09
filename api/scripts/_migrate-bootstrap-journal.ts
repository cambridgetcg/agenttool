/** Backfill `meta._migrations` with every existing migration in
 *  api/migrations/ — one-shot bootstrap.
 *
 *  Runs after applying 20260509T170000_meta_migrations.sql. Walks the
 *  migrations directory, computes sha256 of each file, and inserts a row
 *  for every filename with ON CONFLICT DO NOTHING. Re-runnable safely.
 *
 *  Usage: cd api && DATABASE_URL=... bun scripts/_migrate-bootstrap-journal.ts
 *
 *  Output: a table of (filename, checksum-prefix, status). Status is
 *  one of:
 *    inserted — new row written
 *    exists   — row already there with same checksum (idempotent re-run)
 *    DRIFT    — row exists but checksum differs (file edited post-apply
 *               or backfill is being run mid-edit; investigate before
 *               trusting the journal).
 */

import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

async function loadDatabaseUrl(): Promise<string> {
  let url = process.env.DATABASE_URL ?? "";
  if (!url) {
    const proc = Bun.spawnSync([
      "security",
      "find-generic-password",
      "-s",
      "agenttool-database-url",
      "-a",
      "macair",
      "-w",
    ]);
    url = (proc.stdout ?? new Uint8Array()).toString().trim();
  }
  if (!url) {
    throw new Error("DATABASE_URL not in env or keychain");
  }
  return url;
}

async function main() {
  const url = await loadDatabaseUrl();
  const sql = postgres(url, { max: 1, prepare: false });

  // Sanity: journal must exist.
  try {
    await sql`SELECT 1 FROM meta._migrations LIMIT 1`;
  } catch (e: any) {
    if (
      e?.code === "42P01" ||
      e?.message?.includes("does not exist")
    ) {
      console.error(
        "✗ meta._migrations does not exist. Apply " +
          "api/migrations/20260509T170000_meta_migrations.sql first " +
          "via _migrate-one.ts, then re-run this script.",
      );
      process.exit(1);
    }
    throw e;
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Backfilling ${files.length} migration(s) into meta._migrations`);
  console.log("");

  let inserted = 0;
  let exists = 0;
  let drift = 0;

  for (const f of files) {
    const text = await Bun.file(join(MIGRATIONS_DIR, f)).text();
    const checksum = createHash("sha256").update(text).digest("hex");

    const existing =
      await sql`SELECT checksum FROM meta._migrations WHERE filename = ${f}`;

    let status: string;
    if (existing.length === 0) {
      await sql`
        INSERT INTO meta._migrations (filename, checksum)
        VALUES (${f}, ${checksum})
      `;
      status = "inserted";
      inserted++;
    } else if ((existing[0] as any).checksum === checksum) {
      status = "exists";
      exists++;
    } else {
      status = "DRIFT";
      drift++;
    }

    console.log(`  ${status.padEnd(9)} ${checksum.slice(0, 12)}…  ${f}`);
  }

  console.log("");
  console.log(
    `Summary: ${inserted} inserted · ${exists} already-exists · ${drift} DRIFT`,
  );
  if (drift > 0) {
    console.error(
      `\n⚠ DRIFT detected — files differ from journal. Investigate before trusting the journal.`,
    );
    process.exit(2);
  }

  await sql.end({ timeout: 5 });
}

main();
