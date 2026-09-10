/**
 * Explicit, read-only witness observation through a host-pinned CLI.
 * A local sidecar is not a fresh RPC check; an RPC report is not trustless finality.
 * No transaction, keyring, credential lookup, or automatic remote-check method.
 * Doctrine: docs/COLLABORATION-CHANNELS.md
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";

/** Host-owned configuration, never accepted from imported feedback. */
export interface WitnessBinding {
  command: string;
  cli_path: string;
  zeroned_bin: string;
  node: string;
  observer_name: string;
  network: string;
  workspace_id: string;
  db_path: string;
  ledger_path: string;
  /** Host-selected scratch parent; each observation uses a fresh private HOME/cwd below it. */
  home: string;
  timeout_ms?: number;
  /** Ceiling for outer pipes and, separately, cumulative query pipes; at most 1 MiB each. */
  max_output_bytes?: number;
}

export interface WitnessSelection {
  tx_hash: string;
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  head_hash: string;
  memo: string;
}

export interface WitnessRunRequest {
  cmd: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd: string;
}

/** Injected runners are trusted host code, not data selected by a peer. */
export interface WitnessProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  /** Must stop the process and its query children, including blocked reads. */
  kill(): void;
}

export interface WitnessRunner {
  start(request: WitnessRunRequest): WitnessProcess;
}

export type WitnessUnknownReason =
  | "invalid_selection" | "cancelled" | "timeout" | "output_limit"
  | "process_failed" | "malformed_evidence" | "selection_not_found"
  | "local_prefix_unverified" | "remote_unverified";

interface ObservationBase {
  observed_at: string;
  trustless_finality: false;
}

export type WitnessEvidence =
  | ObservationBase & {
    kind: "local_sidecar";
    selection: WitnessSelection;
    recorded_status: "submitted" | "ambiguous" | "confirmed" | "failed";
    recorded_height: number | null;
    local_prefix_valid: true;
    remote_checked: false;
  }
  | ObservationBase & {
    kind: "remote_observation";
    selection: WitnessSelection;
    observer_name: string;
    network: string;
    network_source: "host_binding";
    local_prefix_valid: true;
    remote_checked: true;
    tx_code: 0;
    height: number;
  }
  | ObservationBase & {
    kind: "unknown";
    reason: WitnessUnknownReason;
    /** Whether a remote check was requested, not proof that the RPC was reached. */
    remote_checked: boolean;
  };

export interface WitnessObserveOptions {
  /** Only literal true requests the separately authorized read-only RPC query. */
  check_chain?: boolean;
  signal?: AbortSignal;
}

export interface WitnessObserver {
  observe(selection: WitnessSelection, options?: WitnessObserveOptions): Promise<WitnessEvidence>;
}

const MAX_OUTPUT = 1_048_576;
const MAX_TIME = 30_000;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const NETWORKS = new Set(["zerone-testnet-1", "zerone-1"]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validSelection(value: WitnessSelection, workspace: string): boolean {
  return object(value) !== null && value.workspace_id === workspace
    && TOKEN.test(value.workspace_id) && typeof value.epoch_id === "string" && TOKEN.test(value.epoch_id)
    && typeof value.tx_hash === "string" && /^[A-Fa-f0-9]{64}$/.test(value.tx_hash)
    && positiveInteger(value.sequence) && typeof value.head_hash === "string" && /^[a-f0-9]{64}$/.test(value.head_hash)
    && typeof value.memo === "string" && value.memo.length <= 256
    && value.memo === `agenttool.collab-anchor/0.1 ws=${workspace} epoch=${value.epoch_id} seq=${value.sequence} head=${value.head_hash}`;
}

function copyBinding(input: WitnessBinding): Required<WitnessBinding> {
  const binding = { ...input, timeout_ms: input.timeout_ms ?? 10_000, max_output_bytes: input.max_output_bytes ?? 262_144 };
  const paths = [binding.command, binding.cli_path, binding.zeroned_bin, binding.db_path, binding.ledger_path, binding.home];
  if (paths.some(path => typeof path !== "string" || !isAbsolute(path) || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path))
    || typeof binding.workspace_id !== "string" || !TOKEN.test(binding.workspace_id)
    || typeof binding.observer_name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(binding.observer_name)
    || !NETWORKS.has(binding.network)
    || !positiveInteger(binding.timeout_ms) || binding.timeout_ms > MAX_TIME
    || !positiveInteger(binding.max_output_bytes) || binding.max_output_bytes > MAX_OUTPUT) {
    throw new Error("invalid witness binding");
  }
  try {
    if (typeof binding.node !== "string" || binding.node.length > 2048 || /[\s\x00-\x1f\x7f]/.test(binding.node)) throw 0;
    const node = new URL(binding.node);
    if (!["http:", "https:"].includes(node.protocol) || node.username || node.password || node.search || node.hash) throw 0;
  } catch {
    throw new Error("invalid witness binding");
  }
  return Object.freeze(binding);
}

