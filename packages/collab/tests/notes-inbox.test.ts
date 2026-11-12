import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { CollabEvent, SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";
import { handleOf } from "../src/verbs.js";

// collab_inbox (Collab Notes spec 5.2) without the ballot parts, and the
// read mark of spec 8.1.

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function journal() {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-inbox-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  let now = Date.parse("2026-11-12T10:00:00.000Z");
  const store = new CollabStore(join(directory, "state", "collab.sqlite"), { now: () => new Date(now) });
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const start = (actor: string, role = `${actor}'s work`) => store.startSession({ root_path: root, actor, role });
  return {
    root,
    store,
    start,
    advance(ms: number) {
      now += ms;
    },
    /** An MCP process holding this session, as a host restart would hand it over. */
    serve(handle: SessionHandle, environment: Record<string, string> = {}) {
      const credentialFile = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
      return buildCollabMcpServer(store, { environment, resumed_session: { handle, credential_file: credentialFile } }) as any;
    },
    server(environment: Record<string, string> = {}) {
      return buildCollabMcpServer(store, { environment }) as any;
    },
    head(): number {
      return (store.db.query(`SELECT COALESCE(MAX(sequence), 0) AS head FROM events`).get() as { head: number }).head;
    },
    allEvents(workspaceId: string): CollabEvent[] {
      return store.eventsSince(workspaceId, 0, 500).events;
    },
  };
}

async function call(server: any, name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, signal ? { mcpReq: { signal } } : {}) as {
    isError?: boolean;
    structuredContent: Record<string, any>;
  };
}

async function ok(server: any, name: string, args: Record<string, unknown> = {}) {
  const result = await call(server, name, args);
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent;
}

function report(store: CollabStore, from: SessionHandle, key: string, body: string, extra: Record<string, unknown> = {}) {
  return store.appendReportForSession({
    ...from.credential,
    idempotency_key: key,
    kind: "observation",
    body,
    ...extra,
  });
}

/** Every for-me item the session would read, paging through its inbox (store level). */
function drain(store: CollabStore, handle: SessionHandle, limit = 50): number[] {
  const sequences: number[] = [];
  for (let page = 0; page < 100; page += 1) {
    const read = store.inboxForSession({ ...handle.credential, limit, include: "for_me" });
    sequences.push(...read.entries.map((entry) => entry.event.sequence));
    if (!read.more) return sequences;
  }
  throw new Error("inbox never drained");
}

/**
 * A journal with every legacy routing case: an addressed report, a reply, a
 * handoff offered, accepted and declined, a review request and its verdicts,
 * a proposal that consults voices, and a relayed rejection, among unaddressed
 * events.
 */
function mixedJournal(j: ReturnType<typeof journal>) {
  const { store } = j;
  const a = j.start("alpha");
  const b = j.start("bravo");
  const c = j.start("charlie");
  const first = report(store, a, "a1", "Alpha observes something.");
  report(store, b, "b1", "Bravo answers alpha.", { relation: "supports", target_report_id: first.id });
  report(store, c, "c1", "Charlie writes to bravo.", { to_session_id: b.session.id });
  report(store, c, "c2", "Charlie speaks to everyone.");
  const proposal = store.openProposalForSession({
    ...a.credential,
    idempotency_key: "p1",
    question: "Should alpha's change land?",
    criteria: "Tests pass.",
    extent: "The parser only.",
  });
  report(store, b, "b2", "Bravo challenges the proposal.", { kind: "inference", relation: "challenges", target_report_id: proposal.proposal.id });
  store.relayProposalRejectionForSession({
    ...c.credential,
    idempotency_key: "relay",
    proposal_report_id: proposal.proposal.id,
    proposal_sha256: proposal.proposal_sha256,
    reason: "The person said no.",
  });
  const task = store.createTaskForSession({
    ...a.credential, idempotency_key: "t1", title: "Edit the parser", work_mode: "edit", completion_policy: "accepted",
    path_scopes: ["src/parser.ts"],
  });
  const claimed = store.claimTaskForSession({ ...a.credential, idempotency_key: "t1c", task_id: task.id, expected_version: task.version });
  const done = store.completeTaskForSession({
    ...a.credential, idempotency_key: "t1d", task_id: claimed.id, lease_id: claimed.lease_id!,
    expected_version: claimed.version, summary: "Parser edited.", review_requested_session_id: b.session.id,
  });
  store.reviewTaskForSession({
    ...b.credential, idempotency_key: "t1r", task_id: done.id, expected_version: done.version,
    outcome: "request_changes", summary: "One more pass.",
  });
  const handed = store.createTaskForSession({ ...c.credential, idempotency_key: "t2", title: "Hand it over", work_mode: "coordination" });
  const held = store.claimTaskForSession({ ...c.credential, idempotency_key: "t2c", task_id: handed.id, expected_version: handed.version });
  const offer = store.offerHandoffForSession({
    ...c.credential, idempotency_key: "t2o", task_id: held.id, lease_id: held.lease_id!,
    expected_version: held.version, to_session_id: a.session.id, summary: "Yours?",
  });
  store.respondHandoffForSession({ ...a.credential, idempotency_key: "t2a", handoff_id: offer.handoff.id, expected_version: offer.task.version, response: "decline" });
  report(store, a, "a2", "Alpha writes to charlie.", { to_session_id: c.session.id });
  return { a, b, c, proposal, task: done };
}

