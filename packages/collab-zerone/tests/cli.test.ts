import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// Cross-package source import mirrors conformance.test.ts.
import { CollabStore } from "../../collab/src/store.js";
import { anchorSaltPath, epochAlias, readAnchorSalt, workspaceAlias } from "../src/alias.js";
import { ANCHOR_MEMO_PROTOCOL, LEGACY_ANCHOR_MEMO_PROTOCOL } from "../src/constants.js";
import { JournalReader } from "../src/journal.js";
import { appendAnchor, loadLedger, newAnchorEntry, recordAnchorOutcome, type AnchorEntry } from "../src/ledger.js";
import { buildAliasedAnchorMemo, buildLegacyAnchorMemo } from "../src/memo.js";

const CLI = new URL("../bin/collab-zerone.ts", import.meta.url).pathname;

interface Fixture {
  dbPath: string;
  ledgerPath: string;
  saltPath: string;
  stubDir: string;
  workspaceId: string;
  epochId: string;
  headSequence: number;
  headHash: string;
  salt: Buffer;
  workspaceAlias: string;
  epochAlias: string;
  /** agenttool.collab-anchor/0.2 memo for the head, under the fixture salt. */
  memo: string;
  /** Legacy agenttool.collab-anchor/0.1 memo for the head. */
  legacyMemo: string;
}

/** By default the salt is written beside the ledger so tests know the 0.2 memo in advance. */
function fixture(options: { writeSalt?: boolean } = {}): Fixture {
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
  const ledgerPath = join(mkdtempSync(join(tmpdir(), "collab-zerone-cli-ledger-")), "anchors.json");
  const saltPath = anchorSaltPath(ledgerPath);
  const salt = randomBytes(32);
  if (options.writeSalt !== false) writeFileSync(saltPath, `${salt.toString("hex")}\n`, { mode: 0o600 });
  const aliases = {
    workspace_alias: workspaceAlias(salt, refreshed.id),
    epoch_alias: epochAlias(salt, refreshed.epoch_id),
  };
  const head = { sequence: refreshed.event_head_sequence, head_hash: refreshed.event_head_hash };
  return {
    dbPath,
    ledgerPath,
    saltPath,
    stubDir: mkdtempSync(join(tmpdir(), "collab-zerone-cli-stub-")),
    workspaceId: refreshed.id,
    epochId: refreshed.epoch_id,
    headSequence: refreshed.event_head_sequence,
    headHash: refreshed.event_head_hash,
    salt,
    workspaceAlias: aliases.workspace_alias,
    epochAlias: aliases.epoch_alias,
    memo: buildAliasedAnchorMemo({ ...aliases, ...head }),
    legacyMemo: buildLegacyAnchorMemo({ workspace_id: refreshed.id, epoch_id: refreshed.epoch_id, ...head }),
  };
}

function baseFields(fix: Fixture, memo: string) {
  return {
    workspace_id: fix.workspaceId,
    epoch_id: fix.epochId,
    sequence: fix.headSequence,
    head_hash: fix.headHash,
    network: "zerone-testnet-1",
    caip2: "cosmos:zerone-testnet-1",
    account: "zrn1fixture",
    memo,
  };
}

/** A ledger entry as written before 0.2: no memo_protocol, raw ids in the memo. */
function legacyEntry(fix: Fixture, fields: Partial<AnchorEntry> = {}): AnchorEntry {
  return { ...newAnchorEntry(baseFields(fix, fix.legacyMemo)), ...fields };
}

/** A ledger entry as `anchor` now writes it. */
function aliasedEntry(fix: Fixture, fields: Partial<AnchorEntry> = {}): AnchorEntry {
  return {
    ...newAnchorEntry({
      ...baseFields(fix, fix.memo),
      memo_protocol: ANCHOR_MEMO_PROTOCOL,
      workspace_alias: fix.workspaceAlias,
      epoch_alias: fix.epochAlias,
    }),
    ...fields,
  };
}

interface StubSpec {
  sendJson?: string;
  sendExit?: number;
  sendStdout?: string;
  queryJson?: string;
  queryExit?: number;
  /** Per-transaction query responses, keyed by the hash zeroned is asked for. */
  queryByHash?: Record<string, string>;
  markerPath?: string;
  keyMarkerPath?: string;
  queryMarkerPath?: string;
  /** Records the argv of the broadcast, one argument per line. */
  argsPath?: string;
}

