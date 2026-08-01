#!/usr/bin/env bun
import { parseArgs } from "node:util";
import {
  DEFAULT_FEE_UZRN,
  DEFAULT_GAS,
  DEFAULT_NETWORK,
  NETWORKS,
  defaultCollabDbPath,
  defaultLedgerPath,
  type ZeroneNetworkConfig,
} from "../src/constants.js";
import { JournalReader, type JournalWorkspace } from "../src/journal.js";
import {
  anchorsForWorkspace,
  appendAnchor,
  emptyLedger,
  loadLedger,
  newAnchorEntry,
  recordAnchorOutcome,
  type AnchorEntry,
  type AnchorLedger,
} from "../src/ledger.js";
import { buildAnchorMemo, parseAnchorMemo } from "../src/memo.js";
import { computeAnchorStatus, type AnchorStatusReport } from "../src/status.js";
import {
  bankSendAnchorArgs,
  broadcastAnchor,
  defaultZeronedBin,
  lookupTx,
  resolveKeyAddress,
  systemZeronedRunner,
  waitForTx,
} from "../src/zeroned.js";

const USAGE = `collab-zerone — witness-only zerone anchoring for agenttool-collab journals

The local collab journal stays canonical; the chain only witnesses its head
hashes. Anchoring never mutates the collab database.

Usage:
  collab-zerone status   [--workspace <id>] [--network <net>]
  collab-zerone verify   --workspace <id> [--network <net>] [--check-chain]
  collab-zerone anchor   --workspace <id> [--network <net>] [--key <name>]
                         [--dry-run] [--force] [--gas <n>] [--fee-uzrn <n>]
                         [--node <url>] [--keyring-home <path>] [--wait <seconds>]
  collab-zerone resolve  --workspace <id> [--network <net>]

Common flags: --db <path> --ledger <path> --json
Networks: ${Object.keys(NETWORKS).join(", ")} (default ${DEFAULT_NETWORK})
Each anchor is a 1uzrn bank send-to-self costing ~${DEFAULT_FEE_UZRN} uzrn in fees.

verify --check-chain also gates the exit code: every confirmed anchor must be
found on chain with code 0 and a byte-identical memo, or verify exits 2.
resolve re-queries submitted/ambiguous anchors and upgrades them only on
positive on-chain proof; it never re-broadcasts.

Exit codes: 0 ok · 1 error · 2 integrity/verification failure
            3 anchor(s) accepted or in flight but not yet resolved
`;

interface CliOptions {
  workspace?: string;
  network?: string;
  db: string;
  ledger: string;
  key?: string;
  node?: string;
  keyringHome?: string;
  gas: number;
  feeUzrn: number;
  waitSeconds: number;
  dryRun: boolean;
  force: boolean;
  checkChain: boolean;
  json: boolean;
}

function fail(message: string, code = 1): never {
  console.error(`collab-zerone: ${message}`);
  process.exit(code);
}

function resolveNetwork(options: CliOptions, name?: string): ZeroneNetworkConfig {
  const networkName = name ?? options.network ?? DEFAULT_NETWORK;
  const base = NETWORKS[networkName];
  if (!base) fail(`unknown network "${networkName}" (known: ${Object.keys(NETWORKS).join(", ")})`);
  return {
    ...base,
    rpc: options.node ?? base.rpc,
    keyring_home: options.keyringHome ?? base.keyring_home,
  };
}

