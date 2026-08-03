import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAnchor,
  emptyLedger,
  latestConfirmedAnchor,
  loadLedger,
  newAnchorEntry,
  patchAnchor,
  recordAnchorOutcome,
  saveLedger,
  withLedgerLock,
  type AnchorEntry,
} from "../src/ledger.js";
import { computeAnchorStatus, type WorkspaceHead } from "../src/status.js";

const HEAD_HASH = "aa".repeat(32);
const OLD_HASH = "bb".repeat(32);

function tempLedgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "collab-zerone-ledger-")), "anchors.json");
}

function entry(fields: Partial<AnchorEntry>): AnchorEntry {
  return {
    ...newAnchorEntry({
      workspace_id: "ws_a",
      epoch_id: "epoch_a",
      sequence: 5,
      head_hash: HEAD_HASH,
      network: "zerone-testnet-1",
      caip2: "cosmos:zerone-testnet-1",
      account: "zrn1example",
      memo: "memo",
    }),
    ...fields,
  };
}

const HEAD: WorkspaceHead = {
  workspace_id: "ws_a",
  epoch_id: "epoch_a",
  event_head_sequence: 5,
  event_head_hash: HEAD_HASH,
};

describe("anchor ledger", () => {
  test("append, patch, reload; file stays 0600", () => {
    const path = tempLedgerPath();
    const created = entry({});
    appendAnchor(path, created);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const patched = patchAnchor(path, created.id, { status: "confirmed", tx_hash: "ABC", confirmed_height: 7 });
    expect(patched.status).toBe("confirmed");
    const reloaded = loadLedger(path);
    expect(reloaded.anchors).toHaveLength(1);
    expect(reloaded.anchors[0]!.tx_hash).toBe("ABC");
    expect(reloaded.anchors[0]!.confirmed_height).toBe(7);
  });

  test("missing file loads as an empty ledger; wrong protocol throws", () => {
    const path = tempLedgerPath();
    expect(loadLedger(path).anchors).toHaveLength(0);
    writeFileSync(path, JSON.stringify({ protocol: "something/else", anchors: [] }));
    expect(() => loadLedger(path)).toThrow(/is not a agenttool\.collab-zerone-ledger/);
    const goodPath = tempLedgerPath();
    saveLedger(goodPath, emptyLedger());
    expect(loadLedger(goodPath).protocol).toBe("agenttool.collab-zerone-ledger/0.1");
  });

  test("patching an unknown anchor id throws", () => {
    const path = tempLedgerPath();
    appendAnchor(path, entry({}));
    expect(() => patchAnchor(path, "anchor_nope", { status: "failed" })).toThrow(/not found/);
  });

  test("recordAnchorOutcome restores a vanished entry instead of throwing", () => {
    const path = tempLedgerPath();
    const created = entry({});
    // Simulate a concurrent writer having dropped the entry: the ledger on
    // disk never saw it.
    saveLedger(path, emptyLedger());
    const restored = recordAnchorOutcome(path, created, { status: "ambiguous", tx_hash: "FEED" });
    expect(restored.status).toBe("ambiguous");
    const reloaded = loadLedger(path);
    expect(reloaded.anchors).toHaveLength(1);
    expect(reloaded.anchors[0]!.id).toBe(created.id);
    expect(reloaded.anchors[0]!.tx_hash).toBe("FEED");
  });

  test("withLedgerLock refuses a second holder until released", () => {
    const path = tempLedgerPath();
    withLedgerLock(path, () => {
      const start = Date.now();
      expect(() => withLedgerLock(path, () => "never")).toThrow(/could not acquire/);
      expect(Date.now() - start).toBeGreaterThanOrEqual(4_000);
    });
    // Released: a new holder succeeds immediately.
    expect(withLedgerLock(path, () => "ok")).toBe("ok");
  }, 15_000);

  test("latestConfirmedAnchor picks the highest confirmed sequence for the epoch", () => {
    const path = tempLedgerPath();
    appendAnchor(path, entry({ sequence: 3, status: "confirmed" }));
    appendAnchor(path, entry({ sequence: 6, status: "submitted" }));
    appendAnchor(path, entry({ sequence: 5, status: "confirmed" }));
    appendAnchor(path, entry({ sequence: 9, status: "confirmed", epoch_id: "epoch_other" }));
    const ledger = loadLedger(path);
    const best = latestConfirmedAnchor(ledger, "ws_a", "epoch_a");
    expect(best?.sequence).toBe(5);
    expect(latestConfirmedAnchor(ledger, "ws_a", "epoch_missing")).toBeNull();
  });
});

