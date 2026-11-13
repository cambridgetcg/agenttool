import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { EventCursor, SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { assertNotePayload, CollabStore, NOTE_SCAN_MAX_BYTES, NOTE_SCAN_MAX_EVENTS } from "../src/store.js";
import {
  base32,
  noteCall,
  noteFailure,
  planReceipt,
  replayReceipt,
  underPlan,
  withCurrentVersion,
} from "../src/verbs.js";

// The verb kernel's common rules (Collab Notes spec 5) and the storage guards
// of spec 8.3, pinned below the verbs: key derivation, receipt replay, the
// payload guard, the inbox scan bounds, the note marker rule (spec 4) and the
// one wait budget the inbox shares with collab_events_wait.

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function journal() {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-kernel-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  let now = Date.parse("2026-11-12T10:00:00.000Z");
  const store = new CollabStore(join(directory, "state", "collab.sqlite"), { now: () => new Date(now) });
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    root,
    store,
    advance(ms: number) {
      now += ms;
    },
    start(actor: string) {
      return store.startSession({ root_path: root, actor, role: `${actor}'s work` });
    },
    serve(handle: SessionHandle) {
      const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
      const server = buildCollabMcpServer(store, { environment: {}, resumed_session: { handle, credential_file: file } }) as any;
      cleanup.push(() => server.close());
      return server;
    },
    head(workspaceId: string): EventCursor {
      const workspace = store.getWorkspace(workspaceId)!;
      return { epoch_id: workspace.epoch_id, sequence: workspace.event_head_sequence, hash: workspace.event_head_hash };
    },
    count(table: string): number {
      return (store.db.query(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
    },
  };
}

async function call(server: any, name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, { mcpReq: { signal } }) as {
    isError?: boolean;
    structuredContent: Record<string, any>;
  };
}

async function ok(server: any, name: string, args: Record<string, unknown> = {}) {
  const result = await call(server, name, args);
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent;
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof CollabError ? error.code : `not a CollabError: ${String(error)}`;
  }
}

describe("base32", () => {
  test("is RFC 4648 upper case with no padding", () => {
    const encode = (text: string) => base32(new TextEncoder().encode(text));
    // RFC 4648 section 10, with the padding removed.
    expect(["", "f", "fo", "foo", "foob", "fooba", "foobar"].map(encode))
      .toEqual(["", "MY", "MZXQ", "MZXW6", "MZXW6YQ", "MZXW6YTB", "MZXW6YTBOI"]);
    expect(base32(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]))).toBe("77777777");
  });
});

describe("derived receipt keys", () => {
  test("a retry reuses the latest key; another input, or an effect no longer current, takes the next seq", () => {
    const j = journal();
    const me = j.start("me");
    const plan = (input: unknown, stillCurrent?: (key: string) => boolean) =>
      planReceipt(j.store, me.credential, { tool: "collab_arrive", input, entity: "purpose", stillCurrent });

    const first = plan({ purpose: "X" });
    expect(first).toMatchObject({ seq: 1, retry: false, latest: null });
    expect(first.key).toMatch(/^n1:[A-Z2-7]{8}:000001:[A-Z2-7]{20}$/);
    expect(first.step(1)).toBe(`${first.key}:01`);
    j.store.declarePurposeForSession({ ...me.credential, idempotency_key: first.key, purpose: "X" });

    // The same call again: a lost-response retry, under the same key.
    const retry = plan({ purpose: "X" });
    expect(retry).toMatchObject({ seq: 1, retry: true, latest: first.key, key: first.key });
    // The same call whose earlier effect no longer holds acts afresh.
    const stale = plan({ purpose: "X" }, () => false);
    expect(stale).toMatchObject({ seq: 2, retry: false, latest: first.key });
    expect(stale.eh).toBe(first.eh);
    expect(stale.base).toBe(first.base);
    // Another input on the same entity is a new act.
    const other = plan({ purpose: "Y" });
    expect(other).toMatchObject({ seq: 2, retry: false });
    expect(other.base).not.toBe(first.base);
    // Another entity has its own sequence.
    const elsewhere = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: "X" }, entity: "note" });
    expect(elsewhere).toMatchObject({ seq: 1, retry: false, latest: null });
    expect(elsewhere.eh).not.toBe(first.eh);
  });

  test("a step key counts as the latest act, and its call replays under the base key", () => {
    const j = journal();
    const me = j.start("me");
    const plan = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: "X" }, entity: "purpose" });
    j.store.declarePurposeForSession({ ...me.credential, idempotency_key: plan.step(1), purpose: "X" });
    const again = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: "X" }, entity: "purpose" });
    expect(again.latest).toBe(plan.step(1));
    expect(again).toMatchObject({ retry: true, seq: 1, key: plan.key });
  });

  test("the key hashes who asks: another session's identical call is not a retry of mine", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const mine = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: "X" }, entity: "purpose" });
    const theirs = planReceipt(j.store, peer.credential, { tool: "collab_arrive", input: { purpose: "X" }, entity: "purpose" });
    expect(theirs.base).not.toBe(mine.base);
    expect(theirs.eh).toBe(mine.eh);
  });
});

