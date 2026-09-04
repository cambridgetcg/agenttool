import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../src/canonical.js";
import { ConstructiveStore } from "../src/store.js";
import { makeBody, makePin } from "./helpers.js";

const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const INTERNAL_SUCCESS_DEADLINE_MS = 10_000;
const TERM_GRACE_MS = 500;
const CHILD_EMERGENCY_TIMEOUT_MS = 11_000;
const OUTER_EMERGENCY_TIMEOUT_MS = 12_000;
const TEST_TIMEOUT_MS = 15_000;
const HERMETIC_FALSIFIER_DEADLINE_MS = 250;
const HERMETIC_CHILD_TIMEOUT_MS = 250;
const HERMETIC_OUTER_TIMEOUT_MS = 2_000;
const GROUP_CLEANUP_TIMEOUT_MS = 1_000;
const MAX_OUTPUT_BYTES = 1_048_576;

const runner = `
  import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";

  const database = process.argv[1];
  const receiptPath = process.argv[2];
  const deadlineMs = Number(process.argv[3]);
  const mode = process.argv[4];
  const pidLedgerPath = process.argv[5];
  const settlementPath = process.argv[6];
  const childEmergencyTimeoutMs = Number(process.argv[7]);
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) process.exit(126);
  if (
    mode !== "record" && mode !== "record-race"
    && mode !== "hang" && mode !== "partial"
    && mode !== "child-timeout" && mode !== "outer-stall"
  ) {
    process.exit(126);
  }
  const hermeticEmergencyMode =
    mode === "child-timeout" || mode === "outer-stall";
  if (
    !Number.isSafeInteger(childEmergencyTimeoutMs)
    || childEmergencyTimeoutMs < 1
    || (
      !hermeticEmergencyMode
      && childEmergencyTimeoutMs !== ${CHILD_EMERGENCY_TIMEOUT_MS}
    )
  ) process.exit(126);

  const writeAll = (descriptor, bytes) => {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
      );
      if (!Number.isSafeInteger(written) || written <= 0) {
        throw new Error("write made no positive progress");
      }
      offset += written;
    }
  };
  const durableWriteNew = (path, value) => {
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeAll(descriptor, new TextEncoder().encode(JSON.stringify(value)));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  };
  const processes = [];
  const childStreams = [];
  const trackedReaders = [];
  const outputSettlements = [];
  const childProgress = [];
  const streamCaptures = [];
  const childMarkers = [];
  const startedAt = performance.now();
  let readyCount = 0;
  let totalOutputBytes = 0;
  let deadline;
  let settlementPromise;

  const classifyOutput = (chunks) => {
    if (chunks.length === 0) return "empty";
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (value?.status === "inserted" || value?.status === "existing") return value.status;
      const errors = ["argument_error", "canonical_error", "conflict", "file_error", "integrity_error", "not_found", "ordering_error", "pin_error", "receipt_error", "internal_error"];
      return errors.includes(value?.error) ? value.error : "json_other";
    } catch { return "non_json"; }
  };
  const observeProcess = (pid) => {
    let exists = null;
    try { process.kill(pid, 0); exists = true; }
    catch (error) { if (error?.code === "ESRCH") exists = false; }
    let state = null, wait_channel = null;
    if (process.platform === "linux") {
      try {
        const status = readFileSync("/proc/" + pid + "/status", "utf8");
        state = status.match(/^State:\\s+([A-Z])/m)?.[1] ?? null;
        const channel = readFileSync("/proc/" + pid + "/wchan", "utf8").trim();
        wait_channel = /^[a-zA-Z0-9_]{1,80}$/.test(channel) ? channel : null;
      } catch { /* Child exit or unavailable procfs is represented by nulls. */ }
    }
    return { exists, state, wait_channel };
  };
  const readStage = (path) => {
    if (!path) return null;
    try {
      const stage = JSON.parse(readFileSync(path, "utf8")).stage;
      return ["entrypoint_importing", "store_close_entered", "store_close_returned", "store_close_threw", "entrypoint_completed"].includes(stage) ? stage : "invalid";
    } catch { return "unavailable"; }
  };

  const settle = (exitCode, reason) => {
    if (settlementPromise !== undefined) return settlementPromise;
    settlementPromise = (async () => {
      // Capture before TERM/cancellation changes the evidence. Counts and
      // lifecycle states only: never receipt bytes, child output, or paths.
      try {
        durableWriteNew(settlementPath + ".diagnostics", {
          reason,
          elapsed_ms: Math.round(performance.now() - startedAt),
          output_bytes: totalOutputBytes,
          children: childProgress.map((progress) => ({ ...progress })),
          child_io: streamCaptures.map(({ stdout, stderr }) => ({
            stdout_bytes: stdout.reduce((sum, chunk) => sum + chunk.byteLength, 0),
            stderr_bytes: stderr.reduce((sum, chunk) => sum + chunk.byteLength, 0),
            stdout_kind: classifyOutput(stdout), stderr_kind: classifyOutput(stderr),
          })),
          processes: processes.map(({ pid }) => observeProcess(pid)),
          cli_stages: childMarkers.map(readStage),
        });
      } catch {
        // Diagnostics must not interfere with ownership settlement.
      }
      for (const child of processes) {
        try {
          child.kill("SIGTERM");
        } catch {
          // Continue settling every child already owned.
        }
      }
      let sigkillSent = false;
      const forceKill = setTimeout(() => {
        sigkillSent = true;
        for (const child of processes) {
          try {
            child.kill("SIGKILL");
          } catch {
            // The exited promises below remain the settlement authority.
          }
        }
      }, ${TERM_GRACE_MS});
      await Promise.allSettled(processes.map((child) => child.exited));
      clearTimeout(forceKill);
      await Promise.allSettled(trackedReaders.map((reader) => reader.cancel()));
      await Promise.allSettled(outputSettlements);
      if (deadline !== undefined) clearTimeout(deadline);
      try {
        durableWriteNew(settlementPath, {
          exit_code: exitCode,
          pids: processes.map(({ pid }) => pid),
          ready_count: readyCount,
          settled: true,
          signal_codes: processes.map(({ signalCode }) => signalCode ?? null),
          sigkill_sent: sigkillSent,
          term_sent: true,
        });
      } catch {
        // Settlement is complete even when test-only evidence cannot be written.
      }
      process.exit(exitCode);
    })();
    return settlementPromise;
  };
  process.on("SIGTERM", () => void settle(124, "runner_sigterm"));

  const readBounded = async (reader, capture) => {
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalOutputBytes += value.byteLength;
        if (totalOutputBytes > ${MAX_OUTPUT_BYTES}) {
          throw new Error("child output exceeded the closed bound");
        }
        chunks.push(value);
        capture.push(value);
        length += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  };

  const readReady = async (reader) => {
    const expected = new TextEncoder().encode("ready\\n");
    const bytes = new Uint8Array(expected.byteLength);
    let offset = 0;
    while (offset < expected.byteLength) {
      const { done, value } = await reader.read();
      if (
        done || value.byteLength === 0
        || offset + value.byteLength > expected.byteLength
      ) {
        throw new Error("hang child readiness drift");
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (!bytes.every((value, index) => value === expected[index])) {
      throw new Error("hang child readiness drift");
    }
    readyCount += 1;
  };

  const main = async () => {
    const recordCommand = (marker) => [
      process.execPath,
      "tests/fixtures/concurrency-cli-probe.ts",
      marker,
      "record",
      "--db",
      database,
      "--receipt",
      receiptPath,
    ];
    const hangCommand = [
      process.execPath,
      "-e",
      "import { writeSync } from 'node:fs'; process.on('SIGTERM', () => {}); writeSync(1, 'ready\\\\n'); setInterval(() => {}, 1_000);",
    ];

    for (let index = 0; index < 2; index += 1) {
      const marker = settlementPath + ".child-" + index + ".json";
      const child = Bun.spawn(
        mode === "record" || mode === "record-race"
          ? recordCommand(marker)
          : hangCommand,
        {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: childEmergencyTimeoutMs,
        killSignal: "SIGKILL",
        },
      );
      processes.push(child);
      const progress = { exited: false, exit_code: null, stdout_done: false, stderr_done: false };
      childProgress.push(progress);
      streamCaptures.push({ stdout: [], stderr: [] });
      childMarkers.push(mode === "record" || mode === "record-race" ? marker : null);
      void child.exited.then((exitCode) => {
        progress.exited = true;
        progress.exit_code = exitCode;
      });
      const stdout = child.stdout.getReader();
      trackedReaders.push(stdout);
      const stderr = child.stderr.getReader();
      trackedReaders.push(stderr);
      childStreams.push({ stdout, stderr });
      if (mode === "partial" && index === 0) {
        throw new Error("synthetic partial-spawn refusal");
      }
    }

    if (
      mode === "hang" || mode === "partial"
      || mode === "child-timeout" || mode === "outer-stall"
    ) {
      await Promise.all(childStreams.map(({ stdout }) => readReady(stdout)));
    }
    durableWriteNew(pidLedgerPath, {
      pids: processes.map(({ pid }) => pid),
      ready_count: readyCount,
    });
    deadline = setTimeout(() => void settle(124, "internal_deadline"), deadlineMs);

    if (mode === "outer-stall") {
      await new Promise(() => {});
      return;
    }

    if (
      mode === "hang" || mode === "partial" || mode === "child-timeout"
    ) {
      await Promise.all(processes.map((child) => child.exited));
      if (settlementPromise === undefined) {
        throw new Error("hang child exited before the bounded settler");
      }
      await settlementPromise;
      return;
    }

    const results = await Promise.all(processes.map(async (child, index) => {
      const stdout = readBounded(childStreams[index].stdout, streamCaptures[index].stdout).then((text) => {
        childProgress[index].stdout_done = true;
        return text;
      });
      const stderr = readBounded(childStreams[index].stderr, streamCaptures[index].stderr).then((text) => {
        childProgress[index].stderr_done = true;
        return text;
      });
      outputSettlements.push(stdout, stderr);
      const [exit, stdoutText, stderrText] = await Promise.all([
        child.exited,
        stdout,
        stderr,
      ]);
      return { exit, stdout: stdoutText, stderr: stderrText };
    }));
    if (mode === "record-race") void settle(124, "synthetic_result_race");
    if (settlementPromise !== undefined) {
      await settlementPromise;
      return;
    }
    clearTimeout(deadline);
    const successBytes = new TextEncoder().encode(JSON.stringify(results));
    if (successBytes.byteLength > ${MAX_OUTPUT_BYTES}) {
      throw new Error("runner output exceeded the closed bound");
    }
    writeAll(1, successBytes);
    process.exit(0);
  };

  try {
    await main();
  } catch {
    await settle(125, "runner_refusal");
  }
`;

