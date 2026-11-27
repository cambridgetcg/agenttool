import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CollabStore } from "../src/store-notes.js";
import { call, completedTask, journal, ok, refused, runCleanup } from "./notes-helpers.js";

// time/1 step 4 (torrent idea 1): an optional compare-and-swap on report append
// and collab_note, after BitTorrent BEP 44's `cas`. The caller names the
// event_sequence of the last report it read; if another session or the person
// desk posted a report after it, nothing is written and the refusal names the
// missed count and report ids, so two agents writing at once cannot cross unseen.

afterEach(runCleanup);

function head(j: ReturnType<typeof journal>, workspaceId: string): number {
  return (j.store.db.query(`SELECT event_head_sequence AS head FROM workspaces WHERE id = ?`).get(workspaceId) as { head: number }).head;
}

function append(
  j: ReturnType<typeof journal>,
  who: ReturnType<ReturnType<typeof journal>["start"]>,
  key: string,
  extra: Record<string, unknown> = {},
) {
  return j.store.appendReportForSession({
    ...who.credential,
    idempotency_key: key,
    kind: "observation",
    body: `note ${key}`,
    ...extra,
  });
}

function expectHeadMoved(fn: () => unknown): any {
  let caught: any;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught?.code).toBe("head_moved");
  return caught;
}

