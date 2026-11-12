import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { CollabReport, SessionHandle, Task } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";
// Namespace import, so a missing export fails only the test that uses it.
import * as storeModule from "../src/store.js";

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
const memberStores: CollabStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-addressed-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  while (memberStores.length) memberStores.pop()!.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string): SessionHandle {
  return store.startSession({ root_path: root, actor });
}

function waiting(who: SessionHandle, eventLimit = 50): number {
  return store.nextForSession({ ...who.credential, event_limit: eventLimit })
    .session.addressed_waiting;
}

function note(from: SessionHandle, key: string, to?: SessionHandle): CollabReport {
  return store.appendReportForSession({
    ...from.credential,
    idempotency_key: key,
    kind: "observation",
    body: `Note ${key}.`,
    ...(to ? { to_session_id: to.session.id } : {}),
  });
}

function claimedEditTask(owner: SessionHandle, name: string): Task {
  const created = store.createTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-create`,
    title: name,
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: [`src/${name}.ts`],
  });
  return store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-claim`,
    task_id: created.id,
    expected_version: created.version,
  });
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("addressed_waiting on the bound session of collab_next", () => {
  test("counts reports and session handoff offers addressed to the session, never its own", () => {
    const target = session("addressed-target");
    const sender = session("addressed-sender");
    const bystander = session("addressed-bystander");
    expect(waiting(target)).toBe(0);

    note(sender, "to-target", target);
    expect(waiting(target)).toBe(1);

    // Broadcasts, notes to someone else and notes to oneself are not knocks.
    note(sender, "broadcast");
    note(sender, "to-bystander", bystander);
    note(target, "to-self", target);
    expect(waiting(target)).toBe(1);
    expect(waiting(bystander)).toBe(1);

    // A legacy actor-path offer to the same label carries no session address.
    const legacy = store.createTask({
      workspace_id: target.workspace.id,
      actor: "legacy-holder",
      idempotency_key: "legacy-create",
      title: "Legacy offer",
    });
    const legacyClaim = store.claimTask({
      workspace_id: target.workspace.id,
      actor: "legacy-holder",
      idempotency_key: "legacy-claim",
      task_id: legacy.id,
      expected_version: legacy.version,
    });
    store.offerHandoff({
      workspace_id: target.workspace.id,
      actor: "legacy-holder",
      idempotency_key: "legacy-offer",
      task_id: legacy.id,
      lease_id: legacyClaim.lease_id!,
      expected_version: legacyClaim.version,
      to_actor: target.session.actor,
      summary: "A label-addressed offer.",
    });
    expect(waiting(target)).toBe(1);

    const offeredTask = claimedEditTask(sender, "offered");
    const offered = store.offerHandoffForSession({
      ...sender.credential,
      idempotency_key: "offer-to-target",
      task_id: offeredTask.id,
      lease_id: offeredTask.lease_id!,
      expected_version: offeredTask.version,
      to_session_id: target.session.id,
      summary: "Please continue this task.",
    });
    expect(waiting(target)).toBe(2);

    // handoff.accepted names the acceptor as to_session_id; it is never counted.
    store.respondHandoffForSession({
      ...target.credential,
      idempotency_key: "accept-offer",
      handoff_id: offered.handoff.id,
      expected_version: offered.task.version,
      response: "accept",
    });
    expect(waiting(target)).toBe(2);
    expect(waiting(sender)).toBe(0);

    // The review request report counts; its task.reported_complete twin does not.
    const requested = claimedEditTask(sender, "review-requested");
    const reported = store.completeTaskForSession({
      ...sender.credential,
      idempotency_key: "review-requested-complete",
      task_id: requested.id,
      lease_id: requested.lease_id!,
      expected_version: requested.version,
      summary: "Ready for review.",
      review_requested_session_id: target.session.id,
    });
    expect(waiting(target)).toBe(3);

    // The review result is addressed to the reporter.
    store.reviewTaskForSession({
      ...target.credential,
      idempotency_key: "target-reviews",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "request_changes",
      summary: "Please add a regression test.",
    });
    expect(waiting(sender)).toBe(1);
    expect(waiting(target)).toBe(3);
  });

  test("counts past the acknowledged cursor, regardless of the event page size", () => {
    const target = session("cursor-target");
    const sender = session("cursor-sender");
    const first = note(sender, "first", target);
    note(sender, "between");
    note(sender, "second", target);
    expect(waiting(target, 1)).toBe(2);

    const firstEvent = store.eventsSince(target.workspace.id, 0, 500).events
      .find((event) => event.sequence === first.event_sequence)!;
    store.acknowledgeSessionCursor({
      ...target.credential,
      anchor: {
        epoch_id: firstEvent.epoch_id,
        sequence: firstEvent.sequence,
        hash: firstEvent.hash,
      },
      expected_cursor_version: 0,
    });
    expect(waiting(target)).toBe(1);

    const page = store.nextForSession({ ...target.credential, event_limit: 50 });
    store.acknowledgeSessionCursor({
      ...target.credential,
      anchor: page.events.next_anchor,
      expected_cursor_version: page.session.cursor_version,
    });
    expect(waiting(target)).toBe(0);

    note(sender, "third", target);
    expect(waiting(target)).toBe(1);
  });

  test("matches only explicit session addresses, by event type", () => {
    const isAddressedTo = storeModule.isAddressedTo;
    expect(typeof isAddressedTo).toBe("function");
    const me = "session_me";
    const row = (
      type: string,
      payload: Record<string, unknown>,
      authorSessionId: string | null = "session_sender",
    ) => ({ type, session_id: authorSessionId, payload_json: JSON.stringify(payload) });

    expect(isAddressedTo(row("report.posted", { to_session_id: me }), me)).toBe(true);
    expect(isAddressedTo(row("handoff.offered", { handoff: { to_session_id: me } }), me)).toBe(true);
    // Never its own, never a broadcast, never an actor-path offer.
    expect(isAddressedTo(row("report.posted", { to_session_id: me }, me), me)).toBe(false);
    expect(isAddressedTo(row("report.posted", { to_session_id: null }), me)).toBe(false);
    expect(isAddressedTo(row("handoff.offered", { offer: { to_actor: "me", to_session_id: null } }, null), me))
      .toBe(false);
    // Other event types that name the session are not addressed notes.
    expect(isAddressedTo(row("handoff.accepted", { to_session_id: me }), me)).toBe(false);
    expect(isAddressedTo(row("task.reported_complete", { review_requested_session_id: me }), me)).toBe(false);
    // A damaged payload reads as not addressed instead of throwing.
    expect(isAddressedTo({ type: "report.posted", session_id: "session_sender", payload_json: "{" }, me))
      .toBe(false);
  });

  test("collab_next shows addressed_waiting on the bound session and says what it counts", async () => {
    const description = (buildCollabMcpServer(store) as any)._registeredTools.collab_next.description;
    expect(description).toContain("addressed_waiting");
    expect(description).toContain("falls as collab_cursor_ack advances");

    const memberStore = new CollabStore(databasePath);
    memberStores.push(memberStore);
    const server = buildCollabMcpServer(memberStore);
    const started = await callTool(server, "collab_session_start", { root_path: root, actor: "mcp-target" });
    expect(started.isError).toBeUndefined();
    const sender = session("mcp-sender");
    store.appendReportForSession({
      ...sender.credential,
      idempotency_key: "mcp-note",
      kind: "proposal",
      body: "Addressed through the store.",
      to_session_id: started.structuredContent.session.id,
    });
    const next = await callTool(server, "collab_next", {
      workspace_id: started.structuredContent.workspace.id,
    });
    expect(next.isError).toBeUndefined();
    expect(next.structuredContent.session.addressed_waiting).toBe(1);

    const legacy = await callTool(buildCollabMcpServer(store), "collab_next", {
      workspace_id: started.structuredContent.workspace.id,
      actor: "legacy-reader",
    });
    expect(legacy.isError).toBeUndefined();
    expect(legacy.structuredContent.session).toBeNull();
  });
});