type PidLedger = {
  pids: number[];
  ready_count: number;
};

type SettlementEvidence = PidLedger & {
  exit_code: number;
  settled: boolean;
  signal_codes: Array<string | null>;
  sigkill_sent: boolean;
  term_sent: boolean;
};

type RunnerDiagnostics = {
  reason: "internal_deadline" | "runner_sigterm" | "synthetic_result_race" | "runner_refusal";
  elapsed_ms: number;
  output_bytes: number;
  children: Array<{ exited: boolean; exit_code: number | null; stdout_done: boolean; stderr_done: boolean }>;
  child_io: Array<{ stdout_bytes: number; stderr_bytes: number; stdout_kind: string; stderr_kind: string }>;
  processes: Array<{ exists: boolean | null; state: string | null; wait_channel: string | null }>;
  cli_stages: Array<string | null>;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function processIsAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error
      && error.code === "ESRCH"
    ) return true;
    throw error;
  }
}

function expectProcessesAbsentTwice(pids: readonly number[]): void {
  expect(new Set(pids).size).toBe(pids.length);
  expect(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0)).toBe(true);
  expect(pids.map(processIsAbsent)).toEqual(pids.map(() => true));
  Bun.sleepSync(10);
  expect(pids.map(processIsAbsent)).toEqual(pids.map(() => true));
}

