import { afterEach, describe, expect, test } from "bun:test";
import { journal, runCleanup } from "./notes-helpers.js";

// time/1 step 4 (torrent idea 1): an optional compare-and-swap on report append,
// after BitTorrent BEP 44's `cas`. The caller names the journal head it last
// read; if anything was posted since, nothing is written and the refusal says
// how far the journal moved, so two agents writing at once cannot cross unseen.

afterEach(runCleanup);

function head(j: ReturnType<typeof journal>, workspaceId: string): number {
  return (j.store.db.query(`SELECT event_head_sequence AS head FROM workspaces WHERE id = ?`).get(workspaceId) as { head: number }).head;
}

function append(j: ReturnType<typeof journal>, who: ReturnType<ReturnType<typeof journal>["start"]>, key: string, extra: Record<string, unknown> = {}) {
  return j.store.appendReportForSession({ ...who.credential, idempotency_key: key, kind: "observation", body: `note ${key}`, ...extra });
}

describe("collab_report_append expected_head_sequence", () => {
  test("writes when the journal head is where the caller last read it", () => {
    const j = journal();
    const me = j.start("me");
    const at = head(j, me.workspace.id);
    const report = append(j, me, "first", { expected_head_sequence: at });
    expect(report.body).toBe("note first");
    expect(head(j, me.workspace.id)).toBeGreaterThan(at);
  });

  test("refuses, writes nothing and says how far the journal moved when a peer posted first", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const seen = head(j, me.workspace.id);
    append(j, peer, "peer-first");
    const moved = head(j, me.workspace.id);
    const before = j.count();
    let refusal: any;
    try {
      append(j, me, "mine", { expected_head_sequence: seen });
    } catch (error) {
      refusal = error;
    }
    expect(refusal?.code).toBe("head_moved");
    expect(refusal.details).toEqual({ expected_head_sequence: seen, head_sequence: moved, events_since: moved - seen });
    expect(j.count()).toBe(before);
    // Re-read and send again, under the same key: the refused attempt left no receipt.
    const sent = append(j, me, "mine", { expected_head_sequence: moved });
    expect(sent.body).toBe("note mine");
  });

  test("refuses an expected head that is ahead of the journal", () => {
    const j = journal();
    const me = j.start("me");
    const at = head(j, me.workspace.id);
    expect(() => append(j, me, "ahead", { expected_head_sequence: at + 5 })).toThrow("ahead of the journal");
  });

  test("a retry with the same key replays its first answer, even after the journal moved", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const at = head(j, me.workspace.id);
    const first = append(j, me, "once", { expected_head_sequence: at });
    append(j, peer, "later");
    const replay = append(j, me, "once", { expected_head_sequence: at });
    expect(replay.id).toBe(first.id);
  });

  test("without the field, nothing changes", () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    append(j, peer, "peer");
    expect(append(j, me, "plain").body).toBe("note plain");
    expect(() => append(j, me, "bad", { expected_head_sequence: -1 })).toThrow("non-negative integer");
  });

  test("the MCP tool takes the field and returns the refusal with its details", async () => {
    const j = journal();
    const me = j.start("me");
    const peer = j.start("peer");
    const server = j.serve(me);
    const tool = (server as any)._registeredTools.collab_report_append;
    const seen = head(j, me.workspace.id);
    append(j, peer, "peer-first");
    const refused = await tool.handler({
      workspace_id: me.workspace.id, idempotency_key: "via-mcp", kind: "observation", body: "crossed", expected_head_sequence: seen,
    }, {});
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error).toBe("head_moved");
    expect(refused.structuredContent.events_since).toBeGreaterThan(0);
  });
});
