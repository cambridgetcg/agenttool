import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
let currentTime: Date;
const memberStores: CollabStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-addressee-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  currentTime = new Date("2026-10-09T09:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => new Date(currentTime) });
});

afterEach(() => {
  while (memberStores.length) memberStores.pop()!.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string, rootPath = root): SessionHandle {
  return store.startSession({ root_path: rootPath, actor });
}

function advance(milliseconds: number): void {
  currentTime = new Date(currentTime.getTime() + milliseconds);
}

function errorFrom(operation: () => unknown): CollabError {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error;
  }
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

async function boundMember(actor: string) {
  const memberStore = new CollabStore(databasePath, { now: () => new Date(currentTime) });
  memberStores.push(memberStore);
  const server = buildCollabMcpServer(memberStore);
  const started = await callTool(server, "collab_session_start", { root_path: root, actor });
  if (started.isError) throw new Error(JSON.stringify(started.structuredContent));
  return {
    server,
    store: memberStore,
    session_id: started.structuredContent.session.id as string,
    workspace_id: started.structuredContent.workspace.id as string,
  };
}

async function claimedEditTask(member: { server: any; workspace_id: string }, name: string) {
  const created = await callTool(member.server, "collab_task_create", {
    workspace_id: member.workspace_id,
    idempotency_key: `${name}-create`,
    title: name,
    work_mode: "edit",
    path_scopes: [`src/${name}.ts`],
  });
  const claimed = await callTool(member.server, "collab_task_claim", {
    workspace_id: member.workspace_id,
    idempotency_key: `${name}-claim`,
    task_id: created.structuredContent.task.id,
    expected_version: created.structuredContent.task.version,
  });
  if (claimed.isError) throw new Error(JSON.stringify(claimed.structuredContent));
  return claimed.structuredContent.task as { id: string; lease_id: string; version: number };
}

describe("addressee hint", () => {
  test("maps the addressee's liveness and declared rest to a delivery, read now", () => {
    const sender = session("hint-sender");
    const live = session("hint-live");
    const waker = session("hint-waker");
    const holder = session("hint-holder");
    const napper = session("hint-napper");
    const departed = session("hint-departed");
    store.restSessionForSession({
      ...waker.credential,
      idempotency_key: "waker-rests",
      mode: "resting",
      reason: "Waiting for review notes.",
      wake_on: ["addressed"],
    });
    store.restSessionForSession({
      ...holder.credential,
      idempotency_key: "holder-rests",
      mode: "resting",
      wake_on: [],
    });
    store.restSessionForSession({
      ...napper.credential,
      idempotency_key: "napper-rests",
      mode: "resting",
      until: new Date(currentTime.getTime() + 60_000).toISOString(),
      wake_on: ["addressed"],
    });
    store.endSession({ ...departed.credential, reason: "Finished and gone." });
    const hint = (who: SessionHandle) => store.addresseeHint(sender.workspace.id, who.session.id);
    const headBefore = store.eventsSince(sender.workspace.id, 0, 500).head_sequence;

    expect(hint(live)).toEqual({
      session_id: live.session.id,
      liveness: "live",
      rest: null,
      delivery: "tap",
    });
    expect(hint(waker)).toMatchObject({
      session_id: waker.session.id,
      liveness: "resting",
      rest: {
        mode: "resting",
        until: null,
        reason: "Waiting for review notes.",
        wake_on: ["addressed"],
      },
      delivery: "wake",
    });
    expect(hint(holder)).toMatchObject({
      session_id: holder.session.id,
      liveness: "resting",
      rest: { mode: "resting", wake_on: [] },
      delivery: "held",
    });
    expect(hint(napper).delivery).toBe("wake");
    expect(hint(departed)).toEqual({
      session_id: departed.session.id,
      liveness: "ended",
      rest: null,
      delivery: "none",
    });

    // Expiry is computed on read: a lapsed rest is simply not resting.
    advance(60_001);
    expect(hint(napper)).toEqual({
      session_id: napper.session.id,
      liveness: "live",
      rest: null,
      delivery: "tap",
    });

    // Quiet without a declaration is stale and held; a declared rest still wakes.
    advance(STALE_AFTER_MS);
    expect(hint(live)).toEqual({
      session_id: live.session.id,
      liveness: "stale",
      rest: null,
      delivery: "held",
    });
    expect(hint(waker).delivery).toBe("wake");
    expect(hint(holder).delivery).toBe("held");

    // A read: nothing appended, and the addressee is not marked seen.
    expect(store.eventsSince(sender.workspace.id, 0, 500).head_sequence).toBe(headBefore);
    expect(hint(live).liveness).toBe("stale");
  });

  test("refuses an unknown session or one in another workspace", () => {
    const sender = session("hint-refusal-sender");
    const elsewhereRoot = join(directory, "elsewhere");
    mkdirSync(elsewhereRoot);
    const elsewhere = session("hint-elsewhere", elsewhereRoot);
    expect(elsewhere.workspace.id).not.toBe(sender.workspace.id);
    expect(errorFrom(() => store.addresseeHint(sender.workspace.id, "session_missing")).code)
      .toBe("session_not_found");
    expect(errorFrom(() => store.addresseeHint(sender.workspace.id, elsewhere.session.id)).code)
      .toBe("session_workspace_mismatch");
  });

  test("attaches the addressee's current state to addressed MCP mutations, replays included", async () => {
    const sender = await boundMember("mcp-sender");
    const addressee = await boundMember("mcp-addressee");
    const reviewer = await boundMember("mcp-reviewer");
    const workspace = sender.workspace_id;
    const tools = (sender.server as any)._registeredTools;
    for (const name of [
      "collab_report_append",
      "collab_handoff_offer",
      "collab_task_complete",
      "collab_task_review",
    ]) {
      expect(tools[name].description).toContain("addressee");
    }

    const noteArgs = {
      workspace_id: workspace,
      idempotency_key: "mcp-note",
      kind: "proposal",
      body: "Please look at the parser change.",
      to_session_id: addressee.session_id,
    };
    const first = await callTool(sender.server, "collab_report_append", noteArgs);
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent.addressee).toEqual({
      session_id: addressee.session_id,
      liveness: "live",
      rest: null,
      delivery: "tap",
    });
    const broadcast = await callTool(sender.server, "collab_report_append", {
      workspace_id: workspace,
      idempotency_key: "mcp-broadcast",
      kind: "observation",
      body: "For everyone.",
    });
    expect(broadcast.isError).toBeUndefined();
    expect("addressee" in broadcast.structuredContent).toBe(false);

    const rested = await callTool(addressee.server, "collab_session_rest", {
      workspace_id: workspace,
      idempotency_key: "addressee-rests",
      mode: "resting",
      reason: "Back after lunch.",
      wake_on: ["addressed"],
    });
    expect(rested.isError).toBeUndefined();

    // An idempotent replay shows the addressee as it is now, never a stored copy.
    const replay = await callTool(sender.server, "collab_report_append", noteArgs);
    expect(replay.isError).toBeUndefined();
    expect(replay.structuredContent.report.id).toBe(first.structuredContent.report.id);
    expect(replay.structuredContent.addressee).toMatchObject({
      session_id: addressee.session_id,
      liveness: "resting",
      rest: { reason: "Back after lunch.", wake_on: ["addressed"] },
      delivery: "wake",
    });
    const receipt = store.db.query(`
      SELECT response_json FROM mutations WHERE idempotency_key = 'mcp-note'
    `).get() as { response_json: string };
    expect(receipt.response_json).not.toContain("addressee");

    const handoffTask = await claimedEditTask(sender, "mcp-handoff");
    const offered = await callTool(sender.server, "collab_handoff_offer", {
      workspace_id: workspace,
      idempotency_key: "mcp-offer",
      task_id: handoffTask.id,
      lease_id: handoffTask.lease_id,
      expected_version: handoffTask.version,
      to_session_id: addressee.session_id,
      summary: "Yours if you want it.",
    });
    expect(offered.isError).toBeUndefined();
    expect(offered.structuredContent.handoff.to_session_id).toBe(addressee.session_id);
    expect(offered.structuredContent.addressee).toMatchObject({
      session_id: addressee.session_id,
      liveness: "resting",
      delivery: "wake",
    });

    const plainTask = await claimedEditTask(sender, "mcp-plain");
    const plain = await callTool(sender.server, "collab_task_complete", {
      workspace_id: workspace,
      idempotency_key: "mcp-plain-complete",
      task_id: plainTask.id,
      lease_id: plainTask.lease_id,
      expected_version: plainTask.version,
      summary: "Done; anyone may review.",
    });
    expect(plain.isError).toBeUndefined();
    expect("addressee" in plain.structuredContent).toBe(false);

    const reviewTask = await claimedEditTask(sender, "mcp-review");
    const reported = await callTool(sender.server, "collab_task_complete", {
      workspace_id: workspace,
      idempotency_key: "mcp-review-complete",
      task_id: reviewTask.id,
      lease_id: reviewTask.lease_id,
      expected_version: reviewTask.version,
      summary: "Ready for the requested reviewer.",
      review_requested_session_id: reviewer.session_id,
    });
    expect(reported.isError).toBeUndefined();
    expect(reported.structuredContent.addressee).toEqual({
      session_id: reviewer.session_id,
      liveness: "live",
      rest: null,
      delivery: "tap",
    });

    // The reporter may have left by the time its review lands.
    const ended = await callTool(sender.server, "collab_session_end", {
      reason: "Done for today.",
      release_leases: true,
    });
    expect(ended.isError).toBeUndefined();
    const review = await callTool(reviewer.server, "collab_task_review", {
      workspace_id: workspace,
      idempotency_key: "mcp-review",
      task_id: reviewTask.id,
      expected_version: reported.structuredContent.task.version,
      outcome: "request_changes",
      summary: "One more regression test, please.",
    });
    expect(review.isError).toBeUndefined();
    expect(review.structuredContent.report.to_session_id).toBe(sender.session_id);
    expect(review.structuredContent.addressee).toEqual({
      session_id: sender.session_id,
      liveness: "ended",
      rest: null,
      delivery: "none",
    });
  });

  test("never turns a committed mutation into an error when the hint cannot be read", async () => {
    const sender = await boundMember("hint-failure-sender");
    const addressee = session("hint-failure-addressee");
    (sender.store as any).addresseeHint = () => {
      throw new Error("hint unavailable");
    };
    const sent = await callTool(sender.server, "collab_report_append", {
      workspace_id: sender.workspace_id,
      idempotency_key: "hint-failure-note",
      kind: "observation",
      body: "Sent even when the hint cannot be read.",
      to_session_id: addressee.session.id,
    });
    expect(sent.isError).toBeUndefined();
    expect(sent.structuredContent.report.to_session_id).toBe(addressee.session.id);
    expect("addressee" in sent.structuredContent).toBe(false);
    expect(store.listReports(sender.workspace_id, { to_session_id: addressee.session.id }))
      .toHaveLength(1);
  });
});