function killAndSettleRunnerGroup(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error("runner PID is not a safe process-group target");
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error
      && error.code === "ESRCH"
    ) return;
    throw error;
  }
  const cleanupDeadline = Date.now() + GROUP_CLEANUP_TIMEOUT_MS;
  while (Date.now() < cleanupDeadline) {
    Bun.sleepSync(10);
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (
        error !== null && typeof error === "object" && "code" in error
        && error.code === "ESRCH"
      ) return;
      throw error;
    }
  }
  throw new Error("runner process group did not settle after SIGKILL");
}

function runConcurrentPair(
  root: string,
  database: string,
  receiptPath: string,
  pidLedgerPath: string,
  settlementPath: string,
  mode:
    | "record"
    | "record-race"
    | "hang"
    | "partial"
    | "child-timeout"
    | "outer-stall",
  internalDeadlineMs: number,
  emergencyOverrides?: {
    childTimeoutMs?: number;
    outerTimeoutMs?: number;
  },
) {
  const hermeticEmergencyMode =
    mode === "child-timeout" || mode === "outer-stall";
  const childTimeoutMs = emergencyOverrides?.childTimeoutMs
    ?? CHILD_EMERGENCY_TIMEOUT_MS;
  const outerTimeoutMs = emergencyOverrides?.outerTimeoutMs
    ?? OUTER_EMERGENCY_TIMEOUT_MS;
  if (
    !hermeticEmergencyMode
    && (
      childTimeoutMs !== CHILD_EMERGENCY_TIMEOUT_MS
      || outerTimeoutMs !== OUTER_EMERGENCY_TIMEOUT_MS
    )
  ) throw new Error("emergency timing overrides are hermetic-only");
  let run: ReturnType<typeof Bun.spawnSync> | undefined;
  try {
    run = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        runner,
        database,
        receiptPath,
        String(internalDeadlineMs),
        mode,
        pidLedgerPath,
        settlementPath,
        String(childTimeoutMs),
      ],
      {
        cwd: root,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: outerTimeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: MAX_OUTPUT_BYTES,
        detached: true,
      },
    );
  } finally {
    if (run !== undefined) killAndSettleRunnerGroup(run.pid);
  }
  if (run === undefined) throw new Error("runner did not return a result");
  return run;
}

