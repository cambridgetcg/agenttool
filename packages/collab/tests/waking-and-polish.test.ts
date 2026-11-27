import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCollabHostCli, waitForSessionEvents } from "../src/host.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store-notes.js";
import { isAddressedTo, isOpenTableReport, toReportHeader } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const watcherEntry = join(packageRoot, "integrations", "claude-code", "collab-doorbell-watch.ts");
const hostBundle = join(packageRoot, "dist", "agenttool-collab-host.js");

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()!();
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "agenttool-collab-polish-"));
  const root = join(dir, "repo");
  mkdirSync(root, { recursive: true });
  const dbPath = join(dir, "collab.sqlite");
  const store = new CollabStore(dbPath);
  const server = buildCollabMcpServer(store);
  cleanup.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, root, dbPath, store, server };
}

async function callTool(
  server: ReturnType<typeof buildCollabMcpServer>,
  name: string,
  args: Record<string, unknown>,
) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return await tool.handler(args, {});
}

describe("waking: wait --addressed --open and shared isOpenTableReport predicate", () => {
  test("rings on peer and desk open broadcasts, skips targeted/reply/proposal/to_person reports, and obeys rest", () => {
    const { root, store } = fixture();
    const alice = store.startSession({ root_path: root, actor: "alice" });
    const bob = store.startSession({ root_path: root, actor: "bob" });
    const carol = store.startSession({ root_path: root, actor: "carol" });
    const wsId = alice.workspace.id;

    // Anchor Bob after Carol joins.
    const anchor0 = store.eventsSince(wsId, 0, 100).next_anchor;

    // 1. Report from Alice to Carol (addressed elsewhere): must NOT ring Bob under --addressed --open.
    const toCarol = store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "r-to-carol",
      to_session_id: carol.session.id,
      kind: "observation",
      body: "private to carol",
    });
    // 2. Report from Alice to person: must NOT ring Bob under --addressed --open.
    store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "r-to-person",
      to_person: true,
      kind: "observation",
      body: "question for person",
    });
    // 3. Report from Alice targeting Carol's report: must NOT ring Bob under --addressed --open.
    const carolOpen = store.appendReportForSession({
      ...carol.credential,
      idempotency_key: "r-carol-seed",
      to_session_id: alice.session.id,
      kind: "observation",
      body: "carol to alice",
    });
    store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "r-reply-carol",
      relation: "supports",
      target_report_id: carolOpen.id,
      kind: "observation",
      body: "reply to carol's report",
    });
    // 4. Bob's own open broadcast: must NOT ring Bob.
    store.appendReportForSession({
      ...bob.credential,
      idempotency_key: "r-bob-own",
      kind: "observation",
      body: "bob's own broadcast",
    });
    expect(toCarol.to_session_id).toBe(carol.session.id);

    const idle = waitForSessionEvents(store, bob.credential, {
      after_anchor: anchor0,
      wait_ms: 0,
      include_own: false,
      addressed: true,
      open: true,
    });
    expect(idle.status).toBe("idle");

    // 5. Open broadcast from Alice (no addressee, target, proposal, or to_person): MUST ring Bob under --addressed --open.
    const anchorBeforeOpen = idle.next_anchor;
    const openFromAlice = store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "r-open-alice",
      kind: "observation",
      body: "SIGN hold until 18:00Z: live session",
    });
    const plainAddressed = waitForSessionEvents(store, bob.credential, {
      after_anchor: anchorBeforeOpen,
      wait_ms: 0,
      include_own: false,
      addressed: true,
      open: false,
    });
    expect(plainAddressed.status).toBe("idle");

    const openRing = waitForSessionEvents(store, bob.credential, {
      after_anchor: anchorBeforeOpen,
      wait_ms: 0,
      include_own: false,
      addressed: true,
      open: true,
    });
    expect(openRing.status).toBe("ready");

    // collab_inbox with include: "open" agrees with wait --addressed --open.
    const bobInbox = store.inboxForSession({
      ...bob.credential,
      limit: 20,
      include: "open",
      peek: true,
    });
    expect(bobInbox.entries.some((entry) => entry.report?.id === openFromAlice.id)).toBe(true);
    expect(bobInbox.entries.some((entry) => entry.report?.id === toCarol.id)).toBe(false);

    // 6. Open desk note (person say without --to or --proposal): MUST ring Bob under --addressed --open.
    const anchorBeforeDesk = store.eventsSince(wsId, 0, 100).next_anchor;
    const deskOpen = store.appendPersonNote({
      workspace_id: wsId,
      idempotency_key: "desk-open-1",
      body: "Desk open broadcast",
    });
    const deskEvent = store.eventsSince(wsId, anchorBeforeDesk.sequence, 10).events[0]!;
    expect(isOpenTableReport(deskEvent, bob.session.id)).toBe(true);
    const deskRing = waitForSessionEvents(store, bob.credential, {
      after_anchor: anchorBeforeDesk,
      wait_ms: 0,
      include_own: false,
      addressed: true,
      open: true,
    });
    expect(deskRing.status).toBe("ready");
    expect(deskOpen.to_session_id).toBeNull();

    // 7. Declared rest (even with wake_on: ["addressed"]) STILL holds open broadcasts.
    store.restSessionForSession({
      ...bob.credential,
      idempotency_key: "bob-rest-addressed",
      mode: "resting",
      wake_on: ["addressed"],
      reason: "resting",
    });
    const anchorWhileResting = store.eventsSince(wsId, 0, 100).next_anchor;
    store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "r-open-while-resting",
      kind: "observation",
      body: "open while bob rests",
    });
    const heldByRest = waitForSessionEvents(store, bob.credential, {
      after_anchor: anchorWhileResting,
      wait_ms: 0,
      include_own: false,
      addressed: true,
      open: true,
    });
    expect(heldByRest.status).toBe("idle");
    expect(heldByRest.skipped_held_events).toBe(1);
  });

  test("CLI rejects --open without --addressed", () => {
    const { dir } = fixture();
    const run = runCollabHostCli(["wait", "--session", "session_00000000-0000-0000-0000-000000000000", "--open", "--db", join(dir, "collab.sqlite")]);
    expect(run.exit_code).toBe(1);
    expect(JSON.parse(run.line!).message).toContain("--open requires --addressed");
  });
});

