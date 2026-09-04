import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConstructiveStore } from "../src/store.js";
import { ConstructiveError } from "../src/errors.js";

for (const kind of ["memory", "file"] as const) {
  test(`constructor releases its acquired ${kind} database after configuration refuses`, () => {
    const directory = mkdtempSync(join(tmpdir(), "constructive-lifecycle-"));
    const path = kind === "memory" ? ":memory:" : join(directory, "pilot.sqlite");
    const refusal = new Error("synthetic configuration refusal");
    const exec = Database.prototype.exec;
    let acquired: Database | undefined;
    let observed: unknown;
    // Fail an actual acquired SQLite connection at its first configuration
    // command, before the constructor can transfer ownership to its caller.
    Database.prototype.exec = function (sql: string) {
      if (sql === "PRAGMA foreign_keys = ON") {
        acquired = this;
        throw refusal;
      }
      return exec.call(this, sql);
    };
    try {
      try { new ConstructiveStore(path, { create: true }); }
      catch (error) { observed = error; }
      expect(observed).toBe(refusal);
      expect(acquired).toBeDefined();
      expect(() => acquired!.query("SELECT 1").get()).toThrow(/closed/i);
    } finally {
      Database.prototype.exec = exec;
      acquired?.close(false);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("close preserves a real permission refusal while releasing the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "constructive-lifecycle-"));
  const store = new ConstructiveStore(join(directory, "pilot.sqlite"), { create: true });
  try {
    chmodSync(directory, 0o777);
    expect(() => store.close()).toThrow(/no group\/other write bits/);
    expect(() => store.db.query("SELECT 1").get()).toThrow(/closed/i);
  } finally {
    chmodSync(directory, 0o700);
    store.db.close(false);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a secondary cleanup failure cannot replace the original security refusal", () => {
  const directory = mkdtempSync(join(tmpdir(), "constructive-lifecycle-"));
  const store = new ConstructiveStore(join(directory, "pilot.sqlite"), { create: true });
  const close = store.db.close;
  let closeAttempts = 0;
  store.db.close = () => { closeAttempts++; throw new Error("synthetic close refusal"); };
  try {
    chmodSync(directory, 0o777);
    let observed: unknown;
    try { store.close(); } catch (error) { observed = error; }
    expect(closeAttempts).toBe(1);
    expect(observed).toBeInstanceOf(ConstructiveError);
    expect((observed as ConstructiveError).code).toBe("file_error");
    expect((observed as Error).message).toContain("no group/other write bits");
  } finally {
    chmodSync(directory, 0o700);
    store.db.close = close;
    close.call(store.db, false);
    rmSync(directory, { recursive: true, force: true });
  }
});
