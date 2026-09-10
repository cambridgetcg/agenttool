import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  ANCHOR_SEND_AMOUNT,
  DEFAULT_FEE_UZRN,
  DEFAULT_GAS,
  expandHome,
  type ZeroneNetworkConfig,
} from "./constants.js";

export interface ZeronedRunResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface ZeronedRunner {
  run(args: string[]): ZeronedRunResult;
}

export function defaultZeronedBin(env: Record<string, string | undefined> = process.env): string {
  if (env.ZERONED_BIN) return env.ZERONED_BIN;
  const agentCopy = expandHome("~/.zerone-agent/bin/zeroned", env);
  if (existsSync(agentCopy)) return agentCopy;
  return "zeroned";
}

export function systemZeronedRunner(bin: string): ZeronedRunner {
  return {
    run(args: string[]): ZeronedRunResult {
      const result = Bun.spawnSync({ cmd: [bin, ...args], stdout: "pipe", stderr: "pipe" });
      return {
        exit_code: result.exitCode ?? -1,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    },
  };
}

export interface QueryRunLimits {
  /** Combined stdout/stderr budget shared by this verifier's read-only queries. */
  max_output_bytes: number;
  /** Maximum duration of one query; the courier separately bounds the whole CLI. */
  timeout_ms: number;
}

/** Read-only streaming path. Never buffer a query through spawnSync. */
export function createReadOnlyTxLookup(bin: string, limits: QueryRunLimits = { max_output_bytes: 262_144, timeout_ms: 10_000 }):
  (network: ZeroneNetworkConfig, txHash: string) => Promise<TxLookup> {
  if (!Number.isSafeInteger(limits.max_output_bytes) || limits.max_output_bytes < 1 || limits.max_output_bytes > 1_048_576
    || !Number.isSafeInteger(limits.timeout_ms) || limits.timeout_ms < 1 || limits.timeout_ms > 30_000) {
    throw new Error("invalid read-only query limits");
  }
  let remaining = limits.max_output_bytes;
  const timeout = limits.timeout_ms;
  return async (network, txHash) => {
    const failed = (): TxLookup => ({ found: false, detail: "query failed or exceeded its execution bounds" });
    if (remaining < 1) return failed();
    try {
      return await new Promise<TxLookup>(resolve => {
        // Inherit the verifier's group: the courier owns teardown of this
        // process and all query descendants on every outer completion path.
        const child = spawn(bin, queryTxArgs(network, txHash), { stdio: ["ignore", "pipe", "pipe"], shell: false });
        const chunks: Buffer[] = [];
        let settled = false;
        let code: number | undefined;
        let stdoutDone = false;
        let stderrDone = false;
        const finish = (success: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          child.stdout.destroy(); child.stderr.destroy();
          resolve(success ? parseTxLookup({ exit_code: 0, stdout: Buffer.concat(chunks).toString("utf8"), stderr: "" }, txHash) : failed());
        };
        const timer = setTimeout(() => finish(false), timeout);
        const checkDone = () => { if (code !== undefined && stdoutDone && stderrDone) finish(code === 0); };
        const read = (chunk: Buffer, retain: boolean) => {
          if (settled) return;
          remaining -= chunk.byteLength;
          if (remaining < 0) { finish(false); return; }
          // Copy only admitted stdout bytes; never retain stderr or an over-cap
          // chunk. Native sync maxBuffer can overshoot by hundreds of KiB.
          if (retain) chunks.push(Buffer.from(chunk));
        };
        child.stdout.on("data", chunk => read(chunk, true));
        child.stderr.on("data", chunk => read(chunk, false));
        child.stdout.once("end", () => { stdoutDone = true; checkDone(); });
        child.stderr.once("end", () => { stderrDone = true; checkDone(); });
        child.stdout.once("error", () => finish(false));
        child.stderr.once("error", () => finish(false));
        child.once("error", () => finish(false));
        child.once("exit", exitCode => { code = exitCode ?? -1; checkDone(); });
      });
    } catch { return failed(); }
  };
}

export function keyAddressArgs(network: ZeroneNetworkConfig, keyName: string): string[] {
  return [
    "keys", "show", keyName, "-a",
    "--keyring-backend", "test",
    "--home", expandHome(network.keyring_home),
  ];
}

export function resolveKeyAddress(
  runner: ZeronedRunner,
  network: ZeroneNetworkConfig,
  keyName: string,
): string {
  const result = runner.run(keyAddressArgs(network, keyName));
  const address = result.stdout.trim();
  if (result.exit_code !== 0 || !/^zrn1[0-9a-z]{20,90}$/.test(address)) {
    throw new Error(
      `could not resolve address for key "${keyName}" in ${network.keyring_home}: ${result.stderr.trim() || address || "empty output"}`,
    );
  }
  return address;
}

export interface AnchorTxOptions {
  gas?: number;
  fee_uzrn?: number;
}

export function bankSendAnchorArgs(
  network: ZeroneNetworkConfig,
  address: string,
  memo: string,
  options: AnchorTxOptions = {},
): string[] {
  return [
    "tx", "bank", "send", address, address, ANCHOR_SEND_AMOUNT,
    "--note", memo,
    "--chain-id", network.chain_id,
    "--node", network.rpc,
    "--home", expandHome(network.keyring_home),
    "--keyring-backend", "test",
    "--gas", String(options.gas ?? DEFAULT_GAS),
    "--fees", `${options.fee_uzrn ?? DEFAULT_FEE_UZRN}uzrn`,
    "--broadcast-mode", "sync",
    "--yes",
    "--output", "json",
  ];
}

export interface BroadcastResult {
  outcome: "accepted" | "rejected" | "ambiguous";
  tx_hash: string | null;
  code?: number;
  detail?: string;
}

// Errors zeroned can only produce BEFORE a transaction leaves this machine.
const PRE_BROADCAST_ERROR = /key .* not found|key not found|no such file|unknown flag|invalid coins|invalid decimal|tx intended signer does not match|chain-id required|failed to read|is not a valid/i;

/**
 * Broadcast discipline: once the process was invoked, any unparseable outcome
 * is "ambiguous" — the tx may or may not have entered the mempool. Only a
 * parsed CheckTx response or a recognisably pre-broadcast error is definite.
 */
export function broadcastAnchor(runner: ZeronedRunner, args: string[]): BroadcastResult {
  let result: ZeronedRunResult;
  try {
    result = runner.run(args);
  } catch (error) {
    return {
      outcome: "ambiguous",
      tx_hash: null,
      detail: `broadcast invocation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsed = extractJson(result.stdout);
  if (parsed && typeof parsed.txhash === "string") {
    const code = parseUnsignedInteger(parsed.code);
    if (code === null) {
      return { outcome: "ambiguous", tx_hash: parsed.txhash, detail: "missing or malformed CheckTx code" };
    }
    if (code === 0) return { outcome: "accepted", tx_hash: parsed.txhash, code };
    return {
      outcome: "rejected",
      tx_hash: parsed.txhash,
      code,
      detail: typeof parsed.raw_log === "string" ? parsed.raw_log : `CheckTx code ${code}`,
    };
  }
  const stderr = result.stderr.trim();
  if (result.exit_code !== 0 && PRE_BROADCAST_ERROR.test(stderr)) {
    return { outcome: "rejected", tx_hash: null, detail: stderr };
  }
  return {
    outcome: "ambiguous",
    tx_hash: null,
    detail: stderr || result.stdout.trim() || `zeroned exited ${result.exit_code} with no output`,
  };
}

export type TxLookup =
  | { found: true; height: number; code: number; memo: string; detail?: string }
  | { found: false; height?: never; code?: never; memo?: never; detail?: string };

/** JSON numbers and decimal integer strings only; never coerce null/bools/empty. */
function parseUnsignedInteger(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function queryTxArgs(network: ZeroneNetworkConfig, txHash: string): string[] {
  return ["query", "tx", txHash, "--node", network.rpc, "--output", "json"];
}

export function lookupTx(
  runner: ZeronedRunner,
  network: ZeroneNetworkConfig,
  txHash: string,
): TxLookup {
  let result: ZeronedRunResult;
  try {
    result = runner.run(queryTxArgs(network, txHash));
  } catch {
    return { found: false, detail: "query tx invocation failed" };
  }
  return parseTxLookup(result, txHash);
}

function parseTxLookup(result: ZeronedRunResult, txHash: string): TxLookup {
  if (result.exit_code !== 0) {
    return { found: false, detail: "query tx failed or transaction not found" };
  }
  const parsed = extractJson(result.stdout);
  if (!parsed) return { found: false, detail: "unparseable query tx output" };
  const height = parseUnsignedInteger(parsed.height);
  const code = parseUnsignedInteger(parsed.code);
  const tx = parsed.tx as { body?: { memo?: unknown } } | null | undefined;
  const memo = tx?.body?.memo;
  if (height === null || height <= 0 || code === null || typeof memo !== "string") {
    return { found: false, detail: "missing or malformed transaction evidence" };
  }
  // Positive evidence must explicitly echo the transaction this query selected.
  // A legacy response omitting txhash is unknown, not proof by request alone.
  if (typeof parsed.txhash !== "string" || parsed.txhash.toUpperCase() !== txHash.toUpperCase()) {
    return { found: false, detail: "transaction hash does not match query" };
  }
  return { found: true, height, code, memo };
}

export async function waitForTx(
  runner: ZeronedRunner,
  network: ZeroneNetworkConfig,
  txHash: string,
  options: { timeout_ms?: number; interval_ms?: number } = {},
): Promise<TxLookup> {
  const timeoutMs = options.timeout_ms ?? 60_000;
  const intervalMs = options.interval_ms ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  let last: TxLookup = { found: false, detail: "not yet queried" };
  for (;;) {
    last = lookupTx(runner, network, txHash);
    if (last.found) return last;
    if (Date.now() >= deadline) return last;
    await Bun.sleep(intervalMs);
  }
}

function extractJson(output: string): Record<string, unknown> | null {
  const start = output.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed: unknown = JSON.parse(output.slice(start));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
