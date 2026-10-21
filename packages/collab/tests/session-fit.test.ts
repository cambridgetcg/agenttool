import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultActor } from "../src/actor-default.js";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { SESSION_STALE_AFTER_MS } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

let directory: string;
let root: string;
let now: Date;
let store: CollabStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "collab-fit-"));
  root = join(directory, "repo");
  mkdirSync(root);
  now = new Date("2026-10-21T00:00:00Z");
  store = new CollabStore(join(directory, "collab.sqlite"), { now: () => new Date(now) });
});
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
function advance(ms: number) { now = new Date(now.getTime() + ms); }
function code(fn: () => unknown) {
  try { fn(); return "no_error"; } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error.code;
  }
}
async function tool(server: any, name: string, args: Record<string, unknown> = {}) {
  const entry = server._registeredTools[name];
  return (entry.handler ?? entry.callback)(args, {});
}
function claimed() {
  const owner = store.startSession({ root_path: root, actor: "owner" });
  const task = store.createTaskForSession({ ...owner.credential, idempotency_key: "create", title: "Fit", work_mode: "coordination" });
  const claim = store.claimTaskForSession({ ...owner.credential, idempotency_key: "claim", task_id: task.id, expected_version: task.version, ttl_seconds: 30 });
  return { owner, claim };
}