describe("collab_inbox addressing", () => {
  test("lists exactly what eventAddressesSession routes to a session, never its own events", () => {
    const j = journal();
    const { a, b, c } = mixedJournal(j);
    const workspaceId = a.workspace.id;
    const events = j.allEvents(workspaceId);
    expect(events.length).toBeGreaterThan(20);
    for (const handle of [a, b, c]) {
      const expected = events
        .filter((event) => event.session_id !== handle.session.id && j.store.eventAddressesSession(event, handle.session.id))
        .map((event) => event.sequence);
      expect(expected.length).toBeGreaterThan(0);
      // Pages of two exercise the limit cut as well.
      expect(drain(j.store, handle, 2)).toEqual(expected);
    }
  });

  test("items name the entity the next call takes, with act, sender and reason from storage", async () => {
    const j = journal();
    const { a, b, proposal, task } = mixedJournal(j);
    const read = await ok(j.serve(b), "collab_inbox", { limit: 50 });
    const items = read.items as Array<Record<string, any>>;
    const byWhy = (why: string) => items.filter((item) => item.why_you === why);
    const support = items.find((item) => item.act === "support");
    expect(support).toBeUndefined(); // bravo's own support is not news to bravo
    const addressed = byWhy("addressed").find((item) => item.statement === "Charlie writes to bravo.")!;
    expect(addressed).toMatchObject({
      act: "note",
      from: { name: "charlie" },
      to: { session: b.session.id, name: "bravo" },
      text: "Charlie writes to bravo.",
      why: [],
      evidence: [],
    });
    expect(addressed.handle).toBe(handleOf("report", addressed.id));
    const consulted = byWhy("voice_awaited")[0]!;
    expect(consulted).toMatchObject({ act: "propose", id: proposal.proposal.id, handle: handleOf("proposal", proposal.proposal.id) });
    const review = byWhy("review_requested")[0]!;
    expect(review).toMatchObject({ act: "done", id: task.id, handle: handleOf("task", task.id) });
    expect(review.completion.id).toBe(task.completion_report_id);
    // A review request also arrives as its own addressed report.
    expect(items.some((item) => item.why_you === "addressed" && String(item.statement).startsWith("Review requested"))).toBe(true);
    expect(read.next).toEqual({ tool: "collab_inbox", input: { about: items[0]!.id } });
    void a;
  });
});

