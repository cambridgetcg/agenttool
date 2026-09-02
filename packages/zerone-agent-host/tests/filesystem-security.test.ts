import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ZeroneAgentHostStore } from "../src/index.js";

test("rejects a silently non-durable in-memory production ledger", () => {
  expect(() => new ZeroneAgentHostStore(":memory:", { create: true }))
    .toThrow(/allow_in_memory_for_tests/);
});

test("refuses writable parents, symlinked files, and multiply-linked ledgers", () => {
  const unsafe = mkdtempSync(join(tmpdir(), "zerone-host-unsafe-"));
  chmodSync(unsafe, 0o777);
  expect(() => new ZeroneAgentHostStore(join(unsafe, "host.sqlite"), { create: true }))
    .toThrow(/no group\/other write bits/);
  chmodSync(unsafe, 0o700);

  const parentTarget = mkdtempSync(join(tmpdir(), "zerone-host-parent-target-"));
  const parentAlias = `${parentTarget}-alias`;
  symlinkSync(parentTarget, parentAlias);
  expect(() => new ZeroneAgentHostStore(join(parentAlias, "host.sqlite"), { create: true }))
    .toThrow(/parent must not be a symlink/);

  const directory = mkdtempSync(join(tmpdir(), "zerone-host-links-"));
  const target = join(directory, "target.sqlite");
  writeFileSync(target, "not sqlite", { mode: 0o600 });
  symlinkSync(target, join(directory, "symlink.sqlite"));
  expect(() => new ZeroneAgentHostStore(join(directory, "symlink.sqlite"), { create: false }))
    .toThrow(/securely open regular/);
  linkSync(target, join(directory, "hardlink.sqlite"));
  expect(() => new ZeroneAgentHostStore(join(directory, "hardlink.sqlite"), { create: false }))
    .toThrow(/singly linked/);
});

test("event rows are append-only and an unexpected table fails schema verification", () => {
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  const rawDatabase = Reflect.get(store, "db") as Database;
  rawDatabase.exec("CREATE TABLE attacker_added (value TEXT)");
  expect(() => store.verify()).toThrow(/table set/);
  store.close();
});

test("pins the held-fence index predicate and refuses unknown schema versions", () => {
  const indexDirectory = mkdtempSync(join(tmpdir(), "zerone-host-index-"));
  const indexPath = join(indexDirectory, "host.sqlite");
  const first = new ZeroneAgentHostStore(indexPath, { create: true });
  first.initialize();
  first.close();
  const indexDatabase = new Database(indexPath);
  indexDatabase.exec(`
    DROP INDEX sequence_fences_one_held_account_idx;
    CREATE UNIQUE INDEX sequence_fences_one_held_account_idx
      ON sequence_fences(chain_id, source_account) WHERE state = 'released';
  `);
  indexDatabase.close(false);
  const badIndex = new ZeroneAgentHostStore(indexPath, { create: false });
  expect(() => badIndex.initialize()).toThrow(/index definitions/);
  badIndex.close();

  const versionDirectory = mkdtempSync(join(tmpdir(), "zerone-host-version-"));
  const versionPath = join(versionDirectory, "host.sqlite");
  const versioned = new ZeroneAgentHostStore(versionPath, { create: true });
  versioned.initialize();
  versioned.close();
  const versionDatabase = new Database(versionPath);
  versionDatabase.exec("PRAGMA user_version = 99");
  versionDatabase.close(false);
  const unknownVersion = new ZeroneAgentHostStore(versionPath, { create: false });
  expect(() => unknownVersion.initialize()).toThrow(/unknown host-ledger schema version/);
  unknownVersion.close();
});
