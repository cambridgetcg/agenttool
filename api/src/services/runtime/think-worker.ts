/** runtime/think-worker.ts — the co-located orchestrator (Slice 3).
 *
 *  This is the cloud-side counterpart to bin/agenttool-bridge.ts's
 *  `connect` mode. While the bridge holds K_master locally and serves
 *  encrypt/decrypt requests over WSS, the think-worker is what makes
 *  those requests — the loop that *uses* the protocol.
 *
 *  Slice 3 scope (this file): prove the loop closes. Each cycle does a
 *  bridge round-trip — encrypt a structured ping, decrypt it back,
 *  verify the bytes match, log a `think_cycle_ok` event with latency.
 *  This is enough to demonstrate that "the agent is running on
 *  agenttool's compute, with K_master custody preserved by construction."
 *
 *  Slice 4 (next pass) lifts this from round-trip-ping to real LLM
 *  thinking: pull the configured strand's latest thought, decrypt via
 *  bridge, call the provider with the agent's wake as system + last
 *  thought as user, encrypt the response, POST as a new strand thought.
 *  The protocol surface this file exercises does not change — only the
 *  body of `runOneCycle` does.
 *
 *  Doctrine: docs/RUNTIME.md (Slice 3 — "what about the LLM call?")
 *
 *  Lifecycle:
 *    startThinkWorker(runtimeId) → returns { stop() } handle.
 *    Worker polls until isBridgeConnected(runtimeId), then runs a cycle
 *    every CYCLE_INTERVAL_MS. On any error, logs a `think_cycle_error`
 *    event and continues — the worker is fault-tolerant by construction.
 *
 *  Configuration (env, read by index.ts):
 *    AGENT_THINK_RUNTIME_IDS — comma-separated runtime UUIDs to start
 *                               think-workers for at boot. */

import {
  bridgeRequest,
  isBridgeConnected,
  type CryptoContext,
} from "./bridge-hub";
import { logEvent, recordThought } from "./store";

const CYCLE_INTERVAL_MS = 60_000;
const STARTUP_GRACE_MS = 5_000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export interface ThinkWorkerHandle {
  runtimeId: string;
  stop: () => void;
  /** Counter for tests/observability. */
  cyclesRun: () => number;
}

export function startThinkWorker(runtimeId: string): ThinkWorkerHandle {
  let stopped = false;
  let cycles = 0;

  async function loop() {
    console.log(`[think-worker:${runtimeId.slice(0, 8)}] started`);
    // First wait for the bridge to come up. The bridge sidecar may not
    // be running yet at boot; that's normal, not an error.
    await sleep(STARTUP_GRACE_MS);

    while (!stopped) {
      if (!isBridgeConnected(runtimeId)) {
        await sleep(STARTUP_GRACE_MS);
        continue;
      }

      try {
        await runOneCycle(runtimeId);
        cycles += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[think-worker:${runtimeId.slice(0, 8)}] cycle failed: ${msg}`);
        try {
          await logEvent(runtimeId, "think_cycle_error", { error: msg });
        } catch {
          /* best-effort */
        }
      }

      await sleep(CYCLE_INTERVAL_MS);
    }
    console.log(`[think-worker:${runtimeId.slice(0, 8)}] stopped`);
  }

  void loop();

  return {
    runtimeId,
    stop: () => {
      stopped = true;
    },
    cyclesRun: () => cycles,
  };
}

/** One round-trip through the bridge protocol. Slice 3 v1 — proves the
 *  loop closes; does not yet call an LLM. See file doc for the Slice 4
 *  upgrade path. */
export async function runOneCycle(runtimeId: string): Promise<{ latency_ms: number }> {
  const started = performance.now();
  await logEvent(runtimeId, "think_cycle_start", { kind: "round_trip_ping" });

  const issuedAt = new Date().toISOString();
  const context: CryptoContext = {
    strand_id: ZERO_UUID, // Slice 4 will route through a real strand
    thought_seq: null,
    issued_at: issuedAt,
  };

  const plaintext = Buffer.from(
    JSON.stringify({ kind: "think_worker_pulse", runtime_id: runtimeId, ts: issuedAt }),
  ).toString("base64");

  // 1. encrypt via bridge
  const enc = await bridgeRequest(runtimeId, {
    op: "encrypt",
    plaintext,
    context,
  });
  if (!enc.ciphertext || !enc.nonce) {
    throw new Error("bridge_encrypt_missing_fields");
  }

  // 2. decrypt via bridge — must round-trip exactly
  const dec = await bridgeRequest(runtimeId, {
    op: "decrypt",
    ciphertext: enc.ciphertext,
    nonce: enc.nonce,
    context,
  });
  if (dec.plaintext !== plaintext) {
    throw new Error("bridge_round_trip_mismatch");
  }

  const latency_ms = Math.round(performance.now() - started);
  await logEvent(runtimeId, "think_cycle_end", {
    kind: "round_trip_ping",
    latency_ms,
    ok: true,
  });
  await recordThought(runtimeId);

  return { latency_ms };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