describe("waking: collab-doorbell-watch --stdout", () => {
  test("emits one content-free ring line to stdout without CLAUDE_CODE_MESSAGING_SOCKET (and honors --open)", async () => {
    const { root, dbPath, store } = fixture();
    const alice = store.startSession({ root_path: root, actor: "alice" });
    const bob = store.startSession({ root_path: root, actor: "bob" });
    writeSessionCredentialFile(store.defaultSessionCredentialPath(bob.session.id), bob.credential);

    const proc = Bun.spawn([
      process.execPath,
      watcherEntry,
      "--session", bob.session.id,
      "--db", dbPath,
      "--host-bin", hostBundle,
      "--stdout",
      "--open",
      "--once",
      "--cycle-ms", "2000",
      "--min-gap-ms", "0",
    ], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: tmpdir(),
        TMPDIR: tmpdir(),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Give the watcher a brief moment to anchor at head, then post an open broadcast.
    await Bun.sleep(300);
    store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "stdout-open-secret",
      kind: "observation",
      body: "SECRET-CANARY-BODY-NEVER-IN-RING",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[collab doorbell] ready:");
    expect(lines[0]).toContain(`session ${bob.session.id}`);
    expect(lines[0]).toContain("collab_inbox");
    expect(lines[0]).not.toContain("SECRET-CANARY-BODY-NEVER-IN-RING");
  }, 15_000);
});

describe("table polish: also_to_session_ids (payload-only, up to 8)", () => {
  test("routes through eventAddressesSession, isAddressedTo, collab_inbox, collab_next, wait --addressed, and declared rest", async () => {
    const { root, store, server } = fixture();
    const alice = store.startSession({ root_path: root, actor: "alice" });
    const bob = store.startSession({ root_path: root, actor: "bob" });
    const carol = store.startSession({ root_path: root, actor: "carol" });
    const dave = store.startSession({ root_path: root, actor: "dave" });
    const wsId = alice.workspace.id;

    // Carol rests with wake_on: ["addressed"]; also_to MUST wake Carol too!
    store.restSessionForSession({
      ...carol.credential,
      idempotency_key: "carol-rest",
      mode: "resting",
      wake_on: ["addressed"],
      reason: "resting for addressed notes",
    });

    const anchorBefore = store.eventsSince(wsId, 0, 100).next_anchor;
    const posted = store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "multi-to-1",
      to_session_id: bob.session.id,
      also_to_session_ids: [carol.session.id, bob.session.id, carol.session.id],
      kind: "observation",
      body: "Sync note for Bob and Carol",
    });
    // Deduplicated and primary to_session_id stripped from also_to_session_ids.
    expect(posted.to_session_id).toBe(bob.session.id);
    expect(posted.also_to_session_ids).toEqual([carol.session.id]);

    const event = store.eventsSince(wsId, anchorBefore.sequence, 10).events[0]!;
    // Both routing predicates agree on Bob (primary), Carol (also_to), Dave (neither), Alice (author).
    expect(store.eventAddressesSession(event, bob.session.id)).toBe(true);
    expect(store.eventAddressesSession(event, carol.session.id)).toBe(true);
    expect(store.eventAddressesSession(event, dave.session.id)).toBe(false);
    expect(store.eventAddressesSession(event, alice.session.id)).toBe(false);

    const rowForIsAddressed = {
      type: event.type,
      session_id: event.session_id ?? null,
      payload_json: JSON.stringify(event.payload),
    };
    expect(isAddressedTo(rowForIsAddressed, bob.session.id)).toBe(true);
    expect(isAddressedTo(rowForIsAddressed, carol.session.id)).toBe(true);
    expect(isAddressedTo(rowForIsAddressed, dave.session.id)).toBe(false);
    expect(isAddressedTo(rowForIsAddressed, alice.session.id)).toBe(false);
    expect(isOpenTableReport(event, dave.session.id)).toBe(false);

    // Carol's wait --addressed wakes EVEN WHILE RESTING with wake_on: ["addressed"] because isAddressedTo matches.
    const carolWait = waitForSessionEvents(store, carol.credential, {
      after_anchor: anchorBefore,
      wait_ms: 0,
      include_own: false,
      addressed: true,
    });
    expect(carolWait.status).toBe("ready");

    // Dave's wait --addressed stays idle.
    const daveWait = waitForSessionEvents(store, dave.credential, {
      after_anchor: anchorBefore,
      wait_ms: 0,
      include_own: false,
      addressed: true,
    });
    expect(daveWait.status).toBe("idle");

    // Carol sees the report in collab_inbox (with why_you: "addressed") and in collab_next.reports.
    const carolInbox = store.inboxForSession({
      ...carol.credential,
      limit: 20,
      include: "for_me",
      peek: true,
    });
    const entry = carolInbox.entries.find((e) => e.report?.id === posted.id);
    expect(entry).toBeDefined();
    expect(entry!.why_you).toBe("addressed");

    const carolNext = store.nextForSession({ ...carol.credential, event_limit: 50 });
    expect(carolNext.reports.some((r) => r.id === posted.id)).toBe(true);
    expect(carolNext.session!.addressed_waiting).toBeGreaterThanOrEqual(1);

    // Dave does NOT see the report in collab_next.reports (addressed to Bob & Carol).
    const daveNext = store.nextForSession({ ...dave.credential, event_limit: 50 });
    expect(daveNext.reports.some((r) => r.id === posted.id)).toBe(false);

    // Cap enforcement: >8 session IDs refused before writing.
    const nineIds = Array.from({ length: 9 }, () => bob.session.id);
    expect(() => store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "multi-to-9",
      also_to_session_ids: nineIds,
      kind: "observation",
      body: "too many",
    })).toThrow(/at most 8/);

    // Cross-workspace session ID refused before writing.
    const otherRoot = join(tmpdir(), `agenttool-other-ws-${Date.now()}`);
    mkdirSync(otherRoot, { recursive: true });
    cleanup.push(() => rmSync(otherRoot, { recursive: true, force: true }));
    const foreign = store.startSession({ root_path: otherRoot, actor: "foreign" });
    expect(() => store.appendReportForSession({
      ...alice.credential,
      idempotency_key: "multi-to-foreign",
      also_to_session_ids: [foreign.session.id],
      kind: "observation",
      body: "cross workspace",
    })).toThrow(/another workspace/);

    // MCP collab_report_append accepts also_to_session_ids too.
    const started = await callTool(server, "collab_session_start", { root_path: root, actor: "mcp-sender" });
    expect(started.isError).toBeUndefined();
    const mcpPosted = await callTool(server, "collab_report_append", {
      workspace_id: wsId,
      idempotency_key: "mcp-multi-1",
      to_session_id: bob.session.id,
      also_to_session_ids: [carol.session.id],
      kind: "observation",
      body: "via MCP",
    });
    expect(mcpPosted.isError).toBeUndefined();
    expect(mcpPosted.structuredContent.report.also_to_session_ids).toEqual([carol.session.id]);
  });
});

