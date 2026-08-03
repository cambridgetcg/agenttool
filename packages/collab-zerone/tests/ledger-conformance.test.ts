import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Cross-package source imports: this suite binds the ledger protocol string,
// entry shape, env override, and default path across BOTH packages, so drift
// in either side fails here instead of degrading silently to "unanchored"
// (the reader is deliberately fail-open, which would otherwise hide drift).
import {
  ANCHOR_LEDGER_PROTOCOL as READER_PROTOCOL,
  anchorStatusForWorkspace,
  defaultAnchorLedgerPath,
} from "../../collab/src/anchor-status.js";
import { CollabStore } from "../../collab/src/store.js";
import { ANCHOR_LEDGER_PROTOCOL as WRITER_PROTOCOL, defaultLedgerPath } from "../src/constants.js";
import { appendAnchor, newAnchorEntry, recordAnchorOutcome, type AnchorEntry } from "../src/ledger.js";

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "collab-zerone-lconf-repo-"));
  const init = Bun.spawnSync({ cmd: ["git", "init", "-q", repo], stdout: "pipe", stderr: "pipe" });
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.toString()}`);
  const dbPath = join(mkdtempSync(join(tmpdir(), "collab-zerone-lconf-db-")), "journal.sqlite");
  const store = new CollabStore(dbPath);
  const workspace = store.openWorkspace({ root_path: repo, actor: "lconf-tester" });
  store.recordDecision({
    workspace_id: workspace.id,
    actor: "lconf-tester",
    idempotency_key: "lconf-d1",
    topic: "conformance",
    decision: "bridge-written ledgers must read back identically in collab",
  });
  const refreshed = store.getWorkspace(workspace.id)!;
  const ledgerPath = join(mkdtempSync(join(tmpdir(), "collab-zerone-lconf-ledger-")), "anchors.json");
  return { store, workspace: refreshed, ledgerPath };
}

function bridgeEntry(workspace: { id: string; epoch_id: string }, fields: Partial<AnchorEntry>): AnchorEntry {
  return {
    ...newAnchorEntry({
      workspace_id: workspace.id,
      epoch_id: workspace.epoch_id,
      sequence: 1,
      head_hash: "00".repeat(32),
      network: "zerone-testnet-1",
      caip2: "cosmos:zerone-testnet-1",
      account: "zrn1conftest",
      memo: "m",
    }),
    ...fields,
  };
}

describe("ledger conformance across packages", () => {
  test("the protocol constants are the same string", () => {
    expect(WRITER_PROTOCOL).toBe(READER_PROTOCOL);
  });

  test("default paths agree for every env shape", () => {
    for (const env of [
      { HOME: "/Users/nobody" },
      { HOME: "/Users/nobody", XDG_DATA_HOME: "/data" },
      { HOME: "/Users/nobody", AGENTOOL_COLLAB_ANCHOR_LEDGER: "/tmp/override.json" },
    ]) {
      expect(defaultLedgerPath(env)).toBe(defaultAnchorLedgerPath(env));
    }
  });

  test("a bridge-written submitted entry reads back as anchor_pending", () => {
    const { store, workspace, ledgerPath } = fixture();
    appendAnchor(ledgerPath, bridgeEntry(workspace, {
      sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
    }));
    const status = anchorStatusForWorkspace(store, workspace.id, ledgerPath);
    expect(status.ledger_readable).toBe(true);
    expect(status.status).toBe("anchor_pending");
  });

  test("a bridge-confirmed entry at head reads back as anchored; at a verified prefix as anchor_stale; conflicting as anchor_conflict", () => {
    const { store, workspace, ledgerPath } = fixture();
    const page = store.eventsSince(workspace.id, 0, 1);
    const first = page.events[0]!;

    const stale = bridgeEntry(workspace, { sequence: first.sequence, head_hash: first.hash });
    appendAnchor(ledgerPath, stale);
    recordAnchorOutcome(ledgerPath, stale, { status: "confirmed", tx_hash: "T1", confirmed_height: 10 });
    expect(anchorStatusForWorkspace(store, workspace.id, ledgerPath).status).toBe("anchor_stale");

    const atHead = bridgeEntry(workspace, {
      sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
    });
    appendAnchor(ledgerPath, atHead);
    recordAnchorOutcome(ledgerPath, atHead, { status: "confirmed", tx_hash: "T2", confirmed_height: 11 });
    const anchored = anchorStatusForWorkspace(store, workspace.id, ledgerPath);
    expect(anchored.status).toBe("anchored");
    expect(anchored.anchor?.tx_hash).toBe("T2");
    expect(anchored.anchor?.confirmed_height).toBe(11);

    const conflicting = bridgeEntry(workspace, {
      sequence: workspace.event_head_sequence,
      head_hash: "ff".repeat(32),
    });
    appendAnchor(ledgerPath, conflicting);
    recordAnchorOutcome(ledgerPath, conflicting, { status: "confirmed", tx_hash: "T3", confirmed_height: 12 });
    expect(anchorStatusForWorkspace(store, workspace.id, ledgerPath).status).toBe("anchor_conflict");
  });
});
