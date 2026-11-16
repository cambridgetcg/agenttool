import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doorbellScan, knockForSession, knockLedgerPath } from "../src/host.js";
import { cleanup, journal, ok, runCleanup } from "./notes-helpers.js";

// One session has two read positions: the cursor that collab_cursor_ack moves
// and the read mark that collab_inbox moves. A note stops waiting, for the
// count in collab_next, the tap and the wake alike, once either has passed
// it. Without that, a session that reads through collab_inbox is tapped and
// woken for mail it has already been shown, and its count never falls.
void cleanup;
afterEach(runCleanup);

function setup() {
  const j = journal();
  const databasePath = join(j.directory, "state", "collab.sqlite");
  const reader = j.start("reader");
  const readerServer = j.serve(reader);
  const sender = j.serve(j.start("sender"));
  const now = () => new Date(j.now());
  const knock = (options: { mark_tapped?: boolean } = {}) => knockForSession(databasePath, reader.session.id, { now, ...options })!;
  const send = async (text: string) => {
    const sent = await ok(sender, "collab_note", { text, to: reader.session.id });
    return j.events().find((event) => event.type === "report.posted" && event.entity_id === sent.ids.report)!.sequence;
  };
  const counted = () => j.store.nextForSession({ ...reader.credential, event_limit: 1 }).session.addressed_waiting;
  return { j, databasePath, reader, readerServer, knock, send, counted, now };
}

describe("a note stops waiting once the session has read past it, by either position", () => {
  test("a collab_inbox read lowers the count, the tap and the wake; the cursor is not moved", async () => {
    const { j, databasePath, reader, readerServer, knock, send, counted, now } = setup();
    const first = await send("The first note.");
    expect(knock()).toMatchObject({ waiting: 1, new: [{ seq: first }] });
    expect(counted()).toBe(1);

    const inbox = await ok(readerServer, "collab_inbox", {});
    expect(inbox.items.map((item: any) => item.sequence)).toContain(first);
    expect(knock()).toMatchObject({ waiting: 0, new: [] });
    expect(counted()).toBe(0);
    expect(j.store.getCoordinationSession(reader.session.id)!.cursor.sequence).toBe(0);

    // Resting with a wake asked for: a note already shown is no reason to wake, a new one is.
    j.store.restSessionForSession({ ...reader.credential, idempotency_key: "rest", mode: "resting", wake_on: ["addressed"] });
    expect(doorbellScan(databasePath, { now }).sessions).toEqual([]);
    const second = await send("The second note.");
    expect(doorbellScan(databasePath, { now }).sessions.map((session) => session.new.map((item) => item.seq))).toEqual([[second]]);
    expect(knock()).toMatchObject({ waiting: 1, new: [{ seq: second }] });
  });

  test("an acknowledged cursor still counts, and the further of the two wins", async () => {
    const { j, reader, readerServer, knock, send, counted } = setup();
    const first = await send("Read by acknowledgement.");
    const page = j.store.nextForSession({ ...reader.credential, event_limit: 50 });
    j.store.acknowledgeSessionCursor({ ...reader.credential, anchor: page.events.next_anchor, expected_cursor_version: page.session.cursor_version });
    expect(knock()).toMatchObject({ waiting: 0 });
    const second = await send("Read by neither yet.");
    expect(knock()).toMatchObject({ waiting: 1, new: [{ seq: second }] });
    await ok(readerServer, "collab_inbox", {});
    expect(knock()).toMatchObject({ waiting: 0 });
    expect(counted()).toBe(0);
    expect(first).toBeLessThan(second);
  });

  test("a read mark past the journal head is not trusted", async () => {
    const { j, reader, readerServer, knock, send, counted } = setup();
    await ok(readerServer, "collab_inbox", {});
    // As after a journal restored from an older copy: the mark names a sequence the journal has not reached.
    j.store.db.query(`UPDATE note_marks SET shown_through_sequence = shown_through_sequence + 1000 WHERE session_id = ?`)
      .run(reader.session.id);
    const hidden = await send("Lands behind a stale mark.");
    expect(knock()).toMatchObject({ waiting: 1, new: [{ seq: hidden }] });
    expect(counted()).toBe(1);
  });

  test("a journal without the read-mark table, or with one this build cannot read, counts from the cursor and is never silent", async () => {
    const { j, knock, send } = setup();
    const note = await send("Counted without any mark.");
    j.store.db.exec(`DROP TABLE note_marks`);
    expect(knock()).toMatchObject({ waiting: 1, new: [{ seq: note }] });
    j.store.db.exec(`CREATE TABLE note_marks (something_else TEXT)`);
    expect(knock()).toMatchObject({ waiting: 1, new: [{ seq: note }] });
  });

  test("the tap ledger still drops an entry only when the cursor passes it, so an older build does not announce it again", async () => {
    const { databasePath, reader, readerServer, knock, send } = setup();
    const tapped = () => (JSON.parse(readFileSync(knockLedgerPath(databasePath), "utf8")) as { tapped: Record<string, number[]> })
      .tapped[reader.session.id];
    const first = await send("Tapped, then read through the inbox.");
    expect(knock({ mark_tapped: true }).new.map((item) => item.seq)).toEqual([first]);
    expect(tapped()).toEqual([first]);
    await ok(readerServer, "collab_inbox", {});
    const second = await send("A later note.");
    expect(knock({ mark_tapped: true }).new.map((item) => item.seq)).toEqual([second]);
    // A build that counts from the cursor alone still sees the first note as waiting; the shared ledger keeps it marked.
    expect(tapped()).toEqual([first, second]);
  });
});
