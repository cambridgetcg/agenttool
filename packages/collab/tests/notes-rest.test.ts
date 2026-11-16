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

describe("every Notes path that names a session says when it rests", () => {
  const held = (name: string, id: string, what = "the note") =>
    `${name} (${id}) is resting and asked not to be woken; ${what} is recorded and waits for its return.`;

  test("collab_done with review_by: the review request", async () => {
    const { j, sleeper, rest, id } = setup();
    const worker = j.serve(j.start("worker"));
    void sleeper;
    j.write("src/parser.ts", "parser\n");
    await ok(worker, "collab_take", { title: "Edit the parser", paths: ["src/parser.ts"] });
    rest("rest-reviewer");
    const done = await ok(worker, "collab_done", {
      text: "The parser is done.", why: [{ text: "the tests pass", basis: "seen" }], limits: "Only the parser.",
      review_by: "sleeper",
    });
    expect(done.advice).toContain(held("sleeper", id, "the review request"));
  });

  test("a verdict on the work of a resting reporter", async () => {
    const { j, sleeper, sender, rest, id } = setup();
    const reporter = j.serve(sleeper);
    j.write("src/lexer.ts", "lexer\n");
    await ok(reporter, "collab_take", { title: "Edit the lexer", paths: ["src/lexer.ts"] });
    const done = await ok(reporter, "collab_done", {
      text: "The lexer is done.", why: [{ text: "the tests pass", basis: "seen" }], limits: "Only the lexer.",
    });
    rest("rest-reporter");
    const verdict = await ok(sender, "collab_note", { act: "request_changes", text: "One more case.", re: done.ids.completion });
    expect(verdict.advice).toContain(held("sleeper", id, "the verdict"));
  });

  test("a decide on a resting author's report, a note on a resting holder's task, and a withdrawal to a resting challenger", async () => {
    const { j, sleeper, sender, rest, id } = setup();
    const own = j.serve(sleeper);
    const report = await ok(own, "collab_note", { text: "The cache can go." });
    const taken = await ok(own, "collab_take", { title: "Remove the cache" });
    const mine = await ok(sender, "collab_note", { text: "Keep the cache." });
    await ok(own, "collab_note", { act: "challenge", text: "It costs more than it saves.", re: mine.ids.report });
    rest("rest-all");

    const decided = await ok(sender, "collab_note", { act: "decide", text: "Remove the cache.", re: report.ids.report });
    expect(decided.advice).toContain(held("sleeper", id));
    const onTask = await ok(sender, "collab_note", { text: "Mind the tests.", re: taken.ids.task });
    expect(onTask.advice).toContain(held("sleeper", id));
    const withdrawn = await ok(sender, "collab_note", { act: "withdraw", text: "I take it back.", re: mine.ids.report });
    expect(withdrawn.advice).toContain(held("sleeper", id));
  });

  test("a reply routed to the active namesake of an ended author", async () => {
    const { j, sleeper, sender, id } = setup();
    const first = j.start("namesake");
    const report = await ok(j.serve(first), "collab_note", { text: "First words." });
    j.store.endSession({ ...first.credential, reason: "restart" });
    const again = j.start("namesake");
    j.store.restSessionForSession({ ...again.credential, idempotency_key: "rest-namesake", mode: "resting" });
    void sleeper;
    void id;
    const reply = await ok(sender, "collab_note", { act: "support", text: "Agreed.", re: report.ids.report });
    expect(reply.to).toMatchObject({ session: again.session.id });
    expect(reply.advice).toContain(held("namesake", again.session.id));
  });

  test("collab_propose: the note to a carried objector who rests", async () => {
    const { j, sleeper, sender, rest, id } = setup();
    const p1 = await ok(sender, "collab_propose", {
      question: "Should the parser keep trailing tabs?", criteria: "Round trips stay byte-equal.", extent: "packages/collab/src/note.ts only.",
    });
    await ok(j.serve(sleeper), "collab_note", { act: "challenge", text: "Tabs break the diff.", re: p1.ids.proposal });
    rest("rest-objector");
    const replaced = await ok(sender, "collab_propose", {
      question: "Revised?", criteria: "Round trips stay byte-equal.", extent: "packages/collab/src/note.ts only.", replaces: p1.ids.proposal,
    });
    expect(replaced.ids.objector_notes).toEqual([{ report: expect.any(String), to: { id, name: "sleeper" } }]);
    expect(replaced.advice).toContain(held("sleeper", id));
  });
});

describe("the arrival card", () => {
  test("marks who is resting among those here, with until and whether it asked to be woken", async () => {
    const { j, sender, rest, id } = setup();
    j.start("worker");
    const until = new Date(Date.parse(j.now()) + 1_800_000).toISOString();
    rest("rest-card", { wake_on: ["addressed"], until });
    const card = await ok(sender, "collab_arrive", { purpose: "see who is here" });
    const quiet = j.start("quiet");
    j.store.restSessionForSession({ ...quiet.credential, idempotency_key: "rest-quiet", mode: "resting" });
    const later = await ok(sender, "collab_arrive", { purpose: "see who is here" });
    const here = Object.fromEntries((later.here as Array<Record<string, any>>).map((entry) => [entry.name, entry]));
    expect(here.sleeper).toMatchObject({ session: id, resting: { until, wakes_for_addressed: true } });
    expect(here.quiet).toMatchObject({ session: quiet.session.id, resting: { until: null, wakes_for_addressed: false } });
    expect(here.worker).not.toHaveProperty("resting");
    void card;
  });
});