describe("session-fit leases", () => {
  test("a live session retains every lease past TTL without renew events or version churn", () => {
    const { owner, claim } = claimed();
    const head = store.getWorkspace(owner.workspace.id)!.event_head_sequence;
    for (let i = 0; i < 4; i++) {
      advance(SESSION_STALE_AFTER_MS - 1);
      expect(store.getTask(owner.workspace.id, claim.id).effective_status).toBe("claimed");
      store.nextForSession(owner.credential);
    }
    expect(store.getTask(owner.workspace.id, claim.id).version).toBe(claim.version);
    expect(store.getWorkspace(owner.workspace.id)!.event_head_sequence).toBe(head);
    expect(code(() => store.endSession(owner.credential))).toBe("session_has_active_leases");
    const ended = store.endSessionWithReleases({ ...owner.credential, release_leases: true });
    expect(ended.released_leases[0]?.via).toBe("release");
    expect(store.getTask(owner.workspace.id, claim.id).status).toBe("open");
  });

  test("stale owners still require audited recovery; takeover fences the old lease", () => {
    const { owner, claim } = claimed();
    const peer = store.startSession({ root_path: root, actor: "peer" });
    advance(SESSION_STALE_AFTER_MS + 1);
    expect(store.getTask(owner.workspace.id, claim.id).effective_status).toBe("recovery_required");
    const recovered = store.recoverTaskForSession({ ...peer.credential, task_id: claim.id, expected_version: claim.version, idempotency_key: "recover", recovery_note: "Inspected checkpoint" });
    expect(recovered.lease_id).not.toBe(claim.lease_id);
    const expiration = store.eventsSince(owner.workspace.id, 0, 500).events.find(event => event.type === "task.claim_expired");
    expect(expiration?.payload.effective_at).toBe(now.toISOString());
    expect(expiration?.payload.lease_expires_at).toBe(claim.lease_expires_at);
    expect(code(() => store.renewLeaseForSession({ ...owner.credential, task_id: claim.id, lease_id: claim.lease_id!, idempotency_key: "old-renew" }))).toBe("lease_not_holder");
    expect(store.verifyJournal(owner.workspace.id)).toBe(true);
  });

  test("host-end preflight refuses stale held leases before resume can revive them", () => {
    const { owner, claim } = claimed();
    advance(SESSION_STALE_AFTER_MS + 1);
    expect(store.getTask(owner.workspace.id, claim.id).effective_status).toBe("recovery_required");
    const before = store.getCoordinationSession(owner.session.id);
    const head = store.getWorkspace(owner.workspace.id)!.event_head_sequence;
    expect(code(() => store.preflightSessionEnd(owner.credential))).toBe("session_has_active_leases");
    expect(store.getCoordinationSession(owner.session.id)).toEqual(before);
    expect(store.getWorkspace(owner.workspace.id)!.event_head_sequence).toBe(head);
  });

  test("a stale holder cannot renew or progress an expired lease before recovery", () => {
    const { owner, claim } = claimed();
    advance(SESSION_STALE_AFTER_MS + 1);
    const before = store.getCoordinationSession(owner.session.id);
    const request = { ...owner.credential, task_id: claim.id, lease_id: claim.lease_id!, expected_version: claim.version };
    expect(code(() => store.renewLeaseForSession({ ...request, idempotency_key: "late" }))).toBe("lease_expired");
    expect(code(() => store.progressTaskForSession({ ...request, idempotency_key: "late-progress", message: "late" }))).toBe("lease_expired");
    expect(store.getCoordinationSession(owner.session.id)).toEqual(before);
    expect(store.getTask(owner.workspace.id, claim.id).effective_status).toBe("recovery_required");
    const recovered = store.recoverTaskForSession({ ...owner.credential, task_id: claim.id, expected_version: claim.version, idempotency_key: "recover-own", recovery_note: "Checked expired work" });
    expect(recovered.lease_id).not.toBe(claim.lease_id);
  });

  for (const activity of ["poll", "ack", "resume", "report", "retry"] as const) {
    test(`stale ${activity} refreshes activity without reviving an expired lease`, () => {
      const { owner, claim } = claimed();
      let credential = owner.credential;
      const renewal = { ...credential, task_id: claim.id, lease_id: claim.lease_id!, idempotency_key: "original-renew" };
      const receipt = store.renewLeaseForSession(renewal);
      advance(SESSION_STALE_AFTER_MS + 1);
      const expiredAt = now.toISOString();
      if (activity === "poll") store.nextForSession(credential);
      if (activity === "ack") store.acknowledgeSessionCursor({ ...credential, anchor: owner.session.cursor, expected_cursor_version: 0 });
      if (activity === "resume") credential = store.resumeSession(credential).credential;
      if (activity === "report") store.appendReportForSession({ ...credential, idempotency_key: "report", kind: "observation", body: "Back from rest" });
      if (activity === "retry") expect(store.renewLeaseForSession(renewal)).toEqual(receipt);
      expect(store.getCoordinationSession(owner.session.id)!.liveness).toBe("live");
      expect(store.getTask(owner.workspace.id, claim.id).effective_status).toBe("recovery_required");
      expect(code(() => store.renewLeaseForSession({ ...renewal, ...credential, idempotency_key: "revive" }))).toBe("lease_expired");
      store.close();
      store = new CollabStore(join(directory, "collab.sqlite"), { now: () => new Date(now) });
      expect(store.getTask(owner.workspace.id, claim.id).effective_status).toBe("recovery_required");
      const recovered = store.recoverTaskForSession({ ...credential, task_id: claim.id, expected_version: claim.version, idempotency_key: "recover", recovery_note: "Inspected expired lease" });
      expect(recovered.lease_id).not.toBe(claim.lease_id);
      const expiration = store.eventsSince(owner.workspace.id, 0, 500).events.find(event => event.type === "task.claim_expired");
      expect(expiration?.payload.effective_at).toBe(expiredAt);
      expect(store.verifyJournal(owner.workspace.id)).toBe(true);
    });
  }

  test("renew ignores stale versions, preserves progress/version and exact retry receipts", () => {
    const { owner, claim } = claimed();
    const progress = store.progressTaskForSession({ ...owner.credential, task_id: claim.id, lease_id: claim.lease_id!, expected_version: claim.version, idempotency_key: "progress", message: "In progress" });
    const request = { ...owner.credential, task_id: claim.id, lease_id: claim.lease_id!, expected_version: claim.version, idempotency_key: "renew", ttl_seconds: 3600 };
    const renew = store.renewLeaseForSession(request);
    expect(renew.version).toBe(progress.version);
    expect(renew.latest_progress).toBe("In progress");
    advance(1000);
    expect(store.renewLeaseForSession(request)).toEqual(renew);
    const withoutVersion = store.renewLeaseForSession({ ...owner.credential, task_id: claim.id, lease_id: claim.lease_id!, idempotency_key: "renew-no-version", ttl_seconds: 30 });
    expect(withoutVersion.lease_expires_at).toBe(renew.lease_expires_at);
    expect(code(() => store.renewLeaseForSession({ ...request, ttl_seconds: 30 }))).toBe("idempotency_conflict");
    const resumed = store.resumeSession(owner.credential);
    expect(code(() => store.renewLeaseForSession({ ...request, idempotency_key: "fenced" }))).toBe("session_auth_failed");
    expect(resumed.session.id).toBe(owner.session.id);
  });

  test("legacy renew accepts missing/stale versions but retains TTL and holder checks", () => {
    const ws = store.openWorkspace({ root_path: root, actor: "legacy" });
    const task = store.createTask({ workspace_id: ws.id, actor: "legacy", idempotency_key: "create", title: "legacy" });
    const claim = store.claimTask({ workspace_id: ws.id, actor: "legacy", idempotency_key: "claim", task_id: task.id, expected_version: task.version, ttl_seconds: 30 });
    const input = { workspace_id: ws.id, actor: "legacy", task_id: task.id, lease_id: claim.lease_id!, idempotency_key: "renew", ttl_seconds: 30 };
    expect(store.renewLease({ ...input, expected_version: 1 }).version).toBe(claim.version);
    expect(code(() => store.renewLease({ ...input, expected_version: 2 }))).toBe("idempotency_conflict");
    expect(code(() => store.renewLease(input))).toBe("idempotency_conflict");
    expect(store.renewLease({ ...input, idempotency_key: "without" }).version).toBe(claim.version);
    expect(code(() => store.renewLease({ ...input, actor: "other", idempotency_key: "other" }))).toBe("lease_not_holder");
    advance(31_000);
    expect(code(() => store.renewLease({ ...input, idempotency_key: "expired" }))).toBe("lease_expired");
  });

  test("handoff offered after raw TTL remains usable while source session is live", () => {
    const { owner, claim } = claimed();
    const peer = store.startSession({ root_path: root, actor: "peer" });
    advance(31_000);
    const offered = store.offerHandoffForSession({ ...owner.credential, task_id: claim.id, lease_id: claim.lease_id!, expected_version: claim.version, idempotency_key: "offer", to_session_id: peer.session.id, summary: "Continue" });
    const accepted = store.respondHandoffForSession({ ...peer.credential, handoff_id: offered.handoff.id, expected_version: offered.task.version, idempotency_key: "accept", response: "accept" });
    expect(accepted.task.assignee_session_id).toBe(peer.session.id);
  });
});