function loadLedgerSafe(path: string): { ledger: AnchorLedger; note: string | null } {
  try {
    return { ledger: loadLedger(path), note: null };
  } catch (error) {
    return {
      ledger: emptyLedger(),
      note: `anchor ledger unreadable (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

function requireWorkspace(reader: JournalReader, workspaceId: string): JournalWorkspace {
  const workspace = reader.getWorkspace(workspaceId);
  if (!workspace) fail(`workspace ${workspaceId} not found in the collab journal`);
  return workspace;
}

function statusIcon(status: AnchorStatusReport["status"]): string {
  switch (status) {
    case "anchored": return "🟢";
    case "anchor_stale": return "🟡";
    case "anchor_pending": return "🟠";
    case "unanchored": return "⚪";
    case "anchor_conflict": return "🔴";
  }
}

function memoMatchesEntry(memo: string | undefined, entry: AnchorEntry): boolean {
  const parsed = memo ? parseAnchorMemo(memo) : null;
  return parsed !== null
    && parsed.workspace_id === entry.workspace_id
    && parsed.epoch_id === entry.epoch_id
    && parsed.sequence === entry.sequence
    && parsed.head_hash === entry.head_hash;
}

function commandStatus(options: CliOptions): void {
  const reader = new JournalReader(options.db);
  try {
    const workspaces = options.workspace
      ? [requireWorkspace(reader, options.workspace)]
      : reader.listWorkspaces();
    const { ledger, note } = loadLedgerSafe(options.ledger);
    const reports: Array<AnchorStatusReport & { workspace_name: string; network: string | null }> = [];
    for (const workspace of workspaces) {
      const head = {
        workspace_id: workspace.id,
        epoch_id: workspace.epoch_id,
        event_head_sequence: workspace.event_head_sequence,
        event_head_hash: workspace.event_head_hash,
      };
      const entries = anchorsForWorkspace(ledger, workspace.id, workspace.epoch_id, options.network);
      const networks = options.network
        ? [options.network]
        : [...new Set(entries.map(entry => entry.network))];
      const hashAt = (sequence: number): string | null => {
        const verification = reader.verify(workspace.id, sequence);
        return verification.valid ? verification.hash_at_sequence : null;
      };
      if (networks.length === 0) {
        reports.push({
          ...computeAnchorStatus(head, [], hashAt),
          workspace_name: workspace.name,
          network: null,
        });
        continue;
      }
      for (const network of networks) {
        reports.push({
          ...computeAnchorStatus(head, entries.filter(entry => entry.network === network), hashAt),
          workspace_name: workspace.name,
          network,
        });
      }
    }
    if (options.json) {
      console.log(JSON.stringify({ ledger_path: options.ledger, ledger_note: note, reports }, null, 2));
      return;
    }
    if (note) console.log(`⚠ ${note}`);
    for (const report of reports) {
      const where = report.network ? ` [${report.network}]` : "";
      const anchorInfo = report.anchor
        ? ` (anchor seq ${report.anchor.sequence}${report.anchor.tx_hash ? `, tx ${report.anchor.tx_hash.slice(0, 12)}…` : ""})`
        : "";
      console.log(
        `${statusIcon(report.status)} ${report.workspace_name} (${report.workspace_id})${where}`
        + ` head ${report.head_sequence}: ${report.status} — ${report.reason}${anchorInfo}`,
      );
    }
  } finally {
    reader.close();
  }
}

function commandVerify(options: CliOptions): void {
  if (!options.workspace) fail("verify requires --workspace <id>");
  const reader = new JournalReader(options.db);
  try {
    const workspace = requireWorkspace(reader, options.workspace);
    const journal = reader.verify(workspace.id);
    const { ledger, note } = loadLedgerSafe(options.ledger);
    const entries = anchorsForWorkspace(ledger, workspace.id, workspace.epoch_id, options.network);
    const runner = options.checkChain ? systemZeronedRunner(defaultZeronedBin()) : null;
    const anchorChecks = entries.map(entry => {
      let localMatch = false;
      let localDetail: string;
      if (!journal.valid) {
        localDetail = `journal itself failed verification (${journal.failure})`;
      } else {
        const prefix = reader.verify(workspace.id, entry.sequence);
        localMatch = prefix.valid && prefix.hash_at_sequence === entry.head_hash;
        localDetail = prefix.valid
          ? (localMatch ? "recomputed hash matches anchor" : "recomputed hash DIFFERS from anchor")
          : `prefix verification failed (${prefix.failure})`;
      }
      let chain: { found: boolean; height: number | null; tx_code: number | null; memo_matches: boolean; detail: string | null } | null = null;
      if (runner && entry.tx_hash) {
        const network = resolveNetwork(options, entry.network);
        const found = lookupTx(runner, network, entry.tx_hash);
        chain = {
          found: found.found,
          height: found.height ?? null,
          tx_code: found.code ?? null,
          memo_matches: memoMatchesEntry(found.memo, entry),
          detail: found.detail ?? null,
        };
      }
      return { anchor: entry, local_match: localMatch, local_detail: localDetail, chain };
    });
    const localOk = journal.valid && anchorChecks.every(check =>
      check.anchor.status !== "confirmed" || check.local_match);
    // --check-chain gates the exit code too: a confirmed anchor must be found
    // on chain with code 0 and a byte-identical memo, or verification fails.
    const chainOk = !options.checkChain || anchorChecks.every(check =>
      check.anchor.status !== "confirmed"
      || (check.chain !== null && check.chain.found && check.chain.tx_code === 0 && check.chain.memo_matches));
    const result = {
      workspace_id: workspace.id,
      journal_valid: journal.valid,
      journal_detail: journal.valid
        ? `${journal.checked_events} events verified; head consistent`
        : `${journal.failure}${"failed_sequence" in journal && journal.failed_sequence ? ` at sequence ${journal.failed_sequence}` : ""}`,
      chain_checked: options.checkChain,
      ledger_note: note,
      anchors: anchorChecks,
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${journal.valid ? "🟢" : "🔴"} journal: ${result.journal_detail}`);
      if (note) console.log(`⚠ ${note}`);
      for (const check of anchorChecks) {
        const chainPart = check.chain
          ? ` | chain: ${check.chain.found ? `found @${check.chain.height}, code ${check.chain.tx_code}, memo ${check.chain.memo_matches ? "matches" : "MISMATCH"}` : `not found (${check.chain.detail ?? "no detail"})`}`
          : "";
        console.log(
          `${check.local_match ? "🟢" : "🔴"} anchor seq ${check.anchor.sequence} [${check.anchor.network}]`
          + ` ${check.anchor.status}: ${check.local_detail}${chainPart}`,
        );
      }
      if (anchorChecks.length === 0) console.log("⚪ no anchors recorded for this workspace/epoch");
    }
    process.exit(localOk && chainOk ? 0 : 2);
  } finally {
    reader.close();
  }
}

