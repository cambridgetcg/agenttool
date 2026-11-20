import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForSessionEvents } from "../src/host.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabStore } from "../src/store-notes.js";

// time/1 (C3): every Collab result and every host wait receipt names the
// journal store's clock as `observed_at`, so agents on any harness that read
// the same journal share one "now" and can measure their own clocks against it.

const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function fixture(start = "2026-11-19T15:50:00.000Z") {
  const directory = mkdtempSync(join(tmpdir(), "collab-observed-at-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  let currentTime = Date.parse(start);
  const store = new CollabStore(join(directory, "collab.sqlite"), { now: () => new Date(currentTime) });
  const server = buildCollabMcpServer(store);
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const advance = (ms: number) => {
    currentTime += ms;
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const registration = (server as any)._registeredTools[name];
    if (!registration) throw new Error(`tool not registered: ${name}`);
    return await (registration.handler ?? registration.callback)(args, {});
  };
  return { root, store, call, advance };
}

test("a success result names the store clock's now first, in structured and text form alike", async () => {
  const { root, call } = fixture();
  const result = await call("collab_workspace_open", { root_path: root, actor: "observer" });
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent.observed_at).toBe("2026-11-19T15:50:00.000Z");
  expect(Object.keys(result.structuredContent)[0]).toBe("observed_at");
  const text = JSON.parse(result.content[0].text);
  expect(text).toEqual(result.structuredContent);
  // Pretty JSON stays pretty: the stamp changes no formatting.
  expect(result.content[0].text).toContain("\n  \"observed_at\": ");
});

test("the stamp follows the clock, and an error result carries it too", async () => {
  const { root, call, advance } = fixture();
  const first = await call("collab_workspace_open", { root_path: root, actor: "observer" });
  advance(90_000);
  const refused = await call("collab_task_get", { workspace_id: "ws_missing", task_id: "nothing" });
  expect(refused.isError).toBe(true);
  expect(refused.structuredContent.error).toBeString();
  expect(refused.structuredContent.observed_at).toBe("2026-11-19T15:51:30.000Z");
  expect(Date.parse(refused.structuredContent.observed_at) - Date.parse(first.structuredContent.observed_at)).toBe(90_000);
});

test("every stamp is canonical UTC, also from a real clock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "collab-observed-at-real-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  const store = new CollabStore(join(directory, "collab.sqlite"));
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const server = buildCollabMcpServer(store);
  const before = Date.now();
  const result = await (server as any)._registeredTools.collab_workspace_open.handler({ root_path: root, actor: "observer" }, {});
  const after = Date.now();
  expect(result.structuredContent.observed_at).toMatch(CANONICAL_UTC);
  const at = Date.parse(result.structuredContent.observed_at);
  expect(at).toBeGreaterThanOrEqual(before);
  expect(at).toBeLessThanOrEqual(after);
});

test("a Notes result that already names observed_at keeps its own, with no second key", async () => {
  const { root, call } = fixture();
  const arrived = await call("collab_arrive", { purpose: "time/1 check", root_path: root });
  // Whatever the verb answers, the text holds exactly one observed_at.
  const text: string = arrived.content[0].text;
  const occurrences = text.split("\"observed_at\"").length - 1;
  expect(occurrences).toBeLessThanOrEqual(1);
  if (arrived.structuredContent && typeof arrived.structuredContent === "object") {
    expect(Object.keys(arrived.structuredContent).filter((key) => key === "observed_at").length).toBeLessThanOrEqual(1);
  }
});

test("a host wait receipt names the store clock's now", () => {
  const { root, store } = fixture("2026-11-19T16:00:00.000Z");
  const handle = store.startSession({ root_path: root, actor: "waiter" });
  const receipt = waitForSessionEvents(store, handle.credential, {
    wait_ms: 0,
    include_own: false,
    addressed: true,
  });
  expect(receipt.status).toBe("idle");
  expect(receipt.observed_at).toBe("2026-11-19T16:00:00.000Z");
  expect(receipt.waited_ms).toBeGreaterThanOrEqual(0);
});