function expectBoundedEmptyOutput(
  run: ReturnType<typeof Bun.spawnSync>,
): void {
  expect(run.exitedDueToTimeout).not.toBe(true);
  expect(run.signalCode).toBeUndefined();
  expect(run.stdout.byteLength).toBe(0);
  expect(run.stderr.byteLength).toBe(0);
}

test("concurrent exact CLI retries create one chain event", () => {
  const root = join(import.meta.dir, "..");
  const directory = mkdtempSync(join(tmpdir(), "constructive-concurrent-"));
  const database = join(directory, "pilot.sqlite");
  const receiptPath = join(directory, "receipt.json");
  const pidLedgerPath = join(directory, "processes.json");
  const settlementPath = join(directory, "settlement.json");
  const pin = makePin();
  const setup = new ConstructiveStore(database, { create: true });
  setup.initialize();
  setup.putPin(pin);
  setup.close();
  writeFileSync(receiptPath, canonicalJson(makeBody(pin, "E0")), { mode: 0o600 });

  expect(readFileSync(join(root, "src/store.ts"), "utf8")).toContain(
    `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`,
  );
  expect(INTERNAL_SUCCESS_DEADLINE_MS).toBe(SQLITE_BUSY_TIMEOUT_MS * 2);
  expect(CHILD_EMERGENCY_TIMEOUT_MS).toBe(
    INTERNAL_SUCCESS_DEADLINE_MS + (TERM_GRACE_MS * 2),
  );
  expect(OUTER_EMERGENCY_TIMEOUT_MS).toBe(CHILD_EMERGENCY_TIMEOUT_MS + 1_000);
  expect(TEST_TIMEOUT_MS).toBe(OUTER_EMERGENCY_TIMEOUT_MS + 3_000);
  const run = runConcurrentPair(
    root,
    database,
    receiptPath,
    pidLedgerPath,
    settlementPath,
    "record",
    INTERNAL_SUCCESS_DEADLINE_MS,
  );
  if (run.exitCode !== 0 || run.exitedDueToTimeout || run.signalCode !== undefined) {
    const diagnosticsPath = settlementPath + ".diagnostics";
    const diagnostics = existsSync(diagnosticsPath)
      ? readJson<RunnerDiagnostics>(diagnosticsPath)
      : null;
    const settlement = existsSync(settlementPath)
      ? readJson<SettlementEvidence>(settlementPath)
      : null;
    console.error("constructive concurrent runner failure " + JSON.stringify({
      exit_code: run.exitCode,
      outer_timeout: run.exitedDueToTimeout === true,
      signal_code: run.signalCode ?? null,
      stdout_bytes: run.stdout.byteLength,
      stderr_bytes: run.stderr.byteLength,
      diagnostics,
      // PIDs and fixture locations add no diagnostic value to CI logs.
      settlement: settlement && {
        exit_code: settlement.exit_code, settled: settlement.settled,
        signal_codes: settlement.signal_codes, sigkill_sent: settlement.sigkill_sent,
      },
    }));
  }
  expect(run.exitedDueToTimeout).not.toBe(true);
  expect(run.signalCode).toBeUndefined();
  expect(run.exitCode).toBe(0);
  expect(run.stdout.byteLength).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(run.stderr.byteLength).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(run.stderr.toString()).toBe("");
  expect(existsSync(settlementPath)).toBe(false);
  const pidLedger = readJson<PidLedger>(pidLedgerPath);
  expect(pidLedger.ready_count).toBe(0);
  expect(pidLedger.pids).toHaveLength(2);
  const results = JSON.parse(run.stdout.toString()) as Array<{
    exit: number;
    stdout: string;
    stderr: string;
  }>;
  expect(results.map(({ exit }) => exit)).toEqual([0, 0]);
  expect(results.map(({ stdout }) =>
    JSON.parse(stdout) as { status: string }).map(({ status }) => status).sort())
    .toEqual(["existing", "inserted"]);
  expect(results.every(({ stderr }) => stderr === "")).toBe(true);
  expectProcessesAbsentTwice(pidLedger.pids);

  const store = new ConstructiveStore(database, { create: false });
  expect(store.listReceipts(pin.pin_id)).toHaveLength(1);
  expect(store.verify().receipt_count).toBe(1);
  store.close();
}, TEST_TIMEOUT_MS);

