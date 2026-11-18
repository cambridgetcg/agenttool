import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForSessionEvents } from "../src/host.js";
import type { CollabEvent, EventCursor, SessionHandle } from "../src/protocol.js";
import { CollabStore, isAddressedTo } from "../src/store-notes.js";

// Two rules say an event is "addressed" to a session, and they are meant to
// differ. isAddressedTo is the explicit set: a report or a session handoff
// offer whose sender named this session. It feeds addressed_waiting, the tap
// (knocks) and the wake (doorbell-scan). CollabStore.eventAddressesSession is
// the routed set that `wait --addressed` rings for: the explicit set plus
// answers to something this session did (a reply to its report, a response to
// or loss of its offer, the recovery of its lease) and the task event beside a
// review request or verdict. collab_inbox reads the same set to say why an
// item is for you; its proposal and ballot cases are pinned by the Notes tests. These tests pin the routed
// set, and that it always contains the explicit one.
let directory: string;
let root: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-addressed-rule-"));
  root = join(directory, "repo");
  mkdirSync(root);
  currentTime = new Date("2026-11-12T09:00:00.000Z");
  store = new CollabStore(join(directory, "state", "collab.sqlite"), { now: () => new Date(currentTime) });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

const session = (actor: string): SessionHandle => store.startSession({ root_path: root, actor });

function events(handle: SessionHandle): CollabEvent[] {
  return store.eventsSince(handle.workspace.id, 0, 500).events;
}

function lastOf(handle: SessionHandle, type: string): CollabEvent {
  const found = events(handle).filter((event) => event.type === type).at(-1);
  if (!found) throw new Error(`no ${type} event`);
  return found;
}

/** Which of the given sessions the routed rule names for the newest event of a type. */
function routed(type: string, ...handles: SessionHandle[]): string[] {
  const event = lastOf(handles[0]!, type);
  return handles.filter((handle) => store.eventAddressesSession(event, handle.session.id))
    .map((handle) => handle.session.actor);
}

function headAnchor(handle: SessionHandle): EventCursor {
  const workspace = store.getWorkspace(handle.workspace.id)!;
  return { epoch_id: workspace.epoch_id, sequence: workspace.event_head_sequence, hash: workspace.event_head_hash };
}

function waitAddressed(handle: SessionHandle, after: EventCursor, includeOwn = false) {
  let now = 0;
  return waitForSessionEvents(store, handle.credential, {
    after_anchor: after,
    wait_ms: 500,
    include_own: includeOwn,
    addressed: true,
  }, { now: () => now, sleep: (ms) => { now += ms; } });
}

/** A coordination task its owner holds for an hour. */
function held(owner: SessionHandle, key: string, policy: "self" | "accepted" = "self") {
  const task = store.createTaskForSession({
    ...owner.credential,
    idempotency_key: `${key}-create`,
    title: key,
    work_mode: "coordination",
    ...(policy === "accepted" ? { completion_policy: "accepted" as const } : {}),
  });
  return store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: `${key}-claim`,
    task_id: task.id,
    expected_version: task.version,
    ttl_seconds: 3600,
  });
}

function offer(from: SessionHandle, to: SessionHandle, key: string, ttlSeconds?: number) {
  const task = held(from, key);
  return store.offerHandoffForSession({
    ...from.credential,
    idempotency_key: `${key}-offer`,
    task_id: task.id,
    lease_id: task.lease_id!,
    expected_version: task.version,
    to_session_id: to.session.id,
    summary: `take ${key}`,
    ...(ttlSeconds ? { ttl_seconds: ttlSeconds } : {}),
  });
}

