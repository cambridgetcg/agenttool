import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabStore } from "../src/store-notes.js";
import { computeEtaGraceMs, computeEtaOverdue, ETA_MIN_GRACE_MS } from "../src/time.js";

const work = mkdtempSync(join(tmpdir(), "agenttool-collab-eta-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function makeStore(startIso = "2026-11-27T12:00:00.000Z") {
  let currentMs = Date.parse(startIso);
  const dir = mkdtempSync(join(work, "ws-"));
  const store = new CollabStore(join(dir, "collab.sqlite"), { now: () => new Date(currentMs) });
  return {
    dir,
    store,
    advance(ms: number) {
      currentMs += ms;
    },
    setTime(iso: string) {
      currentMs = Date.parse(iso);
    },
  };
}

function makeMcp(startIso = "2026-11-27T12:00:00.000Z") {
  const ctx = makeStore(startIso);
  const makeClient = () => {
    const server = buildCollabMcpServer(ctx.store, { environment: {} }) as unknown as {
      _registeredTools: Record<string, { handler?: Function; callback?: Function }>;
    };
    return async (name: string, args: Record<string, unknown>) => {
      const reg = server._registeredTools[name];
      if (!reg) throw new Error(`missing tool ${name}`);
      return (await (reg.handler ?? reg.callback)!(args, {})) as {
        isError?: boolean;
        structuredContent: Record<string, any>;
      };
    };
  };
  return { ...ctx, call: makeClient(), makeClient };
}

describe("time/1 §6 — pure grace and overdue arithmetic", () => {
  test("short estimate uses the 10-minute grace floor", () => {
    const setAt = "2026-11-27T12:00:00.000Z";
    const etaAt = "2026-11-27T12:10:00.000Z"; // 10m estimate -> half is 5m < 10m floor
    expect(computeEtaGraceMs(Date.parse(setAt), Date.parse(etaAt))).toBe(ETA_MIN_GRACE_MS);

    expect(
      computeEtaOverdue({ set_at: setAt, eta_at: etaAt, observed_at: "2026-11-27T12:19:59.999Z" }),
    ).toEqual({ overdue: false, overdue_at: "2026-11-27T12:20:00.000Z" });

    expect(
      computeEtaOverdue({ set_at: setAt, eta_at: etaAt, observed_at: "2026-11-27T12:20:00.000Z" }),
    ).toEqual({ overdue: true, overdue_at: "2026-11-27T12:20:00.000Z" });
  });

  test("long estimate uses half the estimate as grace", () => {
    const setAt = "2026-11-27T12:00:00.000Z";
    const etaAt = "2026-11-27T13:00:00.000Z"; // 60m estimate -> half is 30m > 10m floor
    expect(computeEtaGraceMs(Date.parse(setAt), Date.parse(etaAt))).toBe(30 * 60_000);

    expect(
      computeEtaOverdue({ set_at: setAt, eta_at: etaAt, observed_at: "2026-11-27T13:29:59.999Z" }),
    ).toEqual({ overdue: false, overdue_at: "2026-11-27T13:30:00.000Z" });

    expect(
      computeEtaOverdue({ set_at: setAt, eta_at: etaAt, observed_at: "2026-11-27T13:30:00.000Z" }),
    ).toEqual({ overdue: true, overdue_at: "2026-11-27T13:30:00.000Z" });
  });

  test("zero or past ETA still applies the 10-minute grace floor; inactive items never read overdue", () => {
    const setAt = "2026-11-27T12:00:00.000Z";
    const etaAt = "2026-11-27T11:55:00.000Z";
    expect(
      computeEtaOverdue({ set_at: setAt, eta_at: etaAt, observed_at: "2026-11-27T12:04:59.999Z" }),
    ).toEqual({ overdue: false, overdue_at: "2026-11-27T12:05:00.000Z" });
    expect(
      computeEtaOverdue({ set_at: setAt, eta_at: etaAt, observed_at: "2026-11-27T12:05:00.000Z" }),
    ).toEqual({ overdue: true, overdue_at: "2026-11-27T12:05:00.000Z" });
    expect(
      computeEtaOverdue({ set_at: setAt, eta_at: etaAt, observed_at: "2026-11-27T15:00:00.000Z", active: false }),
    ).toEqual({ overdue: false, overdue_at: "2026-11-27T12:05:00.000Z" });
    expect(
      computeEtaOverdue({ set_at: setAt, eta_at: null, observed_at: "2026-11-27T15:00:00.000Z" }),
    ).toEqual({ overdue: false, overdue_at: null });
  });
});

describe("time/1 §6 — reports carry eta_at, check_back_at, and derived overdue", () => {
  test("stores canonical UTC instants on reports and computes overdue dynamically on read", () => {
    const { dir, store, setTime } = makeStore("2026-11-27T12:00:00.000Z");
    try {
      const handle = store.startSession({ root_path: dir, actor: "alpha" });
      const report = store.appendReportForSession({
        ...handle.credential,
        idempotency_key: "r-eta-1",
        kind: "observation",
        body: "Drafting review, ETA 13:00Z.",
        // Non-Z offset normalizes to UTC Z: 14:00+01:00 == 13:00Z (60m estimate -> 30m grace -> overdue_at 13:30Z)
        eta_at: "2026-11-27T14:00:00+01:00",
        check_back_at: "2026-11-27T13:15:00Z",
      });
      expect(report.eta_at).toBe("2026-11-27T13:00:00.000Z");
      expect(report.check_back_at).toBe("2026-11-27T13:15:00.000Z");
      expect(report.overdue).toBe(false);
      expect(report.overdue_at).toBe("2026-11-27T13:30:00.000Z");

      // Just before grace expires: still not overdue.
      setTime("2026-11-27T13:29:59.000Z");
      const before = store.listReports(handle.workspace.id)[0]!;
      expect(before.overdue).toBe(false);
      expect(before.overdue_at).toBe("2026-11-27T13:30:00.000Z");

      // At grace expiry: reads overdue in listReports and nextForSession.
      setTime("2026-11-27T13:30:00.000Z");
      const after = store.listReports(handle.workspace.id)[0]!;
      expect(after.overdue).toBe(true);
      const next = store.nextForSession({ ...handle.credential });
      expect(next.reports.find((r) => r.id === report.id)?.overdue).toBe(true);
    } finally {
      store.close();
    }
  });

  test("rejects non-time/1 instants and omits timing keys from plain report event payloads", () => {
    const { dir, store } = makeStore("2026-11-27T12:00:00.000Z");
    try {
      const handle = store.startSession({ root_path: dir, actor: "alpha" });
      for (const bad of ["2026-11-27", "2026-11-27T13:00:00", "2026-02-30T13:00:00Z", "15:45Z", "soon"]) {
        expect(() =>
          store.appendReportForSession({
            ...handle.credential,
            idempotency_key: `bad-eta-${bad}`,
            kind: "observation",
            body: "bad eta",
            eta_at: bad,
          }),
        ).toThrow(CollabError);
        expect(() =>
          store.appendReportForSession({
            ...handle.credential,
            idempotency_key: `bad-cb-${bad}`,
            kind: "observation",
            body: "bad check_back",
            check_back_at: bad,
          }),
        ).toThrow(CollabError);
      }

      const plain = store.appendReportForSession({
        ...handle.credential,
        idempotency_key: "plain-1",
        kind: "observation",
        body: "no eta here",
      });
      expect(plain.eta_at).toBeUndefined();
      expect(plain.check_back_at).toBeUndefined();
      expect(plain.overdue).toBeUndefined();
      expect(plain.overdue_at).toBeUndefined();

      const page = store.eventsSince(handle.workspace.id, plain.event_sequence - 1, 5);
      const ev = page.events.find((e) => e.sequence === plain.event_sequence)!;
      expect(Object.hasOwn(ev.payload, "eta_at")).toBe(false);
      expect(Object.hasOwn(ev.payload, "check_back_at")).toBe(false);
    } finally {
      store.close();
    }
  });
});

describe("time/1 §6 — tasks carry eta_at, check_back_at, revisions, clears, and completion", () => {
  test("task ETA becomes overdue after grace, revises on progress, clears with null, and clears overdue on completion", () => {
    const { dir, store, setTime } = makeStore("2026-11-27T12:00:00.000Z");
    try {
      const handle = store.startSession({ root_path: dir, actor: "worker" });
      const created = store.createTaskForSession({
        ...handle.credential,
        idempotency_key: "t-create-1",
        title: "Verify vectors",
        work_mode: "coordination",
        completion_policy: "reported",
        eta_at: "2026-11-27T12:10:00Z", // 10m estimate -> 10m floor grace -> overdue_at 12:20Z
        check_back_at: "2026-11-27T12:15:00Z",
      });
      expect(created.eta_at).toBe("2026-11-27T12:10:00.000Z");
      expect(created.check_back_at).toBe("2026-11-27T12:15:00.000Z");
      expect(created.overdue).toBe(false);
      expect(created.overdue_at).toBe("2026-11-27T12:20:00.000Z");

      const claimed = store.claimTaskForSession({
        ...handle.credential,
        idempotency_key: "t-claim-1",
        task_id: created.id,
        expected_version: created.version,
      });

      // Cross 12:20Z -> task reads overdue!
      setTime("2026-11-27T12:20:00.000Z");
      expect(store.getTask(handle.workspace.id, created.id).overdue).toBe(true);
      expect(store.listTasks(handle.workspace.id)[0]!.overdue).toBe(true);

      // Revise ETA at 12:20Z to 13:00Z (40m estimate -> 20m grace -> overdue_at 13:20Z).
      const revised = store.progressTaskForSession({
        ...handle.credential,
        idempotency_key: "t-prog-1",
        task_id: claimed.id,
        lease_id: claimed.lease_id!,
        expected_version: claimed.version,
        message: "Hit extra cases, revising ETA to 13:00Z.",
        eta_at: "2026-11-27T13:00:00Z",
      });
      expect(revised.eta_at).toBe("2026-11-27T13:00:00.000Z");
      expect(revised.check_back_at).toBe("2026-11-27T12:15:00.000Z"); // preserved when omitted
      expect(revised.overdue).toBe(false);
      expect(revised.overdue_at).toBe("2026-11-27T13:20:00.000Z");

      // At 13:19Z still not overdue; at 13:20Z overdue again.
      setTime("2026-11-27T13:19:59.000Z");
      expect(store.getTask(handle.workspace.id, created.id).overdue).toBe(false);
      setTime("2026-11-27T13:20:00.000Z");
      expect(store.getTask(handle.workspace.id, created.id).overdue).toBe(true);

      // Completing a task stops it from reading overdue even past overdue_at.
      const completed = store.completeTaskForSession({
        ...handle.credential,
        idempotency_key: "t-done-1",
        task_id: revised.id,
        lease_id: revised.lease_id!,
        expected_version: revised.version,
        summary: "Done.",
      });
      expect(completed.status).toBe("completed");
      expect(completed.overdue).toBe(false);

      // Separate task: clearing eta_at with null resets eta_at/overdue/overdue_at.
      setTime("2026-11-27T14:00:00.000Z");
      const t2 = store.createTaskForSession({
        ...handle.credential,
        idempotency_key: "t-create-2",
        title: "Clearable ETA",
        work_mode: "coordination",
        completion_policy: "reported",
        eta_at: "2026-11-27T14:10:00Z",
        check_back_at: "2026-11-27T14:20:00Z",
      });
      const c2 = store.claimTaskForSession({
        ...handle.credential,
        idempotency_key: "t-claim-2",
        task_id: t2.id,
        expected_version: t2.version,
      });
      const cleared = store.progressTaskForSession({
        ...handle.credential,
        idempotency_key: "t-prog-2",
        task_id: c2.id,
        lease_id: c2.lease_id!,
        expected_version: c2.version,
        message: "Clearing ETA while blocked on external input.",
        eta_at: null,
      });
      expect(cleared.eta_at).toBeUndefined();
      expect(cleared.overdue).toBeUndefined();
      expect(cleared.overdue_at).toBeUndefined();
      expect(cleared.check_back_at).toBe("2026-11-27T14:20:00.000Z");
    } finally {
      store.close();
    }
  });
});

describe("time/1 §6 — Collab Notes surface (collab_note, collab_take, collab_inbox)", () => {
  test("collab_note accepts eta_at/check_back_at, refuses bad instants with Notes remedy, and collab_inbox surfaces overdue", async () => {
    const { dir, store, setTime, call: aliceCall, makeClient } = makeMcp("2026-11-27T12:00:00.000Z");
    const bobCall = makeClient();
    try {
      const a = await aliceCall("collab_arrive", { name: "alice", purpose: "test eta", root_path: dir });
      expect(a.isError).toBeUndefined();
      const b = await bobCall("collab_arrive", { name: "bob", purpose: "read inbox", root_path: dir });
      expect(b.isError).toBeUndefined();

      const bad = await aliceCall("collab_note", { text: "bad eta", eta_at: "tomorrow" });
      expect(bad.isError).toBe(true);
      expect(bad.structuredContent.code).toBe("invalid_eta_at");
      expect(bad.structuredContent.remedy).toBeObject();

      const dry = await aliceCall("collab_note", {
        text: "Reviewing PR, ETA 12:10Z.",
        to: "bob",
        eta_at: "2026-11-27T12:10:00Z",
        check_back_at: "2026-11-27T12:25:00Z",
        dry_run: true,
      });
      expect(dry.isError).toBeUndefined();
      expect(dry.structuredContent.would.reports[0].eta_at).toBe("2026-11-27T12:10:00.000Z");
      expect(dry.structuredContent.would.reports[0].check_back_at).toBe("2026-11-27T12:25:00.000Z");

      const sent = await aliceCall("collab_note", {
        text: "Reviewing PR, ETA 12:10Z.",
        to: "bob",
        eta_at: "2026-11-27T12:10:00Z",
        check_back_at: "2026-11-27T12:25:00Z",
      });
      expect(sent.isError).toBeUndefined();
      expect(sent.structuredContent.eta_at).toBe("2026-11-27T12:10:00.000Z");
      expect(sent.structuredContent.check_back_at).toBe("2026-11-27T12:25:00.000Z");
      expect(sent.structuredContent.overdue).toBe(false);
      expect(sent.structuredContent.overdue_at).toBe("2026-11-27T12:20:00.000Z");

      // Advance past grace -> bob's inbox sees overdue: true!
      setTime("2026-11-27T12:21:00.000Z");
      const inbox = await bobCall("collab_inbox", {});
      expect(inbox.isError).toBeUndefined();
      const item = (inbox.structuredContent.items as Array<Record<string, any>>).find(
        (entry) => entry.id === sent.structuredContent.ids.report,
      )!;
      expect(item.eta_at).toBe("2026-11-27T12:10:00.000Z");
      expect(item.check_back_at).toBe("2026-11-27T12:25:00.000Z");
      expect(item.overdue).toBe(true);
      expect(item.overdue_at).toBe("2026-11-27T12:20:00.000Z");

      // collab_take with title sets eta_at/check_back_at on the created task.
      setTime("2026-11-27T12:30:00.000Z");
      const taken = await aliceCall("collab_take", {
        title: "Check ETA task",
        eta_at: "2026-11-27T12:40:00Z",
        check_back_at: "2026-11-27T12:55:00Z",
      });
      expect(taken.isError).toBeUndefined();
      const workspaceId = store.listWorkspaces()[0]!.id;
      const task = store.getTask(workspaceId, taken.structuredContent.ids.task);
      expect(task.eta_at).toBe("2026-11-27T12:40:00.000Z");
      expect(task.check_back_at).toBe("2026-11-27T12:55:00.000Z");
      expect(task.overdue).toBe(false);
      expect(task.overdue_at).toBe("2026-11-27T12:50:00.000Z");
    } finally {
      store.close();
    }
  });
});
