import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Cross-package source import mirrors conformance.test.ts.
import { CollabStore } from "../../collab/src/store.js";
import { JournalReader } from "../src/journal.js";
import { appendAnchor, loadLedger, newAnchorEntry, recordAnchorOutcome } from "../src/ledger.js";
import { buildAnchorMemo } from "../src/memo.js";

const CLI = new URL("../bin/collab-zerone.ts", import.meta.url).pathname;

interface Fixture {
  dbPath: string;
  ledgerPath: string;
  stubDir: string;
  workspaceId: string;
  epochId: string;
  headSequence: number;
  headHash: string;
  memo: string;
}

function fixture(): Fixture {
  const repo = mkdtempSync(join(tmpdir(), "collab-zerone-cli-repo-"));
  const init = Bun.spawnSync({ cmd: ["git", "init", "-q", repo], stdout: "pipe", stderr: "pipe" });
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.toString()}`);
  const dbPath = join(mkdtempSync(join(tmpdir(), "collab-zerone-cli-db-")), "journal.sqlite");
  const store = new CollabStore(dbPath);
  const workspace = store.openWorkspace({ root_path: repo, actor: "cli-tester" });
  store.recordDecision({
    workspace_id: workspace.id,
    actor: "cli-tester",
    idempotency_key: "cli-d1",
    topic: "cli",
    decision: "anchor me",
  });
  const refreshed = store.getWorkspace(workspace.id)!;
  const memo = buildAnchorMemo({
    workspace_id: refreshed.id,
    epoch_id: refreshed.epoch_id,
    sequence: refreshed.event_head_sequence,
    head_hash: refreshed.event_head_hash,
  });
  return {
    dbPath,
    ledgerPath: join(mkdtempSync(join(tmpdir(), "collab-zerone-cli-ledger-")), "anchors.json"),
    stubDir: mkdtempSync(join(tmpdir(), "collab-zerone-cli-stub-")),
    workspaceId: refreshed.id,
    epochId: refreshed.epoch_id,
    headSequence: refreshed.event_head_sequence,
    headHash: refreshed.event_head_hash,
    memo,
  };
}

interface StubSpec {
  sendJson?: string;
  sendExit?: number;
  sendStdout?: string;
  queryJson?: string;
  queryExit?: number;
  markerPath?: string;
}

function writeStub(fix: Fixture, spec: StubSpec): string {
  const stubPath = join(fix.stubDir, `zeroned-${Math.random().toString(36).slice(2)}`);
  const sendFile = join(fix.stubDir, "send.json");
  const queryFile = join(fix.stubDir, "query.json");
  writeFileSync(sendFile, spec.sendStdout ?? spec.sendJson ?? "{}");
  writeFileSync(queryFile, spec.queryJson ?? "{}");
  writeFileSync(stubPath, `#!/bin/sh
case "$1" in
  keys) echo "zrn1stubaddressstubaddress0stub"; exit 0 ;;
  tx) ${spec.markerPath ? `touch "${spec.markerPath}"; ` : ""}cat "${sendFile}"; exit ${spec.sendExit ?? 0} ;;
  query) cat "${queryFile}"; ${spec.queryExit ? `echo "tx not found" >&2; ` : ""}exit ${spec.queryExit ?? 0} ;;
