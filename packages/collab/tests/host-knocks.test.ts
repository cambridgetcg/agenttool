import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { knockLedgerPath, runCollabHostCli, type HostCliDependencies } from "../src/host.js";
import { HOST_BINDING_FORMAT, writeHostBinding, type HostBinding } from "../src/host-binding.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { readProcessTable, type ProcessRecord, type ProcessTable } from "../src/process-tree.js";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const hostEntry = join(packageRoot, "bin", "agenttool-collab-host.ts");
const mcpEntry = join(packageRoot, "bin", "agenttool-collab-mcp.ts");
const SEAT_STARTED = "Fri Oct 9 09:00:00 2026";

let directory: string;
let root: string;
let databasePath: string;
let clock: Date;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-knocks-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  clock = new Date("2026-10-09T12:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => clock });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function proc(pid: number, ppid: number, comm: string, args = comm, started_at = SEAT_STARTED): ProcessRecord {
  return { pid, ppid, comm, args, started_at };
}

/** launchd → claude seat 4100 → (collab MCPs 4101/4102, hook shell 4150, tool shell 4200 → codex 4300 → hook 4301). */
function seat(...extra: ProcessRecord[]): ProcessTable {
  return new Map([
    proc(1, 0, "/sbin/launchd"),
    proc(4100, 1, "/Users/someone/.local/bin/claude", "claude"),
    proc(4101, 4100, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp"),
    proc(4150, 4100, "/bin/zsh", "/bin/zsh -c knock-tap"),
    proc(4200, 4100, "/bin/zsh"),
    proc(4300, 4200, "codex", "codex"),
    proc(4301, 4300, "/bin/zsh", "/bin/zsh -c knock-tap"),
    ...extra,
  ].map((entry) => [entry.pid, entry]));
}

function bindingFor(handle: SessionHandle, overrides: Partial<HostBinding> = {}): HostBinding {
  return {
    format: HOST_BINDING_FORMAT,
    session_id: handle.session.id,
    host_kind: "claude-code",
    host_pid: 4100,
    host_started_at: SEAT_STARTED,
    mcp_pid: 4101,
    credential_file_path: store.defaultSessionCredentialPath(handle.session.id),
    written_at: clock.toISOString(),
    ...overrides,
  };
}

function bind(handle: SessionHandle, overrides: Partial<HostBinding> = {}): HostBinding {
  const binding = bindingFor(handle, overrides);
  writeHostBinding(databasePath, binding);
  return binding;
}

function run(args: string[], dependencies: HostCliDependencies = {}) {
  const result = runCollabHostCli([...args, "--db", databasePath], {}, {
    process_table: () => seat(),
    now: () => clock,
    ...dependencies,
  });
  expect(result.exit_code).toBe(0);
  return result.line === null ? null : JSON.parse(result.line) as Record<string, any>;
}

const knocks = (args: string[], dependencies: HostCliDependencies = {}) => run(["knocks", ...args], dependencies);

function report(from: SessionHandle, to: SessionHandle | null, key: string) {
  return store.appendReportForSession({
    ...from.credential,
    idempotency_key: key,
    ...(to ? { to_session_id: to.session.id } : {}),
    kind: "observation",
    body: "A note for the knock tests.",
  });
}

function offerHandoff(from: SessionHandle, to: SessionHandle, key: string) {
  const task = store.createTaskForSession({
    ...from.credential,
    idempotency_key: `${key}-create`,
    title: key,
    work_mode: "coordination",
  });
  const claimed = store.claimTaskForSession({
    ...from.credential,
    idempotency_key: `${key}-claim`,
    task_id: task.id,
    expected_version: task.version,
  });
  const offered = store.offerHandoffForSession({
    ...from.credential,
    idempotency_key: `${key}-offer`,
    task_id: task.id,
    lease_id: claimed.lease_id!,
    expected_version: claimed.version,
    to_session_id: to.session.id,
    summary: "Please take this over.",
  });
  const event = store.eventsSince(from.workspace.id, 0, 500).events
    .find((entry) => entry.type === "handoff.offered" && entry.entity_id === offered.handoff.id)!;
  return { handoff: offered.handoff, sequence: event.sequence };
}

function acknowledgeAll(handle: SessionHandle): SessionHandle["credential"] {
  const session = store.getCoordinationSession(handle.session.id)!;
  const head = store.getWorkspace(handle.workspace.id)!;
  store.acknowledgeSessionCursor({
    ...handle.credential,
    anchor: { epoch_id: head.epoch_id, sequence: head.event_head_sequence, hash: head.event_head_hash },
    expected_cursor_version: session.cursor_version,
  });
  return handle.credential;
}

function readLedger() {
  return JSON.parse(readFileSync(knockLedgerPath(databasePath), "utf8"));
}

describe("agenttool-collab-host knocks", () => {
  test("prints one pointer per addressed item and marks each tapped exactly once", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    const first = report(alpha, beta, "knock-first");
    report(alpha, null, "knock-broadcast");
    report(beta, alpha, "knock-reply");
    const handoff = offerHandoff(alpha, beta, "knock-handoff");
    const expectedNew = [
      { seq: first.event_sequence, kind: "report.posted", from_actor: "alpha", ref_id: first.id },
      { seq: handoff.sequence, kind: "handoff.offered", from_actor: "alpha", ref_id: handoff.handoff.id },
    ];

    const peek = knocks(["--host-ancestor", "4150"]);
    expect(peek).toEqual({
      protocol: "agenttool.collab-knock/1",
      session_id: beta.session.id,
      liveness: "live",
      rest: null,
      waiting: 2,
      new: expectedNew,
    });
    expect(knocks(["--host-ancestor", "4150"])).toEqual(peek);
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])?.new).toEqual(expectedNew);
    expect(readLedger()).toEqual({
      format: "agenttool.collab-knock-ledger/1",
      tapped: { [beta.session.id]: [first.event_sequence, handoff.sequence] },
    });
    expect(statSync(knockLedgerPath(databasePath)).mode & 0o777).toBe(0o600);
    expect(existsSync(`${knockLedgerPath(databasePath)}.lock`)).toBe(false);

    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({ waiting: 2, new: [] });

    const second = report(alpha, beta, "knock-second");
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({
      waiting: 3,
      new: [{ seq: second.event_sequence, kind: "report.posted", from_actor: "alpha", ref_id: second.id }],
    });

    acknowledgeAll(beta);
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({ waiting: 0, new: [] });
  });

  test("agrees with the store's liveness and rest and with collab_next's addressed_waiting", async () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    report(alpha, beta, "parity-first");
    offerHandoff(alpha, beta, "parity-handoff");
    const resumed = store.resumeSession(beta.credential);
    const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(beta.session.id), resumed.credential);
    bind(beta);
    const server = buildCollabMcpServer(store, { resumed_session: { handle: resumed, credential_file: file } });
    const tool = (server as any)._registeredTools.collab_next;
    const parity = async (liveness: string) => {
      const knock = knocks(["--host-ancestor", "4100"])!;
      const projected = store.getCoordinationSession(beta.session.id)!;
      expect(knock.liveness).toBe(liveness);
      expect(projected.liveness).toBe(liveness as never);
      expect(knock.rest).toEqual(projected.rest);
      const next = await (tool.handler ?? tool.callback)({ workspace_id: beta.workspace.id }, {});
      expect(next.isError).toBeUndefined();
      expect(next.structuredContent.session.addressed_waiting).toBe(knock.waiting);
      return knock;
    };

    expect((await parity("live")).waiting).toBe(2);

    store.restSessionForSession({
      ...resumed.credential,
      idempotency_key: "parity-rest",
      mode: "resting",
      until: new Date(clock.getTime() + 2 * 3_600_000).toISOString(),
      reason: "back this evening",
      wake_on: ["addressed"],
    });
    expect((await parity("resting")).rest).toEqual({
      mode: "resting",
      since: clock.toISOString(),
      until: "2026-10-09T14:00:00.000Z",
      reason: "back this evening",
      wake_on: ["addressed"],
    });

    clock = new Date(clock.getTime() + 3 * 3_600_000);
    expect((await parity("live")).rest).toBeNull();

    clock = new Date(clock.getTime() + 7 * 3_600_000);
    await parity("stale");

    store.restSessionForSession({
      ...resumed.credential,
      idempotency_key: "parity-rest-again",
      mode: "resting",
      wake_on: [],
    });
    expect((await parity("resting")).rest).toMatchObject({ until: null, reason: null, wake_on: [] });
    store.restSessionForSession({ ...resumed.credential, idempotency_key: "parity-return", mode: "ready" });
    await parity("live");

    acknowledgeAll({ ...beta, credential: resumed.credential });
    expect((await parity("live")).waiting).toBe(0);
  });

  test("never marks a held rest's items, so they tap once the session returns", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    const first = report(alpha, beta, "held-first");
    store.restSessionForSession({ ...beta.credential, idempotency_key: "held-rest", mode: "resting", wake_on: [] });
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({
      liveness: "resting",
      rest: { wake_on: [] },
      waiting: 1,
      new: [{ seq: first.event_sequence }],
    });
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    store.restSessionForSession({ ...beta.credential, idempotency_key: "held-return", mode: "ready" });
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({
      liveness: "live",
      new: [{ seq: first.event_sequence }],
    });
    expect(readLedger().tapped).toEqual({ [beta.session.id]: [first.event_sequence] });

    // A rest that consents to a wake is tapped and marked like a live session.
    const second = report(alpha, beta, "held-second");
    store.restSessionForSession({
      ...beta.credential,
      idempotency_key: "wake-rest",
      mode: "resting",
      wake_on: ["addressed"],
    });
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({
      liveness: "resting",
      waiting: 2,
      new: [{ seq: second.event_sequence }],
    });
    expect(readLedger().tapped).toEqual({ [beta.session.id]: [first.event_sequence, second.event_sequence] });
  });

  test("walks to the nearest bound host, and an unbound nearer host stops the walk", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "walk-note");

    for (const start of ["4100", "4150", "4200"]) {
      expect(knocks(["--host-ancestor", start])?.session_id).toBe(beta.session.id);
    }
    expect(knocks(["--host-ancestor", "auto"], { parent_pid: 4150 })?.session_id).toBe(beta.session.id);
    // A Codex started from the seat's tool shell is the nearest host for its own hooks.
    expect(knocks(["--host-ancestor", "4301"])).toBeNull();
    expect(knocks(["--host-ancestor", "4300"])).toBeNull();
    expect(knocks(["--host-ancestor", "auto"], { parent_pid: 4301 })).toBeNull();
    expect(knocks(["--host-ancestor", "999999"])).toBeNull();
  });

  test("never matches a reused pid, an orphaned binding, an ambiguous host, or an ended session", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    const gamma = store.startSession({ root_path: root, actor: "gamma" });
    report(alpha, beta, "ambiguity-beta");
    report(alpha, gamma, "ambiguity-gamma");

    bind(beta, { host_started_at: "Thu Oct 8 23:59:59 2026" });
    expect(knocks(["--host-ancestor", "4150"])).toBeNull();

    bind(beta);
    // gamma's MCP (4102) is gone: its binding is orphaned and does not count.
    bind(gamma, { mcp_pid: 4102 });
    expect(knocks(["--host-ancestor", "4150"])?.session_id).toBe(beta.session.id);
    // Nor when its pid was reused by another child of the seat that is not a collab MCP.
    bind(gamma, { mcp_pid: 4150 });
    expect(knocks(["--host-ancestor", "4150"])?.session_id).toBe(beta.session.id);
    bind(gamma, { mcp_pid: 4102 });

    const withGamma = { process_table: () => seat(proc(4102, 4100, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp")) };
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"], withGamma)).toBeNull();
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    store.endSession({ ...gamma.credential, reason: "gamma is done" });
    expect(knocks(["--host-ancestor", "4150"], withGamma)?.session_id).toBe(beta.session.id);
    store.endSession({ ...beta.credential, reason: "beta is done" });
    expect(knocks(["--host-ancestor", "4150"], withGamma)).toBeNull();
  });

  test("a Desktop app-server knocks only while it runs a single collab MCP", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta, { host_kind: "codex-app-server", host_pid: 4400, mcp_pid: 4401 });
    report(alpha, beta, "app-server-note");
    const appServer = (...threads: ProcessRecord[]) => ({
      process_table: () => seat(
        proc(4399, 1, "/x/releases/0.162.0/bin/codex", "/x/releases/0.162.0/bin/codex app-server daemon pid-update-loop"),
        proc(4400, 4399, "/x/releases/0.162.0/bin/codex", "/x/releases/0.162.0/bin/codex app-server --listen unix:// --managed-daemon"),
        proc(4401, 4400, "bun", "bun dist/agenttool-collab-mcp.js"),
        proc(4450, 4400, "/bin/zsh", "/bin/zsh -c knock-tap"),
        ...threads,
      ),
    });
    expect(knocks(["--host-ancestor", "4450"], appServer())?.session_id).toBe(beta.session.id);
    // A second thread's collab MCP, even unbound, makes every hook under this app-server ambiguous.
    expect(knocks(["--host-ancestor", "4450"], appServer(proc(4402, 4400, "bun", "bun dist/agenttool-collab-mcp.js"))))
      .toBeNull();
  });

  test("is silent on every failure and on any argument outside its own option set", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    report(alpha, beta, "silent-note");

    // Nothing bound: no ps call at all.
    expect(knocks(["--host-ancestor", "4150"], {
      process_table: () => {
        throw new Error("ps must not run without a binding");
      },
    })).toBeNull();

    bind(beta);
    expect(knocks(["--host-ancestor", "4150"], { process_table: () => null })).toBeNull();

    for (const args of [
      ["knocks"],
      ["knocks", "--host-ancestor", "0"],
      ["knocks", "--host-ancestor", "4150x"],
      ["knocks", "--host-ancestor", "auto", "extra"],
      ["knocks", "--host-ancestor", "auto", "--session-file", "x"],
      ["knocks", "--host-ancestor", "auto", "--db", ""],
      ["doorbell-scan", "--host-ancestor", "auto"],
      ["doorbell-scan", "--mark-tapped"],
      ["doorbell-scan", "extra"],
      // --help and -h belong to end's option set: a read verb never prints end's usage line.
      ["knocks", "--host-ancestor", "4150", "--help"],
      ["knocks", "--host-ancestor", "4150", "-h"],
      ["doorbell-scan", "--help"],
      ["doorbell-scan", "-h"],
    ]) {
      expect(runCollabHostCli(args, { AGENTOOL_COLLAB_DB: databasePath }, { process_table: () => seat() }))
        .toEqual({ exit_code: 0, line: null });
    }

    const missing = join(directory, "elsewhere", "collab.sqlite");
    for (const verb of [["knocks", "--host-ancestor", "4150"], ["doorbell-scan"]]) {
      expect(runCollabHostCli([...verb, "--db", missing], {}, { process_table: () => seat() }))
        .toEqual({ exit_code: 0, line: null });
    }
    expect(existsSync(dirname(missing))).toBe(false);

    const foreign = join(directory, "foreign", "other.sqlite");
    mkdirSync(dirname(foreign), { mode: 0o700 });
    new Database(foreign).close();
    writeHostBinding(foreign, bindingFor(beta));
    expect(runCollabHostCli(["knocks", "--host-ancestor", "4150", "--db", foreign], {}, {
      process_table: () => seat(),
    })).toEqual({ exit_code: 0, line: null });

    // A symlinked journal is refused, as the store refuses it.
    const linked = join(dirname(databasePath), "linked.sqlite");
    symlinkSync(databasePath, linked);
    for (const verb of [["knocks", "--host-ancestor", "4150"], ["doorbell-scan"]]) {
      expect(runCollabHostCli([...verb, "--db", linked], {}, { process_table: () => seat() }))
        .toEqual({ exit_code: 0, line: null });
    }

    // end keeps its own option set and its JSON refusals.
    for (const extra of [["--host-ancestor", "auto"], ["--mark-tapped"]]) {
      const refused = runCollabHostCli(
        ["end", "--session-file", "x.json", "--reason", "x", ...extra, "--db", databasePath],
        {},
      );
      expect(refused.exit_code).toBe(1);
      expect(JSON.parse(refused.line!)).toMatchObject({ status: "error", error: "usage_error" });
    }
  });

  test("refuses a damaged or busy ledger rather than risk a repeated tap", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "ledger-note");
    const ledger = knockLedgerPath(databasePath);

    writeFileSync(ledger, "{damaged", { mode: 0o600 });
    expect(knocks(["--host-ancestor", "4150"])).toBeNull();
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toBeNull();
    expect(run(["doorbell-scan"])).toBeNull();

    writeFileSync(ledger, JSON.stringify({ format: "agenttool.collab-knock-ledger/1", tapped: {} }));
    chmodSync(ledger, 0o644);
    expect(knocks(["--host-ancestor", "4150"])).toBeNull();
    chmodSync(ledger, 0o600);

    const lock = `${ledger}.lock`;
    writeFileSync(lock, "", { mode: 0o600 });
    expect(knocks(["--host-ancestor", "4150"])?.new).toHaveLength(1);
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toBeNull();
    expect(readLedger().tapped).toEqual({});

    // A lock left by a crashed run expires.
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])?.new).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
    expect(readLedger().tapped[beta.session.id]).toHaveLength(1);
  });

  test("reads one committed snapshot without waiting on or writing to the journal", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "snapshot-committed");
    const sessionsBefore = store.db.query("SELECT * FROM coordination_sessions ORDER BY id").all();
    const headBefore = store.getWorkspace(beta.workspace.id)!.event_head_sequence;

    store.db.exec("BEGIN IMMEDIATE");
    try {
      report(alpha, beta, "snapshot-uncommitted");
      const started = performance.now();
      expect(knocks(["--host-ancestor", "4150"])).toMatchObject({ waiting: 1 });
      expect(run(["doorbell-scan"])).toEqual({ protocol: "agenttool.collab-doorbell-scan/1", sessions: [] });
      expect(performance.now() - started).toBeLessThan(1_000);
    } finally {
      store.db.exec("ROLLBACK");
    }
    expect(store.db.query("SELECT * FROM coordination_sessions ORDER BY id").all()).toEqual(sessionsBefore);
    expect(store.getWorkspace(beta.workspace.id)!.event_head_sequence).toBe(headBefore);
  });
});

