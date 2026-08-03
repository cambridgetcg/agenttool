import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANCHOR_LEDGER_PROTOCOL,
  anchorStatusForWorkspace,
  defaultAnchorLedgerPath,
} from "../src/anchor-status.js";
import { CollabError } from "../src/errors.js";
import { CollabStore } from "../src/store.js";

function freshRepoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "collab-anchor-status-"));
  const init = Bun.spawnSync({ cmd: ["git", "init", "-q", dir], stdout: "pipe", stderr: "pipe" });
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.toString()}`);
  return dir;
}

function fixture() {
  const repo = freshRepoDir();
  const dbPath = join(mkdtempSync(join(tmpdir(), "collab-anchor-db-")), "journal.sqlite");
  const store = new CollabStore(dbPath);
  const workspace = store.openWorkspace({ root_path: repo, actor: "anchor-tester" });
  store.recordDecision({
    workspace_id: workspace.id,
    actor: "anchor-tester",
    idempotency_key: "anchor-d1",
    topic: "anchor status",
    decision: "fixture decision",
  });
  const refreshed = store.getWorkspace(workspace.id)!;
  const ledgerDir = mkdtempSync(join(tmpdir(), "collab-anchor-ledger-"));
  return { store, dbPath, workspace: refreshed, ledgerPath: join(ledgerDir, "anchors.json") };
}

function writeLedger(path: string, anchors: unknown[]): void {
  writeFileSync(path, JSON.stringify({
    protocol: ANCHOR_LEDGER_PROTOCOL,
    updated_at: "2026-08-01T00:00:00.000Z",
    anchors,
  }));
}

function anchorEntry(workspace: { id: string; epoch_id: string }, fields: Record<string, unknown>) {
  return {
    id: "anchor_test",
    workspace_id: workspace.id,
    epoch_id: workspace.epoch_id,
    network: "zerone-testnet-1",
    caip2: "cosmos:zerone-testnet-1",
    account: "zrn1test",
    memo: "m",
    tx_hash: "AB12",
    status: "confirmed",
    submitted_at: "2026-08-01T00:00:00.000Z",
    ...fields,
  };
}

describe("collab_anchor_status backing logic", () => {
  test("missing ledger file → unanchored, fail-open", () => {
    const { store, workspace, ledgerPath } = fixture();
    const status = anchorStatusForWorkspace(store, workspace.id, ledgerPath);
    expect(status.status).toBe("unanchored");
    expect(status.ledger_readable).toBe(false);
    expect(status.head_sequence).toBe(workspace.event_head_sequence);
  });

  test("corrupt ledger → unanchored, fail-open, never throws", () => {
    const { store, workspace, ledgerPath } = fixture();
    writeFileSync(ledgerPath, "{not json");
    expect(anchorStatusForWorkspace(store, workspace.id, ledgerPath).status).toBe("unanchored");
    writeFileSync(ledgerPath, JSON.stringify({ protocol: "wrong/1", anchors: [] }));
    expect(anchorStatusForWorkspace(store, workspace.id, ledgerPath).ledger_readable).toBe(false);
  });

  test("confirmed anchor at the current head → anchored", () => {
    const { store, workspace, ledgerPath } = fixture();
    writeLedger(ledgerPath, [anchorEntry(workspace, {
      sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
    })]);
    const status = anchorStatusForWorkspace(store, workspace.id, ledgerPath);
    expect(status.status).toBe("anchored");
    expect(status.lag_events).toBe(0);
    expect(status.anchor?.tx_hash).toBe("AB12");
  });

  test("confirmed anchor behind head with intact history → anchor_stale", () => {
    const { store, workspace, ledgerPath } = fixture();
    const page = store.eventsSince(workspace.id, 0, 1);
    const first = page.events[0]!;
    writeLedger(ledgerPath, [anchorEntry(workspace, { sequence: first.sequence, head_hash: first.hash })]);
    const status = anchorStatusForWorkspace(store, workspace.id, ledgerPath);
    expect(status.status).toBe("anchor_stale");
    expect(status.lag_events).toBe(workspace.event_head_sequence - first.sequence);
  });

  test("anchored hash that no longer matches the journal → anchor_conflict", () => {
    const { store, workspace, ledgerPath } = fixture();
    writeLedger(ledgerPath, [anchorEntry(workspace, {
      sequence: 1,
      head_hash: "ee".repeat(32),
    })]);
    expect(anchorStatusForWorkspace(store, workspace.id, ledgerPath).status).toBe("anchor_conflict");
  });

  test("submitted-only anchors → anchor_pending; other epochs are ignored", () => {
    const { store, workspace, ledgerPath } = fixture();
    writeLedger(ledgerPath, [
      anchorEntry(workspace, {
        sequence: workspace.event_head_sequence,
        head_hash: workspace.event_head_hash,
        status: "submitted",
      }),
      anchorEntry(workspace, {
        epoch_id: "epoch_other",
        sequence: 99,
        head_hash: "ff".repeat(32),
      }),
    ]);
    expect(anchorStatusForWorkspace(store, workspace.id, ledgerPath).status).toBe("anchor_pending");
  });

  test("all attempts definitively failed → unanchored, not pending", () => {
    const { store, workspace, ledgerPath } = fixture();
    writeLedger(ledgerPath, [anchorEntry(workspace, {
      sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
      status: "failed",
    })]);
    const status = anchorStatusForWorkspace(store, workspace.id, ledgerPath);
    expect(status.status).toBe("unanchored");
    expect(status.reason).toContain("definitively failed");
  });

  test("history rewritten BELOW the anchored sequence → anchor_conflict (full recompute, not a one-page probe)", () => {
    const { store, dbPath, workspace, ledgerPath } = fixture();
    // Confirmed anchor at the current head, then grow the journal past it.
    writeLedger(ledgerPath, [anchorEntry(workspace, {
      sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
    })]);
    store.recordDecision({
      workspace_id: workspace.id,
      actor: "anchor-tester",
      idempotency_key: "anchor-d2",
      topic: "growth",
      decision: "one more event after the anchor",
    });
    expect(anchorStatusForWorkspace(store, workspace.id, ledgerPath).status).toBe("anchor_stale");
    // Tamper an event BELOW the anchored sequence, leaving hash columns
    // intact, on the already-open store (the long-lived MCP deployment mode).
    const db = new Database(dbPath);
    db.query("UPDATE events SET payload_json = ? WHERE workspace_id = ? AND sequence = 1")
      .run(JSON.stringify({ rewritten: true }), workspace.id);
    db.close();
    const status = anchorStatusForWorkspace(store, workspace.id, ledgerPath);
    expect(status.status).toBe("anchor_conflict");
    expect(status.reason).toContain("full recomputation");
  });

  test("a FIFO ledger_path fails open instead of blocking the server", () => {
    const { store, workspace } = fixture();
    const fifoPath = join(mkdtempSync(join(tmpdir(), "collab-anchor-fifo-")), "ledger.fifo");
    const mkfifo = Bun.spawnSync({ cmd: ["mkfifo", fifoPath], stdout: "pipe", stderr: "pipe" });
    expect(mkfifo.exitCode).toBe(0);
    const status = anchorStatusForWorkspace(store, workspace.id, fifoPath);
    expect(status.status).toBe("unanchored");
    expect(status.ledger_readable).toBe(false);
  }, 5_000);

  test("unknown workspace → workspace_not_found CollabError", () => {
    const { store, ledgerPath } = fixture();
    expect(() => anchorStatusForWorkspace(store, "ws_missing", ledgerPath))
      .toThrow(CollabError);
  });

  test("default ledger path honours the environment override", () => {
    expect(defaultAnchorLedgerPath({ AGENTOOL_COLLAB_ANCHOR_LEDGER: "/tmp/x.json" })).toBe("/tmp/x.json");
    expect(defaultAnchorLedgerPath({ HOME: "/Users/nobody" }))
      .toBe("/Users/nobody/.local/share/agenttool/collab-zerone-anchors.json");
    expect(defaultAnchorLedgerPath({ HOME: "/Users/nobody", XDG_DATA_HOME: "/data" }))
      .toBe("/data/agenttool/collab-zerone-anchors.json");
  });
});