describe("display-name defaults", () => {
  test("requires the selected live PID, matching socket and exact process start", () => {
    const config = join(directory, "claude");
    mkdirSync(join(config, "sessions"), { recursive: true });
    const pid = process.pid;
    const socket = `/fixture/${pid}.sock`;
    const procStart = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).stdout.trim();
    expect(procStart.length).toBeGreaterThan(0);
    const file = join(config, `sessions/${pid}.json`);
    const metadata = { pid, name: "chosen name", messagingSocketPath: socket, procStart, logPath: "/never/read", extra: "not returned" };
    writeFileSync(file, JSON.stringify(metadata));
    const env = { CLAUDE_CONFIG_DIR: config, AGENTOOL_COLLAB_CLAUDE_PID: String(pid), CLAUDE_CODE_MESSAGING_SOCKET: socket };
    expect(defaultActor(env)).toBe("chosen name");
    expect(defaultActor({ CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_MESSAGING_SOCKET: socket }, pid)).toBe("chosen name");
    expect(code(() => defaultActor({ CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_MESSAGING_SOCKET: socket }, pid + 1))).toBe("actor_required");
    expect(code(() => defaultActor({ ...env, CLAUDE_CODE_MESSAGING_SOCKET: undefined }))).toBe("actor_required");
    expect(code(() => defaultActor({ ...env, CLAUDE_CODE_MESSAGING_SOCKET: `/other/${pid}.sock` }))).toBe("actor_required");
    for (const update of [{ procStart: "reused-pid" }, { procStart: undefined }, { messagingSocketPath: undefined }]) {
      writeFileSync(file, JSON.stringify({ ...metadata, ...update }));
      expect(code(() => defaultActor(env))).toBe("actor_required");
    }
  });

  test("missing, malformed, oversized, wrong-PID and symlink metadata fail without paths or bytes", () => {
    const config = join(directory, "claude");
    mkdirSync(join(config, "sessions"), { recursive: true });
    const file = join(config, "sessions/123.json");
    const env = { CLAUDE_CONFIG_DIR: config, AGENTOOL_COLLAB_CLAUDE_PID: "123", CLAUDE_CODE_MESSAGING_SOCKET: "/fixture/123.sock" };
    for (const content of ["not-json-private", JSON.stringify({ pid: 456, name: "wrong" }), JSON.stringify({ pid: 123, name: "x".repeat(201) }), "x".repeat(65537)]) {
      writeFileSync(file, content);
      expect(code(() => defaultActor(env))).toBe("actor_required");
      try { defaultActor(env); } catch (error) { expect(String(error)).not.toContain(config); expect(String(error)).not.toContain(content); }
    }
    rmSync(file);
    const target = join(directory, "not-session.key");
    writeFileSync(target, JSON.stringify({ pid: 123, name: "must-not-follow" }));
    symlinkSync(target, file);
    expect(code(() => defaultActor(env))).toBe("actor_required");
    expect(code(() => defaultActor({ ...env, AGENTOOL_COLLAB_CLAUDE_PID: "../123" }))).toBe("actor_required");
  });
});