describe("a journal whose last connection closed cleanly", () => {
  test("is read without a -wal file and left unchanged", () => {
    // Built in a child process that exits, as a Python or sqlite3 client
    // would leave it: fully checkpointed, then no -wal or -shm on disk.
    const closed = join(directory, "closed");
    const journal = join(closed, "state", "collab.sqlite");
    mkdirSync(join(closed, "repo"), { recursive: true });
    const script = join(closed, "fixture.ts");
    writeFileSync(script, `
      import { Database } from "bun:sqlite";
      import { CollabStore } from ${JSON.stringify(join(packageRoot, "src", "store.ts"))};
      import { writeHostBinding } from ${JSON.stringify(join(packageRoot, "src", "host-binding.ts"))};
      const journal = ${JSON.stringify(journal)};
      const store = new CollabStore(journal);
      const alpha = store.startSession({ root_path: ${JSON.stringify(join(closed, "repo"))}, actor: "alpha" });
      const beta = store.startSession({ root_path: ${JSON.stringify(join(closed, "repo"))}, actor: "beta" });
      store.appendReportForSession({
        ...alpha.credential,
        idempotency_key: "closed-note",
        to_session_id: beta.session.id,
        kind: "observation",
        body: "A note in a closed journal.",
      });
      writeHostBinding(journal, {
        format: "agenttool.collab-host-binding/1",
        session_id: beta.session.id,
        host_kind: "claude-code",
        host_pid: 4100,
        host_started_at: ${JSON.stringify(SEAT_STARTED)},
        mcp_pid: 4101,
        credential_file_path: store.defaultSessionCredentialPath(beta.session.id),
        written_at: new Date().toISOString(),
      });
      store.close();
      const checkpoint = new Database(journal);
      checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      checkpoint.close();
      process.stdout.write(JSON.stringify({ session_id: beta.session.id, workspace_id: beta.workspace.id }));
    `);
    const built = Bun.spawnSync([process.execPath, script], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
    expect(built.exitCode).toBe(0);
    const fixture = JSON.parse(built.stdout.toString()) as { session_id: string; workspace_id: string };
    const dropSidecars = () => {
      rmSync(`${journal}-wal`, { force: true });
      rmSync(`${journal}-shm`, { force: true });
    };
    dropSidecars();
    // macOS's system SQLite (3.43.2, which bun:sqlite uses there) cannot open it
    // read-only: a readonly connection may not create the -wal (SQLITE_CANTOPEN).
    // Newer SQLite builds (Homebrew's 3.53.4, for one) create the sidecars and read
    // it, so the probe is asserted only on darwin; the outcome below on every platform.
    const probe = new Database(journal, { readonly: true });
    let plainReadonlyOpens = true;
    try {
      probe.query("PRAGMA application_id").get();
    } catch (error) {
      expect((error as { code?: string }).code).toBe("SQLITE_CANTOPEN");
      plainReadonlyOpens = false;
    } finally {
      probe.close();
    }
    if (process.platform === "darwin") expect(plainReadonlyOpens).toBe(false);
    dropSidecars();
    const before = Bun.hash(readFileSync(journal));

    const closedRun = (args: string[]) => {
      const result = runCollabHostCli([...args, "--db", journal], {}, {
        process_table: () => seat(),
        now: () => new Date(),
      });
      expect(result.exit_code).toBe(0);
      return result.line === null ? null : JSON.parse(result.line);
    };
    expect(closedRun(["knocks", "--host-ancestor", "4150"])).toMatchObject({
      session_id: fixture.session_id,
      waiting: 1,
    });
    expect(closedRun(["doorbell-scan"])).toEqual({ protocol: "agenttool.collab-doorbell-scan/1", sessions: [] });
    expect(Bun.hash(readFileSync(journal))).toBe(before);
    for (const sidecar of ["-wal", "-shm"]) {
      if (existsSync(`${journal}${sidecar}`)) expect(statSync(`${journal}${sidecar}`).mode & 0o777).toBe(0o600);
    }
    const reopened = new CollabStore(journal);
    try {
      expect(reopened.verifyJournal(fixture.workspace_id)).toBe(true);
    } finally {
      reopened.close();
    }
  });
});

describe("agenttool-collab-host doorbell-scan", () => {
  test("lists only resting wake_on-addressed sessions with unknocked items, with their binding", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const start = (actor: string) => store.startSession({ root_path: root, actor });
    const rest = (handle: SessionHandle, key: string, wakeOn: "addressed"[], until?: string) =>
      store.restSessionForSession({
        ...handle.credential,
        idempotency_key: key,
        mode: "resting",
        reason: `${handle.session.actor} is resting`,
        wake_on: wakeOn,
        ...(until ? { until } : {}),
      });
    const wakeable = start("wakeable");
    const unbound = start("unbound");
    const heldOnly = start("held-only");
    const live = start("live");
    const nothingWaiting = start("nothing-waiting");
    const alreadyTapped = start("already-tapped");
    const ended = start("ended");
    const expiring = start("expiring");
    for (const handle of [wakeable, unbound, heldOnly, live, alreadyTapped, ended, expiring]) {
      report(alpha, handle, `scan-note-${handle.session.actor}`);
    }
    const wakeableBinding = bind(wakeable, { host_kind: "codex", host_pid: 5100, mcp_pid: 5101 });
    rest(wakeable, "rest-wakeable", ["addressed"], "2026-10-10T08:00:00.000Z");
    rest(unbound, "rest-unbound", ["addressed"]);
    rest(heldOnly, "rest-held", []);
    rest(nothingWaiting, "rest-nothing", ["addressed"]);
    rest(alreadyTapped, "rest-tapped", ["addressed"]);
    rest(ended, "rest-ended", ["addressed"]);
    store.endSession({ ...ended.credential, reason: "departed while resting" });
    rest(expiring, "rest-expiring", ["addressed"], "2026-10-09T12:30:00.000Z");
    const tappedNote = store.eventsSince(alpha.workspace.id, 0, 500).events.find(
      (event) => event.type === "report.posted" && event.payload.to_session_id === alreadyTapped.session.id,
    )!;
    mkdirSync(dirname(knockLedgerPath(databasePath)), { recursive: true, mode: 0o700 });
    writeFileSync(knockLedgerPath(databasePath), JSON.stringify({
      format: "agenttool.collab-knock-ledger/1",
      tapped: { [alreadyTapped.session.id]: [tappedNote.sequence] },
    }), { mode: 0o600 });
    clock = new Date("2026-10-09T13:00:00.000Z");

    const scan = run(["doorbell-scan"])!;
    expect(scan.protocol).toBe("agenttool.collab-doorbell-scan/1");
    // Every session here joined at the same clock instant, so order by actor to compare.
    const listed = new Map<string, any>(scan.sessions.map((entry: any) => [entry.actor, entry]));
    expect([...listed.keys()].sort()).toEqual(["unbound", "wakeable"]);
    const note = store.eventsSince(alpha.workspace.id, 0, 500).events.find(
      (event) => event.type === "report.posted" && event.payload.to_session_id === wakeable.session.id,
    )!;
    expect(listed.get("wakeable")).toEqual({
      session_id: wakeable.session.id,
      workspace_id: wakeable.workspace.id,
      worktree_root: wakeable.worktree.root_path,
      actor: "wakeable",
      rest: {
        mode: "resting",
        since: "2026-10-09T12:00:00.000Z",
        until: "2026-10-10T08:00:00.000Z",
        reason: "wakeable is resting",
        wake_on: ["addressed"],
      },
      waiting: 1,
      new: [{ seq: note.sequence, kind: "report.posted", from_actor: "alpha", ref_id: note.entity_id }],
      binding: wakeableBinding,
    });
    expect(listed.get("unbound")).toMatchObject({ session_id: unbound.session.id, binding: null, waiting: 1 });
  });

  test("prints an empty list when nothing is waiting", () => {
    store.startSession({ root_path: root, actor: "alone" });
    expect(run(["doorbell-scan"])).toEqual({ protocol: "agenttool.collab-doorbell-scan/1", sessions: [] });
  });
});

