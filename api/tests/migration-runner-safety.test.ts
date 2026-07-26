import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function runnerFixture(): {
  directory: string;
  bin: string;
  securityMarker: string;
  bunLog: string;
  applyMarker: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-migration-cli-"));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const securityMarker = join(directory, "security-called");
  const bunLog = join(directory, "bun-calls");
  const applyMarker = join(directory, "apply-called");

  writeExecutable(
    join(bin, "security"),
    `#!/bin/sh
: > "$SECURITY_MARKER"
printf '%s\\n' 'postgres://should-not-be-used.invalid/audit'
`,
  );
  writeExecutable(
    join(bin, "bun"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$BUN_LOG"
case " $* " in
  *"_migrate-one.ts"*)
    : > "$APPLY_MARKER"
    exit 97
    ;;
esac
printf '%s\\n' '20990101T000000_fixture.sql'
`,
  );

  return { directory, bin, securityMarker, bunLog, applyMarker };
}

describe("migration runner safety", () => {
  test("compatibility runner delegates applies without printing connection URLs", () => {
    const source = read("bin/migrate.sh");

    expect(source).toContain('exec "$ROOT/bin/migrate-pending.sh" "$@"');
    expect(source).toContain(
      'exec env DATABASE_URL="$database_url" "$ROOT/bin/migrate-pending.sh" "$@"',
    );
    expect(source).not.toContain('echo "▸ migrating $DATABASE_URL"');
    expect(source).not.toMatch(/\bpsql\b/);

    const result = spawnSync(
      "/bin/bash",
      [join(root, "bin/migrate.sh"), "--help"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: "/usr/bin:/bin",
          HOME: tmpdir(),
          LANG: "C",
          DATABASE_URL: "postgres://must-not-appear.invalid/audit",
        },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("usage:");
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "must-not-appear.invalid",
    );
  });

  test("help and invalid argv exit before credential or database tooling", () => {
    for (const { args, code } of [
      { args: ["--help"], code: 0 },
      { args: ["-h"], code: 0 },
      { args: ["--unknown"], code: 2 },
      { args: ["--dry-run", "extra"], code: 2 },
      { args: ["--help", "extra"], code: 2 },
    ]) {
      const fixture = runnerFixture();
      try {
        const result = spawnSync(
          "/bin/bash",
          [join(root, "bin/migrate-pending.sh"), ...args],
          {
            cwd: root,
            encoding: "utf8",
            env: {
              PATH: `${fixture.bin}:/usr/bin:/bin`,
              HOME: fixture.directory,
              LANG: "C",
              SECURITY_MARKER: fixture.securityMarker,
              BUN_LOG: fixture.bunLog,
              APPLY_MARKER: fixture.applyMarker,
            },
          },
        );

        expect(result.status).toBe(code);
        expect(`${result.stdout}${result.stderr}`).toContain(
          "usage:",
        );
        expect(existsSync(fixture.securityMarker)).toBe(false);
        expect(existsSync(fixture.bunLog)).toBe(false);
        expect(existsSync(fixture.applyMarker)).toBe(false);
      } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
      }
    }
  });

  test("dry-run scans only and never invokes the per-file applier", () => {
    const fixture = runnerFixture();
    try {
      const result = spawnSync(
        "/bin/bash",
        [join(root, "bin/migrate-pending.sh"), "--dry-run"],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            PATH: `${fixture.bin}:/usr/bin:/bin`,
            HOME: fixture.directory,
            LANG: "C",
            DATABASE_URL: "postgres://audit.invalid/fixture",
            SECURITY_MARKER: fixture.securityMarker,
            BUN_LOG: fixture.bunLog,
            APPLY_MARKER: fixture.applyMarker,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("(dry-run — no migrations applied)");
      expect(readFileSync(fixture.bunLog, "utf8")).toContain("-e");
      expect(readFileSync(fixture.bunLog, "utf8")).not.toContain(
        "_migrate-one.ts",
      );
      expect(existsSync(fixture.securityMarker)).toBe(false);
      expect(existsSync(fixture.applyMarker)).toBe(false);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test("legacy TypeScript runner refuses without importing a database client", () => {
    const result = spawnSync(
      process.execPath,
      [join(root, "bin/migrate.ts")],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: tmpdir(),
          LANG: "C",
          DATABASE_URL: "postgres://should-not-be-used.invalid/audit",
        },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("bin/migrate.ts is retired");
    expect(result.stderr).toContain("bin/migrate-pending.sh --dry-run");
    expect(read("bin/migrate.ts")).not.toContain('from "postgres"');
  });

  test("the production-journaled federation migration remains byte-for-byte original", () => {
    const migration = read("api/migrations/0012_federation.sql");
    expect(createHash("sha256").update(migration).digest("hex")).toBe(
      "d0771748b16ba18a297a526824e53004dd07185f4eb601ef4cc1789b92985ee8",
    );
    const policy = read("api/migrations/README.md");
    expect(policy).toContain("frozen byte-for-byte");
    expect(policy).toContain("Do not change the journal checksum");
  });

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

  test("quiescence policy is exact, sorted, unique, and points to real migrations", async () => {
    const expected = [
      "20260725T054912_crypto_deposit_identity.sql",
      "20260726T070000_deposit_watch_reconciliation.sql",
      "20260726T185835_crypto_deposit_finality.sql",
      "20260726T191000_payout_policy_e2e_fixture_repair.sql",
      "20260726T191500_payout_operation_identity.sql",
      "20260726T191500_payout_request_idempotency.sql",
      "20260726T193000_payout_confirmation_fairness.sql",
      "20260726T194500_evm_payout_nonce_fence.sql",
      "20260726T200000_deposit_observation_generation.sql",
      "20260726T201000_payout_dispatch_fairness.sql",
      "20260726T202500_crypto_deposit_finality.sql",
      "20260726T203000_payout_network_binding.sql",
      "20260726T211500_deposit_watch_target_binding.sql",
      "20260726T214500_deposit_watch_target_registry.sql",
      "20260726T220000_crypto_finality_convergence.sql",
    ];
    const entries = read("api/migrations/quiescence-required.txt")
      .trim()
      .split("\n");
    expect(entries).toEqual(expected);
    expect(entries).toEqual([...entries].sort());
    expect(new Set(entries).size).toBe(entries.length);
    for (const filename of entries) {
      expect(filename).toMatch(/^[0-9]{8}T[0-9]{6}_[a-z0-9_]+\.sql$/);
      await access(join(root, "api", "migrations", filename));
    }
  });

  test("pending runner refuses protected files until the maintenance assertion", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "agenttool-migration-policy-"));
    const fakeBin = join(fixture, "bin");
    const applyLog = join(fixture, "apply.log");
    const protectedMigration =
      "20260726T202500_crypto_deposit_finality.sql";
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, "bun"),
      [
        "#!/usr/bin/env bash",
        "set -eu",
        'if [ "${1:-}" = -e ]; then',
        '  printf "%s\\n" "$DEPLOY_TEST_PENDING_MIGRATIONS"',
        "  exit 0",
        "fi",
        'printf "%s\\n" "${2##*/}" >> "$DEPLOY_TEST_APPLY_LOG"',
        "",
      ].join("\n"),
    );
    await chmod(join(fakeBin, "bun"), 0o755);

    const run = async (args: string[]) => {
      const child = Bun.spawn(
        ["bash", "bin/migrate-pending.sh", ...args],
        {
          cwd: root,
          env: {
            PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
            HOME: fixture,
            LANG: "C",
            DATABASE_URL: "postgres://fixture.invalid/migration_policy",
            DEPLOY_TEST_PENDING_MIGRATIONS: protectedMigration,
            DEPLOY_TEST_APPLY_LOG: applyLog,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code };
    };

    try {
      const survey = await run(["--dry-run"]);
      expect(survey.code, survey.stderr).toBe(42);
      expect(survey.stdout).toContain(protectedMigration);
      expect(survey.stdout).toContain("Refusing before the first migration");

      const refusedApply = await run([]);
      expect(refusedApply.code, refusedApply.stderr).toBe(42);
      await expect(access(applyLog)).rejects.toThrow();

      const assertedApply = await run(["--maintenance-quiesced"]);
      expect(assertedApply.code, assertedApply.stderr).toBe(0);
      expect(assertedApply.stdout).toContain(
        "--maintenance-quiesced is an operator assertion",
      );
      expect(await readFile(applyLog, "utf8")).toBe(`${protectedMigration}\n`);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
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
    for (const marker of ["@no-transaction", "firstExecutableSql"]) {
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