describe("the read mark", () => {
  test("a session that never arrived starts from its legacy cursor, once", async () => {
    const j = journal();
    const { a, c } = mixedJournal(j);
    const workspaceId = a.workspace.id;
    // Charlie has processed everything up to here through the legacy cursor.
    const page = j.store.nextForSession({ ...c.credential, event_limit: 50 });
    const ackedSession = j.store.acknowledgeSessionCursor({
      ...c.credential, anchor: page.events.next_anchor, expected_cursor_version: page.session.cursor_version,
    });
    const acked = ackedSession.cursor.sequence;
    report(j.store, a, "after-ack", "Alpha writes to charlie again.", { to_session_id: c.session.id });
    expect(j.store.noteMark(workspaceId, c.session.id)).toBeNull();
    const server = j.serve({ ...c, session: ackedSession, credential: { ...c.credential, last_cursor: ackedSession.cursor } });
    const first = await ok(server, "collab_inbox");
    expect(first.mark_initialised_from).toBe("cursor");
    expect(first.items.map((item: any) => item.statement)).toEqual(["Alpha writes to charlie again."]);
    expect(first.items[0].sequence).toBeGreaterThan(acked);
    const second = await ok(server, "collab_inbox");
    expect(second.mark_initialised_from).toBeUndefined();
    expect(second.items).toEqual([]);
    // The legacy cursor never moves.
    const cursor = j.store.getCoordinationSession(c.session.id)!;
    expect(cursor.cursor.sequence).toBe(acked);
    expect(cursor.cursor_version).toBe(ackedSession.cursor_version);
  });

  test("advances past what it scanned, or to just before the first item a limit cut", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const addressed: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      report(j.store, peer, `noise-${index}`, `Unaddressed ${index}.`);
      addressed.push(report(j.store, peer, `to-me-${index}`, `For me ${index}.`, { to_session_id: me.session.id }).event_sequence);
    }
    const first = await ok(server, "collab_inbox", { limit: 2 });
    expect(first.items.map((item: any) => item.statement)).toEqual(["For me 0.", "For me 1."]);
    expect(first.more).toBe(true);
    expect(first.read_through.sequence).toBe(addressed[2]! - 1);
    // Noise 0, 1 and 2 lie before the cut; each is counted, none is skipped silently.
    expect(first.also_new).toEqual({ count: 3 });
    const second = await ok(server, "collab_inbox", { limit: 2 });
    expect(second.items.map((item: any) => item.statement)).toEqual(["For me 2.", "For me 3."]);
    expect(second.also_new).toEqual({ count: 2 });
    const third = await ok(server, "collab_inbox", { limit: 2 });
    expect(third.items.map((item: any) => item.statement)).toEqual(["For me 4."]);
    expect(third.more).toBe(false);
    expect(third.read_through.sequence).toBe(j.head());
    expect(j.store.noteMark(me.workspace.id, me.session.id)).toBe(j.head());
    expect(j.store.getCoordinationSession(me.session.id)!.cursor.sequence).toBe(0);
  });

  test("include: all adds unaddressed items as subject lines only", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    report(j.store, peer, "n1", "Unaddressed news.\n\nWith a body.");
    report(j.store, peer, "m1", "For me.", { to_session_id: me.session.id });
    const all = await ok(server, "collab_inbox", { include: "all" });
    expect(all.items.map((item: any) => [item.statement, item.for_me])).toEqual([
      ["Unaddressed news.", false],
      ["For me.", true],
    ]);
    expect(all.items[0].text).toBeUndefined();
    expect(all.items[1].text).toBe("For me.");
    expect(all.also_new).toEqual({ count: 1 });
  });

  test("reading refreshes last-seen through the existing path; arrive on a bound slot does not", async () => {
    const j = journal();
    const me = j.start("me");
    const server = j.serve(me);
    const lastSeen = () => j.store.getCoordinationSession(me.session.id)!.last_seen_at;
    const before = lastSeen();
    j.advance(10 * 60_000);
    await ok(server, "collab_arrive", { purpose: "look around" });
    expect(lastSeen()).toBe(before);
    await ok(server, "collab_inbox");
    expect(Date.parse(lastSeen()) - Date.parse(before)).toBe(10 * 60_000);
  });
});

describe("waiting_on_you", () => {
  test("is computed on every call, whatever the read mark", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    const task = j.store.createTaskForSession({
      ...peer.credential, idempotency_key: "t", title: "Peer's edit", work_mode: "edit", completion_policy: "accepted",
      path_scopes: ["a.txt"],
    });
    const claimed = j.store.claimTaskForSession({ ...peer.credential, idempotency_key: "c", task_id: task.id, expected_version: task.version });
    j.store.completeTaskForSession({
      ...peer.credential, idempotency_key: "d", task_id: claimed.id, lease_id: claimed.lease_id!,
      expected_version: claimed.version, summary: "Done.", review_requested_session_id: me.session.id,
    });
    const mine = report(j.store, me, "mine", "My claim about the build.");
    const challenge = report(j.store, peer, "ch", "That claim is wrong.", { kind: "inference", relation: "challenges", target_report_id: mine.id });
    const myChallenge = report(j.store, me, "my-ch", "Your claim is wrong too.", { kind: "inference", relation: "challenges", target_report_id: challenge.id });
    const answer = report(j.store, peer, "ans", "Here is why it is not.", { evidence_refs: [`report:${myChallenge.id}`] });
    const proposal = j.store.openProposalForSession({
      ...peer.credential, idempotency_key: "p", question: "Ship it?", criteria: "Green.", extent: "This repo.",
    });

    const first = await ok(server, "collab_inbox", { limit: 50 });
    expect(first.items.length).toBeGreaterThan(0);
    const second = await ok(server, "collab_inbox");
    expect(second.items).toEqual([]);
    const waiting = (second.waiting_on_you as Array<Record<string, any>>).map((entry) => [entry.what, entry.id]);
    expect(waiting).toEqual(expect.arrayContaining([
      ["review", task.id],
      ["voice", proposal.proposal.id],
      ["challenge", challenge.id],
      ["answer", answer.id],
    ]));
    const review = second.waiting_on_you.find((entry: any) => entry.what === "review");
    // The ref is the display handle; the ready call names the task exactly.
    expect(review).toMatchObject({ ref: handleOf("task", task.id), by: "peer", next: { tool: "collab_inbox", input: { about: task.id } } });
    // Supporting the proposal answers it, so it no longer waits.
    report(j.store, me, "sup", "Yes.", { kind: "inference", relation: "supports", target_report_id: proposal.proposal.id });
    const third = await ok(server, "collab_inbox");
    expect(third.waiting_on_you.some((entry: any) => entry.what === "voice")).toBe(false);
  });

  test("a rejection after an agreement reads as stop, due now", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const opened = j.store.openProposalForSession({
      ...me.credential, idempotency_key: "p", question: "Proceed?", criteria: "Green.", extent: "This repo.",
    });
    report(j.store, peer, "sup", "Yes.", { kind: "inference", relation: "supports", target_report_id: opened.proposal.id });
    const status = j.store.proposalStatus(me.workspace.id, opened.proposal.id);
    expect(status.ai.position).toBe("consented");
    j.store.recordPersonActAtTerminal({ proposal_report_id: opened.proposal.id, proposal_sha256: status.proposal_sha256, act: "agree" } as never);
    const server = j.serve(me);
    const agreed = await ok(server, "collab_inbox");
    expect(agreed.waiting_on_you.map((entry: any) => entry.what)).toContain("record_decision");
    j.store.relayProposalRejectionForSession({
      ...peer.credential, idempotency_key: "r", proposal_report_id: opened.proposal.id,
      proposal_sha256: status.proposal_sha256, reason: "Stop.",
    });
    const stopped = await ok(server, "collab_inbox");
    const stop = stopped.waiting_on_you.find((entry: any) => entry.what === "stop");
    expect(stop).toMatchObject({ ref: handleOf("proposal", opened.proposal.id), by: "relayed_by_session", due: "now" });
    expect(stop.next.say).toContain("Stop work");
  });
});

