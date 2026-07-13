/** Apply a single migration file to the live DB.
 *
 *  Usage: cd api && bun run scripts/_migrate-one.ts ../api/migrations/<file>.sql
 *  Reads DATABASE_URL from env or macOS keychain (service: agenttool-database-url).
 *
 *  Behavior since 20260509T170000_meta_migrations.sql:
 *    1. Computes sha256 of the file contents.
 *    2. Looks up the filename in meta._migrations.
 *       - already there + same checksum → skip ("already applied")
 *       - already there + different checksum → REFUSE (corruption signal —
 *         someone edited the file post-apply; resolve manually)
 *       - not there → apply, then INSERT INTO meta._migrations
 *    3. Apply is wrapped in BEGIN/COMMIT by default. Opt out with a
 *       `-- @no-transaction` line in the file (e.g. for CREATE INDEX
 *       CONCURRENTLY which can't run inside a transaction).
 *    4. If the file already starts with BEGIN/COMMIT, the wrap is skipped
 *       to avoid nested-transaction WARNINGs (legacy migration tolerance).
 *
 *  Bootstrap fallback: if meta._migrations doesn't exist (fresh DB or
 *  pre-journal era), the script applies normally and skips journal
 *  recording. Run _migrate-bootstrap-journal.ts to backfill afterward.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";
import postgres from "postgres";

const JOURNAL_TABLE = "meta._migrations";
const JOURNAL_MIGRATION = "20260509T170000_meta_migrations.sql";
type MigrationSql = ReturnType<typeof postgres> | postgres.TransactionSql;

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
    throw new Error(
      "DATABASE_URL not in env or keychain (agenttool-database-url)",
    );
  }
  return url;
}

async function journalLookup(
  sql: ReturnType<typeof postgres>,
  filename: string,
): Promise<{ available: boolean; exists: boolean; checksum?: string }> {
  try {
    const rows =
      await sql`SELECT checksum FROM meta._migrations WHERE filename = ${filename}`;
    if (rows.length === 0) return { available: true, exists: false };
    return {
      available: true,
      exists: true,
      checksum: (rows[0] as any).checksum,
    };
  } catch (e: any) {
    // Table doesn't exist yet (bootstrap case) — graceful fallback.
    if (
      e?.code === "42P01" /* undefined_table */ ||
      e?.message?.includes("relation") ||
      e?.message?.includes("does not exist")
    ) {
      return { available: false, exists: false };
    }
    throw e;
  }
}

async function recordApplied(
  sql: MigrationSql,
  filename: string,
  checksum: string,
): Promise<void> {
  await sql`
    INSERT INTO meta._migrations (filename, checksum)
    VALUES (${filename}, ${checksum})
    ON CONFLICT (filename) DO NOTHING
  `;
}

function shouldWrapInTransaction(text: string): boolean {
  // Opt-out marker (e.g. for CREATE INDEX CONCURRENTLY).
  if (/^--\s*@no-transaction\b/m.test(text)) return false;
  // Legacy migrations that already manage their own BEGIN/COMMIT.
  if (/^\s*BEGIN\b/im.test(text.split("\n").slice(0, 5).join("\n")))
    return false;
  return true;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: bun run scripts/_migrate-one.ts <path-to-sql>");
    process.exit(1);
  }

  const url = await loadDatabaseUrl();
  const text = await Bun.file(file).text();
  const checksum = createHash("sha256").update(text).digest("hex");
  const filename = basename(file);

  const sql = postgres(url, { max: 1, prepare: false });
  let migrationLockHeld = false;

  console.log(`▸ ${filename}`);
  console.log(`  size:     ${text.length} bytes`);
  console.log(`  checksum: ${checksum.slice(0, 16)}…`);

  try {
    await sql.unsafe("SET lock_timeout = '10s'");
    await sql.unsafe("SET statement_timeout = '30s'");
    await sql.unsafe(
      "SELECT pg_advisory_lock(hashtext('agenttool:migrations'))",
    );
    migrationLockHeld = true;
    await sql.unsafe("SET statement_timeout = '2min'");
    const journal = await journalLookup(sql, filename);

    if (journal.exists) {
      if (journal.checksum === checksum) {
        console.log(`  ✓ already applied (checksum match) — skipping`);
        return;
      }
      console.error(
        `  ✗ CHECKSUM MISMATCH — file in repo differs from what was applied.`,
      );
      console.error(`     applied: ${journal.checksum?.slice(0, 16)}…`);
      console.error(`     current: ${checksum.slice(0, 16)}…`);
      console.error(
        `     This is a drift / corruption signal. Inspect git history for the file;`,
      );
      console.error(
        `     if the edit was intentional, manually update meta._migrations.checksum`,
      );
      console.error(`     for this row. Otherwise, restore the file from git.`);
      process.exit(2);
    }

    const wrap = shouldWrapInTransaction(text);
    const shouldRecord = journal.available || filename === JOURNAL_MIGRATION;
    if (wrap) {
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        if (shouldRecord) await recordApplied(tx, filename, checksum);
      });
    } else {
      console.log(
        `  · atomic migration+journal transaction unavailable ` +
          `(file manages its own transaction or uses @no-transaction)`,
      );
      await sql.unsafe(text);
      if (shouldRecord) await recordApplied(sql, filename, checksum);
    }
    if (shouldRecord) {
      console.log(`  ✓ applied + recorded`);
    } else {
      console.log(
        `  ✓ applied without journal (bootstrap phase; run ` +
          `_migrate-bootstrap-journal.ts after ${JOURNAL_MIGRATION})`,
      );
    }
  } catch (e) {
    console.error(`  ✗ failed:`, (e as Error).message);
    process.exit(1);
  } finally {
    if (migrationLockHeld) {
      try {
        await sql.unsafe(
          "SELECT pg_advisory_unlock(hashtext('agenttool:migrations'))",
        );
      } catch {
        // Closing the session releases advisory locks even if explicit unlock fails.
      }
    }
    await sql.end({ timeout: 5 });
  }
}

main();