describe("anchor status", () => {
  test("no entries → unanchored", () => {
    const report = computeAnchorStatus(HEAD, []);
    expect(report.status).toBe("unanchored");
  });

  test("entries only for another epoch → unanchored (epoch rotation resets)", () => {
    const report = computeAnchorStatus(HEAD, [entry({ epoch_id: "epoch_other", status: "confirmed" })]);
    expect(report.status).toBe("unanchored");
    expect(report.reason).toContain("other workspaces or epochs");
  });

  test("only submitted/ambiguous entries → anchor_pending", () => {
    const report = computeAnchorStatus(HEAD, [entry({ status: "ambiguous" })]);
    expect(report.status).toBe("anchor_pending");
    expect(report.reason).toContain("ambiguous");
  });

  test("all attempts definitively failed → unanchored, not pending", () => {
    const report = computeAnchorStatus(HEAD, [
      entry({ status: "failed", sequence: 4 }),
      entry({ status: "failed" }),
    ]);
    expect(report.status).toBe("unanchored");
    expect(report.reason).toContain("definitively failed");
  });

  test("failed attempts plus one submitted → still anchor_pending", () => {
    const report = computeAnchorStatus(HEAD, [
      entry({ status: "failed" }),
      entry({ status: "submitted" }),
    ]);
    expect(report.status).toBe("anchor_pending");
    expect(report.anchor?.status).toBe("submitted");
  });

  test("confirmed at head, recompute matches → anchored and verified", () => {
    const report = computeAnchorStatus(
      HEAD,
      [entry({ status: "confirmed" })],
      sequence => (sequence === 5 ? HEAD_HASH : null),
    );
    expect(report.status).toBe("anchored");
    expect(report.lag_events).toBe(0);
    expect(report.verified_against_journal).toBe(true);
  });

  test("confirmed at head without a recompute callback → anchored but honestly unverified", () => {
    const report = computeAnchorStatus(HEAD, [entry({ status: "confirmed" })]);
    expect(report.status).toBe("anchored");
    expect(report.verified_against_journal).toBe(false);
    expect(report.reason).toContain("not recomputed");
  });

  test("confirmed at head but recompute disagrees with the pointer → anchor_conflict", () => {
    const report = computeAnchorStatus(
      HEAD,
      [entry({ status: "confirmed" })],
      () => "dd".repeat(32),
    );
    expect(report.status).toBe("anchor_conflict");
    expect(report.reason).toContain("rewritten under an unchanged pointer");
  });

  test("confirmed at head with differing hash → anchor_conflict", () => {
    const report = computeAnchorStatus(HEAD, [entry({ status: "confirmed", head_hash: OLD_HASH })]);
    expect(report.status).toBe("anchor_conflict");
  });

  test("confirmed behind head, prefix recomputes to the anchored hash → anchor_stale verified", () => {
    const report = computeAnchorStatus(
      HEAD,
      [entry({ status: "confirmed", sequence: 3, head_hash: OLD_HASH })],
      sequence => (sequence === 3 ? OLD_HASH : null),
    );
    expect(report.status).toBe("anchor_stale");
    expect(report.lag_events).toBe(2);
    expect(report.verified_against_journal).toBe(true);
  });

  test("confirmed behind head without a recompute callback → anchor_stale unverified", () => {
    const report = computeAnchorStatus(HEAD, [entry({ status: "confirmed", sequence: 3, head_hash: OLD_HASH })]);
    expect(report.status).toBe("anchor_stale");
    expect(report.verified_against_journal).toBe(false);
  });

  test("confirmed behind head but history rewritten → anchor_conflict", () => {
    const report = computeAnchorStatus(
      HEAD,
      [entry({ status: "confirmed", sequence: 3, head_hash: OLD_HASH })],
      () => "cc".repeat(32),
    );
    expect(report.status).toBe("anchor_conflict");
    expect(report.reason).toContain("history rewritten");
  });

  test("confirmed ahead of head → anchor_conflict (journal rewound)", () => {
    const report = computeAnchorStatus(HEAD, [entry({ status: "confirmed", sequence: 9 })]);
    expect(report.status).toBe("anchor_conflict");
    expect(report.reason).toContain("rewound");
  });

  test("pending newer entry does not mask an older confirmed anchor", () => {
    const report = computeAnchorStatus(
      HEAD,
      [
        entry({ status: "confirmed", sequence: 3, head_hash: OLD_HASH }),
        entry({ status: "submitted", sequence: 5 }),
      ],
      sequence => (sequence === 3 ? OLD_HASH : null),
    );
    expect(report.status).toBe("anchor_stale");
    expect(report.anchor?.sequence).toBe(3);
  });
});
