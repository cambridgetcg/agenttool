import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { canonicalJson, domainSeparatedId } from "../src/canonical.js";
import { EVENT_HASH_DOMAIN, GENESIS_EVENT_HASH } from "../src/constants.js";
import { createReceiptEnvelope } from "../src/contracts.js";
import { ConstructiveStore } from "../src/store.js";
import type { EvidenceLevel, EvidenceReceiptBody } from "../src/types.js";
import { digest, makeBody, makePin } from "./helpers.js";

const temporaryDirectories: string[] = [];

function databasePath(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `constructive-${label}-`));
  temporaryDirectories.push(directory);
  return join(directory, "pilot.sqlite");
}

afterAll(() => {
  // OS temporary-directory cleanup is intentionally left to the runner; these
  // paths contain only disposable test databases and avoid broad deletion.
  expect(temporaryDirectories.length).toBeGreaterThan(0);
});

function openInitialized(path: string) {
  const store = new ConstructiveStore(path, { create: true });
  store.initialize();
  const pin = makePin();
  store.putPin(pin);
  return { store, pin };
}

function recordLadderThrough(
  store: ConstructiveStore,
  pin: ReturnType<typeof makePin>,
  terminal: EvidenceLevel,
): void {
  store.record(makeBody(pin, "E0", 0));
  if (terminal === "E0") return;
  store.record(makeBody(pin, "E1", 0));
  if (terminal === "E1") return;
  store.record(makeBody(pin, "E2", 0));
  if (terminal === "E2") return;
  for (let index = 0; index < 3; index += 1) store.record(makeBody(pin, "E3", index, 4));
  if (terminal === "E3") return;
  store.record(makeBody(pin, "E4", 0));
  if (terminal === "E4") return;
  store.record(makeBody(pin, "E5", 0));
  if (terminal === "E5") return;
  store.record(makeBody(pin, "E6", 0));
}

