import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knockForHost,
  knockForSession,
  knockLedgerPath,
  runCollabHostCli,
  type HostCliDependencies,
  type SenderKnockItem,
} from "../src/host.js";
import { HOST_BINDING_FORMAT, hostBindingPath, writeHostBinding, type HostBinding } from "../src/host-binding.js";
import type { ProcessRecord, ProcessTable } from "../src/process-tree.js";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

// The helpers below are copied from tests/host-knocks.test.ts:1-151, never
// imported from it: bun re-runs every test in an imported test file.
const SEAT_STARTED = "Fri Oct 9 09:00:00 2026";
const ITEM_KEYS = ["seq", "kind", "from_actor", "ref_id"];
const SENDER_ITEM_KEYS = ["seq", "kind", "from_actor", "ref_id", "from_session_id"];

let directory: string;
let root: string;
let databasePath: string;
let clock: Date;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-knocks-session-"));
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

/** launchd → claude seat 4100 → (collab MCP 4101, hook shell 4150). */
function seat(...extra: ProcessRecord[]): ProcessTable {
  return new Map([
    proc(1, 0, "/sbin/launchd"),
    proc(4100, 1, "/Users/someone/.local/bin/claude", "claude"),
    proc(4101, 4100, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp"),
    proc(4150, 4100, "/bin/zsh", "/bin/zsh -c knock-tap"),
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

/** What a hub child leaves behind: the session's credential file (it creates collab-sessions/ 0700). */
function credential(handle: SessionHandle): string {
  return writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
}

function line(args: string[], dependencies: HostCliDependencies = {}): string | null {
  const result = runCollabHostCli([...args, "--db", databasePath], {}, {
    process_table: () => seat(),
    now: () => clock,
    ...dependencies,
  });
  expect(result.exit_code).toBe(0);
  return result.line;
}

function run(args: string[], dependencies: HostCliDependencies = {}) {
  const printed = line(args, dependencies);
  return printed === null ? null : JSON.parse(printed) as Record<string, any>;
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

function readLedger() {
  return JSON.parse(readFileSync(knockLedgerPath(databasePath), "utf8"));
}

describe("agenttool-collab-host knocks --session (C10)", () => {
  test("knockForSession returns the same report as knockForHost for the bound session, byte for byte", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "same-first");
    report(alpha, null, "same-broadcast");
    offerHandoff(alpha, beta, "same-handoff");
    const now = () => clock;

    const byHost = JSON.stringify(knockForHost(databasePath, 4150, { process_table: () => seat(), now }));
    const bySession = JSON.stringify(knockForSession(databasePath, beta.session.id, { now }));
    expect(bySession).toBe(byHost);
    expect(JSON.parse(bySession).new).toHaveLength(2);
    expect(bySession).not.toContain("from_session_id");

    // The CLI lines agree byte for byte, and a mark through one path is seen through the other.
    expect(line(["knocks", "--session", beta.session.id])).toBe(byHost);
    expect(line(["knocks", "--host-ancestor", "4150"])).toBe(byHost);
    expect(line(["knocks", "--session", beta.session.id, "--mark-tapped"])).toBe(byHost);
    const after = line(["knocks", "--host-ancestor", "4150"]);
    expect(line(["knocks", "--session", beta.session.id])).toBe(after);
    expect(JSON.parse(after!).new).toEqual([]);
  });

  test("from_session_id appears only with include_sender_session and equals the sender for report.posted and handoff.offered", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    const note = report(alpha, beta, "sender-note");
    const handoff = offerHandoff(alpha, beta, "sender-handoff");
    // beta's own note to alpha is never one of beta's knocks.
    report(beta, alpha, "sender-reply");

    const withSender = knockForSession(databasePath, beta.session.id, { include_sender_session: true, now: () => clock })!;
    expect(withSender.new as SenderKnockItem[]).toEqual([
      { seq: note.event_sequence, kind: "report.posted", from_actor: "alpha", ref_id: note.id, from_session_id: alpha.session.id },
      {
        seq: handoff.sequence,
        kind: "handoff.offered",
        from_actor: "alpha",
        ref_id: handoff.handoff.id,
        from_session_id: alpha.session.id,
      },
    ]);
    for (const item of withSender.new) expect(Object.keys(item)).toEqual(SENDER_ITEM_KEYS);

    const without = knockForSession(databasePath, beta.session.id, { now: () => clock })!;
    expect(JSON.stringify(without)).not.toContain("from_session_id");
    for (const item of without.new) expect(Object.keys(item)).toEqual(ITEM_KEYS);

    // The CLI carries the sender only with --with-sender.
    expect(knocks(["--session", beta.session.id, "--with-sender"])?.new.map((item: any) => item.from_session_id))
      .toEqual([alpha.session.id, alpha.session.id]);
    expect(line(["knocks", "--session", beta.session.id])).not.toContain("from_session_id");
  });

  test("knocks --session --mark-tapped marks each item once, then reports new: []", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    credential(beta);
    const id = beta.session.id;
    const first = report(alpha, beta, "mark-first");
    const handoff = offerHandoff(alpha, beta, "mark-handoff");
    const tap = () => knocks(["--session", id, "--mark-tapped", "--with-sender"]);

    expect(knocks(["--session", id])?.new.map((item: any) => item.seq)).toEqual([first.event_sequence, handoff.sequence]);
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    expect(tap()?.new).toEqual([
      { seq: first.event_sequence, kind: "report.posted", from_actor: "alpha", ref_id: first.id, from_session_id: alpha.session.id },
      {
        seq: handoff.sequence,
        kind: "handoff.offered",
        from_actor: "alpha",
        ref_id: handoff.handoff.id,
        from_session_id: alpha.session.id,
      },
    ]);
    expect(readLedger()).toEqual({
      format: "agenttool.collab-knock-ledger/1",
      tapped: { [id]: [first.event_sequence, handoff.sequence] },
    });
    expect(statSync(knockLedgerPath(databasePath)).mode & 0o777).toBe(0o600);
    expect(existsSync(`${knockLedgerPath(databasePath)}.lock`)).toBe(false);

    expect(tap()).toMatchObject({ waiting: 2, new: [] });

    const second = report(alpha, beta, "mark-second");
    expect(tap()).toMatchObject({
      waiting: 3,
      new: [{ seq: second.event_sequence, from_session_id: alpha.session.id }],
    });
    expect(readLedger().tapped[id]).toEqual([first.event_sequence, handoff.sequence, second.event_sequence]);
    expect(tap()).toMatchObject({ waiting: 3, new: [] });
  });

  test("knocks --session never marks a held rest's items, so they tap once the session returns", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    credential(beta);
    const id = beta.session.id;
    const tap = () => knocks(["--session", id, "--mark-tapped", "--with-sender"]);
    const first = report(alpha, beta, "held-first");
    store.restSessionForSession({ ...beta.credential, idempotency_key: "held-rest", mode: "resting", wake_on: [] });

    expect(tap()).toMatchObject({
      liveness: "resting",
      rest: { wake_on: [] },
      waiting: 1,
      new: [{ seq: first.event_sequence, from_session_id: alpha.session.id }],
    });
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);
    // A second turn during the same rest still marks nothing.
    expect(tap()).toMatchObject({ liveness: "resting", new: [{ seq: first.event_sequence }] });
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    store.restSessionForSession({ ...beta.credential, idempotency_key: "held-return", mode: "ready" });
    expect(tap()).toMatchObject({ liveness: "live", new: [{ seq: first.event_sequence }] });
    expect(readLedger().tapped).toEqual({ [id]: [first.event_sequence] });
    expect(tap()).toMatchObject({ liveness: "live", new: [] });

    // A rest that consents to a wake is tapped and marked like a live session.
    const second = report(alpha, beta, "held-second");
    store.restSessionForSession({
      ...beta.credential,
      idempotency_key: "wake-rest",
      mode: "resting",
      wake_on: ["addressed"],
    });
    expect(tap()).toMatchObject({ liveness: "resting", waiting: 2, new: [{ seq: second.event_sequence }] });
    expect(readLedger().tapped).toEqual({ [id]: [first.event_sequence, second.event_sequence] });
  });

  test("knocks --session needs no binding and no ps call", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    credential(beta);
    const note = report(alpha, beta, "unbound-note");
    const noPs: HostCliDependencies = {
      process_table: () => {
        throw new Error("ps must not run for knocks --session");
      },
    };

    expect(existsSync(hostBindingPath(databasePath, beta.session.id))).toBe(false);
    expect(knocks(["--session", beta.session.id], noPs)).toMatchObject({
      session_id: beta.session.id,
      liveness: "live",
      waiting: 1,
      new: [{ seq: note.event_sequence }],
    });
    expect(knocks(["--session", beta.session.id, "--mark-tapped", "--with-sender"], noPs)?.new).toHaveLength(1);
    expect(readLedger().tapped).toEqual({ [beta.session.id]: [note.event_sequence] });
    // --session wrote no binding, so --host-ancestor (with a ps table that
    // would resolve beta's seat if a binding existed) is silent.
    expect(existsSync(hostBindingPath(databasePath, beta.session.id))).toBe(false);
    expect(knocks(["--host-ancestor", "4150"])).toBeNull();
    // Positive control: once beta is bound, the same call speaks, so the null above meant "nothing bound".
    bind(beta);
    expect(knocks(["--host-ancestor", "4150"])).toMatchObject({ session_id: beta.session.id });
  });

  test("an unknown, ended or malformed session id is silent", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    report(alpha, beta, "silent-note");
    const now = () => clock;
    expect(knockForSession(databasePath, beta.session.id, { now })).not.toBeNull();

    for (const id of ["ses_unknown", "a".repeat(200), "", " ", "-x", ".x", "a b", "a/b", "a\nb", "é", "a".repeat(201)]) {
      expect(knockForSession(databasePath, id, { now })).toBeNull();
      expect(knocks(["--session", id])).toBeNull();
    }
    // A malformed id is refused before the journal is opened.
    const missing = join(directory, "elsewhere", "collab.sqlite");
    expect(knockForSession(missing, "a".repeat(201), { now })).toBeNull();
    expect(knockForSession(missing, "a b", { now })).toBeNull();
    expect(() => knockForSession(missing, "a".repeat(200), { now })).toThrow();

    store.endSession({ ...beta.credential, reason: "beta is done" });
    expect(knockForSession(databasePath, beta.session.id, { now })).toBeNull();
    expect(knocks(["--session", beta.session.id])).toBeNull();
    expect(knocks(["--session", beta.session.id, "--mark-tapped", "--with-sender"])).toBeNull();
  });

  test("--session with --host-ancestor, --with-sender without --session, an empty --session, a positional, or --help is silent", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "combo-note");
    const id = beta.session.id;
    const cli = (args: string[]) => runCollabHostCli(args, { AGENTOOL_COLLAB_DB: databasePath }, {
      process_table: () => seat(),
      now: () => clock,
    });

    // Each shape alone speaks, so the silence below comes from the combination.
    expect(cli(["knocks", "--session", id]).line).not.toBeNull();
    expect(cli(["knocks", "--session", id, "--with-sender"]).line).not.toBeNull();
    expect(cli(["knocks", "--host-ancestor", "4150"]).line).not.toBeNull();

    for (const args of [
      ["knocks", "--session", id, "--host-ancestor", "4150"],
      ["knocks", "--host-ancestor", "4150", "--session", id],
      ["knocks", "--session", id, "--host-ancestor", "auto", "--mark-tapped"],
      ["knocks", "--host-ancestor", "4150", "--with-sender"],
      ["knocks", "--host-ancestor", "4150", "--with-sender", "--mark-tapped"],
      ["knocks", "--with-sender"],
      ["knocks", "--with-sender", "--mark-tapped"],
      ["knocks", "--session", ""],
      ["knocks", "--session="],
      ["knocks", "--session"],
      ["knocks", "--session", id, "extra"],
      ["knocks", "extra", "--session", id],
      ["knocks", "--session", id, "--help"],
      ["knocks", "--session", id, "-h"],
      ["knocks", "--session", id, "--session-file", "x"],
      ["knocks", "--session", id, "--db", ""],
      ["doorbell-scan", "--session", id],
      ["doorbell-scan", "--with-sender"],
    ]) {
      expect(cli(args)).toEqual({ exit_code: 0, line: null });
    }
    // Silence marks nothing.
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    // end keeps its own option set and its JSON refusals.
    for (const extra of [["--session", id], ["--with-sender"]]) {
      const refused = runCollabHostCli(
        ["end", "--session-file", "x.json", "--reason", "x", ...extra, "--db", databasePath],
        {},
      );
      expect(refused.exit_code).toBe(1);
      expect(JSON.parse(refused.line!)).toMatchObject({ status: "error", error: "usage_error" });
    }
  });

  test("--host-ancestor output keeps exactly the four item keys in their order", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "keys-note");
    offerHandoff(alpha, beta, "keys-handoff");

    const parsed = JSON.parse(line(["knocks", "--host-ancestor", "4150", "--mark-tapped"])!);
    expect(Object.keys(parsed)).toEqual(["protocol", "session_id", "liveness", "rest", "waiting", "new"]);
    expect(parsed.new).toHaveLength(2);
    for (const item of parsed.new) expect(Object.keys(item)).toEqual(ITEM_KEYS);
  });
});