describe("wait_seconds", () => {
  test("a wait with nothing new writes nothing and ends at its deadline", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    // Something already waits on me; it must not end the wait.
    report(j.store, peer, "mine", "Look at this.", { to_session_id: me.session.id });
    await ok(server, "collab_inbox");
    const snapshot = () => JSON.stringify([
      j.store.db.query(`SELECT * FROM coordination_sessions ORDER BY id`).all(),
      j.store.db.query(`SELECT * FROM note_marks`).all(),
      j.store.db.query(`SELECT * FROM note_shown`).all(),
      j.store.db.query(`SELECT COUNT(*) AS n FROM events`).get(),
      j.store.db.query(`SELECT COUNT(*) AS n FROM mutations`).get(),
    ]);
    let during = "";
    const started = performance.now();
    const waiting = ok(server, "collab_inbox", { wait_seconds: 1 });
    await new Promise((done) => setTimeout(done, 300));
    during = snapshot();
    const result = await waiting;
    expect(performance.now() - started).toBeGreaterThanOrEqual(900);
    expect(result.waited.ended_by).toBe("timeout");
    expect(result.items).toEqual([]);
    expect(snapshot()).toBe(during);
  });

  test("returns early only when an item for this session arrives", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    // Counted by the pass before the wait; the result must keep that count.
    report(j.store, peer, "before", "Also not for you.");
    const started = performance.now();
    const waiting = ok(server, "collab_inbox", { wait_seconds: 20 });
    setTimeout(() => report(j.store, peer, "noise", "Not for you."), 200);
    setTimeout(() => report(j.store, peer, "for-me", "For you.", { to_session_id: me.session.id }), 700);
    const result = await waiting;
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(600);
    expect(elapsed).toBeLessThan(10_000);
    expect(result.waited.ended_by).toBe("item");
    expect(result.items.map((item: any) => item.statement)).toEqual(["For you."]);
    expect(result.also_new).toEqual({ count: 2 });
  });

  test("a wait that fails after the first pass still returns that pass, which already moved the mark", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    report(j.store, peer, "before", "Not for you.");
    const waiting = call(server, "collab_inbox", { wait_seconds: 5, include: "all" });
    await new Promise((done) => setTimeout(done, 300));
    // The host ends the session while it waits.
    j.store.endSession({ ...me.credential, reason: "ended by the host mid-wait" });
    const result = await waiting;
    expect(result.isError).toBeUndefined();
    const content = result.structuredContent;
    expect(content.waited).toMatchObject({ ended_by: "error", code: "session_auth_failed" });
    expect(content.also_new).toEqual({ count: 1 });
    expect(content.items.map((item: any) => item.statement)).toEqual(["Not for you."]);
    expect(content.read_through.sequence).toBe(j.store.noteMark(me.workspace.id, me.session.id));
    expect(content.next.say).toBeString();
  });

  test("a read that fails after the housekeeping commit never says nothing was written", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    report(j.store, peer, "for-me", "For you.", { to_session_id: me.session.id });
    const markBefore = j.store.noteMark(me.workspace.id, me.session.id);
    // The deferred read, which runs after the housekeeping committed, fails once.
    const views = j.store.noteSessionViews.bind(j.store);
    let failures = 1;
    (j.store as any).noteSessionViews = (workspaceId: string) => {
      if (failures-- > 0) throw new CollabError("event_not_found", "No event at sequence 9");
      return views(workspaceId);
    };
    const failed = await call(server, "collab_inbox");
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ code: "event_not_found", after_housekeeping: true });
    expect(failed.structuredContent.remedy.say).toContain("had already recorded its housekeeping");
    expect(failed.structuredContent.remedy.say).not.toContain("Nothing was written");
    expect(j.store.noteMark(me.workspace.id, me.session.id)).toBeGreaterThan(markBefore!);
  });

  test("a cancelled wait says what its first pass did, and never that nothing was written", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    report(j.store, peer, "before", "Not for you.");
    const controller = new AbortController();
    const waiting = call(server, "collab_inbox", { wait_seconds: 5, include: "all" }, controller.signal);
    await new Promise((done) => setTimeout(done, 300));
    controller.abort();
    const result = await waiting;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("wait_cancelled");
    expect(result.structuredContent.remedy.say).not.toContain("Nothing was written");
    expect(result.structuredContent.remedy.say).toContain("read mark");
    // What the first pass counted travels with the refusal, so it is not lost silently.
    expect(result.structuredContent.first_pass.also_new).toEqual({ count: 1 });
    expect(result.structuredContent.first_pass.items.map((item: any) => item.statement)).toEqual(["Not for you."]);
  });
});