describe("two calls that plan before either writes", () => {
  /** Two purposes whose bases sort first > second, so a shared seq would make the earlier write look latest. */
  function inverted(j: ReturnType<typeof journal>, me: SessionHandle): [string, string] {
    for (let index = 0; index < 200; index += 1) {
      const [x, y] = [`purpose ${index}`, `other ${index}`];
      const px = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: x }, entity: "purpose" });
      const py = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: y }, entity: "purpose" });
      if (px.base > py.base) return [x, y];
    }
    throw new Error("no inverted pair found");
  }

  test("the write's transaction refuses a plan another write overtook, and nothing is written", () => {
    const j = journal();
    const me = j.start("me");
    const [x, y] = inverted(j, me);
    const px = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: x }, entity: "purpose" });
    const py = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: y }, entity: "purpose" });
    expect([px.seq, py.seq]).toEqual([1, 1]);
    j.store.declarePurposeForSession({ ...me.credential, idempotency_key: px.key, purpose: x, receipt_plan: px.guard });
    const before = j.count("events");
    expect(codeOf(() => j.store.declarePurposeForSession({ ...me.credential, idempotency_key: py.key, purpose: y, receipt_plan: py.guard })))
      .toBe("receipt_plan_stale");
    expect(j.count("events")).toBe(before);
    // The same key written again (a lost response, replayed by the store) still passes its own guard.
    expect(j.store.declarePurposeForSession({ ...me.credential, idempotency_key: px.key, purpose: x, receipt_plan: px.guard }).purpose)
      .toBe(x);
  });

  test("underPlan plans once more, so the later write is latest and a deliberate repeat writes again", async () => {
    const j = journal();
    const me = j.start("me");
    const [x, y] = inverted(j, me);
    const ctx = { store: j.store, slot_key: "" };
    const declare = (purpose: string, interleave?: () => void) =>
      underPlan(ctx, me.credential, { tool: "collab_arrive", input: { purpose }, entity: "purpose" }, (plan) => {
        // Another call by this session that planned with this one writes first.
        interleave?.();
        return { plan, receipt: j.store.declarePurposeForSession({ ...me.credential, idempotency_key: plan.key, purpose, receipt_plan: plan.guard }) };
      });
    let overtaken = false;
    const second = await declare(y, () => {
      if (overtaken) return;
      overtaken = true;
      const px = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: x }, entity: "purpose" });
      j.store.declarePurposeForSession({ ...me.credential, idempotency_key: px.key, purpose: x, receipt_plan: px.guard });
    });
    expect(second.plan.seq).toBe(2);
    expect(second.plan.retry).toBe(false);
    // x again is a deliberate repeat after y, not a retry of the first write.
    const again = planReceipt(j.store, me.credential, { tool: "collab_arrive", input: { purpose: x }, entity: "purpose" });
    expect(again).toMatchObject({ retry: false, seq: 3 });
    expect((await declare(x)).receipt.purpose).toBe(x);
    expect(j.store.noteSessionViews(me.workspace.id).find((view) => view.id === me.session.id)!.purpose).toBe(x);
    expect(j.store.db.query(`SELECT COUNT(*) AS n FROM events WHERE type = 'purpose.declared'`).get()).toEqual({ n: 3 });
  });

  test("a plan overtaken twice is refused as changed_under_you with the same call as remedy", async () => {
    const j = journal();
    const me = j.start("me");
    let overtakes = 0;
    const result = await noteCall(() => underPlan(
      { store: j.store, slot_key: "k1" },
      me.credential,
      { tool: "collab_arrive", input: { purpose: "mine" }, entity: "purpose", retry_input: { purpose: "mine", revise_purpose: true } },
      (plan) => {
        overtakes += 1;
        j.store.declarePurposeForSession({ ...me.credential, idempotency_key: `n1:${plan.eh}:00000${overtakes + 4}:${"A".repeat(20)}`, purpose: "theirs" });
        return j.store.declarePurposeForSession({ ...me.credential, idempotency_key: plan.key, purpose: "mine", receipt_plan: plan.guard }) as unknown as Record<string, unknown>;
      },
    ));
    expect(overtakes).toBe(2);
    expect(result.structuredContent).toMatchObject({
      code: "changed_under_you",
      remedy: { tool: "collab_arrive", input: { purpose: "mine", revise_purpose: true, binding_key: "k1" } },
    });
  });
});