describe("table polish: fields: headers on collab_report_list and collab_workspace_status", () => {
  test("returns compact first-line headers with body_chars without full bodies, safe across surrogate pairs", async () => {
    const { root, server } = fixture();
    const started = await callTool(server, "collab_session_start", { root_path: root, actor: "writer" });
    const wsId = started.structuredContent.workspace.id as string;

    // 199 ASCII chars + a 2-unit emoji (surrogate pair) + trailing text + multi-KB second paragraph.
    const firstLine = `${"a".repeat(199)}🔥extra`;
    const bigBody = `\n\n${firstLine}\n\n${"detail ".repeat(500)}`;
    const posted = await callTool(server, "collab_report_append", {
      workspace_id: wsId,
      idempotency_key: "big-report-1",
      kind: "observation",
      body: bigBody,
      confidence: "high",
      confidence_basis: "long basis ".repeat(50),
      limits: "long limits ".repeat(50),
    });
    expect(posted.isError).toBeUndefined();

    // Default (omitted) returns full body as before.
    const fullList = await callTool(server, "collab_report_list", { workspace_id: wsId });
    expect(fullList.structuredContent.reports[0].body).toBe(bigBody.trim());

    // Opt-in fields: "headers" omits body/confidence_basis/limits and returns safe summary + body_chars.
    const headerList = await callTool(server, "collab_report_list", { workspace_id: wsId, fields: "headers" });
    expect(headerList.isError).toBeUndefined();
    const header = headerList.structuredContent.reports[0];
    expect(header.body).toBeUndefined();
    expect(header.confidence_basis).toBeUndefined();
    expect(header.limits).toBeUndefined();
    expect(header.body_chars).toBe(bigBody.trim().length);
    // Must not end with an unpaired high surrogate before the ellipsis.
    expect(header.summary).toBe(`${"a".repeat(199)}…`);

    // collab_workspace_status with fields: "headers" compacts recent_reports.
    const headerStatus = await callTool(server, "collab_workspace_status", { workspace_id: wsId, fields: "headers" });
    expect(headerStatus.isError).toBeUndefined();
    expect(headerStatus.structuredContent.recent_reports).toHaveLength(1);
    expect(headerStatus.structuredContent.recent_reports[0].body).toBeUndefined();
    expect(headerStatus.structuredContent.recent_reports[0].summary).toBe(`${"a".repeat(199)}…`);
    expect(toReportHeader(fullList.structuredContent.reports[0])).toEqual(header);
  });
});