describe("append-only SQLite ledger", () => {
  test("enforces strict E0 through E6 ordering and the TLS E3 floors", () => {
    const { store, pin } = openInitialized(databasePath("ladder"));
    expect(() => store.record(makeBody(pin, "E1"))).toThrow(/E0/);
    store.record(makeBody(pin, "E0"));
    expect(() => store.record(makeBody(pin, "E2"))).toThrow(/E0 through E6/);
    store.record(makeBody(pin, "E1"));
    store.record(makeBody(pin, "E2"));
    store.record(makeBody(pin, "E3", 0, 4));
    expect(store.report(pin.pin_id).levels.find(({ level }) => level === "E3")?.reasons)
      .toContain("effective_clusters_below_3");
    expect(() => store.record(makeBody(pin, "E4"))).toThrow(/E3 is not achieved/);
    store.record(makeBody(pin, "E3", 1, 4));
    store.record(makeBody(pin, "E3", 2, 4));
    const e3 = store.report(pin.pin_id);
    expect(e3.e3_coverage).toEqual({
      effective_clusters: 3,
      organization_roots: 2,
      implementation_roots: 3,
      execution_environments: 2,
      unique_cases: 12,
      checker_or_corpus_digests: 1,
      all_after_freeze: true,
    });
    expect(e3.highest_contiguous_level).toBe("E3");
    store.record(makeBody(pin, "E4"));
    store.record(makeBody(pin, "E5"));
    store.record(makeBody(pin, "E6"));
    expect(store.report(pin.pin_id).highest_contiguous_level).toBe("E6");
    store.close();
  });

  test("returns exact retries and refuses changed global-source replays", () => {
    const { store, pin } = openInitialized(databasePath("replay"));
    const receipt = makeBody(pin, "E0");
    const first = store.record(receipt);
    const retry = store.record(structuredClone(receipt));
    expect(first.status).toBe("inserted");
    expect(retry.status).toBe("existing");
    expect(retry.stored).toEqual(first.stored);

    const conflict: EvidenceReceiptBody = {
      ...receipt,
      method_or_adapter_digest: digest("changed-method"),
    };
    expect(() => store.record(conflict)).toThrow(/already consumed/);

    const secondPin = makePin("2026-07-31");
    store.putPin(secondPin);
    const crossLedger = makeBody(secondPin, "E0");
    crossLedger.source_system = receipt.source_system;
    crossLedger.source_record_or_event_id = receipt.source_record_or_event_id;
    crossLedger.source_revision = receipt.source_revision;
    expect(() => store.record(crossLedger)).toThrow(/already consumed/);
    store.close();
  });

  test("persists across reopen and verifies the per-ledger hash chain", () => {
    const path = databasePath("durable");
    const { store, pin } = openInitialized(path);
    recordLadderThrough(store, pin, "E2");
    const before = store.listReceipts(pin.pin_id);
    expect(before.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(before[0]?.previous_event_hash).toBe(`sha256:${"0".repeat(64)}`);
    expect(new Set(before.map(({ event_hash }) => event_hash)).size).toBe(3);
    store.close();

    const reopened = new ConstructiveStore(path, { create: false });
    expect(reopened.listReceipts(pin.pin_id)).toEqual(before);
    expect(reopened.verify()).toMatchObject({
      ok: true,
      receipt_count: 3,
      checked_event_chains: 1,
    });
    reopened.close();
  });

  test("supports append-only supersession without rewriting history", () => {
    const { store, pin } = openInitialized(databasePath("supersedes"));
    const first = store.record(makeBody(pin, "E0", 0)).stored;
    store.record(makeBody(pin, "E1", 0));
    store.record(makeBody(pin, "E2", 0));
    const correction = makeBody(pin, "E0", 1);
    correction.supersedes = first.evidence_id;
    correction.result.conclusion = "contradicted";
    const second = store.record(correction).stored;
    expect(second.receipt.supersedes).toBe(first.evidence_id);
    expect(store.listReceipts(pin.pin_id)).toHaveLength(4);
    expect(store.report(pin.pin_id)).toMatchObject({
      receipt_count: 4,
      active_receipt_count: 3,
      superseded_receipt_count: 1,
      highest_contiguous_level: null,
      conclusion_counts: {
        confirmed: 2,
        contradicted: 1,
      },
    });
    const branch = makeBody(pin, "E0", 2);
    branch.supersedes = first.evidence_id;
    expect(() => store.record(branch)).toThrow(/one direct superseding successor/);
    const wrongLevel = makeBody(pin, "E1", 3);
    wrongLevel.supersedes = first.evidence_id;
    expect(() => store.record(wrongLevel)).toThrow(/preserve evidence level/);
    expect(store.verify().ok).toBe(true);
    store.close();
  });

  test("does not advance the frontier on contradictory reproduction", () => {
    const { store, pin } = openInitialized(databasePath("contradicted"));
    recordLadderThrough(store, pin, "E2");
    const contradicted = makeBody(pin, "E3", 0, 4);
    contradicted.result.conclusion = "contradicted";
    store.record(contradicted);
    const report = store.report(pin.pin_id);
    expect(report.highest_contiguous_level).toBe("E2");
    expect(report.e3_coverage.effective_clusters).toBe(0);
    expect(report.levels.find(({ level }) => level === "E3")?.reasons)
      .toContain("confirmed_independent_reproduction_missing");
    expect(() => store.record(makeBody(pin, "E4"))).toThrow(/E3 is not achieved/);
    store.close();
  });

  test("has exactly two application tables and blocks UPDATE and DELETE", () => {
    const { store, pin } = openInitialized(databasePath("triggers"));
    const stored = store.record(makeBody(pin, "E0")).stored;
    const tables = store.db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual(["pins", "receipts"]);
    expect(() => store.db.query("UPDATE pins SET as_of = as_of WHERE pin_id = ?").run(pin.pin_id))
      .toThrow(/append-only/);
    expect(() => store.db.query("DELETE FROM receipts WHERE evidence_id = ?").run(stored.evidence_id))
      .toThrow(/append-only/);
    store.close();
  });

  test("tightens database, WAL, and SHM permissions to 0600", () => {
    const path = databasePath("modes");
    const { store, pin } = openInitialized(path);
    chmodSync(path, 0o644);
    store.record(makeBody(pin, "E0"));
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      expect(statSync(candidate).mode & 0o777).toBe(0o600);
    }
    store.close();
  });

  test("refuses attacker-writable parents and symlinked ledger entries", () => {
    const unsafeDirectory = mkdtempSync(join(tmpdir(), "constructive-unsafe-parent-"));
    temporaryDirectories.push(unsafeDirectory);
    chmodSync(unsafeDirectory, 0o777);
    expect(() => new ConstructiveStore(join(unsafeDirectory, "pilot.sqlite"), { create: true }))
      .toThrow(/no group\/other write bits/);
    chmodSync(unsafeDirectory, 0o700);

    const symlinkDirectory = mkdtempSync(join(tmpdir(), "constructive-symlink-"));
    temporaryDirectories.push(symlinkDirectory);
    const target = join(symlinkDirectory, "target.sqlite");
    writeFileSync(target, "not a database", { mode: 0o600 });
    symlinkSync(target, join(symlinkDirectory, "pilot.sqlite"));
    expect(() => new ConstructiveStore(
      join(symlinkDirectory, "pilot.sqlite"),
      { create: false },
    )).toThrow(/securely open regular ledger file/);
    linkSync(target, join(symlinkDirectory, "hardlink.sqlite"));
    expect(() => new ConstructiveStore(
      join(symlinkDirectory, "hardlink.sqlite"),
      { create: false },
    )).toThrow(/singly linked regular file/);

    const sidecarPath = databasePath("sidecar-symlink");
    const sidecarStore = new ConstructiveStore(sidecarPath, { create: true });
    sidecarStore.initialize();
    sidecarStore.close();
    const sidecarTarget = `${sidecarPath}.target`;
    if (existsSync(`${sidecarPath}-wal`)) {
      renameSync(`${sidecarPath}-wal`, sidecarTarget);
    } else {
      writeFileSync(sidecarTarget, "not a sidecar", { mode: 0o600 });
    }
    symlinkSync(sidecarTarget, `${sidecarPath}-wal`);
    expect(() => new ConstructiveStore(sidecarPath, { create: false }))
      .toThrow(/securely open regular ledger file/);
  });

  test("rechecks parent trust before writing an open ledger", () => {
    const path = databasePath("parent-recheck");
    const { store, pin } = openInitialized(path);
    const directory = dirname(path);
    chmodSync(directory, 0o777);
    expect(() => store.record(makeBody(pin, "E0"))).toThrow(/no group\/other write bits/);
    chmodSync(directory, 0o700);
    expect(store.verify().ok).toBe(true);
    store.close();
  });

  test("rejects an expired reviewed-standard pin", () => {
    const path = databasePath("expired");
    const store = new ConstructiveStore(path, { create: true });
    store.initialize();
    expect(() => store.putPin(makePin("2026-08-29"))).toThrow(/reviewed standard window/);
    store.close();
  });

  test("verify detects pin-column, source-column, and event-chain tampering", () => {
    const pinPath = databasePath("tamper-pin");
    const pinSetup = openInitialized(pinPath);
    pinSetup.store.db.exec("DROP TRIGGER pins_no_update");
    pinSetup.store.db.query("UPDATE pins SET as_of = ? WHERE pin_id = ?")
      .run("2026-07-31", pinSetup.pin.pin_id);
    pinSetup.store.db.exec(`
      CREATE TRIGGER pins_no_update
      BEFORE UPDATE ON pins BEGIN SELECT RAISE(ABORT, 'pins are append-only'); END
    `);
    expect(() => pinSetup.store.verify()).toThrow(/pin columns/);
    pinSetup.store.close();

    const receiptPath = databasePath("tamper-receipt");
    const receiptSetup = openInitialized(receiptPath);
    const stored = receiptSetup.store.record(makeBody(receiptSetup.pin, "E0")).stored;
    receiptSetup.store.db.exec("DROP TRIGGER receipts_no_update");
    receiptSetup.store.db.query(
      "UPDATE receipts SET source_revision = ? WHERE evidence_id = ?",
    ).run("tampered", stored.evidence_id);
    receiptSetup.store.db.exec(`
      CREATE TRIGGER receipts_no_update
      BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'receipts are append-only'); END
    `);
    expect(() => receiptSetup.store.verify()).toThrow(/content ID or event hash chain/);
    receiptSetup.store.close();

    const chainPath = databasePath("tamper-chain");
    const chainSetup = openInitialized(chainPath);
    const chainReceipt = chainSetup.store.record(makeBody(chainSetup.pin, "E0")).stored;
    chainSetup.store.db.exec("DROP TRIGGER receipts_no_update");
    chainSetup.store.db.query(
      "UPDATE receipts SET event_hash = ? WHERE evidence_id = ?",
    ).run(digest("tampered-event"), chainReceipt.evidence_id);
    chainSetup.store.db.exec(`
      CREATE TRIGGER receipts_no_update
      BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'receipts are append-only'); END
    `);
    expect(() => chainSetup.store.verify()).toThrow(/event hash chain/);
    chainSetup.store.close();
  });

  test("verify rejects bypassed ordering, orphan rows, and no-op trigger names", () => {
    const orderPath = databasePath("tamper-order");
    const orderSetup = openInitialized(orderPath);
    const first = orderSetup.store.record(makeBody(orderSetup.pin, "E0")).stored;
    const e6 = makeBody(orderSetup.pin, "E6", 1);
    const envelope = createReceiptEnvelope(e6);
    const eventHash = domainSeparatedId(EVENT_HASH_DOMAIN, {
      pin_id: orderSetup.pin.pin_id,
      sequence: 2,
      previous_event_hash: first.event_hash,
      evidence_id: envelope.evidence_id,
    });
    orderSetup.store.db.query(`
      INSERT INTO receipts (
        evidence_id, pin_id, sequence,
        source_system, source_record_or_event_id, source_revision,
        receipt_json, previous_event_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      envelope.evidence_id,
      e6.pin_id,
      2,
      e6.source_system,
      e6.source_record_or_event_id,
      e6.source_revision,
      canonicalJson(e6),
      first.event_hash,
      eventHash,
    );
    expect(() => orderSetup.store.verify()).toThrow(/evidence-level ordering/);
    expect(() => orderSetup.store.report(orderSetup.pin.pin_id))
      .toThrow(/evidence-level ordering/);
    orderSetup.store.close();

    const orphanPath = databasePath("tamper-orphan");
    const orphanSetup = openInitialized(orphanPath);
    const orphan = makeBody(orphanSetup.pin, "E0");
    const orphanEnvelope = createReceiptEnvelope(orphan);
    orphanSetup.store.db.exec("PRAGMA foreign_keys = OFF");
    orphanSetup.store.db.query(`
      INSERT INTO receipts (
        evidence_id, pin_id, sequence,
        source_system, source_record_or_event_id, source_revision,
        receipt_json, previous_event_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orphanEnvelope.evidence_id,
      digest("missing-pin"),
      1,
      orphan.source_system,
      `${orphan.source_record_or_event_id}-orphan`,
      orphan.source_revision,
      canonicalJson(orphan),
      GENESIS_EVENT_HASH,
      digest("orphan-event"),
    );
    orphanSetup.store.db.exec("PRAGMA foreign_keys = ON");
    expect(() => orphanSetup.store.verify()).toThrow(/foreign-key/);
    orphanSetup.store.close();

    const triggerPath = databasePath("tamper-trigger");
    const triggerSetup = openInitialized(triggerPath);
    triggerSetup.store.db.exec("DROP TRIGGER pins_no_update");
    triggerSetup.store.db.exec(`
      CREATE TRIGGER pins_no_update
      BEFORE UPDATE ON pins BEGIN SELECT 1; END
    `);
    expect(() => triggerSetup.store.verify()).toThrow(/trigger definitions/);
    triggerSetup.store.close();
  });
});