function writeStub(fix: Fixture, spec: StubSpec): string {
  const dir = mkdtempSync(join(fix.stubDir, "stub-"));
  const stubPath = join(dir, "zeroned");
  const sendFile = join(dir, "send.json");
  const queryFile = join(dir, "query.json");
  writeFileSync(sendFile, spec.sendStdout ?? spec.sendJson ?? "{}");
  writeFileSync(queryFile, spec.queryJson ?? "{}");
  for (const [hash, body] of Object.entries(spec.queryByHash ?? {})) {
    writeFileSync(join(dir, `query-${hash}.json`), body);
  }
  writeFileSync(stubPath, `#!/bin/sh
case "$1" in
  keys) ${spec.keyMarkerPath ? `touch "${spec.keyMarkerPath}"; ` : ""}echo "zrn1stubaddressstubaddress0stub"; exit 0 ;;
  tx) ${spec.markerPath ? `touch "${spec.markerPath}"; ` : ""}${spec.argsPath ? `printf '%s\\n' "$@" > "${spec.argsPath}"; ` : ""}cat "${sendFile}"; exit ${spec.sendExit ?? 0} ;;
  query) ${spec.queryMarkerPath ? `touch "${spec.queryMarkerPath}"; ` : ""}if [ -f "${dir}/query-$3.json" ]; then cat "${dir}/query-$3.json"; else cat "${queryFile}"; fi; ${spec.queryExit ? `echo "tx not found" >&2; ` : ""}exit ${spec.queryExit ?? 0} ;;
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

function txResult(hash: string, memo: string, height = "9"): string {
  return JSON.stringify({ height, code: 0, txhash: hash, tx: { body: { memo } } });
}

describe("collab-zerone CLI end to end (stubbed zeroned)", () => {
  test("happy path: anchor confirms a 0.2 memo and the ledger records height, protocol and aliases", () => {
    const fix = fixture();
    const argsPath = join(fix.stubDir, "send-args");
    const stub = writeStub(fix, {
      sendJson: JSON.stringify({ height: "0", txhash: "STUBHASH01", code: 0, raw_log: "" }),
      queryJson: txResult("STUBHASH01", fix.memo, "7777"),
      argsPath,
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
      memo: fix.memo,
      memo_protocol: ANCHOR_MEMO_PROTOCOL,
      workspace_alias: fix.workspaceAlias,
      epoch_alias: fix.epochAlias,
    });
    // What reaches the chain carries the aliases, never the path-derived ids.
    const sent = readFileSync(argsPath, "utf8");
    expect(sent.split("\n")).toContain(fix.memo);
    expect(sent).not.toContain(fix.workspaceId);
    expect(sent).not.toContain(fix.epochId);
    expect(sent).not.toContain("ws_");
  });

  test("first anchor creates the salt beside the ledger (0600) and derives the published aliases from it", () => {
    const fix = fixture({ writeSalt: false });
    expect(existsSync(fix.saltPath)).toBe(false);
    const argsPath = join(fix.stubDir, "send-args");
    const stub = writeStub(fix, {
      sendJson: JSON.stringify({ height: "0", txhash: "FIRST01", code: 0 }),
      queryJson: "",
      queryExit: 1,
      argsPath,
    });
    const run = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "0"]);
    expect(run.exitCode).toBe(3);
    expect(run.stdout).toContain("created anchor alias salt");
    expect(statSync(fix.saltPath).mode & 0o777).toBe(0o600);
    const salt = readAnchorSalt(fix.saltPath);
    const expected = buildAliasedAnchorMemo({
      workspace_alias: workspaceAlias(salt, fix.workspaceId),
      epoch_alias: epochAlias(salt, fix.epochId),
      sequence: fix.headSequence,
      head_hash: fix.headHash,
    });
    expect(loadLedger(fix.ledgerPath).anchors[0]).toMatchObject({ status: "submitted", memo: expected, memo_protocol: ANCHOR_MEMO_PROTOCOL });
    const sent = readFileSync(argsPath, "utf8");
    expect(sent.split("\n")).toContain(expected);
    expect(sent).not.toContain(fix.workspaceId);
    expect(sent).not.toContain(fix.epochId);
  });

  test("dry run never creates the salt; with a salt it shows the exact memo", () => {
    const fresh = fixture({ writeSalt: false });
    const marker = join(fresh.stubDir, "broadcast");
    const stub = writeStub(fresh, { markerPath: marker });
    const dry = runCli(fresh, stub, ["anchor", "--workspace", fresh.workspaceId, "--dry-run"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain("illustrative");
    expect(dry.stdout).toContain(`memo: ${ANCHOR_MEMO_PROTOCOL} alias=`);
    expect(dry.stdout).not.toContain(" ws=");
    expect(existsSync(fresh.saltPath)).toBe(false);
    expect(existsSync(fresh.ledgerPath)).toBe(false);
    expect(existsSync(marker)).toBe(false);

    const salted = fixture();
    const exact = runCli(salted, writeStub(salted, {}), ["anchor", "--workspace", salted.workspaceId, "--dry-run"]);
    expect(exact.exitCode).toBe(0);
    expect(exact.stdout).toContain(`memo: ${salted.memo}`);
    expect(exact.stdout).not.toContain("illustrative");
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

  test("conflict refusal: a confirmed anchor with a different hash blocks anchoring before any broadcast or salt", () => {
    const fix = fixture({ writeSalt: false });
    appendAnchor(fix.ledgerPath, legacyEntry(fix, {
      head_hash: "ee".repeat(32),
      account: "zrn1old",
      memo: "old",
      status: "confirmed",
      tx_hash: "OLDTX",
    }));
    const marker = join(fix.stubDir, "broadcast-happened");
    const stub = writeStub(fix, {
      sendJson: JSON.stringify({ txhash: "NEW", code: 0 }),
      markerPath: marker,
    });
    const run = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "1"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("refusing to anchor");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(fix.saltPath)).toBe(false);
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
    expect(loadLedger(fix.ledgerPath).anchors[0]).toMatchObject({
      status: "submitted", tx_hash: "SLOW01", memo_protocol: ANCHOR_MEMO_PROTOCOL,
    });

    const resolveStub = writeStub(fix, { queryJson: txResult("SLOW01", fix.memo, "8888") });
    const resolved = runCli(fix, resolveStub, ["resolve", "--workspace", fix.workspaceId]);
    expect(resolved.exitCode).toBe(0);
    expect(resolved.stdout).toContain("confirmed at height 8888");
    expect(loadLedger(fix.ledgerPath).anchors[0]).toMatchObject({ status: "confirmed", confirmed_height: 8888 });

    const already = runCli(fix, resolveStub, ["anchor", "--workspace", fix.workspaceId, "--wait", "1"]);
    expect(already.exitCode).toBe(0);
    expect(already.stdout).toContain("nothing to do");
  });

  for (const kind of ["legacy 0.1", "aliased 0.2"] as const) {
    test(`verify --check-chain exits 2 when a confirmed ${kind} anchor's on-chain memo mismatches`, () => {
      const fix = fixture();
      const entry = kind === "legacy 0.1" ? legacyEntry(fix) : aliasedEntry(fix);
      appendAnchor(fix.ledgerPath, entry);
      recordAnchorOutcome(fix.ledgerPath, entry, { status: "confirmed", tx_hash: "TAMPER01", confirmed_height: 5 });

      const badStub = writeStub(fix, { queryJson: txResult("TAMPER01", "some other memo entirely", "5") });
      const bad = runCli(fix, badStub, ["verify", "--workspace", fix.workspaceId, "--check-chain"]);
      expect(bad.exitCode).toBe(2);
      expect(bad.stdout).toContain("MISMATCH");

      const goodStub = writeStub(fix, { queryJson: txResult("TAMPER01", entry.memo, "5") });
      const good = runCli(fix, goodStub, ["verify", "--workspace", fix.workspaceId, "--check-chain"]);
      expect(good.exitCode).toBe(0);
      // Without --check-chain the same ledger verifies locally.
      const localOnly = runCli(fix, badStub, ["verify", "--workspace", fix.workspaceId]);
      expect(localOnly.exitCode).toBe(0);
    });

    test(`${kind}: memo must equal both the persisted bytes and its recorded fields`, () => {
      const fix = fixture();
      const honest = kind === "legacy 0.1" ? fix.legacyMemo : fix.memo;
      const entry = (kind === "legacy 0.1" ? legacyEntry : aliasedEntry)(fix, { memo: `${honest} ` });
      appendAnchor(fix.ledgerPath, entry);
      recordAnchorOutcome(fix.ledgerPath, entry, { status: "confirmed", tx_hash: "FIXTURETX" });
      const stub = writeStub(fix, { queryJson: txResult("FIXTURETX", honest) });
      expect(runCli(fix, stub, ["verify", "--workspace", fix.workspaceId, "--check-chain"]).exitCode).toBe(2);
      recordAnchorOutcome(fix.ledgerPath, entry, { status: "ambiguous" });
      expect(runCli(fix, stub, ["resolve", "--workspace", fix.workspaceId]).exitCode).toBe(3);
      expect(loadLedger(fix.ledgerPath).anchors[0]!.status).toBe("ambiguous");
    });
  }

  test("verify --check-chain matches each entry of a mixed ledger under its own protocol only", () => {
    const fix = fixture();
    const reader = new JournalReader(fix.dbPath);
    const first = reader.verify(fix.workspaceId, 1);
    reader.close();
    if (!first.valid) throw new Error("fixture journal prefix must verify");
    const firstHash = first.hash_at_sequence;
    const legacyFirstMemo = buildLegacyAnchorMemo({
      workspace_id: fix.workspaceId, epoch_id: fix.epochId, sequence: 1, head_hash: firstHash,
    });
    const aliasedFirstMemo = buildAliasedAnchorMemo({
      workspace_alias: fix.workspaceAlias, epoch_alias: fix.epochAlias, sequence: 1, head_hash: firstHash,
    });
    const old = legacyEntry(fix, { sequence: 1, head_hash: firstHash, memo: legacyFirstMemo });
    const current = aliasedEntry(fix);
    appendAnchor(fix.ledgerPath, old);
    recordAnchorOutcome(fix.ledgerPath, old, { status: "confirmed", tx_hash: "LEGACYTX", confirmed_height: 3 });
    appendAnchor(fix.ledgerPath, current);
    recordAnchorOutcome(fix.ledgerPath, current, { status: "confirmed", tx_hash: "ALIASTX", confirmed_height: 4 });

    const honest = writeStub(fix, { queryByHash: {
      LEGACYTX: txResult("LEGACYTX", legacyFirstMemo, "3"),
      ALIASTX: txResult("ALIASTX", fix.memo, "4"),
    } });
    const ok = runCli(fix, honest, ["verify", "--workspace", fix.workspaceId, "--check-chain", "--json"]);
    expect(ok.exitCode).toBe(0);
    const report = JSON.parse(ok.stdout);
    expect(report.salt_note).toBeNull();
    expect(report.anchors.map((check: Record<string, unknown>) => [check.memo_protocol, check.alias_match]))
      .toEqual([[LEGACY_ANCHOR_MEMO_PROTOCOL, null], [ANCHOR_MEMO_PROTOCOL, true]]);
    expect(report.anchors.every((check: { chain: { memo_matches: boolean } }) => check.chain.memo_matches)).toBe(true);

    // Each tx answering with the other protocol's memo for the same journal
    // state is a mismatch, never a cross-protocol match.
    const swapped = writeStub(fix, { queryByHash: {
      LEGACYTX: txResult("LEGACYTX", aliasedFirstMemo, "3"),
      ALIASTX: txResult("ALIASTX", fix.legacyMemo, "4"),
    } });
    const crossed = runCli(fix, swapped, ["verify", "--workspace", fix.workspaceId, "--check-chain", "--json"]);
    expect(crossed.exitCode).toBe(2);
    expect(JSON.parse(crossed.stdout).anchors.map((check: { chain: { memo_matches: boolean } }) => check.chain.memo_matches))
      .toEqual([false, false]);

    const status = runCli(fix, honest, ["status", "--workspace", fix.workspaceId, "--json"]);
    expect(status.exitCode).toBe(0);
    const statusReport = JSON.parse(status.stdout);
    expect(statusReport.salt_note).toBeNull();
    expect(statusReport.reports[0]).toMatchObject({ status: "anchored", anchor: { tx_hash: "ALIASTX", memo_protocol: ANCHOR_MEMO_PROTOCOL } });
  });

  test("a legacy-only workspace needs no salt, and an unknown memo protocol fails closed", () => {
    const fix = fixture({ writeSalt: false });
    const entry = legacyEntry(fix);
    appendAnchor(fix.ledgerPath, entry);
    recordAnchorOutcome(fix.ledgerPath, entry, { status: "confirmed", tx_hash: "FIXTURETX", confirmed_height: 9 });
    const stub = writeStub(fix, { queryJson: txResult("FIXTURETX", fix.legacyMemo) });
    const verify = runCli(fix, stub, ["verify", "--workspace", fix.workspaceId, "--check-chain", "--json"]);
    expect(verify.exitCode).toBe(0);
    const report = JSON.parse(verify.stdout);
    expect(report).toMatchObject({ ledger_note: null, salt_note: null });
    expect(report.anchors[0]).toMatchObject({ memo_protocol: LEGACY_ANCHOR_MEMO_PROTOCOL, local_match: true, alias_match: null });
    expect(existsSync(fix.saltPath)).toBe(false);

    const future = legacyEntry(fix, {
      memo_protocol: "agenttool.collab-anchor/0.3" as unknown as AnchorEntry["memo_protocol"],
      status: "failed",
    });
    appendAnchor(fix.ledgerPath, future);
    const unknown = runCli(fix, stub, ["verify", "--workspace", fix.workspaceId, "--json"]);
    expect(unknown.exitCode).toBe(2);
    expect(JSON.parse(unknown.stdout).anchors[1]).toMatchObject({ alias_match: false });
    expect(JSON.parse(unknown.stdout).anchors[1].alias_detail).toContain("unknown memo protocol");

    // Even when the chain shows a matching memo, resolve never upgrades it.
    recordAnchorOutcome(fix.ledgerPath, future, { status: "ambiguous", tx_hash: "FIXTURETX" });
    const before = readFileSync(fix.ledgerPath, "utf8");
    const resolve = runCli(fix, stub, ["resolve", "--workspace", fix.workspaceId]);
    expect(resolve.exitCode).toBe(3);
    expect(resolve.stdout).toContain("unknown memo protocol");
    expect(readFileSync(fix.ledgerPath, "utf8")).toBe(before);
  });

  test("a lost salt fails closed in anchor, verify and resolve, is never recreated, and status only warns", () => {
    const fix = fixture();
    appendAnchor(fix.ledgerPath, aliasedEntry(fix, { status: "failed", tx_hash: "DEADTX" }));
    unlinkSync(fix.saltPath);
    const marker = join(fix.stubDir, "broadcast");
    const queryMarker = join(fix.stubDir, "query");
    const stub = writeStub(fix, {
      sendJson: JSON.stringify({ txhash: "NEW", code: 0 }),
      queryJson: txResult("FIXTURETX", fix.memo),
      markerPath: marker,
      queryMarkerPath: queryMarker,
    });

    const anchor = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "0"]);
    expect(anchor.exitCode).toBe(2);
    expect(anchor.stderr).toContain("refusing to anchor");
    expect(anchor.stderr).toContain("cannot be re-derived");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(fix.saltPath)).toBe(false);
    expect(loadLedger(fix.ledgerPath).anchors).toHaveLength(1);

    const dry = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--dry-run"]);
    expect(dry.exitCode).toBe(2);
    expect(existsSync(fix.saltPath)).toBe(false);

    const verify = runCli(fix, stub, ["verify", "--workspace", fix.workspaceId, "--json"]);
    expect(verify.exitCode).toBe(2);
    const report = JSON.parse(verify.stdout);
    expect(report.salt_note).toContain("cannot be re-derived");
    expect(report.anchors[0]).toMatchObject({ local_match: true, alias_match: false });

    const status = runCli(fix, stub, ["status", "--workspace", fix.workspaceId, "--json"]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).salt_note).toContain("cannot be re-derived");

    const open = aliasedEntry(fix, { status: "ambiguous", tx_hash: "FIXTURETX" });
    appendAnchor(fix.ledgerPath, open);
    const before = readFileSync(fix.ledgerPath, "utf8");
    const resolve = runCli(fix, stub, ["resolve", "--workspace", fix.workspaceId]);
    expect(resolve.exitCode).toBe(2);
    expect(resolve.stderr).toContain("refusing to resolve");
    expect(resolve.stderr).toContain("cannot be re-derived");
    expect(existsSync(queryMarker)).toBe(false);
    expect(readFileSync(fix.ledgerPath, "utf8")).toBe(before);

    // Restoring the original salt from a backup restores every path.
    writeFileSync(fix.saltPath, `${fix.salt.toString("hex")}\n`, { mode: 0o600 });
    expect(runCli(fix, stub, ["verify", "--workspace", fix.workspaceId]).exitCode).toBe(0);
    const resolved = runCli(fix, stub, ["resolve", "--workspace", fix.workspaceId]);
    expect(resolved.exitCode).toBe(0);
    expect(loadLedger(fix.ledgerPath).anchors.find(entry => entry.id === open.id)?.status).toBe("confirmed");
  });

  test("a replaced salt fails closed: anchor refuses and verify reports aliases that do not re-derive", () => {
    const fix = fixture();
    appendAnchor(fix.ledgerPath, aliasedEntry(fix, { status: "failed", tx_hash: "DEADTX" }));
    writeFileSync(fix.saltPath, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
    const marker = join(fix.stubDir, "broadcast");
    const stub = writeStub(fix, { sendJson: JSON.stringify({ txhash: "NEW", code: 0 }), markerPath: marker });
    const anchor = runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "0"]);
    expect(anchor.exitCode).toBe(2);
    expect(anchor.stderr).toContain("does not reproduce the aliases");
    expect(existsSync(marker)).toBe(false);
    const verify = runCli(fix, stub, ["verify", "--workspace", fix.workspaceId, "--json"]);
    expect(verify.exitCode).toBe(2);
    expect(JSON.parse(verify.stdout).anchors[0].alias_detail).toContain("do not re-derive");
  });

  test("verify rejects malformed inclusion evidence and resolve never clears its sticky attempt", () => {
    const fix = fixture();
    const entry = legacyEntry(fix);
    appendAnchor(fix.ledgerPath, entry);
    const marker = join(fix.stubDir, "broadcast");
    const keyMarker = join(fix.stubDir, "keys");
    // One stub script, re-pointed per case: the first exec of every freshly
    // written script is slow on some hosts, and 13 of them blew the timeout.
    const stub = writeStub(fix, { markerPath: marker, keyMarkerPath: keyMarker });
    for (const patch of [{ code: undefined }, { code: null }, { code: false }, { code: "" }, { code: "0x0" },
      { height: undefined }, { height: 0 }, { height: "" }, { height: -1 }, { height: "1.1" }, { height: 1e20 },
      { txhash: undefined }, { txhash: "UNRELATED" }]) {
      writeFileSync(join(dirname(stub), "query.json"),
        JSON.stringify({ code: 0, height: "9", txhash: "FIXTURETX", tx: { body: { memo: fix.legacyMemo } }, ...patch }));
      recordAnchorOutcome(fix.ledgerPath, entry, { status: "confirmed", tx_hash: "FIXTURETX", confirmed_height: 9 });
      const verify = runCli(fix, stub, ["verify", "--workspace", fix.workspaceId, "--check-chain", "--json"]);
      expect(verify.exitCode).toBe(2);
      expect(JSON.parse(verify.stdout).anchors[0].chain).toMatchObject({ found: false, tx_code: null, height: null });
      recordAnchorOutcome(fix.ledgerPath, entry, { status: "ambiguous" });
      const before = readFileSync(fix.ledgerPath, "utf8");
      const resolve = runCli(fix, stub, ["resolve", "--workspace", fix.workspaceId]);
      expect(resolve.exitCode).toBe(3);
      expect(readFileSync(fix.ledgerPath, "utf8")).toBe(before);
    }
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(keyMarker)).toBe(false);
  });

  test("resolve requires a valid local prefix even when RPC memo and inclusion match", () => {
    const fix = fixture();
    const entry = legacyEntry(fix);
    appendAnchor(fix.ledgerPath, entry);
    recordAnchorOutcome(fix.ledgerPath, entry, { status: "ambiguous", tx_hash: "FIXTURETX" });
    const db = new Database(fix.dbPath);
    db.run("UPDATE events SET payload_json = '{}' WHERE workspace_id = ? AND sequence = ?", [fix.workspaceId, fix.headSequence]);
    db.close();
    const stub = writeStub(fix, { queryJson: JSON.stringify({ height: 9, code: 0, txhash: "FIXTURETX", tx: { body: { memo: fix.legacyMemo } } }) });
    const before = readFileSync(fix.ledgerPath, "utf8");
    const resolve = runCli(fix, stub, ["resolve", "--workspace", fix.workspaceId]);
    expect(resolve.exitCode).toBe(3);
    expect(resolve.stdout).toContain("local prefix is not verified");
    expect(readFileSync(fix.ledgerPath, "utf8")).toBe(before);
  });

  test("unknown inclusion never confirms a newly submitted stub transaction", () => {
    const fix = fixture();
    const stub = writeStub(fix, { sendJson: JSON.stringify({ txhash: "FIXTURETX", code: 0 }),
      queryJson: JSON.stringify({ height: "9", txhash: "FIXTURETX", tx: { body: { memo: fix.memo } } }) });
    expect(runCli(fix, stub, ["anchor", "--workspace", fix.workspaceId, "--wait", "0"]).exitCode).toBe(3);
    expect(loadLedger(fix.ledgerPath).anchors[0]!.status).toBe("submitted");
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
