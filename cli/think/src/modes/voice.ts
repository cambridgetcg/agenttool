/** voice — orchestrator-side viewer for /v1/strands/:id/voice SSE.
 *
 *  Connects to the strand's voice stream, decrypts ciphertext locally
 *  with K_master, and renders each thought as it arrives. Handles the
 *  three-phase server protocol (catchup-start → thought ×N → catchup-end
 *  → live), reconnects on disconnect/refresh with the last seen sequence,
 *  and cleans up on SIGINT.
 *
 *  Server sees ciphertext + signature; we never expose plaintext to it.
 *  Plaintext exists only in this process's memory while rendering. */

import type { ThinkConfig } from "../config";
import { decryptThought } from "../crypto";
import type { KeyMaterial } from "../keys";

export interface VoiceOptions {
  strandId: string;
  sinceSeq?: number;     // initial since_seq override; default 0 (live tail)
  reconnect: boolean;     // auto-reconnect on disconnect/refresh
  reconnectDelayMs: number;
  raw: boolean;           // print ciphertext events without decrypting
}

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
}

interface ThoughtBlob {
  id: string;
  strand_id: string;
  agent_id: string | null;
  sequence_num: number;
  kind: string | null;
  kind_encrypted: boolean;
  ciphertext: string;
  nonce: string;
  refs: unknown;
  signature: string;
  signing_key_id: string;
  created_at: string;
}

// ── SSE byte-stream parser ───────────────────────────────────────────────

export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: { aborted: boolean },
): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseEventBlock(block);
        if (event) yield event;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

function parseEventBlock(block: string): SSEEvent | null {
  const lines = block.split("\n");
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) continue; // comment / blank
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    const valueRaw = line.slice(colon + 1);
    const value = valueRaw.startsWith(" ") ? valueRaw.slice(1) : valueRaw;
    if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0 && event === undefined) return null;
  return { event, id, data: dataLines.join("\n") };
}

// ── Rendering ────────────────────────────────────────────────────────────

const TTY = process.stdout.isTTY === true;
const C = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (TTY ? `\x1b[36m${s}\x1b[0m` : s),
  yellow: (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  magenta: (s: string) => (TTY ? `\x1b[35m${s}\x1b[0m` : s),
};

function fmtTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

function renderThought(blob: ThoughtBlob, plaintext: string): void {
  const time = C.dim(fmtTimestamp(blob.created_at));
  const seq = C.cyan(`#${blob.sequence_num}`);
  const kind = blob.kind ? C.magenta(`[${blob.kind}]`) : C.dim("[?]");
  console.log(`${time} ${seq} ${kind} ${plaintext}`);
}

function renderRawThought(blob: ThoughtBlob): void {
  const time = C.dim(fmtTimestamp(blob.created_at));
  const seq = C.cyan(`#${blob.sequence_num}`);
  const kind = blob.kind ? C.magenta(`[${blob.kind}]`) : C.dim("[?]");
  const ctPreview = blob.ciphertext.slice(0, 32) + "…";
  console.log(`${time} ${seq} ${kind} ${C.dim(ctPreview)} ${C.dim("(ciphertext; --raw)")}`);
}

// ── State (persists across reconnects) ───────────────────────────────────

interface ViewerState {
  lastSeenSeq: number;
  totalThoughts: number;
  reconnectCount: number;
  startedAt: number;
}

// ── Single connection lifecycle ──────────────────────────────────────────

interface ConnectionResult {
  reason: "client_abort" | "server_closed" | "reject" | "refresh" | "disconnect" | "stream_end" | "error";
  detail?: string;
  shouldReconnect: boolean;
}