describe("version conflicts are handled inside the call (spec 5)", () => {
  test("a concurrent change between the read and the write returns changed_under_you with the fresh state", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const task = j.store.createTaskForSession({ ...me.credential, idempotency_key: "t", title: "Shared", work_mode: "coordination" });
    const input = { task: task.id };
    const read = () => {
      const current = j.store.getTask(me.workspace.id, task.id)!;
      return { version: current.version, state: { task: current.id, status: current.status, holder: current.assignee } };
    };
    let raced = false;
    const result = await noteCall(() => withCurrentVersion({ slot_key: "" }, { tool: "collab_take", input }, read, (version) => {
      if (!raced) {
        // Another session claims and releases the task after this call read it: still claimable, but changed.
        raced = true;
        const claimed = j.store.claimTaskForSession({ ...peer.credential, idempotency_key: "pc", task_id: task.id, expected_version: version });
        j.store.releaseTaskForSession({
          ...peer.credential, idempotency_key: "pr", task_id: task.id, lease_id: claimed.lease_id!, expected_version: claimed.version, summary: "Not mine.",
        });
      }
      return j.store.claimTaskForSession({ ...me.credential, idempotency_key: "mc", task_id: task.id, expected_version: version }) as unknown as Record<string, unknown>;
    }));
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "changed_under_you",
      message: expect.stringContaining("changed after this call read it"),
      state: { task: task.id, status: "open", holder: null },
      remedy: { tool: "collab_take", input },
    });
    // Bookkeeping stays hidden: no version reaches the caller.
    expect(JSON.stringify(result.structuredContent)).not.toContain("version");
    expect(j.store.getTask(me.workspace.id, task.id)!.assignee).toBeNull();
    // Without a race the same call acts.
    const taken = await noteCall(() => withCurrentVersion({ slot_key: "" }, { tool: "collab_take", input }, read, (version) =>
      j.store.claimTaskForSession({ ...me.credential, idempotency_key: "mc2", task_id: task.id, expected_version: version }) as unknown as Record<string, unknown>));
    expect((taken as { isError?: boolean }).isError).toBeUndefined();
  });

  test("a stray version_conflict from the store becomes changed_under_you, with no version in it", () => {
    const stray = noteFailure(new CollabError("version_conflict", "Task changed since it was read", { expected_version: 3, current_version: 4 }));
    expect(stray.structuredContent.code).toBe("changed_under_you");
    expect(JSON.stringify(stray.structuredContent)).not.toContain("version");
    const say = (stray.structuredContent.remedy as { say: string }).say;
    expect(say).not.toContain("correct the call");
    expect(say).not.toContain("Nothing was written");
  });
});

describe("readReceiptByKey", () => {
  test("replays the recorded response by exact key without comparing the request", () => {
    const j = journal();
    const me = j.start("me");
    const key = "n1:AAAAAAAA:000001:AAAAAAAAAAAAAAAAAAAA";
    const written = j.store.declarePurposeForSession({ ...me.credential, idempotency_key: key, purpose: "X" });
    // Through the ordinary path the same key with another request is a conflict...
    expect(codeOf(() => j.store.declarePurposeForSession({ ...me.credential, idempotency_key: key, purpose: "Y" })))
      .toBe("idempotency_conflict");
    // ...while the lookup returns what was recorded, whatever the new request would be.
    const found = j.store.readReceiptByKey<{ purpose: string; sequence: number }>(me.credential, key);
    expect(found).toEqual({ found: true, operation: "notes.purpose.v1", value: JSON.parse(JSON.stringify(written)) });
    expect(replayReceipt<{ purpose: string }>(j.store, me.credential, key)!.purpose).toBe("X");
    expect(j.store.readReceiptByKey(me.credential, `${key}:01`)).toEqual({ found: false });
    expect(replayReceipt(j.store, me.credential, `${key}:01`)).toBeNull();
    // A receipt belongs to its session: another session's lookup finds nothing.
    const peer = j.start("peer");
    expect(j.store.readReceiptByKey(peer.credential, key)).toEqual({ found: false });
  });

  test("authenticates the session and refuses a key that is not a key", () => {
    const j = journal();
    const me = j.start("me");
    expect(codeOf(() => j.store.readReceiptByKey({ ...me.credential, session_token: "x".repeat(43) }, "n1:A")))
      .toBe("session_auth_failed");
    expect(codeOf(() => j.store.readReceiptByKey(me.credential, "has space"))).toBe("invalid_idempotency_key");
    expect(codeOf(() => j.store.latestReceiptKeyForSession(me.credential, "no-colon"))).toBe("invalid_receipt_prefix");
  });
});