describe("collab_inbox about", () => {
  test("a report thread: the root, every answer, and which challenges stand", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const third = j.start("third");
    const root = report(j.store, me, "root", "The build is green.");
    const challenge = report(j.store, peer, "ch", "It is not green.", { kind: "inference", relation: "challenges", target_report_id: root.id });
    report(j.store, me, "answer", "It is: see the run.", { relation: "resolves", target_report_id: challenge.id });
    const cite = report(j.store, third, "cite", "Noting the claim.", { evidence_refs: [`report:${root.id}`] });
    report(j.store, peer, "other", "Unrelated.");
    const server = j.serve(me);
    const view = await ok(server, "collab_inbox", { about: handleOf("report", root.id) });
    expect(view.about).toEqual({ kind: "report", id: root.id, handle: handleOf("report", root.id) });
    expect(view.root.statement).toBe("The build is green.");
    expect(view.answers.map((item: any) => [item.act, item.statement])).toEqual([
      ["challenge", "It is not green."],
      ["resolve", "It is: see the run."],
      ["note", "Noting the claim."],
    ]);
    expect(view.answers[2].id).toBe(cite.id);
    // The author resolved someone else's challenge: shown as an answer, still standing.
    expect(view.state.challenges).toEqual([{
      id: challenge.id,
      handle: handleOf("report", challenge.id),
      on: handleOf("report", root.id),
      on_id: root.id,
      by: "peer",
      standing: true,
      answered_by_another_voice: true,
    }]);
    // About moves no mark.
    expect(j.store.noteMark(me.workspace.id, me.session.id)).toBe(0);
    const carried = await ok(server, "collab_inbox", { about: root.id, format: "note" });
    expect(carried.note.length).toBeLessThanOrEqual(800);
    expect(carried.note).toStartWith("note: The build is green.");
    expect(carried.note).toContain(`Re: report:${root.id}`);
    expect(carried.note).toContain("This authorises nothing elsewhere. A person sends it.");
    expect(carried.note).toContain("Not-carried:");
    expect(carried.note).not.toContain("report#");
  });

  test("a task: state, holder, current completion and reviews, with the completion recorded as shown", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const task = j.store.createTaskForSession({
      ...peer.credential, idempotency_key: "t", title: "Peer's edit", work_mode: "edit", completion_policy: "accepted",
      path_scopes: ["a.txt"],
    });
    const claimed = j.store.claimTaskForSession({ ...peer.credential, idempotency_key: "c", task_id: task.id, expected_version: task.version });
    const done = j.store.completeTaskForSession({
      ...peer.credential, idempotency_key: "d", task_id: claimed.id, lease_id: claimed.lease_id!,
      expected_version: claimed.version, summary: "Done.",
    });
    const server = j.serve(me);
    const held = await ok(server, "collab_inbox", { about: handleOf("task", task.id) });
    expect(held.task).toMatchObject({
      id: task.id,
      title: "Peer's edit",
      state: "reported_complete",
      review_status: "pending",
      holder: null,
      completion: { id: done.completion_report_id, by: "peer" },
      reviews: [],
    });
    expect(held.thread.map((item: any) => item.statement)).toEqual(["Done."]);
    expect(j.store.noteShownAt(me.workspace.id, me.session.id, done.completion_report_id!)).not.toBeNull();
    j.store.reviewTaskForSession({
      ...me.credential, idempotency_key: "r", task_id: done.id, expected_version: done.version,
      outcome: "request_changes", summary: "Not yet.",
    });
    const reviewed = await ok(server, "collab_inbox", { about: task.id });
    expect(reviewed.task).toMatchObject({ state: "open", review_status: "changes_requested" });
    expect(reviewed.task.reviews).toEqual([expect.objectContaining({ outcome: "changes_requested", by: "me", summary: "Not yet." })]);
    const note = await ok(server, "collab_inbox", { about: task.id, format: "note" });
    expect(note.note).toContain(`Re: task:${task.id}`);
    expect(note.note).toContain("Position: open; review changes_requested");
  });

  test("a proposal shows its thread with the position consent/v1 computes (the proposal stage's view)", async () => {
    const j = journal();
    const me = j.start("me");
    const opened = j.store.openProposalForSession({
      ...me.credential, idempotency_key: "p", question: "Proceed?", criteria: "Green.", extent: "This repo.",
    });
    const view = await ok(j.serve(me), "collab_inbox", { about: handleOf("proposal", opened.proposal.id) });
    expect(view.about).toEqual({ kind: "proposal", id: opened.proposal.id, handle: handleOf("proposal", opened.proposal.id) });
    expect(view.root.act).toBe("propose");
    expect(view.position).toBe(j.store.proposalStatus(me.workspace.id, opened.proposal.id).ai.position);
    expect(view.advice.join(" ")).not.toContain("not built yet");
  });
});

