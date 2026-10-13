#!/usr/bin/env bun
/** Replay deletions after a database restore (docs/DELETION-REPLAY.md).
 *
 *  Usage (DATABASE_SESSION_URL or DATABASE_URL names the RESTORED database;
 *  the mirror comes from AGENTTOOL_DELETION_MIRROR_* or --mirror-dir):
 *    bun bin/deletion-replay.ts begin --restore-point <ISO time>   # step 0
 *    bun bin/deletion-replay.ts plan                              # dry run (default)
 *    bun bin/deletion-replay.ts apply [--void <seq> ... --void-reason "<why>" --operator <a> --operator <b>]
 *    bun bin/deletion-replay.ts finish                            # step 6
 *
 *  Everything but `begin` refuses unless deletion.settings.replay_required
 *  is set. `plan` changes nothing (its work runs in a rolled-back
 *  transaction). The ledger key is read from Supabase Vault in the target
 *  database, as the API reads it. Output is JSON. */

import { connectDeletionDatabase } from "../api/src/services/deletion/connect";
import { vaultLedgerKeyProvider } from "../api/src/services/deletion/ledger";
import { FileLedgerMirror, ledgerMirrorFromEnv, type LedgerMirror } from "../api/src/services/deletion/mirror";
import {
  ReplayRefusedError,
  beginReplayMaintenance,
  finishReplayMaintenance,
  runReplay,
  type ReplayDatabase,
  type VoidRequest,
} from "../api/src/services/deletion/replay";

export interface ReplayCliArgs {
  command: "begin" | "plan" | "apply" | "finish";
  restorePoint: string | null;
  mirrorDir: string | null;
  voidSeqs: number[];
  voidReason: string | null;
  operators: string[];
}

export function parseReplayArgs(argv: readonly string[]): ReplayCliArgs {
  const args: ReplayCliArgs = { command: "plan", restorePoint: null, mirrorDir: null, voidSeqs: [], voidReason: null, operators: [] };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("--")) {
    const command = rest.shift()!;
    if (!["begin", "plan", "apply", "finish"].includes(command)) throw new Error(`unknown command ${command}`);
    args.command = command as ReplayCliArgs["command"];
  }
  while (rest.length > 0) {
    const flag = rest.shift()!;
    const value = rest.shift();
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--restore-point") args.restorePoint = value;
    else if (flag === "--mirror-dir") args.mirrorDir = value;
    else if (flag === "--void") args.voidSeqs.push(Number(value));
    else if (flag === "--void-reason") args.voidReason = value;
    else if (flag === "--operator") args.operators.push(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  if (args.voidSeqs.length > 0 && args.command !== "apply") throw new Error("--void is only accepted by apply");
  return args;
}

export function resolveMirror(mirrorDir: string | null, env: Record<string, string | undefined>): LedgerMirror {
  if (mirrorDir) return new FileLedgerMirror(mirrorDir);
  const config = ledgerMirrorFromEnv(env);
  if (config.status === "configured") return config.mirror;
  throw new ReplayRefusedError(config.status === "misconfigured"
    ? `the deletion-ledger mirror is misconfigured: ${config.problem}`
    : "no deletion-ledger mirror is configured (AGENTTOOL_DELETION_MIRROR_* or --mirror-dir)");
}

export async function runReplayCli(database: ReplayDatabase, args: ReplayCliArgs, env: Record<string, string | undefined>) {
  if (args.command === "begin") {
    if (!args.restorePoint) throw new ReplayRefusedError("begin needs --restore-point <ISO time of the restored backup>");
    return beginReplayMaintenance(database, new Date(args.restorePoint));
  }
  const mirror = resolveMirror(args.mirrorDir, env);
  if (args.command === "finish") return finishReplayMaintenance(database, { mirror, keyProvider: vaultLedgerKeyProvider });
  const voidRequest: VoidRequest | undefined = args.voidSeqs.length > 0
    ? { seqs: args.voidSeqs, reason: args.voidReason ?? "", operators: [args.operators[0] ?? "", args.operators[1] ?? ""] }
    : undefined;
  if (voidRequest && args.operators.length !== 2) throw new ReplayRefusedError("a void needs exactly two --operator ids");
  return runReplay(database, { mirror, keyProvider: vaultLedgerKeyProvider, apply: args.command === "apply", void: voidRequest });
}

if (import.meta.main) {
  const url = process.env.DATABASE_SESSION_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("deletion-replay: set DATABASE_SESSION_URL or DATABASE_URL to the restored database");
    process.exit(2);
  }
  const { database, end } = connectDeletionDatabase(url);
  try {
    const result = await runReplayCli(database, parseReplayArgs(process.argv.slice(2)), process.env);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`deletion-replay: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof ReplayRefusedError ? 3 : 1;
  } finally {
    await end();
  }
}
