import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CollabError } from "../src/errors.js";
import { breakStaleLedgerLock, knockForSession, knockLedgerPath, releaseLedgerLock } from "../src/host.js";
import { journal, ok, runCleanup } from "./notes-helpers.js";

afterEach(runCleanup);

// Two tappers (say a Claude Code hook and the hub's `knocks --session`) can
// mark the same session at once. Each reads one snapshot of the journal,
// closes it, then takes the ledger lock. A tapper whose snapshot is older than
// the other's must not drop what the newer one has just recorded, or the next
// tap announces that note a second time. The older snapshot is a checkpointed
// copy of the journal beside it, so both tappers share one knock ledger.
describe("knock ledger: taps from snapshots of different ages", () => {
  function scene() {
    const j = journal();
    const db = join(j.directory, "state", "collab.sqlite");
    const older = join(j.directory, "state", "older-snapshot.sqlite");
    const reader = j.start("reader");
    const readerServer = j.serve(reader);
    const sender = j.serve(j.start("sender"));
    const now = () => new Date(j.now());
    const send = async (text: string): Promise<number> => {
      const sent = await ok(sender, "collab_note", { text, to: reader.session.id });
      return j.events().find((event: { type: string; entity_id: string }) =>
        event.type === "report.posted" && event.entity_id === sent.ids.report)!.sequence;
    };
    const snapshot = () => {
      j.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      copyFileSync(db, older);
      chmodSync(older, 0o600);
    };
    const tap = (path: string) =>
      knockForSession(path, reader.session.id, { now, mark_tapped: true })!.new.map((item) => item.seq);
    const ledger = (): number[] =>
      JSON.parse(readFileSync(knockLedgerPath(db), "utf8")).tapped[reader.session.id] ?? [];
    return { j, db, older, reader, readerServer, send, snapshot, tap, ledger };
  }

  test("a cursor ack between the snapshots: the newer tap's entry survives the older tap", async () => {
    const { j, db, older, reader, send, snapshot, tap, ledger } = scene();
    const a = await send("A");
    snapshot(); // the older tapper reads here: cursor 0, waiting [A]
    const page = j.store.nextForSession({ ...reader.credential, event_limit: 50 });
    j.store.acknowledgeSessionCursor({
      ...reader.credential,
      anchor: page.events.next_anchor,
      expected_cursor_version: page.session.cursor_version,
    });
    const b = await send("B");

    expect(tap(db)).toEqual([b]); // the newer tapper takes the lock first
    expect(tap(older)).toEqual([a]); // its snapshot still shows A waiting
    expect(ledger()).toContain(b);
    expect(tap(db)).toEqual([]); // B is not announced a second time
  });

  test("a collab_inbox read between the snapshots: the newer tap's entry survives the older tap", async () => {
    const { db, older, readerServer, send, snapshot, tap, ledger } = scene();
    await send("A");
    snapshot();
    await ok(readerServer, "collab_inbox", {});
    const b = await send("B");

    expect(tap(db)).toEqual([b]);
    tap(older);
    expect(ledger()).toContain(b);
    expect(tap(db)).toEqual([]);
  });

  test("entries the snapshot can judge are still trimmed once acknowledged", async () => {
    const { j, db, reader, send, tap, ledger } = scene();
    const a = await send("A");
    expect(tap(db)).toEqual([a]);
    const page = j.store.nextForSession({ ...reader.credential, event_limit: 50 });
    j.store.acknowledgeSessionCursor({
      ...reader.credential,
      anchor: page.events.next_anchor,
      expected_cursor_version: page.session.cursor_version,
    });
    const b = await send("B");
    expect(tap(db)).toEqual([b]);
    expect(ledger()).toEqual([b]); // A was acknowledged, so its entry is gone
  });
});

describe("knock ledger lock: breaking a stale lock and releasing", () => {
  function lockFile() {
    const j = journal();
    const db = join(j.directory, "state", "collab.sqlite");
    const lock = `${knockLedgerPath(db)}.lock`;
    mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
    return { lock, directory: dirname(lock) };
  }
  const aged = (path: string) => {
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
  };
  const leftovers = (directory: string) => readdirSync(directory).filter((name) => name.includes(".broken-"));

  test("breaks the lock it judged stale", () => {
    const { lock, directory } = lockFile();
    writeFileSync(lock, "", { mode: 0o600 });
    aged(lock);
    breakStaleLedgerLock(lock, lstatSync(lock));
    expect(() => lstatSync(lock)).toThrow();
    expect(leftovers(directory)).toEqual([]);
  });

  test("leaves a fresh lock another tap took after the judgement, and is busy", () => {
    const { lock, directory } = lockFile();
    writeFileSync(lock, "", { mode: 0o600 });
    aged(lock);
    const judged = lstatSync(lock);
    // Another tap breaks the stale lock and takes its own in between.
    unlinkSync(lock);
    writeFileSync(lock, "", { mode: 0o600 });
    const theirs = lstatSync(lock);

    let refused: unknown;
    try {
      breakStaleLedgerLock(lock, judged);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(CollabError);
    expect((refused as CollabError).code).toBe("knock_ledger_busy");
    const now = lstatSync(lock);
    expect([now.dev, now.ino, now.mtimeMs]).toEqual([theirs.dev, theirs.ino, theirs.mtimeMs]);
    expect(leftovers(directory)).toEqual([]);
  });

  test("is busy when the stale lock is already gone", () => {
    const { lock } = lockFile();
    writeFileSync(lock, "", { mode: 0o600 });
    aged(lock);
    const judged = lstatSync(lock);
    unlinkSync(lock);
    expect(() => breakStaleLedgerLock(lock, judged)).toThrow(CollabError);
  });

  test("release removes only the lock this tap took", () => {
    const { lock } = lockFile();
    writeFileSync(lock, "", { mode: 0o600 });
    const ours = lstatSync(lock);
    unlinkSync(lock);
    writeFileSync(lock, "", { mode: 0o600 });
    aged(lock); // a different file, whatever the inode number
    releaseLedgerLock(lock, ours);
    expect(lstatSync(lock).isFile()).toBe(true);

    releaseLedgerLock(lock, lstatSync(lock));
    expect(() => lstatSync(lock)).toThrow();
  });
});