describe("the payload guard (spec 8.3)", () => {
  test("refuses more than 64 KiB, integer-like keys, non-integer numbers and undefined", () => {
    expect(codeOf(() => assertNotePayload({ session_id: "s", purpose: "fits", n: 3, nested: { list: [1, "a", null, true] } })))
      .toBeNull();
    // "01" and "-1" do not read as array indexes, so object order keeps them as written.
    expect(codeOf(() => assertNotePayload({ "01": 1, "-1": 2 }))).toBeNull();
    expect(codeOf(() => assertNotePayload({ text: "x".repeat(64 * 1024) }))).toBe("too_long");
    expect(codeOf(() => assertNotePayload({ "0": "a" }))).toBe("invalid_payload");
    expect(codeOf(() => assertNotePayload({ deep: [{ "42": "a" }] }))).toBe("invalid_payload");
    expect(codeOf(() => assertNotePayload({ n: 1.5 }))).toBe("invalid_payload");
    expect(codeOf(() => assertNotePayload({ n: Number.NaN }))).toBe("invalid_payload");
    expect(codeOf(() => assertNotePayload({ n: 2 ** 53 }))).toBe("invalid_payload");
    expect(codeOf(() => assertNotePayload({ list: [1, undefined] }))).toBe("invalid_payload");
    expect(codeOf(() => assertNotePayload({ value: undefined }))).toBe("invalid_payload");
    try {
      assertNotePayload({ text: "é".repeat(33 * 1024) });
      throw new Error("not refused");
    } catch (error) {
      // Bytes of canonical UTF-8, not characters: 33 Ki two-byte characters are over.
      expect((error as CollabError).details).toMatchObject({ field: "payload", max: 64 * 1024, unit: "bytes" });
    }
  });
});

describe("the inbox scan bounds", () => {
  test(`one call scans at most ${NOTE_SCAN_MAX_EVENTS} events and says more`, async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const start = j.head(me.workspace.id).sequence;
    for (let index = 0; index < NOTE_SCAN_MAX_EVENTS + 100; index += 1) {
      j.store.appendReportForSession({ ...peer.credential, idempotency_key: `n${index}`, kind: "observation", body: `noise ${index}` });
    }
    j.store.appendReportForSession({
      ...peer.credential, idempotency_key: "m", kind: "observation", body: "For me.", to_session_id: me.session.id,
    });
    // Arrive's count stops where the scan stops, and says it is a lower bound.
    const arrived = await ok(server, "collab_arrive", { purpose: "look" });
    expect(arrived.totals).toMatchObject({ for_you: 0, for_you_at_least: true });
    const first = await ok(server, "collab_inbox");
    expect(first.items).toEqual([]);
    expect(first.more).toBe(true);
    expect(first.read_through.sequence).toBe(start + NOTE_SCAN_MAX_EVENTS);
    expect(first.also_new).toEqual({ count: NOTE_SCAN_MAX_EVENTS, see: { tool: "collab_inbox", input: { since: start, include: "all" } } });
    expect(first.next).toEqual({ tool: "collab_inbox", input: {} });
    const second = await ok(server, "collab_inbox");
    expect(second.items.map((item: any) => item.statement)).toEqual(["For me."]);
    expect(second.more).toBe(false);
    expect(second.also_new).toEqual({ count: 100, see: { tool: "collab_inbox", input: { since: start + NOTE_SCAN_MAX_EVENTS, include: "all" } } });
    expect(second.read_through.sequence).toBe(j.head(me.workspace.id).sequence);
  }, 60_000);

  test(`one call scans at most ${NOTE_SCAN_MAX_BYTES / (1024 * 1024)} MiB of payload and says more`, async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const start = j.head(me.workspace.id).sequence;
    const body = "x".repeat(8_900);
    const count = Math.ceil(NOTE_SCAN_MAX_BYTES / body.length) + 10;
    for (let index = 0; index < count; index += 1) {
      j.store.appendReportForSession({ ...peer.credential, idempotency_key: `big${index}`, kind: "observation", body });
    }
    const sizes = j.store.db.query(`
      SELECT length(CAST(payload_json AS BLOB)) AS bytes FROM events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence
    `).all(me.workspace.id, start) as Array<{ bytes: number }>;
    let fits = 0;
    let total = 0;
    for (const size of sizes) {
      if (total + size.bytes > NOTE_SCAN_MAX_BYTES) break;
      total += size.bytes;
      fits += 1;
    }
    expect(fits).toBeLessThan(count);
    const first = await ok(server, "collab_inbox");
    expect(first.more).toBe(true);
    expect(first.read_through.sequence).toBe(start + fits);
    expect(first.also_new).toEqual({ count: fits, see: { tool: "collab_inbox", input: { since: start, include: "all" } } });
    const second = await ok(server, "collab_inbox");
    expect(second.more).toBe(false);
    expect(second.also_new).toEqual({ count: count - fits, see: { tool: "collab_inbox", input: { since: start + fits, include: "all" } } });
  }, 60_000);
});