describe("the host bin's output path", () => {
  function runBin(args: string[]) {
    const result = Bun.spawnSync([process.execPath, hostEntry, ...args], {
      cwd: packageRoot,
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), HOME: join(directory, "home") },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  }

  test("prints nothing for silence, one line for a scan, and one knock found through the real ps", async () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    report(alpha, beta, "bin-note");

    expect(runBin(["knocks", "--host-ancestor", "auto", "--db", databasePath]))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(runBin(["knocks", "--bogus"])).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const scan = runBin(["doorbell-scan", "--db", databasePath]);
    expect(scan.exitCode).toBe(0);
    expect(scan.stdout).toBe('{"protocol":"agenttool.collab-doorbell-scan/1","sessions":[]}\n');

    // This test process plays the host: a real collab MCP runs as its direct child,
    // and the spawned bin's own parent (this process) is where `auto` starts.
    const mcp = Bun.spawn([process.execPath, mcpEntry], {
      cwd: packageRoot,
      env: { AGENTOOL_COLLAB_DB: databasePath, PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      // Its ready line means ps already shows the MCP's own argv.
      const reader = mcp.stderr.getReader();
      const decoder = new TextDecoder();
      let banner = "";
      while (!banner.includes("agenttool-collab MCP ready")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`the collab MCP exited early: ${banner}`);
        banner += decoder.decode(chunk.value, { stream: true });
      }
      bind(beta, {
        host_kind: "unknown",
        host_pid: process.pid,
        host_started_at: readProcessTable()!.get(process.pid)!.started_at,
        mcp_pid: mcp.pid,
      });
      const knock = runBin(["knocks", "--host-ancestor", "auto", "--db", databasePath]);
      expect(knock.exitCode).toBe(0);
      const lines = knock.stdout.split("\n").filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        protocol: "agenttool.collab-knock/1",
        session_id: beta.session.id,
        waiting: 1,
      });
    } finally {
      mcp.kill();
      await mcp.exited;
    }
  });
});