async function commandAnchor(options: CliOptions): Promise<void> {
  if (!options.workspace) fail("anchor requires --workspace <id>");
  const network = resolveNetwork(options);
  const { ledger, note } = loadLedgerSafe(options.ledger);
  if (note) fail(`refusing to anchor with an unreadable ledger: ${note}`);

  const reader = new JournalReader(options.db);
  let workspace: JournalWorkspace;
  let memo: string;
  let report: AnchorStatusReport;
  let sameSeqOpen: AnchorEntry | undefined;
  try {
    workspace = requireWorkspace(reader, options.workspace);
    const verification = reader.verify(workspace.id);
    if (!verification.valid) {
      fail(`refusing to anchor: journal verification failed (${verification.failure}); an anchor must never bless a broken chain`, 2);
    }
    const entries = anchorsForWorkspace(ledger, workspace.id, workspace.epoch_id, network.name);
    report = computeAnchorStatus(
      {
        workspace_id: workspace.id,
        epoch_id: workspace.epoch_id,
        event_head_sequence: workspace.event_head_sequence,
        event_head_hash: workspace.event_head_hash,
      },
      entries,
      (sequence: number): string | null => {
        const prefix = reader.verify(workspace.id, sequence);
        return prefix.valid ? prefix.hash_at_sequence : null;
      },
    );
    sameSeqOpen = entries.find(entry => entry.sequence === workspace.event_head_sequence
      && (entry.status === "submitted" || entry.status === "ambiguous"));
    memo = buildAnchorMemo({
      workspace_id: workspace.id,
      epoch_id: workspace.epoch_id,
      sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
    });
  } finally {
    reader.close();
  }

  if (report.status === "anchored" && !options.force) {
    console.log(`already anchored on ${network.name} at sequence ${report.anchor?.sequence} (tx ${report.anchor?.tx_hash ?? "?"}); nothing to do`);
    return;
  }
  // Anchoring over a conflict would launder tamper evidence into a fresh
  // green anchor; the newest confirmed anchor is what status reports.
  if (report.status === "anchor_conflict" && !options.force) {
    fail(`refusing to anchor: ${report.reason}. Investigate with 'verify' first; --force only if you explicitly intend to bless the current history over the recorded anchor`, 2);
  }
  if (sameSeqOpen && !options.force) {
    fail(`an anchor for sequence ${workspace.event_head_sequence} is already ${sameSeqOpen.status} (${sameSeqOpen.id}); run 'collab-zerone resolve --workspace ${workspace.id} --network ${network.name}' or --force`, 3);
  }

  const runner = systemZeronedRunner(defaultZeronedBin());
  const keyName = options.key ?? network.default_key;
  const address = resolveKeyAddress(runner, network, keyName);
  const txOptions = { gas: options.gas, fee_uzrn: options.feeUzrn };
  const args = bankSendAnchorArgs(network, address, memo, txOptions);

  if (options.dryRun) {
    console.log(`dry run — would anchor ${workspace.name} (${workspace.id}) on ${network.name}:`);
    console.log(`  memo: ${memo}`);
    console.log(`  cost: ~${options.feeUzrn} uzrn fees from ${address} (${keyName})`);
    console.log(`  zeroned ${args.join(" ")}`);
    return;
  }

  console.log(`anchoring ${workspace.name} head seq ${workspace.event_head_sequence} on ${network.name} (~${options.feeUzrn} uzrn fee, key ${keyName})`);
  // The entry lands in the ledger BEFORE broadcast so a crash mid-flight
  // leaves an honest "submitted" trace instead of silence.
  const entry = newAnchorEntry({
    workspace_id: workspace.id,
    epoch_id: workspace.epoch_id,
    sequence: workspace.event_head_sequence,
    head_hash: workspace.event_head_hash,
    network: network.name,
    caip2: network.caip2,
    account: address,
    memo,
  });
  appendAnchor(options.ledger, entry);
  const broadcast = broadcastAnchor(runner, args);
  if (broadcast.outcome === "rejected") {
    recordAnchorOutcome(options.ledger, entry, {
      status: "failed",
      tx_hash: broadcast.tx_hash,
      note: broadcast.detail,
    });
    fail(`broadcast rejected: ${broadcast.detail ?? "unknown"}`);
  }
  if (broadcast.outcome === "ambiguous") {
    recordAnchorOutcome(options.ledger, entry, { status: "ambiguous", note: broadcast.detail });
    fail(`broadcast outcome ambiguous — the tx may or may not exist on ${network.name}; entry ${entry.id} kept for 'collab-zerone resolve': ${broadcast.detail ?? ""}`, 3);
  }
  recordAnchorOutcome(options.ledger, entry, { tx_hash: broadcast.tx_hash });
  console.log(`accepted into mempool, tx ${broadcast.tx_hash}; waiting for inclusion…`);
  const lookup = await waitForTx(runner, network, broadcast.tx_hash as string, {
    timeout_ms: options.waitSeconds * 1000,
  });
  if (!lookup.found) {
    console.log(`⚠ not yet included (${lookup.detail ?? "no detail"}); entry stays "submitted" — run: collab-zerone resolve --workspace ${workspace.id} --network ${network.name}`);
    process.exit(3);
  }
  if (lookup.code !== 0) {
    recordAnchorOutcome(options.ledger, entry, {
      status: "failed",
      note: `included at height ${lookup.height} but execution failed with code ${lookup.code} (fee was still consumed)`,
    });
    fail(`tx included but failed on-chain with code ${lookup.code}`, 2);
  }
  if (lookup.memo !== memo) {
    recordAnchorOutcome(options.ledger, entry, {
      status: "ambiguous",
      note: `included at height ${lookup.height} but on-chain memo does not match the local anchor`,
    });
    fail("on-chain memo does not match the local anchor memo", 2);
  }
  recordAnchorOutcome(options.ledger, entry, {
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    confirmed_height: lookup.height,
  });
  console.log(`🟢 anchored: ${network.name} height ${lookup.height}, tx ${broadcast.tx_hash}`);
  console.log(`   memo: ${memo}`);
}

