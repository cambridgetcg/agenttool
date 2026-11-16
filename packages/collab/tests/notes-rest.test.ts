import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { doorbellScan, knockForSession } from "../src/host.js";
import { cleanup, journal, ok, runCleanup } from "./notes-helpers.js";

// Where Collab Notes meets declared rest. A note that names a session is an
// addressed report, so it knocks like one; these tests pin that, and that the
// Notes surface says when a session rests: to the sender of a note, in the
// words the legacy tools' delivery hint uses, and on the arrival card.
void cleanup;
afterEach(runCleanup);

function setup() {
  const j = journal();
  const sleeper = j.start("sleeper");
  const sender = j.serve(j.start("sender"));
  const databasePath = join(j.directory, "state", "collab.sqlite");
  const rest = (key: string, extra: Record<string, unknown> = {}) =>
    j.store.restSessionForSession({ ...sleeper.credential, idempotency_key: key, mode: "resting", ...extra });
  const scan = () => doorbellScan(databasePath, { now: () => new Date(j.now()) });
  return { j, sleeper, sender, databasePath, rest, scan, id: sleeper.session.id };
}

describe("a Collab Note to a resting session", () => {
  test("the sender is told the note is held until the session returns", async () => {
    const { j, sleeper, sender, rest, id } = setup();
    const awake = await ok(sender, "collab_note", { text: "Before any rest.", to: "sleeper" });
    expect(awake.advice.join(" ")).not.toContain("resting");

    rest("rest-held");
    const held = await ok(sender, "collab_note", { text: "While it rests.", to: "sleeper" });
    expect(held.to).toMatchObject({ session: id });
    expect(held.advice).toContain(
      `sleeper (${id}) is resting and asked not to be woken; the note is recorded and waits for its return.`,
    );

    // A returned session reads as any other again.
    j.store.restSessionForSession({ ...sleeper.credential, idempotency_key: "back", mode: "ready" });
    const back = await ok(sender, "collab_note", { text: "After the return.", to: "sleeper" });
    expect(back.advice.join(" ")).not.toContain("resting");
  });

  test("with wake_on addressed the sender is told a host may wake it, and the note is a knock the doorbell lists", async () => {
    const { j, sender, rest, scan, databasePath, id } = setup();
    const until = new Date(Date.parse(j.now()) + 3_600_000).toISOString();
    rest("rest-wake", { wake_on: ["addressed"], until });
    expect(scan().sessions).toEqual([]);

    const sent = await ok(sender, "collab_note", { text: "Wake for this one.", to: id });
    expect(sent.advice).toContain(
      `sleeper (${id}) is resting until ${until} and asked to be woken for notes addressed to it; `
        + "a host may wake it for this one, and none is promised.",
    );
    const sequence = j.events().find((event) => event.type === "report.posted" && event.entity_id === sent.ids.report)!.sequence;
    // The same note is what the tap and the wake read: one pointer, no body.
    expect(knockForSession(databasePath, id, { now: () => new Date(j.now()) })).toMatchObject({
      liveness: "resting",
      waiting: 1,
      new: [{ seq: sequence, kind: "report.posted", from_actor: "sender", ref_id: sent.ids.report }],
    });
    expect(scan().sessions.map((session) => [session.session_id, session.new.map((item) => item.seq)]))
      .toEqual([[id, [sequence]]]);
  });

  test("a reply that goes to a resting author by default says so too", async () => {
    const { j, sleeper, sender, rest, id } = setup();
    const report = await ok(j.serve(sleeper), "collab_note", { text: "The parser drops trailing commas." });
    rest("rest-author");
    const reply = await ok(sender, "collab_note", { act: "support", text: "Seen here as well.", re: report.ids.report });
    expect(reply.to).toMatchObject({ session: id });
    expect(reply.advice.join(" ")).toContain(`sleeper (${id}) is resting and asked not to be woken`);
  });

  test("rest outranks a stale reading, and an ended session is still said to have ended", async () => {
    const { j, sleeper, sender, rest, id } = setup();
    rest("rest-long");
    j.advance(7 * 3_600_000);
    const stale = await ok(sender, "collab_note", { text: "Hours later.", to: id });
    expect(stale.advice.join(" ")).toContain("is resting and asked not to be woken");
    expect(stale.advice.join(" ")).not.toContain("over 6 hours ago");

    j.store.endSession({ ...sleeper.credential, reason: "left for good" });
    const ended = await ok(sender, "collab_note", { text: "After it left.", to: id });
    expect(ended.advice.join(" ")).toContain("has ended its session");
    expect(ended.advice.join(" ")).not.toContain("resting");
  });
});

describe("the arrival card", () => {
  test("marks who is resting among those here, with until and whether it asked to be woken", async () => {
    const { j, sender, rest, id } = setup();
    j.start("worker");
    const until = new Date(Date.parse(j.now()) + 1_800_000).toISOString();
    rest("rest-card", { wake_on: ["addressed"], until });
    const card = await ok(sender, "collab_arrive", { purpose: "see who is here" });
    const here = Object.fromEntries((card.here as Array<Record<string, any>>).map((entry) => [entry.name, entry]));
    expect(here.sleeper).toMatchObject({ session: id, resting: { until, wakes_for_addressed: true } });
    expect(here.worker).not.toHaveProperty("resting");
  });
});
