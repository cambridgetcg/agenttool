import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../src/canonical.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { MAX_WAIT_ANCHOR_BYTES, MAX_WAIT_PAGE_BYTES, MAX_WAIT_RESPONSE_BYTES, type EventCursor, type JournalPage } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "collab-events-wait-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  let now = new Date("2026-09-08T00:00:00Z");
  const path = join(directory, "collab.sqlite");
  const store = new CollabStore(path, { now: () => now });
  const handle = store.startSession({ root_path: root, actor: "observer" });
  const server = buildCollabMcpServer(store, { resumed_session: {
    handle, credential_file: join(directory, "fixture-session.json"),
  } });
  cleanup.push(async () => {
    await server.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const workspace_id = handle.workspace.id;
  const head = (): EventCursor => {
    const workspace = store.getWorkspace(workspace_id)!;
    return { epoch_id: workspace.epoch_id, sequence: workspace.event_head_sequence, hash: workspace.event_head_hash };
  };
  const page = (after_anchor = head(), event_limit?: number) => store.eventsAfterAnchorForSession({
    ...handle.credential, workspace_id, after_anchor, event_limit,
  });
  const append = (key: string, evidence_refs?: string[]) => store.appendReportForSession({
    ...handle.credential, idempotency_key: key, kind: "observation", body: key, evidence_refs,
  });
  return { directory, root, path, store, server, handle, workspace_id, head, page, append,
    advance: () => { now = new Date(now.getTime() + 120_000); } };
}

async function tool(server: any, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const registration = server._registeredTools[name];
  return (registration.handler ?? registration.callback)(args, { mcpReq: { signal } });
}
function wait(f: ReturnType<typeof fixture>, after_anchor = f.head(), wait_ms = 0, signal?: AbortSignal, event_limit?: number) {
  return tool(f.server, "collab_events_wait", { workspace_id: f.workspace_id, after_anchor, wait_ms, event_limit }, signal);
}
function secondConnection(f: ReturnType<typeof fixture>) {
  const db = new Database(f.path, { strict: true });
  db.exec("PRAGMA busy_timeout = 0");
  cleanup.push(() => db.close());
  return db;
}
async function worker(f: ReturnType<typeof fixture>, mode: string) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "events-wait-worker.ts"), mode, f.path, f.root], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: "/tmp" },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  cleanup.push(async () => { child.kill(); await child.exited; });
  return child;
}