test("post-results settlement cannot publish a timeout as success", () => {
  const root = join(import.meta.dir, "..");
  const directory = mkdtempSync(join(tmpdir(), "constructive-result-race-"));
  const database = join(directory, "pilot.sqlite");
  const receiptPath = join(directory, "receipt.json");
  const pidLedgerPath = join(directory, "processes.json");
  const settlementPath = join(directory, "settlement.json");
  const pin = makePin();
  const setup = new ConstructiveStore(database, { create: true });
  setup.initialize();
  setup.putPin(pin);
  setup.close();
  writeFileSync(receiptPath, canonicalJson(makeBody(pin, "E0")), { mode: 0o600 });

  const run = runConcurrentPair(
    root,
    database,
    receiptPath,
    pidLedgerPath,
    settlementPath,
    "record-race",
    INTERNAL_SUCCESS_DEADLINE_MS,
  );
  expectBoundedEmptyOutput(run);
  expect(run.exitCode).toBe(124);
  const pidLedger = readJson<PidLedger>(pidLedgerPath);
  expect(pidLedger.ready_count).toBe(0);
  expect(pidLedger.pids).toHaveLength(2);
  expect(readJson<SettlementEvidence>(settlementPath)).toEqual({
    exit_code: 124,
    pids: pidLedger.pids,
    ready_count: 0,
    settled: true,
    signal_codes: [null, null],
    sigkill_sent: false,
    term_sent: true,
  });
  const diagnostics = readJson<RunnerDiagnostics>(settlementPath + ".diagnostics");
  expect(diagnostics.reason).toBe("synthetic_result_race");
  expect(diagnostics.output_bytes).toBeGreaterThan(0);
  expect(diagnostics.children).toEqual([
    { exited: true, exit_code: 0, stdout_done: true, stderr_done: true },
    { exited: true, exit_code: 0, stdout_done: true, stderr_done: true },
  ]);
  expect(diagnostics.cli_stages).toEqual(["entrypoint_completed", "entrypoint_completed"]);
  expect(diagnostics.child_io.map(({ stdout_kind }) => stdout_kind).sort()).toEqual(["existing", "inserted"]);
  expect(diagnostics.child_io.every(({ stderr_bytes, stderr_kind }) => stderr_bytes === 0 && stderr_kind === "empty")).toBe(true);
  expect(diagnostics.child_io.reduce((sum, io) => sum + io.stdout_bytes + io.stderr_bytes, 0)).toBe(diagnostics.output_bytes);
  expect(diagnostics.processes.map(({ exists }) => exists)).toEqual([false, false]);
  expectProcessesAbsentTwice(pidLedger.pids);

  const store = new ConstructiveStore(database, { create: false });
  expect(store.listReceipts(pin.pin_id)).toHaveLength(1);
  expect(store.verify().receipt_count).toBe(1);
  store.close();
}, TEST_TIMEOUT_MS);