describe("table polish: person say --to <session>", () => {
  test("routes desk note directly to the target session, wakes resting wake_on addressed, and authorises nothing", () => {
    const { root, dbPath, store } = fixture();
    const alice = store.startSession({ root_path: root, actor: "alice" });
    const bob = store.startSession({ root_path: root, actor: "bob" });
    const wsId = alice.workspace.id;

    store.restSessionForSession({
      ...alice.credential,
      idempotency_key: "alice-rest",
      mode: "resting",
      wake_on: ["addressed"],
      reason: "waiting for person",
    });
    const anchorBefore = store.eventsSince(wsId, 0, 100).next_anchor;

    const cli = runCollabHostCli([
      "person", "say",
      "--workspace", wsId,
      "--to", alice.session.id,
      "--body", "Please check PR #612 next.",
      "--idempotency-key", "desk-to-alice-1",
      "--db", dbPath,
    ]);
    expect(cli.exit_code).toBe(0);
    const parsed = JSON.parse(cli.line!);
    expect(parsed.status).toBe("ok");
    expect(parsed.report.to_session_id).toBe(alice.session.id);
    expect(parsed.report.from_actor).toBe("person:desk");
    expect(parsed.report.limits).toBe("Written at the person desk, which does not authenticate the person.");
    expect(parsed.report.authority_scope).toBeNull();

    // Rings Alice even while resting with wake_on: ["addressed"].
    const aliceWait = waitForSessionEvents(store, alice.credential, {
      after_anchor: anchorBefore,
      wait_ms: 0,
      include_own: false,
      addressed: true,
    });
    expect(aliceWait.status).toBe("ready");

    // Does NOT ring Bob (neither --addressed nor --addressed --open).
    const bobWait = waitForSessionEvents(store, bob.credential, {
      after_anchor: anchorBefore,
      wait_ms: 0,
      include_own: false,
      addressed: true,
      open: true,
    });
    expect(bobWait.status).toBe("idle");

    // Refuses unknown or cross-workspace --to before writing.
    const badCli = runCollabHostCli([
      "person", "say",
      "--workspace", wsId,
      "--to", "session_00000000-0000-0000-0000-000000000000",
      "--body", "nope",
      "--idempotency-key", "desk-to-missing",
      "--db", dbPath,
    ]);
    expect(badCli.exit_code).toBe(1);
    expect(JSON.parse(badCli.line!).error).toBe("session_not_found");
  });
});