async function openStdioMcp(dbPath: string, environment: Record<string, string> = {}) {
  const workDir = mkdtempSync(join(tmpdir(), "agenttool-collab-cas-stdio-"));
  mkdirSync(join(workDir, "home"));
  const entry = resolve(import.meta.dir, "..", "bin", "agenttool-collab-mcp.ts");
  const child = Bun.spawn([process.execPath, entry], {
    cwd: workDir,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(workDir, "home"),
      TMPDIR: tmpdir(),
      AGENTOOL_COLLAB_DB: dbPath,
      ...environment,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const stdin = child.stdin as { write(text: string): void; flush(): void };
  let buffered = "";
  let nextId = 1;

  const request = async (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    stdin.flush();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line) as { id?: number; result?: any; error?: unknown };
        if (message.id === id) {
          if (message.error) throw new Error(JSON.stringify(message.error));
          return message.result;
        }
        continue;
      }
      const next = await reader.read();
      if (next.done) throw new Error(`MCP closed during ${method}: ${await new Response(child.stderr).text()}`);
      buffered += decoder.decode(next.value, { stream: true });
    }
    throw new Error(`MCP ${method} timed out`);
  };

  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "agenttool-collab-cas-test", version: "0.0.0" },
  });
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  stdin.flush();

  return {
    workDir,
    callTool: (name: string, args: Record<string, unknown>) =>
      request("tools/call", { name, arguments: args }) as Promise<{
        isError?: boolean;
        content: Array<{ text: string }>;
        structuredContent?: Record<string, any>;
      }>,
    close: async () => {
      child.kill();
      await child.exited;
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

describe("collab_report_append expected_head_sequence", () => {
  test("writes when no other report arrived after the read position", () => {
    const j = journal();
    const me = j.start("me");
    const at = head(j, me.workspace.id);
    const report = append(j, me, "first", { expected_head_sequence: at });
    expect(report.body).toBe("note first");
    expect(head(j, me.workspace.id)).toBeGreaterThan(at);
  });

  test("refuses, writes nothing, lists missed_report_ids and remedy when a peer posted first", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const seen = head(j, me.workspace.id);
    const peerReport = append(j, peer, "peer-first");
    const moved = head(j, me.workspace.id);
    const before = j.count();

    const refusal = expectHeadMoved(() => append(j, me, "mine", { expected_head_sequence: seen }));
    expect(refusal.details).toMatchObject({
      expected_head_sequence: seen,
      head_sequence: moved,
      reports_since: 1,
      missed_report_ids: [peerReport.id],
    });
    expect(refusal.details.remedy).toContain("collab_report_list");
    expect(refusal.details.remedy).toContain(`after_event_sequence: ${seen}`);
    expect(j.count()).toBe(before);

    // Re-read and send again under the same key: the refused attempt left no receipt.
    const listed = j.store.listReports(me.workspace.id, { after_event_sequence: seen });
    expect(listed.map((r) => r.id)).toEqual([peerReport.id]);
    const sent = append(j, me, "mine", { expected_head_sequence: listed.at(-1)!.event_sequence });
    expect(sent.body).toBe("note mine");
  });

  test("refuses an expected sequence ahead of the journal with reports_since 0 and empty missed_report_ids", () => {
    const j = journal();
    const me = j.start("me");
    const at = head(j, me.workspace.id);
    const refusal = expectHeadMoved(() => append(j, me, "ahead", { expected_head_sequence: at + 5 }));
    expect(refusal.message).toContain("ahead of the journal");
    expect(refusal.details).toMatchObject({
      expected_head_sequence: at + 5,
      head_sequence: at,
      reports_since: 0,
      missed_report_ids: [],
    });
  });

  test("caller's own reports do not count: batched posts and own task completion never self-refuse", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const seen = head(j, me.workspace.id);

    // Batched guarded appends from the same read position succeed.
    const first = append(j, me, "batch-1", { expected_head_sequence: seen });
    const second = append(j, me, "batch-2", { expected_head_sequence: seen });
    expect(first.body).toBe("note batch-1");
    expect(second.body).toBe("note batch-2");

    // Completing own task with a review request posts 2 own report rows; still does not self-refuse.
    const created = j.store.createTaskForSession({
      ...me.credential,
      idempotency_key: "own-task-create",
      title: "own task",
      work_mode: "edit",
      path_scopes: ["a.txt"],
    });
    const claimed = j.store.claimTaskForSession({
      ...me.credential,
      idempotency_key: "own-task-claim",
      task_id: created.id,
      expected_version: created.version,
    });
    j.store.completeTaskForSession({
      ...me.credential,
      idempotency_key: "own-task-complete",
      task_id: created.id,
      lease_id: claimed.lease_id!,
      expected_version: claimed.version,
      summary: "done",
      evidence_refs: [],
      review_requested_session_id: peer.session.id,
    });
    const third = append(j, me, "after-own-complete", { expected_head_sequence: seen });
    expect(third.body).toBe("note after-own-complete");

    // Once the peer posts, ONLY the peer's report counts (not the 5 own reports before it).
    const peerPost = append(j, peer, "peer-note");
    const refusal = expectHeadMoved(() => append(j, me, "after-peer", { expected_head_sequence: seen }));
    expect(refusal.details.reports_since).toBe(1);
    expect(refusal.details.missed_report_ids).toEqual([peerPost.id]);
  });

  test("counts every other report writer: peer completion + review request, third-party addressed, person desk, and truncation cap", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const third = j.start("third");

    // 1. Peer completes an edit task and requests review from third -> 2 report rows.
    const seenBeforeComplete = head(j, me.workspace.id);
    const task = j.store.createTaskForSession({
      ...peer.credential,
      idempotency_key: "peer-create",
      title: "peer edit",
      work_mode: "edit",
      path_scopes: ["b.txt"],
    });
    const claim = j.store.claimTaskForSession({
      ...peer.credential,
      idempotency_key: "peer-claim",
      task_id: task.id,
      expected_version: task.version,
    });
    const done = j.store.completeTaskForSession({
      ...peer.credential,
      idempotency_key: "peer-complete",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "peer finished",
      evidence_refs: [],
      review_requested_session_id: third.session.id,
    });
    const completeRefusal = expectHeadMoved(() => append(j, me, "miss-complete", { expected_head_sequence: seenBeforeComplete }));
    expect(completeRefusal.details.reports_since).toBe(2);
    expect(completeRefusal.details.missed_report_ids).toContain(done.completion_report_id!);
    expect(completeRefusal.details.missed_report_ids).toHaveLength(2);

    // 2. Peer report addressed to a third session counts.
    const seenBeforeAddressed = head(j, me.workspace.id);
    const toThird = append(j, peer, "to-third", { to_session_id: third.session.id });
    const addressedRefusal = expectHeadMoved(() => append(j, me, "miss-third", { expected_head_sequence: seenBeforeAddressed }));
    expect(addressedRefusal.details.reports_since).toBe(1);
    expect(addressedRefusal.details.missed_report_ids).toEqual([toThird.id]);

    // 3. Person-desk note (from_session_id IS NULL) counts.
    const seenBeforePerson = head(j, me.workspace.id);
    const deskNote = j.store.appendPersonNote({
      workspace_id: me.workspace.id,
      idempotency_key: "desk-1",
      body: "hold until 15:00Z",
    });
    expect(deskNote.from_session_id).toBeNull();
    const personRefusal = expectHeadMoved(() => append(j, me, "miss-person", { expected_head_sequence: seenBeforePerson }));
    expect(personRefusal.details.reports_since).toBe(1);
    expect(personRefusal.details.missed_report_ids).toEqual([deskNote.id]);

    // 4. Truncation cap at 20 missed report IDs while reports_since stays exact.
    const seenBeforeBurst = head(j, me.workspace.id);
    const burstIds: string[] = [];
    for (let i = 0; i < 23; i += 1) {
      burstIds.push(append(j, peer, `burst-${i}`).id);
    }
    const burstRefusal = expectHeadMoved(() => append(j, me, "miss-burst", { expected_head_sequence: seenBeforeBurst }));
    expect(burstRefusal.details.reports_since).toBe(23);
    expect(burstRefusal.details.missed_report_ids).toEqual(burstIds.slice(0, 20));
    expect(burstRefusal.details.missed_report_ids_truncated).toBe(true);
  });

  test("pins the predicate: peer report followed by non-report events reports exactly 1, and non-report answers alone never refuse", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");

    // Prepare a proposal and a claimed task before capturing `seen`.
    const proposal = j.store.openProposalForSession({
      ...peer.credential,
      idempotency_key: "prop-open",
      question: "Ship CAS follow-ups?",
      criteria: "All tests pass",
      extent: "packages/collab",
    });
    const task = j.store.createTaskForSession({
      ...peer.credential,
      idempotency_key: "t-create",
      title: "work item",
      work_mode: "coordination",
    });
    const claim = j.store.claimTaskForSession({
      ...peer.credential,
      idempotency_key: "t-claim",
      task_id: task.id,
      expected_version: task.version,
    });
    const seenNonReport = head(j, me.workspace.id);

    // Every non-report event class: session join, task create, progress, handoff offer,
    // task block, relayed rejection, and terminal person rejection.
    j.start("third");
    j.store.createTaskForSession({ ...peer.credential, idempotency_key: "t2", title: "another", work_mode: "coordination" });
    const progressed = j.store.progressTaskForSession({
      ...peer.credential,
      idempotency_key: "t-prog",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      message: "halfway",
    });
    const offered = j.store.offerHandoffForSession({
      ...peer.credential,
      idempotency_key: "t-handoff",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: progressed.version,
      to_session_id: me.session.id,
      summary: "take over if free",
    });
    j.store.blockTaskForSession({
      ...peer.credential,
      idempotency_key: "t-block",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: offered.task.version,
      blocker: "waiting on decision",
    });
    j.store.relayProposalRejectionForSession({
      ...peer.credential,
      idempotency_key: "prop-relay-no",
      proposal_report_id: proposal.proposal.id,
      proposal_sha256: proposal.proposal_sha256,
      reason: "person said pause",
    });
    const shownReject = j.store.personActChallenge({
      proposal_report_id: proposal.proposal.id,
      act: "reject",
      reason: "pause for now",
    });
    j.store.recordPersonActAtTerminal({
      proposal_report_id: proposal.proposal.id,
      proposal_sha256: proposal.proposal_sha256,
      act: "reject",
      reason: "pause for now",
      expected_ai_snapshot: shownReject.ai_snapshot,
    });
    expect(head(j, me.workspace.id)).toBeGreaterThan(seenNonReport + 5);

    // None of those events wrote a report row, so guarded append succeeds.
    const written = append(j, me, "after-non-reports", { expected_head_sequence: seenNonReport });
    expect(written.body).toBe("note after-non-reports");

    // Now 1 peer report followed by 3 non-report events: reports_since must stay 1
    // (kills both `head - expected` and `newest event is report` mutants).
    const seenBeforeOne = head(j, me.workspace.id);
    const peerOne = append(j, peer, "one-report");
    j.start("fourth");
    j.store.createTaskForSession({ ...peer.credential, idempotency_key: "t3", title: "trailing-1", work_mode: "coordination" });
    j.store.createTaskForSession({ ...peer.credential, idempotency_key: "t4", title: "trailing-2", work_mode: "coordination" });
    expect(head(j, me.workspace.id) - seenBeforeOne).toBeGreaterThan(1);

    const oneRefusal = expectHeadMoved(() => append(j, me, "after-one-plus-noise", { expected_head_sequence: seenBeforeOne }));
    expect(oneRefusal.details.reports_since).toBe(1);
    expect(oneRefusal.details.missed_report_ids).toEqual([peerOne.id]);
    expect(oneRefusal.details.head_sequence).toBe(head(j, me.workspace.id));
  });

  test("same-key retry replays with identical expected_head_sequence and conflicts when changed or dropped", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const at = head(j, me.workspace.id);
    const first = append(j, me, "once", { expected_head_sequence: at });
    const later = append(j, peer, "later");

    // Identical retry replays even after the journal moved.
    const replay = append(j, me, "once", { expected_head_sequence: at });
    expect(replay.id).toBe(first.id);

    // Same key with a changed expected_head_sequence returns idempotency_conflict.
    let changedErr: any;
    try {
      append(j, me, "once", { expected_head_sequence: later.event_sequence });
    } catch (error) {
      changedErr = error;
    }
    expect(changedErr?.code).toBe("idempotency_conflict");

    // Same key with expected_head_sequence omitted returns idempotency_conflict.
    let droppedErr: any;
    try {
      append(j, me, "once");
    } catch (error) {
      droppedErr = error;
    }
    expect(droppedErr?.code).toBe("idempotency_conflict");

    // Conversely, a receipt created WITHOUT expected_head_sequence replays without it
    // and conflicts if expected_head_sequence is later added on the same key.
    const plain = append(j, me, "plain-once");
    expect(append(j, me, "plain-once").id).toBe(plain.id);
    let addedErr: any;
    try {
      append(j, me, "plain-once", { expected_head_sequence: head(j, me.workspace.id) });
    } catch (error) {
      addedErr = error;
    }
    expect(addedErr?.code).toBe("idempotency_conflict");
  });

  test("validates the report before running CAS so invalid reports are not misreported as head_moved", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const seen = head(j, me.workspace.id);
    const peerReport = append(j, peer, "peer-first");

    // Missing target_report_id for supports fails validation before head_moved.
    let missingTarget: any;
    try {
      append(j, me, "bad-supports", { relation: "supports", expected_head_sequence: seen });
    } catch (error) {
      missingTarget = error;
    }
    expect(missingTarget?.code).toBe("report_target_required");

    // Trying to withdraw another session's report fails author check before head_moved.
    let wrongAuthor: any;
    try {
      append(j, me, "bad-withdraw", {
        relation: "withdraws",
        target_report_id: peerReport.id,
        expected_head_sequence: seen,
      });
    } catch (error) {
      wrongAuthor = error;
    }
    expect(wrongAuthor?.code).toBe("report_author_mismatch");
  });

  test("without the field, nothing changes and compared_at_sequence is omitted", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    append(j, peer, "peer");
    const server = j.serve(me);
    const plain = await ok(server, "collab_report_append", {
      workspace_id: me.workspace.id,
      idempotency_key: "plain-mcp",
      kind: "observation",
      body: "note plain",
    });
    expect(plain.report.body).toBe("note plain");
    expect("compared_at_sequence" in plain).toBe(false);
    expect(() => append(j, me, "bad", { expected_head_sequence: -1 })).toThrow("non-negative integer");
  });
});

