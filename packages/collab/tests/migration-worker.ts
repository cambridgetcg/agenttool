import { existsSync, writeFileSync } from "node:fs";
import { CollabError } from "../src/errors.js";
import { CollabStore } from "../src/store.js";

const [databasePath, barrierPath, readyPath] = Bun.argv.slice(2);

if (!databasePath || !barrierPath || !readyPath) {
  throw new Error("migration-worker requires database, barrier, and readiness paths");
}

writeFileSync(readyPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });

const deadline = Date.now() + 10_000;
while (!existsSync(barrierPath)) {
  if (Date.now() >= deadline) {
    process.stderr.write("migration barrier timed out\n");
    process.exit(2);
  }
  await Bun.sleep(5);
}

try {
  const holdMilliseconds = Number.parseInt(
    process.env.AGENTOOL_COLLAB_TEST_MIGRATION_HOLD_MS ?? "0",
    10,
  );
  const store = new CollabStore(databasePath, {
    migration_failpoint: (step) => {
      if (
        step === "v2_tables_created"
        && Number.isFinite(holdMilliseconds)
        && holdMilliseconds > 0
      ) {
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          holdMilliseconds,
        );
      }
    },
  });
  const schemaMigrations = (
    store.db.query("SELECT COUNT(*) AS count FROM schema_migrations").get() as {
      count: number;
    }
  ).count;
  const userVersion = (
    store.db.query("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  store.close();
  process.stdout.write(JSON.stringify({
    ok: true,
    schema_migrations: schemaMigrations,
    user_version: userVersion,
  }));
} catch (error) {
  const sqliteCode =
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
      ? error.code
      : null;
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof CollabError ? error.code : "internal_error",
    sqlite_code: sqliteCode,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
  }));
  process.exitCode = 1;
}
