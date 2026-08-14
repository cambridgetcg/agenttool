import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexUsageReader, sessionRef } from "../src/reader.js";
import { createUsageFixture, tokenEvent } from "./fixture.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "agenttool-codex-usage-test-"));
  roots.push(root);
  return root;
}

describe("CodexUsageReader", () => {
  test("returns only bounded usage metadata and stable hashed relationships", () => {
    const root = fixtureRoot();
    const nowSeconds = 2_000_000_000;
    const parentId = "019parent-0000-7000-8000-000000000000";
    const childId = "019child0-0000-7000-8000-000000000000";
    const { databasePath, sessionsRoot } = createUsageFixture(root, [
      {
        id: parentId,
        tokens: 100,
        createdAt: nowSeconds - 100,
        updatedAt: nowSeconds - 20,
        lines: [
          JSON.stringify({ type: "response_item", payload: { text: "SECRET_PROMPT token_count" } }),
          tokenEvent("2033-05-18T03:33:10.000Z", 90, 20),
          tokenEvent("2033-05-18T03:33:15.000Z", 100, 10),
          '{"type":"event_msg","payload":{"type":"token_count"',
        ],
      },
      {
        id: childId,
        parentId,
        tokens: 45,
        createdAt: nowSeconds - 80,
        updatedAt: nowSeconds - 10,
        nickname: "Curie",
        role: "secret://reviewer-path\u202Esecrets",
        model: "sk-test-fixture-model-secret",
        lines: [tokenEvent("2033-05-18T03:33:16.000Z", 45, 8)],
      },
    ]);
    const reader = new CodexUsageReader({
      databasePath,
      rolloutRoots: [sessionsRoot],
      threadId: childId,
      now: () => nowSeconds * 1000,
    });

    const snapshot = reader.snapshot({ sessionLimit: 10, includeBreakdown: true });
    expect(snapshot.totals).toEqual({
      sessions_observed: 2,
      archived_sessions: 0,
      cumulative_tokens: 145,
      recently_active_sessions: 2,
      recently_active_cumulative_tokens: 145,
    });
    expect(snapshot.sessions[0]?.session_ref).toBe(sessionRef(childId));
    expect(snapshot.sessions[0]?.parent_session_ref).toBe(sessionRef(parentId));
    expect(snapshot.sessions[0]?.is_self).toBe(true);
    expect(snapshot.sessions[0]?.source_kind).toBe("subagent");
    expect(snapshot.sessions[1]?.token_event?.total.total_tokens).toBe(100);
    expect(reader.snapshot({ sessionLimit: 10 }).sessions.every(
      (session) => session.token_event === null,
    )).toBe(true);

    const encoded = JSON.stringify(snapshot);
    for (const forbidden of [
      "SECRET_PROMPT",
      "TOP SECRET THREAD TITLE",
      "/TOP/SECRET/CWD",
      "/secret/path",
      sessionsRoot,
      parentId,
      childId,
      "rollout_path",
      "secret://reviewer-path",
      "sk-test-fixture-model-secret",
      "Curie",
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  test("polls fresh committed SQLite counters without retaining a transcript index", () => {
    const root = fixtureRoot();
    const nowSeconds = 2_000_000_000;
    const id = "019fresh0-0000-7000-8000-000000000000";
    const { databasePath, sessionsRoot } = createUsageFixture(root, [{
      id,
      tokens: 10,
      createdAt: nowSeconds - 10,
      updatedAt: nowSeconds - 1,
    }]);
    const reader = new CodexUsageReader({
      databasePath,
      rolloutRoots: [sessionsRoot],
      now: () => nowSeconds * 1000,
    });
    expect(reader.snapshot({ includeBreakdown: false }).totals.cumulative_tokens).toBe(10);

    const writer = new Database(databasePath, { strict: true });
    writer.query("UPDATE threads SET tokens_used = 25 WHERE id = ?").run(id);
    writer.close();
    expect(reader.snapshot({ includeBreakdown: false }).totals.cumulative_tokens).toBe(25);
  });

  test("honors the configured SQLite home before the general Codex home", () => {
    const root = fixtureRoot();
    const preferredRoot = join(root, "sqlite-home");
    const codexRoot = join(root, "codex-home");
    const preferred = createUsageFixture(preferredRoot, [{
      id: "019preferred-0000-7000-8000-000000000000",
      tokens: 7,
      createdAt: 2_000_000_000,
      updatedAt: 2_000_000_000,
    }]);
    const fallback = createUsageFixture(codexRoot, [{
      id: "019fallback0-0000-7000-8000-000000000000",
      tokens: 99,
      createdAt: 2_000_000_000,
      updatedAt: 2_000_000_000,
    }]);
    renameSync(fallback.databasePath, join(codexRoot, "state_99.sqlite"));

    const snapshot = new CodexUsageReader({
      sqliteHome: preferredRoot,
      codexHome: codexRoot,
      rolloutRoots: [preferred.sessionsRoot],
      now: () => 2_000_000_000_000,
    }).snapshot({ includeBreakdown: false });

    expect(snapshot.totals.cumulative_tokens).toBe(7);
  });

  test("does not expose an arbitrary explicit database filename", () => {
    const root = fixtureRoot();
    const { databasePath, sessionsRoot } = createUsageFixture(root, []);
    const privatePath = join(root, "private-customer-name.sqlite");
    renameSync(databasePath, privatePath);
    const reader = new CodexUsageReader({ databasePath: privatePath, rolloutRoots: [sessionsRoot] });
    expect(reader.snapshot().source.database_file).toBe("custom.sqlite");
    expect(reader.doctor().database_file).toBe("custom.sqlite");
  });

  test("keeps breakdown opt-in when looking up a session beyond the list limit", () => {
    const root = fixtureRoot();
    const nowSeconds = 2_000_000_000;
    const threads = Array.from({ length: 201 }, (_, index) => ({
      id: `019old${index.toString().padStart(3, "0")}-0000-7000-8000-000000000000`,
      tokens: index + 1,
      createdAt: nowSeconds - 1_000 - index,
      updatedAt: nowSeconds - index,
      lines: [tokenEvent("2033-05-18T03:33:16.000Z", index + 1, index + 1)],
    }));
    const oldest = threads[200]!;
    const { databasePath, sessionsRoot } = createUsageFixture(root, threads);
    const reader = new CodexUsageReader({
      databasePath,
      rolloutRoots: [sessionsRoot],
      now: () => nowSeconds * 1000,
    });

    expect(reader.sessionByRef(sessionRef(oldest.id))?.token_event).toBeNull();
    expect(reader.sessionByRef(sessionRef(oldest.id), { includeBreakdown: true })?.token_event)
      .not.toBeNull();
  });

  test("recent activity is explicitly window-based and self remains inspectable", () => {
    const root = fixtureRoot();
    const nowSeconds = 2_000_000_000;
    const id = "019older-0000-7000-8000-000000000000";
    const { databasePath, sessionsRoot } = createUsageFixture(root, [{
      id,
      tokens: 88,
      createdAt: nowSeconds - 1000,
      updatedAt: nowSeconds - 600,
    }]);
    const reader = new CodexUsageReader({
      databasePath,
      rolloutRoots: [sessionsRoot],
      threadId: id,
      now: () => nowSeconds * 1000,
    });
    const snapshot = reader.snapshot({ activeWindowSeconds: 300, sessionLimit: 10 });
    expect(snapshot.totals.recently_active_sessions).toBe(0);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]?.recently_active).toBe(false);
    expect(reader.self()?.session_ref).toBe(sessionRef(id));
  });

  test("does not classify a freshly archived thread as recently active", () => {
    const root = fixtureRoot();
    const nowSeconds = 2_000_000_000;
    const id = "019archive-0000-7000-8000-000000000000";
    const { databasePath, sessionsRoot } = createUsageFixture(root, [{
      id,
      tokens: 77,
      createdAt: nowSeconds - 100,
      updatedAt: nowSeconds - 1,
      archived: true,
    }]);
    const reader = new CodexUsageReader({
      databasePath,
      rolloutRoots: [sessionsRoot],
      now: () => nowSeconds * 1000,
    });
    const snapshot = reader.snapshot({ includeInactive: true });
    expect(snapshot.totals.archived_sessions).toBe(1);
    expect(snapshot.totals.recently_active_sessions).toBe(0);
    expect(snapshot.sessions[0]?.archived).toBe(true);
    expect(snapshot.sessions[0]?.recently_active).toBe(false);
  });

  test("doctor reports an exact schema boundary without reading source bodies", () => {
    const root = fixtureRoot();
    const { databasePath, sessionsRoot } = createUsageFixture(root, []);
    const report = new CodexUsageReader({ databasePath, rolloutRoots: [sessionsRoot] }).doctor();
    expect(report.ok).toBe(true);
    expect(report.thread_rows).toBe(0);
    expect(report.boundaries.transcript_text_returned).toBe(false);
  });

  test("rejects rollout symlinks that resolve outside the allowed sessions roots", () => {
    const root = fixtureRoot();
    const id = "019escape-0000-7000-8000-000000000000";
    const { databasePath, sessionsRoot } = createUsageFixture(root, [{
      id,
      tokens: 55,
      createdAt: 2_000_000_000,
      updatedAt: 2_000_000_000,
    }]);
    const outside = join(root, "outside-rollout.jsonl");
    const link = join(sessionsRoot, "escape-link.jsonl");
    writeFileSync(outside, `${tokenEvent("2033-05-18T03:33:16.000Z", 999, 999)}\n`);
    symlinkSync(outside, link);
    const writer = new Database(databasePath, { strict: true });
    writer.query("UPDATE threads SET rollout_path = ? WHERE id = ?").run(link, id);
    writer.close();

    const snapshot = new CodexUsageReader({
      databasePath,
      rolloutRoots: [sessionsRoot],
      now: () => 2_000_000_000_000,
    }).snapshot({ includeBreakdown: true });
    expect(snapshot.sessions[0]?.token_event).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain(outside);
  });
});