describe("cooperative child bindings", () => {
  test("same-label children have separate credentials, attribution, cursors and ending", async () => {
    const server = buildCollabMcpServer(store);
    const parent = (await tool(server, "collab_session_start", { root_path: root, actor: "same" })).structuredContent;
    const workspace_id = parent.workspace.id;
    const unnamed = await tool(server, "collab_session_start", { root_path: root, binding_key: "child", parent_session_id: parent.session.id });
    expect(unnamed.structuredContent.error).toBe("actor_required");
    const child = (await tool(server, "collab_session_start", { root_path: root, actor: "same", binding_key: "child", parent_session_id: parent.session.id })).structuredContent;
    expect(child.session.id).not.toBe(parent.session.id);
    expect(child.session.parent_session_id).toBe(parent.session.id);
    const task = (await tool(server, "collab_task_create", { workspace_id, binding_key: "child", idempotency_key: "child-task", title: "Child task", work_mode: "coordination" })).structuredContent.task;
    const claim = (await tool(server, "collab_task_claim", { workspace_id, binding_key: "child", task_id: task.id, expected_version: task.version, idempotency_key: "child-claim" })).structuredContent.task;
    expect(claim.assignee_session_id).toBe(child.session.id);
    const renew = await tool(server, "collab_task_renew", { workspace_id, binding_key: "child", task_id: task.id, lease_id: claim.lease_id, idempotency_key: "child-renew" });
    expect(renew.isError).toBeUndefined();
    const wrong = await tool(server, "collab_task_renew", { workspace_id, task_id: task.id, lease_id: claim.lease_id, idempotency_key: "parent-cannot-renew" });
    expect(wrong.structuredContent.error).toBe("lease_not_holder");
    const next = (await tool(server, "collab_next", { workspace_id, binding_key: "child" })).structuredContent;
    await tool(server, "collab_cursor_ack", { workspace_id, binding_key: "child", anchor: next.events.next_anchor, expected_cursor_version: 0 });
    expect(store.getCoordinationSession(parent.session.id)!.cursor.sequence).toBe(0);
    expect(store.getCoordinationSession(child.session.id)!.cursor.sequence).toBeGreaterThan(0);
    const ended = await tool(server, "collab_session_end", { binding_key: "child", release_leases: true });
    expect(ended.isError).toBeUndefined();
    expect(existsSync(store.defaultSessionCredentialPath(child.session.id))).toBe(false);
    expect(store.getCoordinationSession(parent.session.id)!.status).toBe("active");
    expect((await tool(server, "collab_next", { workspace_id, binding_key: "unknown" })).structuredContent.error).toBe("session_not_bound");
    expect((await tool(server, "collab_next", { workspace_id, binding_key: "" })).structuredContent.error).toBe("invalid_binding_key");
    expect((await tool(server, "collab_next", { workspace_id, binding_key: "child" })).structuredContent.error).toBe("session_not_bound");
    expect(JSON.stringify(child)).not.toContain("session_token");
    expect(JSON.stringify(child)).not.toContain(store.defaultSessionCredentialPath(child.session.id));
    await server.close();
  });

  test("ending one slot cancels only its pending wait; another slot stays independently usable", async () => {
    const server = buildCollabMcpServer(store);
    const parent = (await tool(server, "collab_session_start", { root_path: root, actor: "parent" })).structuredContent;
    const child = (await tool(server, "collab_session_start", { root_path: root, actor: "child", binding_key: "c", parent_session_id: parent.session.id })).structuredContent;
    const workspace_id = parent.workspace.id;
    const anchor = store.eventsSince(workspace_id, 0, 500).next_anchor;
    const waiting = tool(server, "collab_events_wait", { workspace_id, binding_key: "c", after_anchor: anchor, wait_ms: 5000 });
    await new Promise(resolve => setTimeout(resolve, 20));
    await tool(server, "collab_session_end", { binding_key: "c" });
    const result = await waiting;
    expect(result.isError).toBe(true);
    expect(["session_not_bound", "session_auth_failed"]).toContain(result.structuredContent.error);
    const parentResult = await tool(server, "collab_events_wait", { workspace_id, after_anchor: anchor, wait_ms: 0 });
    expect(parentResult.isError).toBeUndefined();
    expect(store.getCoordinationSession(child.session.id)!.status).toBe("ended");
    await server.close();
  });
});