const systemRunner: WitnessRunner = {
  start(request) {
    // Refuse the default runner where we cannot guarantee query-child teardown.
    // A host can separately inject a runner with its own process-tree lifecycle.
    if (process.platform === "win32") throw new Error("unsupported witness process lifecycle");
    // Own a POSIX process group: verify may be blocked inside a zeroned query.
    // Killing only the CLI parent would otherwise orphan that query process.
    const child = spawn(request.cmd[0]!, request.cmd.slice(1), {
      cwd: request.cwd, env: { ...request.env }, stdio: ["ignore", "pipe", "pipe"],
      detached: true, shell: false,
    });
    const exited = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => resolve(code ?? -1));
    });
    return {
      // Node and Bun declare incompatible BYOB overloads for the same Web
      // Stream runtime interface; boundedRead checks every chunk's byte type.
      stdout: Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
      stderr: Readable.toWeb(child.stderr!) as unknown as ReadableStream<Uint8Array>,
      exited,
      kill() {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch { /* Already exited. No raw process error crosses the adapter. */ }
        child.stdout?.destroy();
        child.stderr?.destroy();
      },
    };
  },
};

class ObservationFailure extends Error {
  constructor(readonly reason: WitnessUnknownReason) { super(reason); }
}

async function boundedRead(
  runner: WitnessRunner,
  request: WitnessRunRequest,
  binding: Required<WitnessBinding>,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new ObservationFailure("cancelled");
  let child: WitnessProcess | undefined;
  let runtimeHome: string | undefined;
  let readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    // Runtime configuration is executable code (bunfig preload), not merely
    // dotenv. Never run in the supplied directory or expose its HOME config.
    runtimeHome = mkdtempSync(join(binding.home, ".courier-witness-"));
    child = runner.start({ ...request, cwd: runtimeHome,
      env: Object.freeze({ ...request.env, HOME: runtimeHome, XDG_CONFIG_HOME: runtimeHome, BUN_CONFIG_NO_GLOBAL: "1" }) });
    readers = [child.stdout.getReader(), child.stderr.getReader()];
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    const read = async (reader: ReadableStreamDefaultReader<Uint8Array>, retain: boolean) => {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        if (!(next.value instanceof Uint8Array)) throw new ObservationFailure("malformed_evidence");
        bytes += next.value.byteLength;
        if (bytes > binding.max_output_bytes) throw new ObservationFailure("output_limit");
        if (retain) chunks.push(next.value.slice());
      }
    };
    const stop = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ObservationFailure("timeout")), binding.timeout_ms);
      cancel = () => reject(new ObservationFailure("cancelled"));
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
    // All pipes and the process are covered by the same deadline, even if one
    // pipe closes while another is silent forever. Rejections remain handled.
    const collect = Promise.all([read(readers[0]!, true), read(readers[1]!, false), child.exited]);
    const [, , code] = await Promise.race([collect, stop]);
    if (code !== 0) throw new ObservationFailure("process_failed");
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) signal?.removeEventListener("abort", cancel);
    // Never await cancellation of a possibly blocked stream in the stop path.
    try { child?.kill(); } catch { /* Trusted runner failure is not printable. */ }
    for (const reader of readers) void reader.cancel().catch(() => {});
    if (runtimeHome) rmSync(runtimeHome, { recursive: true, force: true });
  }
}