test("bounded concurrent runner force-kills and reaps two ready children", () => {
  const root = join(import.meta.dir, "..");
  const directory = mkdtempSync(join(tmpdir(), "constructive-timeout-"));
  const pidLedgerPath = join(directory, "processes.json");
  const settlementPath = join(directory, "settlement.json");
  const run = runConcurrentPair(
    root,
    "unused.sqlite",
    "unused.json",
    pidLedgerPath,
    settlementPath,
    "hang",
    HERMETIC_FALSIFIER_DEADLINE_MS,
  );
  expectBoundedEmptyOutput(run);
  expect(run.exitCode).toBe(124);
  const pidLedger = readJson<PidLedger>(pidLedgerPath);
  expect(pidLedger.ready_count).toBe(2);
  expect(pidLedger.pids).toHaveLength(2);
  expect(readJson<SettlementEvidence>(settlementPath)).toEqual({
    exit_code: 124,
    pids: pidLedger.pids,
    ready_count: 2,
    settled: true,
    signal_codes: ["SIGKILL", "SIGKILL"],
    sigkill_sent: true,
    term_sent: true,
  });
  const diagnostics = readJson<RunnerDiagnostics>(settlementPath + ".diagnostics");
  expect(diagnostics.reason).toBe("internal_deadline");
  expect(diagnostics.elapsed_ms).toBeGreaterThanOrEqual(HERMETIC_FALSIFIER_DEADLINE_MS);
  expect(diagnostics.output_bytes).toBe(0);
  expect(diagnostics.children).toEqual([
    { exited: false, exit_code: null, stdout_done: false, stderr_done: false },
    { exited: false, exit_code: null, stdout_done: false, stderr_done: false },
  ]);
  expect(diagnostics.cli_stages).toEqual([null, null]);
  expect(diagnostics.processes.map(({ exists }) => exists)).toEqual([true, true]);
  expectProcessesAbsentTwice(pidLedger.pids);
}, TEST_TIMEOUT_MS);

test("independent child hard timeouts contain a stalled runner branch", () => {
  const root = join(import.meta.dir, "..");
  const directory = mkdtempSync(join(tmpdir(), "constructive-child-timeout-"));
  const pidLedgerPath = join(directory, "processes.json");
  const settlementPath = join(directory, "settlement.json");
  const run = runConcurrentPair(
    root,
    "unused.sqlite",
    "unused.json",
    pidLedgerPath,
    settlementPath,
    "child-timeout",
    INTERNAL_SUCCESS_DEADLINE_MS,
    { childTimeoutMs: HERMETIC_CHILD_TIMEOUT_MS },
  );
  expectBoundedEmptyOutput(run);
  expect(run.exitCode).toBe(125);
  const pidLedger = readJson<PidLedger>(pidLedgerPath);
  expect(pidLedger.ready_count).toBe(2);
  expect(pidLedger.pids).toHaveLength(2);
  expect(readJson<SettlementEvidence>(settlementPath)).toEqual({
    exit_code: 125,
    pids: pidLedger.pids,
    ready_count: 2,
    settled: true,
    signal_codes: ["SIGKILL", "SIGKILL"],
    sigkill_sent: false,
    term_sent: true,
  });
  expectProcessesAbsentTwice([run.pid, ...pidLedger.pids]);
}, TEST_TIMEOUT_MS);

