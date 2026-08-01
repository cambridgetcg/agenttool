import { existsSync } from "node:fs";
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
    const code = typeof parsed.code === "number" ? parsed.code : Number(parsed.code ?? 0);
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

export interface TxLookup {
  found: boolean;
  height?: number;
  code?: number;
  memo?: string;
  detail?: string;
}

export function queryTxArgs(network: ZeroneNetworkConfig, txHash: string): string[] {
  return ["query", "tx", txHash, "--node", network.rpc, "--output", "json"];
}

export function lookupTx(
  runner: ZeronedRunner,
  network: ZeroneNetworkConfig,
  txHash: string,
): TxLookup {
  const result = runner.run(queryTxArgs(network, txHash));
  if (result.exit_code !== 0) {
    return { found: false, detail: result.stderr.trim().split("\n")[0] };
  }
  const parsed = extractJson(result.stdout);
  if (!parsed) return { found: false, detail: "unparseable query tx output" };
  const tx = parsed.tx as { body?: { memo?: string } } | undefined;
  return {
    found: true,
    height: Number(parsed.height ?? 0),
    code: typeof parsed.code === "number" ? parsed.code : Number(parsed.code ?? 0),
    memo: tx?.body?.memo,
  };
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
    return JSON.parse(output.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