function commandResolve(options: CliOptions): void {
  if (!options.workspace) fail("resolve requires --workspace <id>");
  const { ledger, note } = loadLedgerSafe(options.ledger);
  if (note) fail(`refusing to resolve with an unreadable ledger: ${note}`);
  const reader = new JournalReader(options.db);
  let workspace: JournalWorkspace;
  try {
    workspace = requireWorkspace(reader, options.workspace);
  } finally {
    reader.close();
  }
  const open = anchorsForWorkspace(ledger, workspace.id, workspace.epoch_id, options.network)
    .filter(entry => entry.status === "submitted" || entry.status === "ambiguous");
  if (open.length === 0) {
    console.log("nothing to resolve: no submitted or ambiguous anchors for this workspace/epoch");
    return;
  }
  const runner = systemZeronedRunner(defaultZeronedBin());
  let unresolved = 0;
  for (const entry of open) {
    if (!entry.tx_hash) {
      unresolved += 1;
      console.log(`🟠 ${entry.id} (seq ${entry.sequence}, ${entry.status}) has no tx hash — cannot be resolved from chain; inspect the ledger note and re-anchor if the head moved on`);
      continue;
    }
    const network = resolveNetwork(options, entry.network);
    const lookup = lookupTx(runner, network, entry.tx_hash);
    // Upgrade on positive proof only; absence of evidence never downgrades
    // and never authorises a re-broadcast.
    if (lookup.found && lookup.code === 0 && memoMatchesEntry(lookup.memo, entry)) {
      recordAnchorOutcome(options.ledger, entry, {
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_height: lookup.height,
      });
      console.log(`🟢 ${entry.id} (seq ${entry.sequence}) confirmed at height ${lookup.height} on ${entry.network}`);
    } else if (lookup.found && lookup.code !== 0) {
      recordAnchorOutcome(options.ledger, entry, {
        status: "failed",
        note: `included at height ${lookup.height} but execution failed with code ${lookup.code}`,
      });
      console.log(`🔴 ${entry.id} (seq ${entry.sequence}) was included but failed with code ${lookup.code}; marked failed`);
    } else if (lookup.found) {
      recordAnchorOutcome(options.ledger, entry, {
        status: "ambiguous",
        note: `included at height ${lookup.height} but the on-chain memo does not match this anchor`,
      });
      unresolved += 1;
      console.log(`🔴 ${entry.id} (seq ${entry.sequence}) tx found but memo does not match — kept ambiguous; investigate manually`);
    } else {
      unresolved += 1;
      console.log(`🟠 ${entry.id} (seq ${entry.sequence}) still not found on ${entry.network} (${lookup.detail ?? "no detail"}); left ${entry.status}`);
    }
  }
  process.exit(unresolved > 0 ? 3 : 0);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      network: { type: "string" },
      db: { type: "string" },
      ledger: { type: "string" },
      key: { type: "string" },
      node: { type: "string" },
      "keyring-home": { type: "string" },
      gas: { type: "string" },
      "fee-uzrn": { type: "string" },
      wait: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "check-chain": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }
  const options: CliOptions = {
    workspace: values.workspace,
    network: values.network,
    db: values.db ?? defaultCollabDbPath(),
    ledger: values.ledger ?? defaultLedgerPath(),
    key: values.key,
    node: values.node,
    keyringHome: values["keyring-home"],
    gas: values.gas ? Number(values.gas) : DEFAULT_GAS,
    feeUzrn: values["fee-uzrn"] ? Number(values["fee-uzrn"]) : DEFAULT_FEE_UZRN,
    waitSeconds: values.wait !== undefined ? Number(values.wait) : 60,
    dryRun: values["dry-run"],
    force: values.force,
    checkChain: values["check-chain"],
    json: values.json,
  };
  if (!Number.isSafeInteger(options.gas) || options.gas < 1) fail("--gas must be a positive integer");
  if (!Number.isSafeInteger(options.feeUzrn) || options.feeUzrn < 1) fail("--fee-uzrn must be a positive integer");
  if (!Number.isFinite(options.waitSeconds) || options.waitSeconds < 0) fail("--wait must be a non-negative number of seconds");
  if (options.network && !NETWORKS[options.network]) {
    fail(`unknown network "${options.network}" (known: ${Object.keys(NETWORKS).join(", ")})`);
  }
  switch (command) {
    case "status": return commandStatus(options);
    case "verify": return commandVerify(options);
    case "anchor": return commandAnchor(options);
    case "resolve": return commandResolve(options);
    default: fail(`unknown command "${command}"\n\n${USAGE}`);
  }
}

await main();