describe("waiting_on_you over a long journal", () => {
  test("every proposal counts, however many newer ones there are, and a stop is listed first", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const stopped = j.store.openProposalForSession({
      ...me.credential, idempotency_key: "p0", question: "Proceed?", criteria: "Green.", extent: "This repo.",
    });
    report(j.store, peer, "sup", "Yes.", { kind: "inference", relation: "supports", target_report_id: stopped.proposal.id });
    const status = j.store.proposalStatus(me.workspace.id, stopped.proposal.id);
    j.store.recordPersonActAtTerminal({ proposal_report_id: stopped.proposal.id, proposal_sha256: status.proposal_sha256, act: "agree" } as never);
    j.store.relayProposalRejectionForSession({
      ...peer.credential, idempotency_key: "r", proposal_report_id: stopped.proposal.id,
      proposal_sha256: status.proposal_sha256, reason: "Stop.",
    });
    const old = j.store.openProposalForSession({
      ...peer.credential, idempotency_key: "old", question: "An old question?", criteria: "c", extent: "e",
    });
    const newer = 55;
    for (let index = 1; index <= newer; index += 1) {
      j.store.openProposalForSession({ ...peer.credential, idempotency_key: `p${index}`, question: `Q${index}?`, criteria: "c", extent: "e" });
    }
    const server = j.serve(me);
    const read = await ok(server, "collab_inbox", { limit: 50 });
    const waiting = read.waiting_on_you as Array<Record<string, any>>;
    // The one signal that may stop work is never cut, and comes first.
    expect(waiting[0]).toMatchObject({ what: "stop", id: stopped.proposal.id, due: "now" });
    expect(waiting.filter((entry) => entry.what === "voice")).toHaveLength(newer + 1);
    expect(waiting.some((entry) => entry.what === "voice" && entry.id === old.proposal.id)).toBe(true);
    // Arrive lists ten of each, with true totals.
    const arrived = await ok(server, "collab_arrive", { purpose: "look around" });
    expect(arrived.totals.proposals).toBe(newer + 2);
    expect(arrived.open.proposals).toHaveLength(10);
    expect(arrived.totals.waiting_on_you).toBe(newer + 2);
    expect(arrived.waiting_on_you[0]).toMatchObject({ what: "stop", id: stopped.proposal.id });
  }, 30_000);
});