describe("the routed set that wait --addressed rings for", () => {
  test("reports: an explicit address, or an answer the sender left unaddressed", () => {
    const a = session("a");
    const b = session("b");
    const c = session("c");

    store.appendReportForSession({ ...b.credential, idempotency_key: "plain", kind: "observation", body: "all" });
    expect(routed("report.posted", a, b, c)).toEqual([]);

    store.appendReportForSession({
      ...b.credential, idempotency_key: "to-a", kind: "observation", body: "for a", to_session_id: a.session.id,
    });
    expect(routed("report.posted", a, b, c)).toEqual(["a"]);

    const proposal = store.appendReportForSession({
      ...a.credential, idempotency_key: "a-proposes", kind: "proposal", body: "a proposes",
    });
    expect(routed("report.posted", a, b, c)).toEqual([]);
    store.appendReportForSession({
      ...b.credential, idempotency_key: "b-supports", kind: "observation", body: "agreed",
      relation: "supports", target_report_id: proposal.id,
    });
    expect(routed("report.posted", a, b, c)).toEqual(["a"]);

    // The sender chose its addressee: an answer to a's report that names c is
    // c's mail, and collab_next would not list it for a.
    store.appendReportForSession({
      ...b.credential, idempotency_key: "b-tells-c", kind: "observation", body: "c, see a's proposal",
      relation: "supports", target_report_id: proposal.id, to_session_id: c.session.id,
    });
    expect(routed("report.posted", a, b, c)).toEqual(["c"]);
  });

  test("an event never addresses the session that wrote it", () => {
    const a = session("a");
    const b = session("b");
    const proposal = store.appendReportForSession({
      ...a.credential, idempotency_key: "a-proposes", kind: "proposal", body: "a proposes",
    });
    const before = headAnchor(a);
    // a answers its own report: routed fields name a, and a wrote it.
    store.appendReportForSession({
      ...a.credential, idempotency_key: "a-revises", kind: "proposal", body: "a revises",
      relation: "supersedes", target_report_id: proposal.id,
    });
    expect(routed("report.posted", a, b)).toEqual([]);
    // Even when the wait is asked to include the session's own events.
    expect(waitAddressed(a, before, true)).toMatchObject({ status: "idle", skipped_unaddressed_events: 1 });
  });

  test("handoffs: the offer names its target, and each answer names the offerer", () => {
    const a = session("a");
    const b = session("b");

    const declined = offer(b, a, "declined");
    expect(routed("handoff.offered", a, b)).toEqual(["a"]);
    store.respondHandoffForSession({
      ...a.credential, idempotency_key: "decline", handoff_id: declined.handoff.id,
      expected_version: declined.task.version, response: "decline",
    });
    expect(routed("handoff.declined", a, b)).toEqual(["b"]);

    const accepted = offer(b, a, "accepted");
    store.respondHandoffForSession({
      ...a.credential, idempotency_key: "accept", handoff_id: accepted.handoff.id,
      expected_version: accepted.task.version, response: "accept",
    });
    expect(routed("handoff.accepted", a, b)).toEqual(["b"]);
  });

  test("a lost offer is news to the offerer only when the offerer did not cause it", () => {
    const a = session("a");
    const b = session("b");
    const reason = () => (lastOf(a, "handoff.expired").payload as { reason: string }).reason;

    // The target leaves: news.
    const target = session("target");
    offer(b, target, "target-ends");
    store.endSession({ ...target.credential, reason: "leaving" });
    expect(reason()).toBe("target_session_ended");
    expect(routed("handoff.expired", a, b)).toEqual(["b"]);

    // The deadline passes: news.
    offer(b, a, "deadline", 30);
    currentTime = new Date(currentTime.getTime() + 31_000);
    store.nextForSession(a.credential);
    expect(reason()).toBe("offer_deadline_elapsed");
    expect(routed("handoff.expired", a, b)).toEqual(["b"]);

    // The offerer releases its own task: its own act, written without a
    // session id, and it must not ring the offerer's own doorbell.
    const released = offer(b, a, "released");
    const before = headAnchor(b);
    store.releaseTaskForSession({
      ...b.credential, idempotency_key: "release", task_id: released.task.id,
      lease_id: released.task.lease_id!, expected_version: released.task.version,
    });
    expect(reason()).toBe("task_released");
    expect(lastOf(a, "handoff.expired").session_id).toBeNull();
    expect(routed("handoff.expired", a, b)).toEqual([]);
    expect(waitAddressed(b, before)).toMatchObject({ status: "idle" });
  });

  test("a review request and a verdict each name one session, in the task event and in the report beside it", () => {
    const reviewer = session("reviewer");
    const worker = session("worker");
    const other = session("other");
    const task = held(worker, "review", "accepted");

    const beforeRequest = headAnchor(reviewer);
    const reported = store.completeTaskForSession({
      ...worker.credential, idempotency_key: "complete", task_id: task.id, lease_id: task.lease_id!,
      expected_version: task.version, summary: "done", review_requested_session_id: reviewer.session.id,
    });
    // The task event has an addressed report written beside it. Both name the
    // reviewer (collab_inbox reads the task event to say why), and one wait
    // from before them rings once for the pair.
    expect(routed("task.reported_complete", reviewer, worker, other)).toEqual(["reviewer"]);
    expect(routed("report.posted", reviewer, worker, other)).toEqual(["reviewer"]);
    const request = waitAddressed(reviewer, beforeRequest);
    expect(request.status).toBe("ready");
    const afterRequest = headAnchor(reviewer);

    const beforeVerdict = headAnchor(worker);
    const verdict = store.reviewTaskForSession({
      ...reviewer.credential, idempotency_key: "request-changes", task_id: reported.id,
      expected_version: reported.version, outcome: "request_changes", summary: "one more pass",
    });
    expect(routed("task.changes_requested", reviewer, worker, other)).toEqual(["worker"]);
    expect(routed("report.posted", reviewer, worker, other)).toEqual(["worker"]);
    expect(waitAddressed(worker, beforeVerdict).status).toBe("ready");
    expect(waitAddressed(worker, headAnchor(worker))).toMatchObject({ status: "idle" });
    // Nothing after the request addressed the reviewer again.
    expect(waitAddressed(reviewer, afterRequest)).toMatchObject({ status: "idle" });

    // The verdict keeps naming the worker whoever reports the task next: the
    // answer is read from the event, never from the task's current state.
    const verdictReport = lastOf(worker, "report.posted");
    const reclaimed = store.claimTaskForSession({
      ...other.credential, idempotency_key: "other-claims", task_id: verdict.task.id,
      expected_version: verdict.task.version, ttl_seconds: 3600,
    });
    store.completeTaskForSession({
      ...other.credential, idempotency_key: "other-completes", task_id: reclaimed.id,
      lease_id: reclaimed.lease_id!, expected_version: reclaimed.version, summary: "done again",
    });
    expect(store.eventAddressesSession(verdictReport, worker.session.id)).toBe(true);
    expect(store.eventAddressesSession(verdictReport, other.session.id)).toBe(false);
    expect(routed("task.changes_requested", reviewer, worker, other)).toEqual(["worker"]);
  });

  test("the recovery of a lease names the session that held it", () => {
    const holder = session("holder");
    const rescuer = session("rescuer");
    const task = store.createTaskForSession({
      ...holder.credential, idempotency_key: "create", title: "lapsing", work_mode: "coordination",
    });
    const claimed = store.claimTaskForSession({
      ...holder.credential, idempotency_key: "claim", task_id: task.id,
      expected_version: task.version, ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 6 * 60 * 60 * 1000 + 1);
    const lapsed = store.getTask(claimed.workspace_id, claimed.id);
    expect(lapsed.effective_status).toBe("recovery_required");
    store.recoverTaskForSession({
      ...rescuer.credential, idempotency_key: "recover", task_id: lapsed.id,
      expected_version: lapsed.version, recovery_note: "holder unseen for six hours", action: "release",
    });
    expect(routed("task.recovered", holder, rescuer)).toEqual(["holder"]);
  });

  test("the routed set always contains the explicit one", () => {
    const a = session("a");
    const b = session("b");
    const c = session("c");
    store.appendReportForSession({
      ...b.credential, idempotency_key: "to-a", kind: "observation", body: "for a", to_session_id: a.session.id,
    });
    const proposal = store.appendReportForSession({
      ...a.credential, idempotency_key: "a-proposes", kind: "proposal", body: "a proposes",
    });
    store.appendReportForSession({
      ...b.credential, idempotency_key: "b-answers", kind: "observation", body: "agreed",
      relation: "supports", target_report_id: proposal.id,
    });
    store.appendReportForSession({
      ...a.credential, idempotency_key: "a-notes", kind: "observation", body: "a note for c", to_session_id: c.session.id,
    });
    const declined = offer(b, a, "declined");
    store.respondHandoffForSession({
      ...a.credential, idempotency_key: "decline", handoff_id: declined.handoff.id,
      expected_version: declined.task.version, response: "decline",
    });
    const task = held(c, "review", "accepted");
    const reported = store.completeTaskForSession({
      ...c.credential, idempotency_key: "complete", task_id: task.id, lease_id: task.lease_id!,
      expected_version: task.version, summary: "done", review_requested_session_id: a.session.id,
    });
    store.reviewTaskForSession({
      ...a.credential, idempotency_key: "accept", task_id: reported.id,
      expected_version: reported.version, outcome: "accept", summary: "accepted",
    });

    let explicit = 0;
    let answers = 0;
    for (const event of events(a)) {
      const row = { type: event.type, session_id: event.session_id ?? null, payload_json: JSON.stringify(event.payload) };
      for (const handle of [a, b, c]) {
        const isExplicit = isAddressedTo(row, handle.session.id);
        const isRouted = store.eventAddressesSession(event, handle.session.id);
        if (isExplicit) {
          explicit += 1;
          expect(isRouted).toBe(true);
        } else if (isRouted) {
          answers += 1;
        }
      }
    }
    // to-a, the note for c, the offer, the review request and the verdict.
    expect(explicit).toBe(5);
    // b's unaddressed answer to a's proposal, a's decline of b's offer, and the
    // two task events that sit beside the review request and the verdict.
    expect(answers).toBe(4);
  });
});