esac
exit 1
`);
  chmodSync(stubPath, 0o755);
  return stubPath;
}

function runCli(fix: Fixture, stub: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", CLI, ...args, "--db", fix.dbPath, "--ledger", fix.ledgerPath],
    env: { ...process.env, ZERONED_BIN: stub },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("collab-zerone CLI end to end (stubbed zeroned)", () => {
  test("happy path: anchor confirms and the ledger records the height", () => {
    const fix = fixture();
    const stub = writeStub(fix, {
      sendJson: JSON.stringify({ height: "0", txhash: "STUBHASH01", code: 0, raw_log: "" }),
      queryJson: JSON.stringify({ height: "7777", code: 0, tx: { body: { memo: fix.memo } } }),
    });
    const run = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "1"]);
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("🟢 anchored");
    const ledger = loadLedger(fix.ledgerPath);
    expect(ledger.anchors).toHaveLength(1);
    expect(ledger.anchors[0]).toMatchObject({
      status: "confirmed",
      tx_hash: "STUBHASH01",
      confirmed_height: 7777,
      sequence: fix.headSequence,
      head_hash: fix.headHash,
    });
  });

  test("CheckTx rejection: exit 1 and a failed ledger entry", () => {
    const fix = fixture();
    const stub = writeStub(fix, {
      sendJson: JSON.stringify({ height: "0", txhash: "DEAD01", code: 13, raw_log: "insufficient fee" }),
    });
    const run = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "1"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("broadcast rejected");
    const ledger = loadLedger(fix.ledgerPath);
    expect(ledger.anchors[0]!.status).toBe("failed");
  });

  test("unparseable broadcast: exit 3 and a sticky ambiguous entry", () => {
    const fix = fixture();
    const stub = writeStub(fix, { sendStdout: "network flake, no json", sendExit: 1 });
    const run = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "1"]);
    expect(run.exitCode).toBe(3);
    expect(run.stderr).toContain("ambiguous");
    const ledger = loadLedger(fix.ledgerPath);
    expect(ledger.anchors[0]!.status).toBe("ambiguous");
  });

  test("conflict refusal: a confirmed anchor with a different hash blocks anchoring before any broadcast", () => {
    const fix = fixture();
    appendAnchor(fix.ledgerPath, {
      ...newAnchorEntry({
        workspace_id: fix.workspaceId,
        epoch_id: fix.epochId,
        sequence: fix.headSequence,
        head_hash: "ee".repeat(32),
        network: "zerone-testnet-1",
        caip2: "cosmos:zerone-testnet-1",
        account: "zrn1old",
        memo: "old",
      }),
      status: "confirmed",
      tx_hash: "OLDTX",
    });
    const marker = join(fix.stubDir, "broadcast-happened");
    const stub = writeStub(fix, {
      sendJson: JSON.stringify({ txhash: "NEW", code: 0 }),
      markerPath: marker,
    });
    const run = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "1"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("refusing to anchor");
    expect(existsSync(marker)).toBe(false);
    expect(loadLedger(fix.ledgerPath).anchors).toHaveLength(1);
  });

  test("inclusion not observed: exit 3, entry stays submitted, resolve promotes it on positive proof", () => {
    const fix = fixture();
    const pendingStub = writeStub(fix, {
      sendJson: JSON.stringify({ height: "0", txhash: "SLOW01", code: 0 }),
      queryJson: "",
      queryExit: 1,
    });
    const pending = runCli(fix, pendingStub, ["anchor", "--workspace", fix.workspaceId, "--wait", "0"]);
    expect(pending.exitCode).toBe(3);
    expect(loadLedger(fix.ledgerPath).anchors[0]).toMatchObject({ status: "submitted", tx_hash: "SLOW01" });

    const resolveStub = writeStub(fix, {
      queryJson: JSON.stringify({ height: "8888", code: 0, tx: { body: { memo: fix.memo } } }),
    });
    const resolved = runCli(fix, resolveStub, ["resolve", "--workspace", fix.workspaceId]);
    expect(resolved.exitCode).toBe(0);
    expect(resolved.stdout).toContain("confirmed at height 8888");
    expect(loadLedger(fix.ledgerPath).anchors[0]).toMatchObject({ status: "confirmed", confirmed_height: 8888 });

    const already = runCli(fix, resolveStub, ["anchor", "--workspace", fix.workspaceId, "--wait", "1"]);
    expect(already.exitCode).toBe(0);
    expect(already.stdout).toContain("nothing to do");
  });

  test("verify --check-chain exits 2 when a confirmed anchor's on-chain memo mismatches", () => {
    const fix = fixture();
    const entry = newAnchorEntry({
      workspace_id: fix.workspaceId,
      epoch_id: fix.epochId,
      sequence: fix.headSequence,
      head_hash: fix.headHash,
      network: "zerone-testnet-1",
      caip2: "cosmos:zerone-testnet-1",
      account: "zrn1x",
      memo: fix.memo,
    });
    appendAnchor(fix.ledgerPath, entry);
    recordAnchorOutcome(fix.ledgerPath, entry, { status: "confirmed", tx_hash: "TAMPER01", confirmed_height: 5 });

    const badStub = writeStub(fix, {
      queryJson: JSON.stringify({ height: "5", code: 0, tx: { body: { memo: "some other memo entirely" } } }),
    });
    const bad = runCli(fix, badStub, ["verify", "--workspace", fix.workspaceId, "--check-chain"]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stdout).toContain("MISMATCH");

    const goodStub = writeStub(fix, {
      queryJson: JSON.stringify({ height: "5", code: 0, tx: { body: { memo: fix.memo } } }),
    });
    const good = runCli(fix, goodStub, ["verify", "--workspace", fix.workspaceId, "--check-chain"]);
    expect(good.exitCode).toBe(0);
    // Without --check-chain the same ledger verifies locally.
    const localOnly = runCli(fix, badStub, ["verify", "--workspace", fix.workspaceId]);
    expect(localOnly.exitCode).toBe(0);
  });

  test("journal reader used by the CLI still never mutates the DB", () => {
    const fix = fixture();
    const before = new JournalReader(fix.dbPath);
    const headBefore = before.getWorkspace(fix.workspaceId)!.event_head_hash;
    before.close();
    const stub = writeStub(fix, {});
    runCli(fix, stub, ["status", "--workspace", fix.workspaceId]);
    const after = new JournalReader(fix.dbPath);
    expect(after.getWorkspace(fix.workspaceId)!.event_head_hash).toBe(headBefore);
    after.close();
  });
});
