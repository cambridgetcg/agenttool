import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultDatabasePath, resolveDatabasePath } from "../src/database-path.js";
import type { SessionHandle } from "../src/protocol.js";
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
    expect(run.receipt.message).toContain("release_leases");
    expect(run.receipt.remedy).toContain("release_leases");
    expect(run.stdout).not.toContain(handle.credential.session_token);
    expect(existsSync(file)).toBe(true);
    expect(sessionRow(handle.session.id)).toEqual(before);
    expect(before.cursor_recovery_required).toBe(0);
    expect(store.getWorkspace(handle.workspace.id)!.event_head_sequence).toBe(headBefore);
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