describe("ready calls", () => {
  test("every ready call for a task with a caller-chosen id works, and the bare id does too", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const free = j.store.createTaskForSession({
      ...peer.credential, idempotency_key: "free", id: "my-free-task", title: "Free work", work_mode: "coordination",
    });
    const task = j.store.createTaskForSession({
      ...peer.credential, idempotency_key: "t", id: "my-own-task", title: "Custom", work_mode: "edit",
      completion_policy: "accepted", path_scopes: ["a.txt"],
    });
    const claimed = j.store.claimTaskForSession({ ...peer.credential, idempotency_key: "c", task_id: task.id, expected_version: task.version });
    j.store.completeTaskForSession({
      ...peer.credential, idempotency_key: "d", task_id: claimed.id, lease_id: claimed.lease_id!,
      expected_version: claimed.version, summary: "Done.", review_requested_session_id: me.session.id,
    });
    expect(handleOf("task", task.id)).toBe("task:my-own-task");
    const inbox = await ok(server, "collab_inbox", { limit: 50 });
    const arrived = await ok(server, "collab_arrive", { purpose: "look around" });
    const calls: Array<{ tool: string; input: Record<string, unknown> }> = [
      inbox.next,
      ...inbox.waiting_on_you.map((entry: any) => entry.next),
      ...arrived.open.claimable.map((entry: any) => ({ tool: "collab_inbox", input: { about: entry.task } })),
      ...arrived.open.reviews_wanted.map((entry: any) => ({ tool: "collab_inbox", input: { about: entry.task } })),
      ...arrived.waiting_on_you.map((entry: any) => entry.next),
    ].filter((next) => next && "tool" in next);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const next of calls) {
      const followed = await call(server, next.tool, next.input);
      expect(followed.isError, JSON.stringify({ next, result: followed.structuredContent })).toBeUndefined();
    }
    expect((await ok(server, "collab_inbox", { about: "my-free-task" })).task.id).toBe(free.id);
    expect((await ok(server, "collab_inbox", { about: "task:my-own-task" })).task.id).toBe(task.id);
    const missing = await call(server, "collab_inbox", { about: "no-such-thing" });
    expect(missing.structuredContent.code).toBe("ref_not_found");
    expect(missing.structuredContent.remedy.say).toContain("every id a later call needs");
  });

  test("a ready call names its target exactly, even when its short handle is shared", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const idA = "task_abcdef12-0000-4000-8000-000000000001";
    const idB = "task_abcdef34-0000-4000-8000-000000000002";
    const [taskA] = [idA, idB].map((id, index) => j.store.createTaskForSession({
      ...peer.credential, idempotency_key: `t${index}`, id, title: id, work_mode: "edit",
      completion_policy: "accepted", path_scopes: [`file-${index}.txt`],
    }));
    const claimed = j.store.claimTaskForSession({ ...peer.credential, idempotency_key: "c", task_id: taskA!.id, expected_version: taskA!.version });
    j.store.completeTaskForSession({
      ...peer.credential, idempotency_key: "d", task_id: claimed.id, lease_id: claimed.lease_id!,
      expected_version: claimed.version, summary: "Done.", review_requested_session_id: me.session.id,
    });
    const inbox = await ok(server, "collab_inbox", { limit: 50 });
    const review = inbox.waiting_on_you.find((entry: any) => entry.what === "review");
    // The display handle stays short; the ready call does not guess.
    expect(review.ref).toBe("task#abcdef");
    const viaWaiting = await ok(server, review.next.tool, review.next.input);
    expect(viaWaiting.task.id).toBe(idA);
    const doneItem = inbox.items.find((item: any) => item.why_you === "review_requested");
    expect(doneItem.handle).toBe("task#abcdef");
    const viaNext = await call(server, inbox.next.tool, inbox.next.input);
    expect(viaNext.isError).toBeUndefined();
  });
});

describe("the read mark, more", () => {
  test("a wait ended by an item keeps what the first pass listed and said", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    report(j.store, peer, "n1", "Unaddressed news.");
    const waiting = ok(server, "collab_inbox", { include: "all", wait_seconds: 10 });
    setTimeout(() => report(j.store, peer, "m1", "For me.", { to_session_id: me.session.id }), 300);
    const result = await waiting;
    expect(result.waited.ended_by).toBe("item");
    expect(result.mark_initialised_from).toBe("cursor");
    const reports = (result.items as Array<Record<string, any>>).filter((item) => item.act !== "event");
    expect(reports.map((item) => [item.statement, item.for_me])).toEqual([["Unaddressed news.", false], ["For me.", true]]);
    // Everything unaddressed the first pass passed (the journal's opening
    // events and the news) is both listed and counted.
    const unaddressed = (result.items as Array<Record<string, any>>).filter((item) => !item.for_me);
    expect(unaddressed.length).toBeGreaterThanOrEqual(2);
    expect(result.also_new).toEqual({ count: unaddressed.length });
    expect(result.next).toEqual({ tool: "collab_inbox", input: { about: reports[1]!.id } });
  });

  test("a first call with about initialises the mark from the legacy cursor and says so", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const posted = report(j.store, peer, "x", "For you.", { to_session_id: me.session.id });
    const server = j.serve(me);
    const about = await ok(server, "collab_inbox", { about: posted.id });
    expect(about.mark_initialised_from).toBe("cursor");
    expect(j.store.noteMark(me.workspace.id, me.session.id)).toBe(0);
    const again = await ok(server, "collab_inbox", { about: posted.id });
    expect(again.mark_initialised_from).toBeUndefined();
    const inbox = await ok(server, "collab_inbox");
    expect(inbox.mark_initialised_from).toBeUndefined();
    expect(inbox.items.map((item: any) => item.statement)).toEqual(["For you."]);
  });

  test("what waits on you is recorded as delivered when it is returned", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const task = j.store.createTaskForSession({
      ...peer.credential, idempotency_key: "t", title: "Peer's edit", work_mode: "edit", completion_policy: "accepted",
      path_scopes: ["a.txt"],
    });
    const claimed = j.store.claimTaskForSession({ ...peer.credential, idempotency_key: "c", task_id: task.id, expected_version: task.version });
    const done = j.store.completeTaskForSession({
      ...peer.credential, idempotency_key: "d", task_id: claimed.id, lease_id: claimed.lease_id!,
      expected_version: claimed.version, summary: "Done.", review_requested_session_id: me.session.id,
    });
    const proposal = j.store.openProposalForSession({
      ...peer.credential, idempotency_key: "p", question: "Ship it?", criteria: "Green.", extent: "This repo.",
    });
    await ok(server, "collab_inbox", { limit: 50 });
    // View state may be lost; what is returned next is recorded again.
    j.store.db.exec(`DELETE FROM note_shown`);
    const shown = () => [proposal.proposal.id, done.completion_report_id!]
      .map((id) => j.store.noteShownAt(me.workspace.id, me.session.id, id) !== null);
    // A bound-slot arrive without revise_purpose writes nothing, so it records nothing.
    await ok(server, "collab_arrive", { purpose: "look around" });
    expect(shown()).toEqual([false, false]);
    const read = await ok(server, "collab_inbox");
    expect(read.items).toEqual([]);
    expect(read.waiting_on_you.map((entry: any) => entry.what)).toEqual(expect.arrayContaining(["review", "voice"]));
    expect(shown()).toEqual([true, true]);
    j.store.db.exec(`DELETE FROM note_shown`);
    await ok(server, "collab_arrive", { purpose: "look around again", revise_purpose: true });
    expect(shown()).toEqual([true, true]);
  });
});

