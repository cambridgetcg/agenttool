import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultDatabasePath, resolveDatabasePath } from "../src/database-path.js";
import { MAX_HOST_WAIT_MS, runCollabHostCli, waitForSessionEvents } from "../src/host.js";
import type { EventCursor, SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const hostEntry = join(packageRoot, "bin", "agenttool-collab-host.ts");

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-host-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function startWithCredentialFile(actor: string): { handle: SessionHandle; file: string } {
  const handle = store.startSession({ root_path: root, actor });
  const file = writeSessionCredentialFile(
    store.defaultSessionCredentialPath(handle.session.id),
    handle.credential,
  );
  return { handle, file };
}

function claimEditTask(handle: SessionHandle, key: string, scope: string) {
  const task = store.createTaskForSession({
    ...handle.credential,
    idempotency_key: `${key}-create`,
    title: key,
    work_mode: "edit",
    path_scopes: [scope],
  });
  return store.claimTaskForSession({
    ...handle.credential,
    idempotency_key: `${key}-claim`,
    task_id: task.id,
    expected_version: task.version,
    ttl_seconds: 3600,
  });
}

function sessionRow(sessionId: string) {
  return store.db.query(`
    SELECT status, generation, last_seen_at, cursor_recovery_required
    FROM coordination_sessions WHERE id = ?
  `).get(sessionId) as {
    status: string;
    generation: number;
    last_seen_at: string;
    cursor_recovery_required: number;
  };
}

function runHost(args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync([process.execPath, hostEntry, ...args], {
    cwd: packageRoot,
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: tmpdir(),
      HOME: join(directory, "home"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString();
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  return {
    exitCode: result.exitCode,
    stdout,
    lines,
    receipt: JSON.parse(lines[0] ?? "null") as Record<string, any>,
  };
}

describe("agenttool-collab-host end", () => {
  test("resumes a stale credential, releases every lease, ends, and removes the file", () => {
    const { handle, file } = startWithCredentialFile("host-ended-worker");
    const claim = claimEditTask(handle, "host-live", "src/host-live.ts");
    // A later resume and an acknowledgement leave the file's generation and
    // cursor stale; the host CLI must still end the session.
    const resumed = store.resumeSession(handle.credential);
    const page = store.nextForSession(resumed.credential).events;
    store.acknowledgeSessionCursor({
      ...resumed.credential,
      anchor: page.next_anchor,
      expected_cursor_version: resumed.session.cursor_version,
    });

    const run = runHost([
      "end",
      "--session-file",
      file,
      "--reason",
      "host exit sweep: job test ended completed",
      "--release-leases",
      "--db",
      databasePath,
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.lines).toHaveLength(1);
    expect(run.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "ended",
      session_id: handle.session.id,
      released: [{ task_id: claim.id, lease_id: claim.lease_id, via: "release" }],
      ended_at: expect.any(String),
    });
    expect(run.stdout).not.toContain(handle.credential.session_token);
    expect(existsSync(file)).toBe(false);
    const ended = store.getCoordinationSession(handle.session.id);
    expect(ended?.status).toBe("ended");
    expect(ended?.ended_at).toBe(run.receipt.ended_at);
    expect(store.getTask(handle.workspace.id, claim.id)).toMatchObject({
      status: "open",
      lease_id: null,
    });
    const released = store.eventsSince(handle.workspace.id, 0, 500).events.find(
      (event) => event.type === "task.released" && event.entity_id === claim.id,
    );
    expect(released?.payload.summary).toBe("host exit sweep: job test ended completed");
    expect(store.verifyJournal(handle.workspace.id)).toBe(true);
  });

  test("reports already_ended for an ended session and removes its revoked file", () => {
    const { handle, file } = startWithCredentialFile("host-already-ended");
    const ended = store.endSession({ ...handle.credential, reason: "Ended in-process first" });

    for (const flags of [[], ["--release-leases"]]) {
      if (!existsSync(file)) {
        writeSessionCredentialFile(file, handle.credential);
      }
      const run = runHost(
        ["end", "--session-file", file, "--reason", "host exit sweep: late", ...flags],
        { AGENTOOL_COLLAB_DB: databasePath },
      );

      expect(run.exitCode).toBe(0);
      expect(run.receipt).toEqual({
        protocol: "agenttool.collab-host/1",
        status: "already_ended",
        session_id: handle.session.id,
        released: [],
        ended_at: ended.ended_at,
      });
      expect(run.stdout).not.toContain(handle.credential.session_token);
      expect(existsSync(file)).toBe(false);
    }
  });

  test("refuses without mutating anything when --release-leases is absent and a lease is live", () => {
    const { handle, file } = startWithCredentialFile("host-refused");
    const claim = claimEditTask(handle, "host-refused", "src/host-refused.ts");
    // Leave the file's cursor behind the journal: a resume would now flag
    // cursor recovery, so an unchanged flag proves no resume happened.
    const page = store.nextForSession(handle.credential).events;
    store.acknowledgeSessionCursor({
      ...handle.credential,
      anchor: page.next_anchor,
      expected_cursor_version: handle.session.cursor_version,
    });
    const before = sessionRow(handle.session.id);
    const headBefore = store.getWorkspace(handle.workspace.id)!.event_head_sequence;

    const run = runHost([
      "end",
      "--session-file",
      file,
      "--reason",
      "host exit sweep: no flag",
      "--db",
      databasePath,
    ]);

    expect(run.exitCode).toBe(1);
    expect(run.receipt).toMatchObject({
      protocol: "agenttool.collab-host/1",
      status: "error",
      error: "session_has_active_leases",
      task_ids: [claim.id],
      leases: [{ task_id: claim.id, lease_id: claim.lease_id, expires_at: claim.lease_expires_at }],
      required_action: "resolve_active_task_leases",
    });
    // The host CLI names its own flag, not the MCP tool's parameter.
    expect(run.receipt.message).toContain("--release-leases");
    expect(run.receipt.remedy).toContain("--release-leases");
    expect(run.receipt.remedy).not.toContain("collab_session_end");
    expect(run.stdout).not.toContain(handle.credential.session_token);
    expect(existsSync(file)).toBe(true);
    expect(sessionRow(handle.session.id)).toEqual(before);
    expect(before.cursor_recovery_required).toBe(0);
    expect(store.getWorkspace(handle.workspace.id)!.event_head_sequence).toBe(headBefore);
  });

  test("prints its usage for --help or -h, exit 0, touching no journal", () => {
    for (const argv of [["--help"], ["-h"], ["end", "--help"]]) {
      const run = runCollabHostCli(argv, {});
      expect(run.exit_code).toBe(0);
      expect(JSON.parse(run.line)).toEqual({
        protocol: "agenttool.collab-host/1",
        status: "help",
        usage: "usage: agenttool-collab-host end (--session-file <path> | --seat-ref <ref> [--seat-ref <ref>...])"
          + " --reason <text> [--release-leases] [--db <path>]"
          + " | agenttool-collab-host wait (--session <id> | --session-file <path>) [--after-anchor <json>]"
          + " [--wait-ms <ms>] [--include-own] [--addressed] [--db <path>]",
      });
    }
  });

  test("refuses a reason endSession would refuse before any store call, with or without --release-leases", () => {
    // No lease: the read-only preflight passes, so only an argument check
    // made before the resume can keep the generation and the journal still.
    const { handle, file } = startWithCredentialFile("host-long-reason");
    const before = sessionRow(handle.session.id);
    const headBefore = store.getWorkspace(handle.workspace.id)!.event_head_sequence;
    const expectUnchanged = () => {
      expect(existsSync(file)).toBe(true);
      expect(sessionRow(handle.session.id)).toEqual(before);
      expect(store.getWorkspace(handle.workspace.id)!.event_head_sequence).toBe(headBefore);
    };

    // 2,001 characters once trimmed: one past the limit endSession applies.
    const tooLong = `  ${"x".repeat(2_001)}  `;
    for (const flags of [[], ["--release-leases"]]) {
      const run = runHost([
        "end",
        "--session-file",
        file,
        "--reason",
        tooLong,
        ...flags,
        "--db",
        databasePath,
      ]);
      expect(run.exitCode).toBe(1);
      expect(run.lines).toHaveLength(1);
      expect(run.receipt).toMatchObject({
        protocol: "agenttool.collab-host/1",
        status: "error",
        error: "usage_error",
      });
      expect(run.receipt.message).toContain("--reason");
      expect(run.receipt.message).toContain("2000");
      expect(run.stdout).not.toContain(handle.credential.session_token);
      expectUnchanged();
    }

    // argv cannot carry a NUL byte, but the exported entry point can.
    const nul = runCollabHostCli(
      ["end", "--session-file", file, "--reason", "host exit\0sweep", "--db", databasePath],
      {},
    );
    expect(nul.exit_code).toBe(1);
    expect(JSON.parse(nul.line)).toMatchObject({ status: "error", error: "usage_error" });
    expectUnchanged();

    // Exactly 2,000 characters once trimmed is still accepted, as endSession accepts it.
    const atLimit = "y".repeat(2_000);
    const accepted = runHost([
      "end",
      "--session-file",
      file,
      "--reason",
      ` ${atLimit} `,
      "--release-leases",
      "--db",
      databasePath,
    ]);
    expect(accepted.exitCode).toBe(0);
    expect(accepted.receipt).toMatchObject({ status: "ended", session_id: handle.session.id });
    const endedEvent = store.eventsSince(handle.workspace.id, 0, 500).events.find(
      (event) => event.type === "session.ended" && event.entity_id === handle.session.id,
    );
    expect(endedEvent?.payload.reason).toBe(atLimit);
    expect(store.verifyJournal(handle.workspace.id)).toBe(true);
  });

  test("reports an ended session with a warning when the revoked file cannot be removed", () => {
    const { handle, file } = startWithCredentialFile("host-sticky-file");
    const args = [
      "end",
      "--session-file",
      file,
      "--reason",
      "host exit sweep: sticky file",
      "--db",
      databasePath,
    ];
    // A read-only (but still private) directory lets the CLI read the file
    // and end the session, then makes the unlink fail.
    chmodSync(dirname(file), 0o500);
    let run: ReturnType<typeof runHost>;
    try {
      run = runHost(args);
    } finally {
      chmodSync(dirname(file), 0o700);
    }

    expect(run.exitCode).toBe(0);
    expect(run.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "ended",
      session_id: handle.session.id,
      released: [],
      ended_at: expect.any(String),
      warning: "session_file_remove_failed",
    });
    expect(existsSync(file)).toBe(true);
    expect(store.getCoordinationSession(handle.session.id)?.status).toBe("ended");

    const rerun = runHost(args);
    expect(rerun.exitCode).toBe(0);
    expect(rerun.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "already_ended",
      session_id: handle.session.id,
      released: [],
      ended_at: run.receipt.ended_at,
    });
    expect(existsSync(file)).toBe(false);
  });

  test("fails closed on usage errors, blank values, and a missing journal", () => {
    const { handle, file } = startWithCredentialFile("host-usage");
    const usage = runHost(["end", "--reason", "missing session file"]);
    expect(usage.exitCode).toBe(1);
    expect(usage.receipt).toMatchObject({
      protocol: "agenttool.collab-host/1",
      status: "error",
      error: "usage_error",
    });
    expect(usage.receipt.message).toContain("--session-file");

    for (const args of [
      ["start"],
      ["end", "--session-file", file, "--reason", "x", "extra"],
      ["end", "--session-file", file, "--reason", "x", "--unknown"],
      ["end", "--session-file", "", "--reason", "blank session file"],
      ["end", "--session-file", file],
      ["end", "--session-file", file, "--reason", ""],
      ["end", "--session-file", file, "--reason", "   "],
      ["end", "--session-file", file, "--reason", "blank db", "--db", ""],
      ["end", "--session-file", file, "--reason", "blank db", "--db", "   "],
    ]) {
      const refused = runHost(args, { AGENTOOL_COLLAB_DB: databasePath });
      expect(refused.exitCode).toBe(1);
      expect(refused.lines).toHaveLength(1);
      expect(refused.receipt).toMatchObject({ status: "error", error: "usage_error" });
    }

    const missingDatabase = join(directory, "elsewhere", "collab.sqlite");
    const missing = runHost([
      "end",
      "--session-file",
      file,
      "--reason",
      "wrong journal",
      "--db",
      missingDatabase,
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.receipt).toMatchObject({ status: "error", error: "journal_not_found" });
    expect(existsSync(missingDatabase)).toBe(false);
    expect(existsSync(dirname(missingDatabase))).toBe(false);

    // A set-but-empty AGENTOOL_COLLAB_DB is honoured as given (`??`), so it
    // selects no journal rather than falling back to the default.
    const emptyEnvironment = runHost(
      ["end", "--session-file", file, "--reason", "empty env db"],
      { AGENTOOL_COLLAB_DB: "" },
    );
    expect(emptyEnvironment.receipt).toMatchObject({ status: "error", error: "journal_not_found" });

    expect(existsSync(file)).toBe(true);
    expect(store.getCoordinationSession(handle.session.id)?.status).toBe("active");
  });
});

function headAnchor(workspaceId: string): EventCursor {
  const workspace = store.getWorkspace(workspaceId)!;
  return { epoch_id: workspace.epoch_id, sequence: workspace.event_head_sequence, hash: workspace.event_head_hash };
}

function runHostAsync(args: string[]) {
  const child = Bun.spawn([process.execPath, hostEntry, ...args], {
    cwd: packageRoot,
    env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), HOME: join(directory, "home") },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    child,
    receipt: (async () => {
      const exitCode = await child.exited;
      const stdout = await new Response(child.stdout).text();
      return { exitCode, stdout, receipt: JSON.parse(stdout.split("\n")[0] ?? "null") as Record<string, any> };
    })(),
  };
}

describe("agenttool-collab-host wait", () => {
  test("rings for another session's event, carries no event content, and writes nothing", () => {
    const { handle } = startWithCredentialFile("doorbell-listener");
    const anchor = headAnchor(handle.workspace.id);
    const peer = store.startSession({ root_path: root, actor: "doorbell-peer-actor" });
    store.appendReportForSession({
      ...peer.credential,
      idempotency_key: "doorbell-peer-report",
      kind: "observation",
      body: "doorbell-private-body-marker",
    });
    const before = sessionRow(handle.session.id);
    const head = headAnchor(handle.workspace.id);

    const run = runHost([
      "wait", "--session", handle.session.id, "--after-anchor", JSON.stringify(anchor),
      "--wait-ms", "0", "--db", databasePath,
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.lines).toHaveLength(1);
    expect(run.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "ready",
      session_id: handle.session.id,
      workspace_id: handle.workspace.id,
      after_anchor: anchor,
      next_anchor: anchor,
      head_sequence: head.sequence,
      skipped_own_events: 0,
      waited_ms: expect.any(Number),
    });
    for (const hidden of [
      handle.credential.session_token,
      "doorbell-private-body-marker",
      "doorbell-peer-actor",
      peer.session.id,
    ]) {
      expect(run.stdout).not.toContain(hidden);
    }
    expect(sessionRow(handle.session.id)).toEqual(before);
    expect(headAnchor(handle.workspace.id)).toEqual(head);
  });

  test("passes over its own events from the acknowledged cursor and re-arms from next_anchor", () => {
    const { handle, file } = startWithCredentialFile("doorbell-self");
    // workspace.opened carries no session, so acknowledge past it first.
    store.acknowledgeSessionCursor({
      ...handle.credential,
      anchor: headAnchor(handle.workspace.id),
      expected_cursor_version: handle.session.cursor_version,
    });
    store.appendReportForSession({
      ...handle.credential,
      idempotency_key: "doorbell-own-report",
      kind: "observation",
      body: "own note",
    });
    const head = headAnchor(handle.workspace.id);

    const idle = runHost(["wait", "--session-file", file, "--wait-ms", "0", "--db", databasePath]);
    expect(idle.exitCode).toBe(0);
    expect(idle.receipt).toMatchObject({
      status: "idle",
      after_anchor: store.getCoordinationSession(handle.session.id)!.cursor,
      next_anchor: head,
      head_sequence: head.sequence,
    });
    expect(idle.receipt.skipped_own_events).toBeGreaterThanOrEqual(1);

    const own = runHost([
      "wait", "--session-file", file, "--wait-ms", "0", "--include-own", "--db", databasePath,
    ]);
    expect(own.receipt).toMatchObject({ status: "ready", skipped_own_events: 0 });

    const rearmed = runHost([
      "wait", "--session-file", file, "--after-anchor", JSON.stringify(idle.receipt.next_anchor),
      "--wait-ms", "0", "--db", databasePath,
    ]);
    expect(rearmed.receipt).toMatchObject({ status: "idle", skipped_own_events: 0, next_anchor: head });
  });

  test("returns as soon as an event lands during the wait", async () => {
    const { handle } = startWithCredentialFile("doorbell-patient");
    const anchor = headAnchor(handle.workspace.id);
    const pending = runHostAsync([
      "wait", "--session", handle.session.id, "--after-anchor", JSON.stringify(anchor),
      "--wait-ms", "20000", "--db", databasePath,
    ]);
    await Bun.sleep(400);
    store.startSession({ root_path: root, actor: "doorbell-late-peer" });
    const done = await pending.receipt;
    expect(done.exitCode).toBe(0);
    expect(done.receipt).toMatchObject({ status: "ready", next_anchor: anchor });
    expect(done.receipt.waited_ms).toBeLessThan(20000);
  });

  test("polls on the host clock and reports idle at its deadline", () => {
    const { handle } = startWithCredentialFile("doorbell-clock");
    let now = 0;
    const sleeps: number[] = [];
    const receipt = waitForSessionEvents(store, handle.credential, {
      after_anchor: headAnchor(handle.workspace.id),
      wait_ms: 1_000,
      include_own: false,
    }, { now: () => now, sleep: (ms) => { sleeps.push(ms); now += ms; } });
    expect(receipt).toMatchObject({ status: "idle", waited_ms: 1_000 });
    expect(sleeps).toEqual([250, 250, 250, 250]);
  });

  test("fails closed on a forked anchor, a superseded generation, and an ended session without fencing", () => {
    const { handle, file } = startWithCredentialFile("doorbell-fenced");
    const anchor = headAnchor(handle.workspace.id);
    const forked = runHost([
      "wait", "--session-file", file, "--after-anchor",
      JSON.stringify({ ...anchor, hash: "0".repeat(64) }), "--wait-ms", "0", "--db", databasePath,
    ]);
    expect(forked.exitCode).toBe(1);
    expect(forked.receipt).toMatchObject({ status: "error", error: "cursor_fork_detected" });
    expect(sessionRow(handle.session.id).generation).toBe(handle.credential.generation);

    const resumed = store.resumeSession(handle.credential);
    const superseded = runHost(["wait", "--session-file", file, "--wait-ms", "0", "--db", databasePath]);
    expect(superseded.receipt).toMatchObject({ status: "error", error: "session_auth_failed" });
    expect(sessionRow(handle.session.id).generation).toBe(resumed.credential.generation);

    const other = startWithCredentialFile("doorbell-ended");
    store.endSessionWithReleases({ ...other.handle.credential, reason: "done", release_leases: false });
    const ended = runHost(["wait", "--session-file", other.file, "--wait-ms", "0", "--db", databasePath]);
    expect(ended.receipt).toMatchObject({ status: "error", error: "session_auth_failed" });
    for (const run of [forked, superseded, ended]) {
      expect(run.stdout).not.toContain(handle.credential.session_token);
      expect(run.stdout).not.toContain(other.handle.credential.session_token);
    }
  });

  test("refuses malformed or foreign arguments before reading any credential", () => {
    const { handle, file } = startWithCredentialFile("doorbell-usage");
    const id = handle.session.id;
    for (const args of [
      ["wait"],
      ["wait", "--session", id, "--session-file", file],
      ["wait", "--session", ""],
      ["wait", "--session", id, "--wait-ms", String(MAX_HOST_WAIT_MS + 1)],
      ["wait", "--session", id, "--wait-ms", "-1"],
      ["wait", "--session", id, "--wait-ms", "1.5"],
      ["wait", "--session", id, "--wait-ms", "soon"],
      ["wait", "--session", id, "--after-anchor", "{"],
      ["wait", "--session", id, "--after-anchor", JSON.stringify({ epoch_id: "e", sequence: 1 })],
      ["wait", "--session", id, "--after-anchor", JSON.stringify({ epoch_id: "e", sequence: -1, hash: "h" })],
      ["wait", "--session", id, "--after-anchor", JSON.stringify({ epoch_id: "e", sequence: 1, hash: "h", x: 1 })],
      ["wait", "--session", id, "--reason", "not for wait"],
      ["wait", "--session", id, "--release-leases"],
      ["end", "--session-file", file, "--reason", "x", "--wait-ms", "0"],
      ["end", "--session-file", file, "--reason", "x", "--include-own"],
      ["end", "--session-file", file, "--reason", "x", "--addressed"],
    ]) {
      const refused = runHost(args, { AGENTOOL_COLLAB_DB: databasePath });
      expect(refused.exitCode).toBe(1);
      expect(refused.lines).toHaveLength(1);
      expect(refused.receipt).toMatchObject({ status: "error", error: "usage_error" });
    }
    expect(store.getCoordinationSession(id)?.status).toBe("active");
    expect(existsSync(file)).toBe(true);
  });
});

describe("addressed doorbell", () => {
  test("names the sessions an event is routed to, from routing fields only", () => {
    const a = startWithCredentialFile("addressed-a").handle;
    const b = store.startSession({ root_path: root, actor: "addressed-b" });
    const events = () => store.eventsSince(a.workspace.id, 0, 500).events;
    const lastOf = (type: string) => events().filter((event) => event.type === type).at(-1)!;
    const routes = (type: string) => ({
      a: store.eventAddressesSession(lastOf(type), a.session.id),
      b: store.eventAddressesSession(lastOf(type), b.session.id),
    });

    store.appendReportForSession({
      ...b.credential, idempotency_key: "plain", kind: "observation", body: "for everyone",
    });
    expect(routes("report.posted")).toEqual({ a: false, b: false });
    store.appendReportForSession({
      ...b.credential, idempotency_key: "to-a", kind: "observation", body: "for a",
      to_session_id: a.session.id,
    });
    expect(routes("report.posted")).toEqual({ a: true, b: false });
    const proposal = store.appendReportForSession({
      ...a.credential, idempotency_key: "a-proposes", kind: "proposal", body: "a proposes",
    });
    store.appendReportForSession({
      ...b.credential, idempotency_key: "b-supports", kind: "observation", body: "agreed",
      relation: "supports", target_report_id: proposal.id,
    });
    expect(routes("report.posted")).toEqual({ a: true, b: false });

    const handoffTask = store.createTaskForSession({
      ...b.credential, idempotency_key: "handoff-create", title: "handoff", work_mode: "coordination",
    });
    const held = store.claimTaskForSession({
      ...b.credential, idempotency_key: "handoff-claim", task_id: handoffTask.id,
      expected_version: handoffTask.version, ttl_seconds: 3600,
    });
    const offer = store.offerHandoffForSession({
      ...b.credential, idempotency_key: "handoff-offer", task_id: held.id, lease_id: held.lease_id!,
      expected_version: held.version, to_session_id: a.session.id, summary: "take it",
    });
    expect(routes("handoff.offered")).toEqual({ a: true, b: false });
    store.respondHandoffForSession({
      ...a.credential, idempotency_key: "handoff-decline", handoff_id: offer.handoff.id,
      expected_version: offer.task.version, response: "decline",
    });
    expect(routes("handoff.declined")).toEqual({ a: false, b: true });

    const reviewTask = store.createTaskForSession({
      ...b.credential, idempotency_key: "review-create", title: "review", work_mode: "coordination",
      completion_policy: "accepted",
    });
    const claimed = store.claimTaskForSession({
      ...b.credential, idempotency_key: "review-claim", task_id: reviewTask.id,
      expected_version: reviewTask.version, ttl_seconds: 3600,
    });
    const reported = store.completeTaskForSession({
      ...b.credential, idempotency_key: "review-complete", task_id: claimed.id, lease_id: claimed.lease_id!,
      expected_version: claimed.version, summary: "done", review_requested_session_id: a.session.id,
    });
    expect(routes("task.reported_complete")).toEqual({ a: true, b: false });
    store.reviewTaskForSession({
      ...a.credential, idempotency_key: "review-accept", task_id: reported.id,
      expected_version: reported.version, outcome: "accept", summary: "accepted",
    });
    expect(routes("task.accepted")).toEqual({ a: false, b: true });
    expect(routes("session.joined")).toEqual({ a: false, b: false });
  });

  test("with --addressed the doorbell passes over unaddressed events and rings for its own mail", () => {
    const { handle } = startWithCredentialFile("addressed-listener");
    const peer = store.startSession({ root_path: root, actor: "addressed-peer" });
    const anchor = headAnchor(handle.workspace.id);
    store.appendReportForSession({
      ...peer.credential, idempotency_key: "noise", kind: "observation", body: "general chatter",
    });
    const args = (after: EventCursor) => [
      "wait", "--session", handle.session.id, "--after-anchor", JSON.stringify(after),
      "--wait-ms", "0", "--db", databasePath,
    ];

    const quiet = runHost([...args(anchor), "--addressed"]);
    expect(quiet.receipt).toMatchObject({
      status: "idle", skipped_own_events: 0, skipped_unaddressed_events: 1,
      next_anchor: headAnchor(handle.workspace.id),
    });
    expect(runHost(args(anchor)).receipt).toMatchObject({ status: "ready", next_anchor: anchor });
    expect(runHost(args(anchor)).receipt).not.toHaveProperty("skipped_unaddressed_events");

    store.appendReportForSession({
      ...peer.credential, idempotency_key: "mail", kind: "observation",
      body: "addressed-private-body-marker", to_session_id: handle.session.id,
    });
    const mail = runHost([...args(quiet.receipt.next_anchor), "--addressed"]);
    expect(mail.receipt).toMatchObject({
      status: "ready", next_anchor: quiet.receipt.next_anchor, skipped_unaddressed_events: 0,
    });
    expect(mail.stdout).not.toContain("addressed-private-body-marker");
  });
});

describe("journal path resolution", () => {
  test("mirrors the MCP server: AGENTOOL_COLLAB_DB if set, else XDG_DATA_HOME, else ~/.local/share", () => {
    expect(resolveDatabasePath({ AGENTOOL_COLLAB_DB: "/tmp/explicit.sqlite", XDG_DATA_HOME: "/x" }))
      .toBe("/tmp/explicit.sqlite");
    expect(resolveDatabasePath({ AGENTOOL_COLLAB_DB: "" })).toBe("");
    expect(resolveDatabasePath({ XDG_DATA_HOME: "/data" })).toBe(
      "/data/agenttool/collab.sqlite",
    );
    expect(resolveDatabasePath({ XDG_DATA_HOME: "relative-data" })).toBe(
      join(resolve("relative-data"), "agenttool", "collab.sqlite"),
    );
    expect(defaultDatabasePath({ XDG_DATA_HOME: "" })).toBe(
      join(homedir(), ".local", "share", "agenttool", "collab.sqlite"),
    );
    expect(resolveDatabasePath({})).toBe(
      join(homedir(), ".local", "share", "agenttool", "collab.sqlite"),
    );
  });
});

describe("checked-in host bundle", () => {
  test("runs as the package bin and prints one JSON receipt", () => {
    const result = Bun.spawnSync(
      [process.execPath, join(packageRoot, "dist", "agenttool-collab-host.js"), "end"],
      {
        cwd: packageRoot,
        env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(1);
    const lines = result.stdout.toString().split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      protocol: "agenttool.collab-host/1",
      status: "error",
      error: "usage_error",
    });
  });
});