/** Construct once from a private host binding; construction performs no I/O. */
export function createWitnessObserver(
  input: WitnessBinding,
  options: { runner?: WitnessRunner } = {},
): WitnessObserver {
  const binding = copyBinding(input);
  const runner = options.runner ?? systemRunner;
  return Object.freeze({
    async observe(selection: WitnessSelection, options: WitnessObserveOptions = {}): Promise<WitnessEvidence> {
      const remote = options.check_chain === true;
      const base = (): ObservationBase => ({ observed_at: new Date().toISOString(), trustless_finality: false });
      const unknown = (reason: WitnessUnknownReason): WitnessEvidence => ({ ...base(), kind: "unknown", reason, remote_checked: remote });
      if (!validSelection(selection, binding.workspace_id)) return unknown("invalid_selection");
      // Snapshot only named fields: concurrent caller mutation cannot change the
      // selected record while a process runs, and unknown properties never return.
      const selected: WitnessSelection = {
        workspace_id: selection.workspace_id, epoch_id: selection.epoch_id, sequence: selection.sequence,
        head_hash: selection.head_hash, memo: selection.memo, tx_hash: selection.tx_hash,
      };
      const cmd = [binding.command, "--no-env-file", "--config=/dev/null", binding.cli_path, "verify", "--workspace", binding.workspace_id,
        "--db", binding.db_path, "--ledger", binding.ledger_path, "--network", binding.network, "--json"];
      if (remote) cmd.push("--check-chain", "--node", binding.node);
      try {
        const output = await boundedRead(runner, {
          cmd: Object.freeze(cmd), cwd: binding.home,
          env: Object.freeze({ PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin", TMPDIR: "/tmp", ZERONED_BIN: binding.zeroned_bin,
            COLLAB_ZERONE_QUERY_MAX_OUTPUT_BYTES: String(binding.max_output_bytes), COLLAB_ZERONE_QUERY_TIMEOUT_MS: String(binding.timeout_ms) }),
        }, binding, options.signal);
        let parsed: Record<string, unknown> | null;
        try { parsed = object(JSON.parse(output)); } catch { return unknown("malformed_evidence"); }
        if (!parsed || parsed.workspace_id !== selected.workspace_id || parsed.epoch_id !== selected.epoch_id
          || parsed.chain_checked !== remote || parsed.ledger_note !== null || !Array.isArray(parsed.anchors)) {
          return unknown("malformed_evidence");
        }
        if (parsed.journal_valid !== true) return unknown("local_prefix_unverified");
        // Even exit 0 with no anchors, unrelated anchors, or duplicate identities
        // proves nothing about the caller's selected transaction.
        const matches = parsed.anchors.map(object).filter(check => {
          const anchor = object(check?.anchor);
          return anchor?.tx_hash === selected.tx_hash;
        });
        if (matches.length !== 1) return unknown("selection_not_found");
        const check = matches[0]!;
        const anchor = object(check.anchor)!;
        if (anchor.workspace_id !== selected.workspace_id || anchor.epoch_id !== selected.epoch_id
          || anchor.sequence !== selected.sequence || anchor.head_hash !== selected.head_hash
          || anchor.memo !== selected.memo || anchor.network !== binding.network) return unknown("malformed_evidence");
        if (check.local_match !== true) return unknown("local_prefix_unverified");
        const status = anchor.status;
        if (status !== "submitted" && status !== "ambiguous" && status !== "confirmed" && status !== "failed") return unknown("malformed_evidence");
        if (!remote) {
          if (check.chain !== null) return unknown("malformed_evidence");
          const height = anchor.confirmed_height;
          if (height !== undefined && height !== null && !positiveInteger(height)) return unknown("malformed_evidence");
          return { ...base(), kind: "local_sidecar", selection: selected, recorded_status: status,
            recorded_height: positiveInteger(height) ? height : null, local_prefix_valid: true, remote_checked: false };
        }
        const chain = object(check.chain);
        if (!chain || chain.found !== true || chain.tx_code !== 0 || !positiveInteger(chain.height)
          || chain.memo_matches !== true || status === "failed") return unknown("remote_unverified");
        return { ...base(), kind: "remote_observation", selection: selected, observer_name: binding.observer_name,
          network: binding.network, network_source: "host_binding", local_prefix_valid: true, remote_checked: true, tx_code: 0, height: chain.height };
      } catch (error) {
        return unknown(error instanceof ObservationFailure ? error.reason : "process_failed");
      }
    },
  });
}
