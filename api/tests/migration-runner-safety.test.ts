import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("migration runner safety", () => {
  test("pending scan refuses checksum drift before choosing files", () => {
    const source = read("bin/migrate-pending.sh");
    expect(source).toContain("SELECT filename, checksum FROM meta._migrations");
    expect(source).toContain('createHash("sha256")');
    expect(source).toContain("migration checksum drift");
  });

  test("fresh pending scan actually places the journal migration first", () => {
    const source = read("bin/migrate-pending.sh");
    expect(source).toContain(
      'const journalMigration = "20260509T170000_meta_migrations.sql"',
    );
    expect(source).toContain(
      "orderedFiles = [journalMigration, ...files.filter((f) => f !== journalMigration)]",
    );
    expect(source).toContain(
      "const pending = orderedFiles.filter((f) => !applied.has(f))",
    );
  });

  test("local and Fly runners serialize migration sessions", () => {
    for (const path of [
      "api/scripts/_migrate-one.ts",
      "bin/fly-migrate-one.sh",
    ]) {
      const source = read(path);
      expect(source).toContain("pg_advisory_lock(hashtext('agenttool:migrations'))");
      expect(source).toContain("pg_advisory_unlock(hashtext('agenttool:migrations'))");
    }
  });

  test("local and Fly runners bound advisory, database-lock, and statement waits", () => {
    for (const path of [
      "api/scripts/_migrate-one.ts",
      "bin/fly-migrate-one.sh",
    ]) {
      const source = read(path);
      expect(source).toContain("SET lock_timeout = '10s'");
      expect(source).toMatch(
        /SET statement_timeout = '30s'[\s\S]+pg_advisory_lock[\s\S]+SET statement_timeout = '2min'/,
      );
    }
  });

  test("fresh database migrations remain possible before the journal exists", () => {
    const local = read("api/scripts/_migrate-one.ts");
    expect(local).toContain(
      'const JOURNAL_MIGRATION = "20260509T170000_meta_migrations.sql"',
    );
    expect(local).toContain(
      "const shouldRecord = journal.available || filename === JOURNAL_MIGRATION",
    );
    expect(local).toContain("applied without journal (bootstrap phase");
  });

  test("Fly runner mirrors the local transaction markers", () => {
    const local = read("api/scripts/_migrate-one.ts");
    const fly = read("bin/fly-migrate-one.sh");
    for (const marker of ["@no-transaction", 'slice(0, 5).join("\\n")']) {
      expect(local).toContain(marker);
      expect(fly).toContain(marker);
    }
    for (const source of [local, fly]) {
      expect(source).toContain("await sql.begin(async (tx) => {");
      expect(source).toContain("atomic migration+journal transaction unavailable");
    }
    expect(local).toMatch(
      /tx\.unsafe\(text\)[\s\S]+recordApplied\(tx, filename, checksum\)/,
    );
    expect(fly).toMatch(
      /tx\.unsafe\(migration\)[\s\S]+INSERT INTO meta\._migrations/,
    );
  });

  test("0.11 rollout migrations use the runner's atomic migration+journal transaction", () => {
    for (const filename of [
      "20260713T120000_attestation_receipt_integrity.sql",
      "20260713T130000_managed_escrow_ownership.sql",
      "20260713T140000_reinvest_resting_reconciliation.sql",
      "20260713T150000_dispute_arbitration_resting.sql",
      "20260713T160000_generic_escrow_idempotency.sql",
    ]) {
      const source = read(`api/migrations/${filename}`);
      expect(source.trimStart()).not.toMatch(/^BEGIN\b/i);
      expect(source.trimEnd()).not.toMatch(/COMMIT\s*;$/i);
      expect(source).not.toContain("@no-transaction");
    }
  });
});