describe("bounded anchored local observation", () => {
  test("authenticates and scopes the read without accepting presence-only or legacy binding", async () => {
    const f = fixture();
    const unbound = buildCollabMcpServer(f.store);
    cleanup.push(() => unbound.close());
    expect((await tool(unbound, "collab_events_wait", { workspace_id: f.workspace_id, after_anchor: f.head(), wait_ms: 0 })).structuredContent.error).toBe("session_not_bound");
    expect((await tool(f.server, "collab_events_wait", { workspace_id: "other", after_anchor: f.head(), wait_ms: 0 })).structuredContent.error).toBe("session_workspace_mismatch");
    for (const override of [{ session_token: "wrong" }, { generation: 9 }, { session_id: "missing" }]) {
      expect(() => f.store.eventsAfterAnchorForSession({ ...f.handle.credential, ...override,
        workspace_id: f.workspace_id, after_anchor: f.head(),
      })).toThrow("Session credentials are invalid");
    }
    expect(() => f.store.eventsAfterAnchorForSession({ ...f.handle.credential, workspace_id: "other", after_anchor: f.head() })).toThrow("another workspace");
    for (const event_limit of [0, 51, 1.5, NaN]) expect(() => f.page(f.head(), event_limit)).toThrow("event_limit");
    for (const wait_ms of [-1, 30001, 0.5]) expect((await wait(f, f.head(), wait_ms)).structuredContent.error).toBe("invalid_wait_ms");
    const result = await wait(f);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.events).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(f.handle.credential.session_token);
  });

  test("idle timeout has no last_seen, presence, handoff expiry, lease, acknowledgement or journal writes", async () => {
    const f = fixture();
    const recipient = f.store.startSession({ root_path: f.root, actor: "recipient" });
    const task = f.store.createTaskForSession({ ...f.handle.credential, idempotency_key: "task", title: "fixture only", work_mode: "coordination" });
    const claimed = f.store.claimTaskForSession({ ...f.handle.credential, idempotency_key: "claim", task_id: task.id, expected_version: task.version, ttl_seconds: 30 });
    f.store.offerHandoffForSession({ ...f.handle.credential, idempotency_key: "offer", task_id: task.id,
      expected_version: claimed.version, lease_id: claimed.lease_id!, to_session_id: recipient.session.id, summary: "optional", ttl_seconds: 30 });
    f.store.joinSession({ workspace_id: f.workspace_id, client_instance_id: "presence", actor_label: "route", runtime_kind: "fixture", ttl_seconds: 30 });
    const snapshot = () => Object.fromEntries(["coordination_sessions", "sessions", "tasks", "handoffs", "events", "worktrees", "mutations", "session_cursor_resets"].map(table => [table, f.store.db.query(`SELECT * FROM ${table}`).all()]));
    const before = snapshot();
    const anchor = f.head();
    f.advance();
    const start = performance.now();
    const result = await wait(f, anchor, 140);
    expect(performance.now() - start).toBeGreaterThanOrEqual(130);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.structuredContent).toMatchObject({ events: [], next_anchor: anchor, has_more: false, chain_valid: true, verification_scope: "returned_page" });
    expect(snapshot()).toEqual(before);
    expect(f.store.db.inTransaction).toBe(false);
    expect((f.store as any).eventReader.inTransaction).toBe(false);
    expect(f.store.db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });

  test("presence-only updates and an optional sidecar change do not wake an event wait", async () => {
    const f = fixture();
    const presence = f.store.joinSession({ workspace_id: f.workspace_id, client_instance_id: "presence", actor_label: "route", runtime_kind: "fixture" });
    const anchor = f.head();
    const start = performance.now();
    const pending = wait(f, anchor, 180);
    await sleep(20);
    f.advance();
    f.store.heartbeatSession({ session_id: presence.id, idempotency_key: "heartbeat", expected_version: presence.version });
    writeFileSync(join(f.directory, "fixture-anchor-ledger.json"), "{}");
    const result = await pending;
    expect(performance.now() - start).toBeGreaterThanOrEqual(170);
    expect(result.structuredContent.events).toEqual([]);
    expect(f.head()).toEqual(anchor);
  });

  test("paginates defaults and maximums from next_anchor, never the later head", async () => {
    const f = fixture();
    const anchor = f.head();
    for (let i = 0; i < 61; i++) f.append(`report-${i}`);
    const first = (await wait(f, anchor)).structuredContent as JournalPage;
    expect(first.events).toHaveLength(10);
    expect(first.next_anchor.sequence).toBe(anchor.sequence + 10);
    expect(first.head_sequence).toBe(anchor.sequence + 61);
    expect(first.has_more).toBe(true);
    const second = (await wait(f, first.next_anchor, 0, undefined, 50)).structuredContent as JournalPage;
    expect(second.events).toHaveLength(50);
    const third = f.page(second.next_anchor);
    expect(third.events).toHaveLength(1);
    expect(third.has_more).toBe(false);
    expect(f.store.listCoordinationSessions(f.workspace_id)[0]!.cursor.sequence).toBe(0);
  });

  test("bounds UTF-8 page and complete MCP bytes and never skips an oversized event", async () => {
    const f = fixture();
    const anchor = f.head();
    // Synthetic valid hash-chain rows exercise the reader's bounds independently
    // of the current report-input validator (including legacy/imported data).
    const appendLarge = (key: string, refs: string[]) => f.store.db.transaction(() =>
      (f.store as any).appendEvent(f.workspace_id, "report.posted", key, "fixture", { evidence_refs: refs }, f.handle.session.id),
    ).immediate();
    const refs = Array.from({ length: 65 }, (_, i) => `${i}-${'界"'.repeat(498)}`);
    for (let i = 0; i < 4; i++) appendLarge(`large-${i}`, refs);
    let next = anchor;
    for (let i = 0; i < 4; i++) {
      const result = await wait(f, next, 0, undefined, 50);
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.events).toHaveLength(1);
      expect(Buffer.byteLength(JSON.stringify(result.structuredContent))).toBeLessThanOrEqual(MAX_WAIT_PAGE_BYTES);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MAX_WAIT_RESPONSE_BYTES);
      next = result.structuredContent.next_anchor;
    }
    f.append("small-before-oversized");
    const oversized = appendLarge("oversized", Array.from({ length: 128 }, (_, i) => `${i}-${"界".repeat(1990)}`));
    const partial = await wait(f, next);
    expect(partial.structuredContent.events).toHaveLength(1);
    expect(partial.structuredContent.has_more).toBe(true);
    const failed = await wait(f, partial.structuredContent.next_anchor);
    expect(failed.structuredContent.error).toBe("event_too_large");
    expect(failed.structuredContent.sequence).toBe(oversized.sequence);
    expect(failed.structuredContent.next_anchor).toBeUndefined();
  });

  for (const storedBytes of [MAX_WAIT_ANCHOR_BYTES - 1, MAX_WAIT_ANCHOR_BYTES, MAX_WAIT_ANCHOR_BYTES + 1]) {
    test(`validates processed oversized anchors only within the separate ceiling (${storedBytes} bytes)`, async () => {
      const f = fixture();
      const before = f.head();
      // Synthetic imported row, with the exact preflight sum including metadata.
      const oversized = f.store.db.transaction(() => {
        const event = (f.store as any).appendEvent(f.workspace_id, "report.posted", "large-anchor", "fixture", { body: "" }, f.handle.session.id);
        const { hash: _hash, payload: _payload, ...metadata } = event;
        const metadataBytes = Object.values({ ...metadata, hash: event.hash })
          .reduce<number>((sum, value) => sum + (typeof value === "string" ? Buffer.byteLength(value) : 0), 0);
        event.payload.body = "x".repeat(storedBytes - metadataBytes - Buffer.byteLength(canonicalJson(event.payload)));
        const { hash: _oldHash, ...body } = event;
        event.hash = createHash("sha256").update(canonicalJson(body)).digest("hex");
        f.store.db.query("UPDATE events SET payload_json = ?, hash = ? WHERE workspace_id = ? AND sequence = ?")
          .run(canonicalJson(event.payload), event.hash, f.workspace_id, event.sequence);
        f.store.db.query("UPDATE workspaces SET event_head_hash = ? WHERE id = ?").run(event.hash, f.workspace_id);
        return event;
      }).immediate();
      expect((await wait(f, before)).structuredContent.error).toBe("event_too_large");
      const explicit = await tool(f.server, "collab_events_since", { workspace_id: f.workspace_id, after_anchor: before, limit: 1 });
      expect(explicit.structuredContent.chain_valid).toBe(true);
      expect(explicit.structuredContent.events[0].hash).toBe(oversized.hash);
      const anchor = explicit.structuredContent.next_anchor;
      expect((await tool(f.server, "collab_cursor_ack", { workspace_id: f.workspace_id, anchor, expected_cursor_version: 0 })).isError).toBeUndefined();
      f.append("later-small-anchor");
      const later = f.head();
      const cursorBeforeWait = f.store.listCoordinationSessions(f.workspace_id)[0]!.cursor;
      const result = await wait(f, later);
      expect(f.store.listCoordinationSessions(f.workspace_id)[0]!.cursor).toEqual(cursorBeforeWait);
      if (storedBytes > MAX_WAIT_ANCHOR_BYTES) {
        expect(result.structuredContent).toMatchObject({ error: "event_anchor_too_large", sequence: anchor.sequence, max_anchor_bytes: MAX_WAIT_ANCHOR_BYTES });
        expect(result.structuredContent.next_anchor).toBeUndefined();
        // Invalid JSON of the same size still hits the preflight before parsing.
        f.store.db.query("UPDATE events SET payload_json = '!' || substr(payload_json, 2) WHERE workspace_id = ? AND sequence = ?").run(f.workspace_id, anchor.sequence);
        expect((await wait(f, later)).structuredContent.error).toBe("event_anchor_too_large");
      } else {
        expect(result.isError).toBeUndefined();
        expect(result.structuredContent.events).toEqual([]);
        expect(result.structuredContent.next_anchor).toEqual(later);
        // An oversized event can itself be an observation anchor after processing;
        // only the newer small event is returned, within the unchanged page cap.
        const fromProcessed = await wait(f, anchor);
        expect(fromProcessed.isError).toBeUndefined();
        expect(fromProcessed.structuredContent.events).toHaveLength(1);
        expect(Buffer.byteLength(JSON.stringify(fromProcessed.structuredContent))).toBeLessThan(MAX_WAIT_PAGE_BYTES);
        // Persisted-anchor tampering remains an integrity failure.
        f.store.db.query("UPDATE events SET payload_json = replace(payload_json, 'x', 'y') WHERE workspace_id = ? AND sequence = ?").run(f.workspace_id, anchor.sequence);
        expect((await wait(f, later)).structuredContent.error).toBe("cursor_reset_required");
        f.store.db.query("UPDATE events SET payload_json = ? WHERE workspace_id = ? AND sequence = ?").run(canonicalJson(oversized.payload), f.workspace_id, anchor.sequence);
        // Keep the persisted cursor small to independently exercise last_cursor.
        const ack = await tool(f.server, "collab_cursor_ack", { workspace_id: f.workspace_id, anchor: later, expected_cursor_version: 1 });
        expect(ack.isError).toBeUndefined();
        const hostInput = { ...f.handle.credential, last_cursor: anchor, workspace_id: f.workspace_id, after_anchor: later };
        expect(f.store.eventsAfterAnchorForSession(hostInput).chain_valid).toBe(true);
        // Noncanonical-but-equivalent JSON remains valid under the size ceiling.
        if (storedBytes < MAX_WAIT_ANCHOR_BYTES) {
          f.store.db.query("UPDATE events SET payload_json = ' ' || payload_json WHERE workspace_id = ? AND sequence = ?").run(f.workspace_id, anchor.sequence);
          expect(f.store.eventsAfterAnchorForSession(hostInput).chain_valid).toBe(true);
          f.store.db.query("UPDATE events SET payload_json = substr(payload_json, 2) WHERE workspace_id = ? AND sequence = ?").run(f.workspace_id, anchor.sequence);
        }
        f.store.db.query("UPDATE events SET payload_json = replace(payload_json, 'x', 'y') WHERE workspace_id = ? AND sequence = ?").run(f.workspace_id, anchor.sequence);
        expect(() => f.store.eventsAfterAnchorForSession(hostInput)).toThrow("explicit reconciliation");
      }
    });
  }

  test("caps error JSON as well as successful pages when stored cursor metadata is malformed", async () => {
    const f = fixture();
    f.store.db.query("UPDATE coordination_sessions SET cursor_hash = ?, cursor_recovery_required = 1 WHERE id = ?")
      .run("f".repeat(MAX_WAIT_RESPONSE_BYTES), f.handle.session.id);
    const result = await wait(f);
    expect(result.structuredContent.error).toBe("event_page_too_large");
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(MAX_WAIT_RESPONSE_BYTES);
  });

  test("an in-memory observation refuses an uncommitted transaction and a closed store", () => {
    const f = fixture();
    const store = new CollabStore(":memory:");
    try {
      const handle = store.startSession({ root_path: f.root, actor: "memory-observer" });
      const input = { ...handle.credential, workspace_id: handle.workspace.id, after_anchor: handle.session.cursor };
      expect(store.eventsAfterAnchorForSession(input).chain_valid).toBe(true);
      store.db.transaction(() => {
        expect(() => store.eventsAfterAnchorForSession(input)).toThrow("Finish the active transaction");
      })();
      store.close();
      expect(() => store.eventsAfterAnchorForSession(input)).toThrow("store is closed");
    } finally {
      store.close();
    }
  });

  test("observes actual independent-process appends, not an in-process notifier", async () => {
    const f = fixture();
    let anchor = f.head();
    const pending = wait(f, anchor, 2000);
    const child = await worker(f, "append");
    const output = JSON.parse(await new Response(child.stdout).text());
    expect(await child.exited).toBe(0);
    const first = await pending;
    expect(first.isError).toBeUndefined();
    const events = [...first.structuredContent.events];
    anchor = first.structuredContent.next_anchor;
    if (!events.some(event => event.entity_id === output.report_id)) events.push(...(await wait(f, anchor)).structuredContent.events);
    expect(events.some(event => event.entity_id === output.report_id && event.session_id === output.session_id)).toBe(true);
    expect(output.session_id).not.toBe(f.handle.session.id);
    expect(f.store.listCoordinationSessions(f.workspace_id).find(session => session.id === f.handle.session.id)!.cursor.sequence).toBe(0);
  });

  test("cancels timers and cleans up close and transport-close waits", async () => {
    const f = fixture();
    const controller = new AbortController();
    const pending = wait(f, f.head(), 30000, controller.signal);
    await sleep(10);
    const start = performance.now();
    controller.abort();
    expect((await pending).structuredContent.error).toBe("wait_cancelled");
    expect(performance.now() - start).toBeLessThan(300);
    const alreadyAborted = await wait(f, f.head(), 30000, controller.signal);
    expect(alreadyAborted.structuredContent.error).toBe("wait_cancelled");
    const closing = wait(f, f.head(), 30000);
    await f.server.close();
    expect((await closing).structuredContent.error).toBe("server_closed");
    const other = fixture();
    const disconnecting = wait(other, other.head(), 30000);
    other.server.server.onclose?.();
    expect((await disconnecting).structuredContent.error).toBe("server_closed");
  });

  for (const stop of ["request cancellation", "stdin EOF"] as const) {
  test(`the bundled stdio protocol validates bounds and stops real waits on ${stop}`, async () => {
    const f = fixture();
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../dist/agenttool-collab-mcp.js")], {
      env: { PATH: process.env.PATH ?? "", HOME: f.directory, TMPDIR: "/tmp", AGENTOOL_COLLAB_DB: f.path },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    cleanup.push(async () => { child.kill(); await child.exited; });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const send = async (message: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
      await child.stdin.flush();
    };
    const receive = async (id: number): Promise<any> => {
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const message = JSON.parse(line);
          if (message.id === id) return message;
        } else {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("stdio closed before the response");
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      }
    };
    const call = async (id: number, name: string, args: Record<string, unknown>) => {
      await send({ id, method: "tools/call", params: { name, arguments: args } });
      return receive(id);
    };
    await send({ id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } });
    expect((await receive(1)).result.serverInfo.version).toBe("0.4.1-dev.0");
    await send({ method: "notifications/initialized", params: {} });
    const start = await call(2, "collab_session_start", { root_path: f.root, actor: "stdio-observer" });
    expect(start.result.isError).toBeUndefined();
    const args = { workspace_id: f.workspace_id, after_anchor: f.head() };
    const invalid = await call(3, "collab_events_wait", { ...args, event_limit: 51, wait_ms: 0 });
    expect(Boolean(invalid.error || invalid.result?.isError)).toBe(true);
    for (let id = 10; id < 18; id++) await send({ id, method: "tools/call", params: { name: "collab_events_wait", arguments: args } });
    const full = await call(20, "collab_events_wait", { ...args, wait_ms: 0 });
    expect(full.result.structuredContent.error).toBe("too_many_waits");
    if (stop === "stdin EOF") {
      // The full-slot response proves all eight default 30-second waits really
      // entered the bundled runtime before the input pipe is disconnected.
      const began = performance.now();
      child.stdin.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const exit = await Promise.race([
          child.exited,
          new Promise(resolve => { timer = setTimeout(() => resolve("still running"), 1000); }),
        ]);
        expect(exit).toBe(0);
        expect(performance.now() - began).toBeLessThan(1000);
      } finally {
        clearTimeout(timer);
      }
      expect(await new Response(child.stderr).text()).not.toContain("error");
      return;
    }
    for (let requestId = 10; requestId < 18; requestId++) await send({ method: "notifications/cancelled", params: { requestId, reason: "fixture stop" } });
    await sleep(30);
    const result = await call(21, "collab_events_wait", { ...args, wait_ms: 0 });
    expect(result.result.isError).toBeUndefined();
    expect(result.result.structuredContent.events).toEqual([]);
    expect(result.result.structuredContent.next_anchor).toEqual(args.after_anchor);
  });
  }

  test("bounds outstanding endpoint waits and releases slots after cancellation", async () => {
    const f = fixture();
    const controller = new AbortController();
    const pending = Array.from({ length: 8 }, () => wait(f, f.head(), 30000, controller.signal));
    expect((await wait(f)).structuredContent.error).toBe("too_many_waits");
    controller.abort();
    expect((await Promise.all(pending)).every(result => result.structuredContent.error === "wait_cancelled")).toBe(true);
    expect((await wait(f)).isError).toBeUndefined();
  });

  for (const mode of ["end", "resume", "recovery"] as const) {
    test(`rechecks ${mode} committed by another process while waiting`, async () => {
      const f = fixture();
      const pending = wait(f, f.head(), 2000);
      const child = await worker(f, mode);
      child.stdin.write(JSON.stringify(f.handle.credential));
      child.stdin.end();
      expect(await child.exited).toBe(0);
      expect((await pending).structuredContent.error).toBe(mode === "recovery" ? "cursor_recovery_required" : "session_auth_failed");
    });
  }

  test("rechecks a newly acknowledged host cursor after a later persisted cursor rollback", async () => {
    const f = fixture();
    const anchor = f.head();
    const pending = wait(f, anchor, 1000);
    await tool(f.server, "collab_cursor_ack", { workspace_id: f.workspace_id, anchor, expected_cursor_version: 0 });
    f.store.db.query("UPDATE coordination_sessions SET cursor_sequence = 0, cursor_hash = ? WHERE id = ?")
      .run("0".repeat(64), f.handle.session.id);
    expect((await pending).structuredContent.error).toBe("cursor_reset_required");
  });

  test("stops on exact-anchor fork, epoch mismatch, rollback, missing events and malformed payloads", async () => {
    const f = fixture();
    const anchor = f.head();
    expect((await wait(f, { ...anchor, hash: "f".repeat(64) })).structuredContent.error).toBe("cursor_fork_detected");
    expect((await wait(f, { ...anchor, epoch_id: "wrong" })).structuredContent.error).toBe("cursor_mismatch");
    expect((await wait(f, { ...anchor, sequence: anchor.sequence + 1 })).structuredContent.error).toBe("cursor_ahead");
    const report = f.append("corrupt-me");
    f.store.db.query("UPDATE events SET payload_json = ? WHERE workspace_id = ? AND sequence = ?").run("{", f.workspace_id, report.event_sequence);
    expect((await wait(f, anchor)).structuredContent.error).toBe("database_journal_invalid");
    f.store.db.query("DELETE FROM events WHERE workspace_id = ? AND sequence = ?").run(f.workspace_id, report.event_sequence);
    expect((await wait(f, anchor)).structuredContent.error).toBe("database_journal_invalid");
    f.store.db.query("UPDATE workspaces SET event_head_sequence = ? WHERE id = ?").run(anchor.sequence - 1, f.workspace_id);
    expect((await wait(f, anchor)).structuredContent.error).toBe("cursor_ahead");
  });

  test("uses one page/auth/anchor snapshot, then rechecks committed generation before returning", () => {
    const f = fixture();
    const peer = secondConnection(f);
    const anchor = f.head();
    f.append("before-snapshot");
    const expected = f.head();
    const original = (f.store as any).readEventPage.bind(f.store);
    (f.store as any).readEventPage = (...args: any[]) => {
      // This write is possible only because observation holds no write lock.
      peer.query("UPDATE coordination_sessions SET generation = generation + 1 WHERE id = ?").run(f.handle.session.id);
      const page = original(...args);
      expect(page.head_sequence).toBe(expected.sequence);
      expect(page.events).toHaveLength(1);
      return page;
    };
    expect(() => f.page(anchor)).toThrow("Session credentials are invalid");
    expect((f.store as any).eventReader.inTransaction).toBe(false);
  });

  test("keeps the page snapshot stable while another connection appends", () => {
    const f = fixture();
    const peer = new CollabStore(f.path);
    cleanup.push(() => peer.close());
    const anchor = f.head();
    const original = (f.store as any).readEventPage.bind(f.store);
    (f.store as any).readEventPage = (...args: any[]) => {
      peer.appendReportForSession({ ...f.handle.credential, idempotency_key: "snapshot-append", kind: "observation", body: "later" });
      return original(...args);
    };
    const page = f.page(anchor);
    expect(page.events).toEqual([]);
    expect(page.head_sequence).toBe(anchor.sequence);
    expect(f.head().sequence).toBe(anchor.sequence + 1);
    (f.store as any).readEventPage = original;
    expect(f.page(anchor).events).toHaveLength(1);
  });

  for (const change of ["recovery", "cursor", "rollback", "fork"] as const) {
    test(`rejects ${change} between the page and final read snapshot`, () => {
      const f = fixture();
      const peer = secondConnection(f);
      const anchor = f.head();
      f.append("page-event");
      f.append("unreturned-head");
      const original = (f.store as any).readEventPage.bind(f.store);
      (f.store as any).readEventPage = (...args: any[]) => {
        const page = original(...args);
        if (change === "recovery") peer.query("UPDATE coordination_sessions SET cursor_recovery_required = 1 WHERE id = ?").run(f.handle.session.id);
        if (change === "cursor") peer.query("UPDATE coordination_sessions SET cursor_hash = ? WHERE id = ?").run("f".repeat(64), f.handle.session.id);
        if (change === "rollback") peer.query("UPDATE workspaces SET event_head_sequence = ? WHERE id = ?").run(page.next_anchor.sequence, f.workspace_id);
        if (change === "fork") peer.query("UPDATE events SET hash = ? WHERE workspace_id = ? AND sequence = ?").run("f".repeat(64), f.workspace_id, page.head_sequence);
        return page;
      };
      expect(() => f.page(anchor, 1)).toThrow();
      expect((f.store as any).eventReader.inTransaction).toBe(false);
    });
  }

  test("WAL writer contention does not block the read or change the writer busy timeout", async () => {
    const f = fixture();
    const child = await worker(f, "lock");
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("locked");
    const start = performance.now();
    expect((await wait(f)).isError).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(300);
    expect(f.store.db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    child.stdin.end();
    expect(await child.exited).toBe(0);
  });

  test("exclusive read locks are nonblocking, bounded, cancellable and retry after release", async () => {
    const f = fixture();
    const anchor = f.head();
    f.store.db.exec("PRAGMA journal_mode = DELETE");
    const child = await worker(f, "lock");
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("locked");
    const immediate = performance.now();
    expect((await wait(f, anchor)).structuredContent.error).toBe("event_read_busy");
    expect(performance.now() - immediate).toBeLessThan(300);
    const timed = performance.now();
    expect((await wait(f, anchor, 120)).structuredContent.error).toBe("event_read_busy");
    expect(performance.now() - timed).toBeLessThan(1000);
    const controller = new AbortController();
    // Use the pre-lock anchor: the ordinary mutation connection intentionally
    // retains its 5-second busy handler and is not part of the wait path.
    const pending = wait(f, anchor, 30000, controller.signal);
    await sleep(10);
    controller.abort();
    expect((await pending).structuredContent.error).toBe("wait_cancelled");
    const closingServer = buildCollabMcpServer(f.store, { resumed_session: {
      handle: f.handle, credential_file: join(f.directory, "unused.json"),
    } });
    const closing = tool(closingServer, "collab_events_wait", { workspace_id: f.workspace_id, after_anchor: anchor });
    await closingServer.close();
    expect((await closing).structuredContent.error).toBe("server_closed");
    const retrying = wait(f, anchor, 500);
    child.stdin.end();
    expect(await child.exited).toBe(0);
    expect((await retrying).isError).toBeUndefined();
    expect(f.store.db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });
});