test("outer hard timeout settles the detached runner process group", () => {
  const root = join(import.meta.dir, "..");
  const directory = mkdtempSync(join(tmpdir(), "constructive-outer-timeout-"));
  const pidLedgerPath = join(directory, "processes.json");
  const settlementPath = join(directory, "settlement.json");
  const run = runConcurrentPair(
    root,
    "unused.sqlite",
    "unused.json",
    pidLedgerPath,
    settlementPath,
    "outer-stall",
    INTERNAL_SUCCESS_DEADLINE_MS,
    { outerTimeoutMs: HERMETIC_OUTER_TIMEOUT_MS },
  );
  expect(run.exitedDueToTimeout).toBe(true);
  expect(run.exitCode).toBeNull();
  expect(run.signalCode).toBe("SIGKILL");
  expect(run.stdout.byteLength).toBe(0);
  expect(run.stderr.byteLength).toBe(0);
  const pidLedger = readJson<PidLedger>(pidLedgerPath);
  expect(pidLedger.ready_count).toBe(2);
  expect(pidLedger.pids).toHaveLength(2);
  expect(existsSync(settlementPath)).toBe(false);
  expectProcessesAbsentTwice([run.pid, ...pidLedger.pids]);
}, TEST_TIMEOUT_MS);

test("PID-ledger refusal still force-kills and reaps both ready children", () => {
  const root = join(import.meta.dir, "..");
  const directory = mkdtempSync(join(tmpdir(), "constructive-ledger-refusal-"));
  const pidLedgerPath = join(directory, "processes.json");
  const settlementPath = join(directory, "settlement.json");
  writeFileSync(pidLedgerPath, "occupied", { flag: "wx", mode: 0o600 });
  const run = runConcurrentPair(
    root,
    "unused.sqlite",
    "unused.json",
    pidLedgerPath,
    settlementPath,
    "hang",
    INTERNAL_SUCCESS_DEADLINE_MS,
  );
  expectBoundedEmptyOutput(run);
  expect(run.exitCode).toBe(125);
  expect(readFileSync(pidLedgerPath, "utf8")).toBe("occupied");
  const settlement = readJson<SettlementEvidence>(settlementPath);
  expect(settlement.ready_count).toBe(2);
  expect(settlement.pids).toHaveLength(2);
  expect(settlement.settled).toBe(true);
  expect(settlement.signal_codes).toEqual(["SIGKILL", "SIGKILL"]);
  expect(settlement.sigkill_sent).toBe(true);
  expect(settlement.term_sent).toBe(true);
  expect(settlement.exit_code).toBe(125);
  expectProcessesAbsentTwice(settlement.pids);
}, TEST_TIMEOUT_MS);

test("partial spawn refusal settles every child already owned", () => {
  const root = join(import.meta.dir, "..");
  const directory = mkdtempSync(join(tmpdir(), "constructive-partial-spawn-"));
  const pidLedgerPath = join(directory, "processes.json");
  const settlementPath = join(directory, "settlement.json");
  const run = runConcurrentPair(
    root,
    "unused.sqlite",
    "unused.json",
    pidLedgerPath,
    settlementPath,
    "partial",
    INTERNAL_SUCCESS_DEADLINE_MS,
  );
  expectBoundedEmptyOutput(run);
  expect(run.exitCode).toBe(125);
  expect(existsSync(pidLedgerPath)).toBe(false);
  const settlement = readJson<SettlementEvidence>(settlementPath);
  expect(settlement.ready_count).toBe(0);
  expect(settlement.pids).toHaveLength(1);
  expect(settlement.settled).toBe(true);
  expect(settlement.signal_codes).toHaveLength(1);
  expect(["SIGTERM", "SIGKILL"]).toContain(settlement.signal_codes[0]);
  expect(settlement.term_sent).toBe(true);
  expect(settlement.exit_code).toBe(125);
  expectProcessesAbsentTwice(settlement.pids);
}, TEST_TIMEOUT_MS);