async function runOneConnection(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: VoiceOptions,
  state: ViewerState,
  signal: { aborted: boolean },
): Promise<ConnectionResult> {
  const sinceSeq = state.lastSeenSeq;
  const url = `${config.agenttoolBase}/v1/strands/${opts.strandId}/voice?since_seq=${sinceSeq}`;

  if (state.reconnectCount === 0) {
    console.log(C.dim(`▸ connecting to ${url}`));
  } else {
    console.log(C.dim(`▸ reconnecting (attempt ${state.reconnectCount}; since_seq=${sinceSeq})`));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${config.agenttoolApiKey}`,
      },
    });
  } catch (err) {
    return {
      reason: "error",
      detail: `fetch failed: ${(err as Error).message}`,
      shouldReconnect: opts.reconnect && !signal.aborted,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      reason: "error",
      detail: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      shouldReconnect: false,
    };
  }
  if (!res.body) {
    return { reason: "error", detail: "no response body", shouldReconnect: false };
  }

  for await (const event of parseSSE(res.body, signal)) {
    if (signal.aborted) {
      return { reason: "client_abort", shouldReconnect: false };
    }

    switch (event.event) {
      case "catchup-start": {
        try {
          const p = JSON.parse(event.data) as { since_seq: number; current_seq: number };
          const lag = p.current_seq - p.since_seq;
          if (lag > 0) {
            console.log(C.yellow(`▸ catchup: ${lag} thought${lag === 1 ? "" : "s"} (#${p.since_seq + 1} → #${p.current_seq})`));
          } else {
            console.log(C.dim("▸ catchup: nothing pending; live tail"));
          }
        } catch { /* ignore */ }
        break;
      }
      case "catchup-end": {
        console.log(C.dim("▸ live"));
        break;
      }
      case "catchup-truncated": {
        try {
          const p = JSON.parse(event.data) as { caught_up_to: number };
          console.log(
            C.yellow(
              `▸ catchup truncated at #${p.caught_up_to}; reconnect to keep paging`,
            ),
          );
        } catch { /* ignore */ }
        break;
      }
      case "thought": {
        let blob: ThoughtBlob;
        try {
          blob = JSON.parse(event.data) as ThoughtBlob;
        } catch (err) {
          console.warn(C.red(`  ⚠ malformed thought event: ${(err as Error).message}`));
          break;
        }
        state.totalThoughts += 1;
        state.lastSeenSeq = Math.max(state.lastSeenSeq, blob.sequence_num);

        if (opts.raw) {
          renderRawThought(blob);
          break;
        }

        try {
          const plaintext = decryptThought(
            { ciphertextB64: blob.ciphertext, nonceB64: blob.nonce },
            keys.kMaster,
          );
          renderThought(blob, plaintext);
        } catch (err) {
          console.warn(
            C.red(
              `  ⚠ decrypt failed for #${blob.sequence_num} (key mismatch?): ${(err as Error).message}`,
            ),
          );
        }
        break;
      }
      case "rejected": {
        return {
          reason: "reject",
          detail: event.data,
          shouldReconnect: false,
        };
      }
      case "refresh": {
        return {
          reason: "refresh",
          detail: event.data,
          shouldReconnect: opts.reconnect && !signal.aborted,
        };
      }
      case "disconnect": {
        return {
          reason: "disconnect",
          detail: event.data,
          shouldReconnect: opts.reconnect && !signal.aborted,
        };
      }
      case "keepalive":
        // intentional silence
        break;
      default:
        // unknown event type — silently ignore (forward-compatible)
        break;
    }
  }

  return {
    reason: "stream_end",
    shouldReconnect: opts.reconnect && !signal.aborted,
  };
}

// ── Public entry ─────────────────────────────────────────────────────────

export async function voice(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: VoiceOptions,
): Promise<void> {
  const state: ViewerState = {
    lastSeenSeq: opts.sinceSeq ?? 0,
    totalThoughts: 0,
    reconnectCount: 0,
    startedAt: Date.now(),
  };

  const signal = { aborted: false };
  let sigintCount = 0;
  const sigintHandler = () => {
    sigintCount += 1;
    if (sigintCount >= 2) {
      console.log(C.red("\n(second SIGINT — exiting hard)"));
      process.exit(130);
    }
    console.log(C.dim("\n(SIGINT — closing voice viewer)"));
    signal.aborted = true;
  };
  process.on("SIGINT", sigintHandler);

  console.log(
    C.bold(`▸ voice viewer · strand ${opts.strandId}`) +
      (opts.raw ? C.dim(" · --raw (no decrypt)") : "") +
      (opts.reconnect ? "" : C.dim(" · --no-reconnect")),
  );

  try {
    while (!signal.aborted) {
      const r = await runOneConnection(config, keys, opts, state, signal);

      if (r.reason === "client_abort") break;
      if (r.reason === "reject") {
        console.log(C.red(`✗ rejected by server: ${r.detail ?? ""}`));
        break;
      }
      if (r.reason === "error") {
        console.log(C.red(`✗ error: ${r.detail ?? ""}`));
      } else if (r.reason === "refresh") {
        console.log(C.dim(`▸ server refresh${r.detail ? `: ${r.detail}` : ""}`));
      } else if (r.reason === "disconnect") {
        console.log(C.yellow(`▸ disconnect${r.detail ? `: ${r.detail}` : ""}`));
      } else if (r.reason === "stream_end") {
        console.log(C.dim("▸ stream ended"));
      }

      if (!r.shouldReconnect) break;

      state.reconnectCount += 1;
      await new Promise((r) => setTimeout(r, opts.reconnectDelayMs));
    }
  } finally {
    process.off("SIGINT", sigintHandler);
  }

  const elapsedSec = Math.round((Date.now() - state.startedAt) / 1000);
  console.log("");
  console.log(
    C.dim(
      `closed · ${state.totalThoughts} thought${state.totalThoughts === 1 ? "" : "s"} seen · ${state.reconnectCount} reconnect${state.reconnectCount === 1 ? "" : "s"} · ${elapsedSec}s`,
    ),
  );
}