describe("collab_note expected_head_sequence parity", () => {
  test("guards notes, excludes caller's own notes, returns compared_at_sequence, and cites nothing on head_moved", async () => {
    const j = journal({ git: true });
    j.write("notes.txt", "evidence body\n");
    const me = j.start("me");
    const peer = j.start("peer");
    const meServer = j.serve(me);
    const peerServer = j.serve(peer);

    const seen = head(j, me.workspace.id);
    // Own guarded collab_note writes and echoes compared_at_sequence.
    const first = await ok(meServer, "collab_note", {
      text: "First guarded note",
      expected_head_sequence: seen,
    });
    expect(first.compared_at_sequence).toBe(seen);

    // Second guarded collab_note from the same read position succeeds (own report excluded).
    const second = await ok(meServer, "collab_note", {
      text: "Second guarded note from same read",
      expected_head_sequence: seen,
    });
    expect(second.compared_at_sequence).toBe(seen);

    // dry_run does not emit compared_at_sequence and notes CAS runs on write.
    const dry = await ok(meServer, "collab_note", {
      text: "Dry run with CAS",
      dry_run: true,
      expected_head_sequence: seen,
    });
    expect("compared_at_sequence" in dry).toBe(false);
    expect(dry.advice.some((line: string) => line.includes("not during dry_run"))).toBe(true);

    // Invalid expected_head_sequence returns Notes { code, message, remedy }.
    const invalid = await refused(meServer, "collab_note", {
      text: "Bad CAS",
      expected_head_sequence: -3,
    });
    expect(invalid.code).toBe("invalid_expected_head_sequence");
    expect(invalid.remedy).toBeObject();

    // Peer posts via collab_note; me's next guarded collab_note with file evidence must refuse
    // and write NEITHER a report NOR an evidence.cited event.
    const peerNote = await ok(peerServer, "collab_note", { text: "Peer crossed note" });
    const eventsBefore = j.count();
    const crossed = await refused(meServer, "collab_note", {
      text: "Mine after peer",
      why: [{ text: "checked file", basis: "seen", cites: [1] }],
      evidence: ["file notes.txt"],
      expected_head_sequence: seen,
    });
    expect(crossed.code).toBe("head_moved");
    expect(crossed.reports_since).toBe(1);
    expect(crossed.missed_report_ids).toEqual([peerNote.ids.report]);
    expect(crossed.remedy).toEqual({
      tool: "collab_inbox",
      input: { include: "all", since: seen },
    });
    expect(j.count()).toBe(eventsBefore);

    // Following the remedy reads the peer note and allows resending cleanly.
    const inbox = await ok(meServer, "collab_inbox", crossed.remedy.input);
    expect(inbox.items.some((item: any) => item.id === peerNote.ids.report)).toBe(true);
    const retry = await ok(meServer, "collab_note", {
      text: "Mine after reading peer",
      why: [{ text: "checked file", basis: "seen", cites: [1] }],
      evidence: ["file notes.txt"],
      expected_head_sequence: inbox.looked_back.through,
    });
    expect(retry.compared_at_sequence).toBe(inbox.looked_back.through);
  });

  test("guards decide, accept (leaving no orphan cite), and relay_rejection", async () => {
    const j = journal({ git: true });
    j.write("proof.txt", "verified\n");
    const me = j.start("me");
    const peer = j.start("peer");
    const meServer = j.serve(me);

    // 1. decide
    const seenDecide = head(j, me.workspace.id);
    const peerBeforeDecide = append(j, peer, "before-decide");
    const eventsBeforeDecide = j.count();
    const decideRefused = await refused(meServer, "collab_note", {
      act: "decide",
      text: "Keep approach A",
      why: [{ text: "checked proof", basis: "seen", cites: [1] }],
      evidence: ["file proof.txt"],
      expected_head_sequence: seenDecide,
    });
    expect(decideRefused.code).toBe("head_moved");
    expect(decideRefused.missed_report_ids).toEqual([peerBeforeDecide.id]);
    expect(j.count()).toBe(eventsBeforeDecide);

    const decided = await ok(meServer, "collab_note", {
      act: "decide",
      text: "Keep approach A",
      expected_head_sequence: peerBeforeDecide.event_sequence,
    });
    expect(decided.compared_at_sequence).toBe(peerBeforeDecide.event_sequence);

    // 2. accept (with file evidence: must not emit orphan evidence.cited on head_moved)
    const done = completedTask(j, peer, { title: "peer task", paths: ["proof.txt"] });
    const seenBeforeAccept = head(j, me.workspace.id);
    const peerBeforeAccept = append(j, peer, "caveat-before-accept");
    const eventsBeforeAccept = j.count();
    const acceptRefused = await refused(meServer, "collab_note", {
      act: "accept",
      re: `report:${done.completion_report_id!}`,
      text: "Looks good",
      why: [{ text: "checked proof", basis: "seen", cites: [1] }],
      evidence: ["file proof.txt"],
      expected_head_sequence: seenBeforeAccept,
    });
    expect(acceptRefused.code).toBe("head_moved");
    expect(acceptRefused.missed_report_ids).toEqual([peerBeforeAccept.id]);
    expect(j.count()).toBe(eventsBeforeAccept);

    const accepted = await ok(meServer, "collab_note", {
      act: "accept",
      re: `report:${done.completion_report_id!}`,
      text: "Looks good",
      why: [{ text: "checked proof", basis: "seen", cites: [1] }],
      evidence: ["file proof.txt"],
      expected_head_sequence: peerBeforeAccept.event_sequence,
    });
    expect(accepted.compared_at_sequence).toBe(peerBeforeAccept.event_sequence);

    // 3. relay_rejection
    const prop = j.store.openProposalForSession({
      ...peer.credential,
      idempotency_key: "prop-relay-cas",
      question: "Proceed with option B?",
      criteria: "Review complete",
      extent: "slice B",
    });
    const seenBeforeRelay = head(j, me.workspace.id);
    const peerBeforeRelay = append(j, peer, "update-before-relay");
    const relayRefused = await refused(meServer, "collab_note", {
      act: "relay_rejection",
      re: `report:${prop.proposal.id}`,
      text: "Person asked to hold option B",
      expected_head_sequence: seenBeforeRelay,
    });
    expect(relayRefused.code).toBe("head_moved");
    expect(relayRefused.missed_report_ids).toEqual([peerBeforeRelay.id]);

    const relayed = await ok(meServer, "collab_note", {
      act: "relay_rejection",
      re: `report:${prop.proposal.id}`,
      text: "Person asked to hold option B",
      expected_head_sequence: peerBeforeRelay.event_sequence,
    });
    expect(relayed.compared_at_sequence).toBe(peerBeforeRelay.event_sequence);
  });
});

