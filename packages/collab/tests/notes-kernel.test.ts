import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { EventCursor, SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { assertNotePayload, CollabStore, NOTE_SCAN_MAX_BYTES, NOTE_SCAN_MAX_EVENTS } from "../src/store.js";
import { base32, planReceipt, replayReceipt } from "../src/verbs.js";

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
    const first = await ok(server, "collab_inbox");
    expect(first.items).toEqual([]);
    expect(first.more).toBe(true);
    expect(first.read_through.sequence).toBe(start + NOTE_SCAN_MAX_EVENTS);
    expect(first.also_new).toEqual({ count: NOTE_SCAN_MAX_EVENTS });
    expect(first.next).toEqual({ tool: "collab_inbox", input: {} });
    const second = await ok(server, "collab_inbox");
    expect(second.items.map((item: any) => item.statement)).toEqual(["For me."]);
    expect(second.more).toBe(false);
    expect(second.also_new).toEqual({ count: 100 });
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
    expect(first.also_new).toEqual({ count: fits });
    const second = await ok(server, "collab_inbox");
    expect(second.more).toBe(false);
    expect(second.also_new).toEqual({ count: count - fits });
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
