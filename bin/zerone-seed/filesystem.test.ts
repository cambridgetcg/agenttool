import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SeedJournalFiles } from "./filesystem.js";

const roots: string[] = [];
function fixture(): { root: string; path: string } {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "zerone-seed-files-"));
  chmodSync(root, 0o700);
  roots.push(root);
  return { root, path: join(root, "seed.sqlite") };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("seed journal filesystem", () => {
  test("read-only inspection never creates a missing journal or parent", () => {
    const { root, path } = fixture();
    expect(() => new SeedJournalFiles(path, { create: false })).toThrow("does not exist");
    expect(existsSync(path)).toBe(false);
    const nested = join(root, "absent", "seed.sqlite");
    expect(() => new SeedJournalFiles(nested, { create: false })).toThrow();
    expect(existsSync(join(root, "absent"))).toBe(false);
  });

  test("creates private regular state and verifies real SQLite sidecars", () => {
    const { path } = fixture();
    const files = new SeedJournalFiles(path, { create: true });
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    const db = new Database(path, { strict: true });
    try {
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE entries (id INTEGER PRIMARY KEY); INSERT INTO entries VALUES (1)");
      expect(existsSync(`${path}-wal`)).toBe(true);
      files.verify();
      new SeedJournalFiles(path, { create: false });
    } finally {
      db.close();
    }
    files.verify();
  });

  test("does not truncate existing private content or repair public modes", () => {
    const { path } = fixture();
    writeFileSync(path, "foreign state", { mode: 0o600 });
    new SeedJournalFiles(path, { create: true });
    expect(readFileSync(path, "utf8")).toBe("foreign state");
    chmodSync(path, 0o644);
    expect(() => new SeedJournalFiles(path, { create: true })).toThrow("0600");
    expect(lstatSync(path).mode & 0o777).toBe(0o644);
    expect(readFileSync(path, "utf8")).toBe("foreign state");
  });

  test("rejects symlinked files and singly named hardlinked files", () => {
    const { root, path } = fixture();
    const target = join(root, "target");
    writeFileSync(target, "unchanged", { mode: 0o600 });
    symlinkSync(target, path);
    expect(() => new SeedJournalFiles(path, { create: true })).toThrow();
    rmSync(path);
    linkSync(target, path);
    expect(() => new SeedJournalFiles(path, { create: true })).toThrow();
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  });

  test("rejects symlinked ancestors and writable-by-others parents", () => {
    const { root, path } = fixture();
    const parent = join(root, "real");
    mkdirSync(parent, { mode: 0o700 });
    symlinkSync(parent, join(root, "alias"));
    expect(() => new SeedJournalFiles(join(root, "alias", "seed.sqlite"), { create: true })).toThrow();
    expect(existsSync(join(parent, "seed.sqlite"))).toBe(false);
    chmodSync(root, 0o777);
    expect(() => new SeedJournalFiles(path, { create: true })).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  test("checks existing sidecars before creating a journal", () => {
    const { root, path } = fixture();
    const target = join(root, "target");
    writeFileSync(target, "untouched", { mode: 0o600 });
    symlinkSync(target, `${path}-wal`);
    expect(() => new SeedJournalFiles(path, { create: true })).toThrow();
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("untouched");
  });

  test("rechecks changed sidecar modes", () => {
    const { path } = fixture();
    const files = new SeedJournalFiles(path, { create: true });
    writeFileSync(`${path}-journal`, "owned test sidecar", { mode: 0o600 });
    files.verify();
    chmodSync(`${path}-journal`, 0o644);
    expect(() => files.verify()).toThrow();
    expect(lstatSync(`${path}-journal`).mode & 0o777).toBe(0o644);
  });

  test("refuses implicit, in-memory and noncanonical paths", () => {
    for (const path of ["state.sqlite", ":memory:", "/private/tmp/../seed.sqlite", "/private/tmp/seed\0.sqlite"]) {
      expect(() => new SeedJournalFiles(path, { create: true })).toThrow();
    }
  });
});