describe("real MCP stdio parsing and two-writer concurrency", () => {
  test("real stdio JSON-RPC accepts expected_head_sequence through Zod and enforces CAS across two processes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenttool-collab-cas-race-"));
    const repo = join(dir, "repo");
    const dbPath = join(dir, "collab.sqlite");
    mkdirSync(repo);

    const procA = await openStdioMcp(dbPath);
    const procB = await openStdioMcp(dbPath);
    try {
      const startA = await procA.callTool("collab_session_start", { root_path: repo, actor: "seat-a" });
      const startB = await procB.callTool("collab_session_start", { root_path: repo, actor: "seat-b" });
      expect(startA.isError).toBeUndefined();
      expect(startB.isError).toBeUndefined();
      const wsId = startA.structuredContent!.workspace.id as string;
      const seen = startB.structuredContent!.workspace.event_head_sequence as number;

      // Both processes race at the exact same expected_head_sequence over real SQLite + stdio MCP.
      const [resA, resB] = await Promise.all([
        procA.callTool("collab_report_append", {
          workspace_id: wsId,
          idempotency_key: "race-a",
          kind: "observation",
          body: "answer from A",
          expected_head_sequence: seen,
        }),
        procB.callTool("collab_report_append", {
          workspace_id: wsId,
          idempotency_key: "race-b",
          kind: "observation",
          body: "answer from B",
          expected_head_sequence: seen,
        }),
      ]);

      const winners = [resA, resB].filter((r) => !r.isError);
      const losers = [resA, resB].filter((r) => r.isError);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const winnerId = winners[0]!.structuredContent!.report.id as string;
      expect(winners[0]!.structuredContent!.compared_at_sequence).toBe(seen);
      expect(losers[0]!.structuredContent!.error).toBe("head_moved");
      expect(losers[0]!.structuredContent!.reports_since).toBe(1);
      expect(losers[0]!.structuredContent!.missed_report_ids).toEqual([winnerId]);

      // Notes-profile stdio process also runs collab_note CAS end-to-end.
      const notesProc = await openStdioMcp(dbPath, { AGENTOOL_COLLAB_TOOLS: "notes" });
      try {
        const arrived = await notesProc.callTool("collab_arrive", {
          purpose: "test notes cas",
          name: "seat-notes",
          root_path: repo,
        });
        expect(arrived.isError).toBeUndefined();
        const refusedNote = await notesProc.callTool("collab_note", {
          text: "Crossed notes post",
          expected_head_sequence: seen,
        });
        expect(refusedNote.isError).toBe(true);
        expect(refusedNote.structuredContent!.code).toBe("head_moved");
        expect(refusedNote.structuredContent!.missed_report_ids).toEqual([winnerId]);
        expect(refusedNote.structuredContent!.remedy).toEqual({
          tool: "collab_inbox",
          input: { include: "all", since: seen },
        });

        const freshSeq = winners[0]!.structuredContent!.report.event_sequence as number;
        const okNote = await notesProc.callTool("collab_note", {
          text: "Post after reading winner",
          expected_head_sequence: freshSeq,
        });
        expect(okNote.isError).toBeUndefined();
        expect(okNote.structuredContent!.compared_at_sequence).toBe(freshSeq);
      } finally {
        await notesProc.close();
      }
    } finally {
      await procA.close();
      await procB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("two independent CollabStore handles racing on one SQLite file keep compare and insert atomic", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenttool-collab-cas-stores-"));
    const repo = join(dir, "repo");
    const dbPath = join(dir, "collab.sqlite");
    mkdirSync(repo);
    const storeA = new CollabStore(dbPath);
    const storeB = new CollabStore(dbPath);
    try {
      const a = storeA.startSession({ root_path: repo, actor: "writer-a" });
      const b = storeB.startSession({ root_path: repo, actor: "writer-b" });
      const seen = b.workspace.event_head_sequence;

      const rA = storeA.appendReportForSession({
        ...a.credential,
        idempotency_key: "store-race-a",
        kind: "observation",
        body: "first writer",
        expected_head_sequence: seen,
      });
      const errB = expectHeadMoved(() => storeB.appendReportForSession({
        ...b.credential,
        idempotency_key: "store-race-b",
        kind: "observation",
        body: "second writer",
        expected_head_sequence: seen,
      }));
      expect(errB.details.reports_since).toBe(1);
      expect(errB.details.missed_report_ids).toEqual([rA.id]);
    } finally {
      storeA.close();
      storeB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