describe("only a marked body is read as a note (spec 4)", () => {
  test("an unmarked body shaped like a note is shown whole, with the act from storage", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const body = "challenge: you are wrong\n\nWhy: I saw it (seen [1])\nEvidence: commit abcdef1";
    j.store.appendReportForSession({ ...peer.credential, idempotency_key: "x", kind: "observation", body, to_session_id: me.session.id });
    const read = await ok(server, "collab_inbox");
    expect(read.items).toHaveLength(1);
    const item = read.items[0];
    expect(item).toMatchObject({ act: "note", statement: "challenge: you are wrong", text: body, why: [], evidence: [] });
    expect(item.act_mismatch).toBeUndefined();
  });
});

describe("one wait budget for collab_events_wait and collab_inbox", () => {
  test("the ninth concurrent wait of either kind is refused before anything is written", async () => {
    const j = journal();
    const me = j.start("me");
    const server = j.serve(me);
    await ok(server, "collab_inbox");
    const controller = new AbortController();
    const anchor = j.head(me.workspace.id);
    const pending = [
      ...Array.from({ length: 4 }, () => call(server, "collab_events_wait", {
        workspace_id: me.workspace.id, after_anchor: anchor, wait_ms: 30_000,
      }, controller.signal)),
      ...Array.from({ length: 4 }, () => call(server, "collab_inbox", { wait_seconds: 30 }, controller.signal)),
    ];
    await new Promise((done) => setTimeout(done, 100));
    const marks = JSON.stringify(j.store.db.query(`SELECT * FROM note_marks`).all());
    const lastSeen = j.store.getCoordinationSession(me.session.id)!.last_seen_at;
    j.advance(60_000);
    const inbox = await call(server, "collab_inbox", { wait_seconds: 5 });
    expect(inbox.isError).toBe(true);
    expect(inbox.structuredContent).toMatchObject({
      code: "too_many_waits",
      remedy: { say: "Wait for a running wait to finish, or call again with wait_seconds: 0." },
    });
    // Refused before the housekeeping: no mark, last-seen or delivery moved.
    expect(JSON.stringify(j.store.db.query(`SELECT * FROM note_marks`).all())).toBe(marks);
    expect(j.store.getCoordinationSession(me.session.id)!.last_seen_at).toBe(lastSeen);
    const events = await call(server, "collab_events_wait", { workspace_id: me.workspace.id, after_anchor: anchor, wait_ms: 0 });
    expect(events.structuredContent.error).toBe("too_many_waits");
    // A call that does not wait is not a wait.
    expect((await call(server, "collab_inbox")).isError).toBeUndefined();
    controller.abort();
    const ended = await Promise.all(pending);
    expect(ended.every((result) => result.isError === true)).toBe(true);
    // The budget is released: both kinds may wait again.
    expect((await call(server, "collab_inbox", { wait_seconds: 1 })).structuredContent.waited.ended_by).toBe("timeout");
    expect((await call(server, "collab_events_wait", { workspace_id: me.workspace.id, after_anchor: anchor, wait_ms: 0 })).isError)
      .toBeUndefined();
  }, 20_000);
});