describe("collab_inbox about, format note", () => {
  // A report's author can restate it; a proposal cannot be restated, so it
  // travels under a stand-in statement instead (tests/notes-propose.test.ts).
  test("a statement naming a local detail returns the view with note: null and says why", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const posted = j.store.appendReportForSession({
      ...peer.credential, idempotency_key: "r", kind: "observation", body: "Ship /Users/example/secret/path?",
    });
    const view = await ok(j.serve(me), "collab_inbox", { about: posted.id, format: "note" });
    expect(view.root.id).toBe(posted.id);
    expect(view.note).toBeNull();
    expect(view.not_carried).toEqual(["statement (local detail)"]);
    expect(view.advice.join(" ")).toContain("cannot be carried");
    expect(view.advice.join(" ")).toContain(posted.id);
  });

  test("a first line cut at 200 characters never splits an emoji, in items or in the carried note", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const body = `${"x".repeat(198)}\u{1F600}${"y".repeat(20)}\nsecond line`;
    const posted = report(j.store, peer, "emoji", body, { to_session_id: me.session.id });
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const inbox = await ok(server, "collab_inbox");
    expect(inbox.items[0].statement).toBe(`${"x".repeat(198)}…`);
    const view = await ok(server, "collab_inbox", { about: posted.id, format: "note" });
    expect(lone.test(view.root.statement)).toBe(false);
    expect(view.note).toStartWith(`note: ${"x".repeat(198)}…`);
    // A legacy carriage return is not part of the statement.
    const crlf = report(j.store, peer, "crlf", "Line one\r\nline two", { to_session_id: me.session.id });
    expect((await ok(server, "collab_inbox", { about: crlf.id })).root.statement).toBe("Line one");
    // The summaries of what waits on you are cut the same way.
    j.store.openProposalForSession({ ...peer.credential, idempotency_key: "p", question: body, criteria: "c", extent: "e" });
    const waiting = (await ok(server, "collab_inbox")).waiting_on_you;
    // JSON escapes a lone surrogate, so the cut shows here as \ud83d before the ellipsis.
    const summaries = waiting.map((entry: any) => JSON.stringify(entry));
    expect(summaries.some((text: string) => text.includes(`${"x".repeat(198)}…`))).toBe(true);
  });

  test("a failure after the thread's housekeeping never says nothing was written", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const posted = report(j.store, peer, "r", "A plain report.", { to_session_id: me.session.id });
    const thread = j.store.noteThreadForSession.bind(j.store);
    (j.store as any).noteThreadForSession = (input: any) => {
      const data = thread(input);
      Object.defineProperty(data, "truncated", { get: () => { throw new CollabError("event_not_found", "No event at sequence 9"); } });
      return data;
    };
    const failed = await call(j.serve(me), "collab_inbox", { about: posted.id, format: "note" });
    expect(failed.structuredContent).toMatchObject({ code: "event_not_found", after_housekeeping: true });
    expect(failed.structuredContent.remedy.say).toContain("had already recorded its housekeeping");
    expect(failed.structuredContent.remedy.say).not.toContain("Nothing was written");
  });
});

describe("ready calls keep the way the caller reads", () => {
  test("more keeps include and limit, and a wait with about says it did not wait", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    for (let index = 0; index < 4; index += 1) report(j.store, peer, `n${index}`, `Noise ${index}.`);
    const cut = await ok(server, "collab_inbox", { include: "all", limit: 2 });
    expect(cut.more).toBe(true);
    expect(cut.next).toEqual({ tool: "collab_inbox", input: { include: "all", limit: 2 } });
    const rest = await ok(server, "collab_inbox", cut.next.input);
    expect(rest.items.map((item: any) => item.statement)).toEqual(["Noise 2.", "Noise 3."]);
    expect(rest.next).toEqual({ tool: "collab_inbox", input: { wait_seconds: 30, include: "all", limit: 2 } });
    const posted = report(j.store, peer, "r", "A thread.");
    const started = performance.now();
    const view = await ok(server, "collab_inbox", { about: posted.id, wait_seconds: 3 });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(view.advice.join(" ")).toContain("did not wait");
  });
});
