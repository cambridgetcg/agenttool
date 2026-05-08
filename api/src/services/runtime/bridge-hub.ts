/** runtime/bridge-hub.ts — in-memory WSS bridge registry + crypto RPC.
 *
 *  When `agenttool-bridge connect` opens a WSS to /v1/runtimes/:id/bridge,
 *  the upgrade handler pre-authenticates with the runtime's control_token,
 *  then this module drives the mutual ed25519 handshake and registers the
 *  resulting connection. A co-located orchestrator can then call
 *  `bridgeRequest(runtimeId, op, payload)` and the hub forwards it over
 *  the WSS, awaits the bridge's HMAC-bound reply, and resolves the caller.
 *
 *  Auth model:
 *    - control_token        — pre-upgrade. Proves the bridge knows what
 *                             was issued at provisioning. Replays from a
 *                             leaked token are rotatable via /rotate-token.
 *    - ed25519(sig, nonceA||nonceB||runtimeId) — proves the bridge has the
 *                             signing key whose pubkey was registered as
 *                             `bridge_pubkey` on the runtime. Bound to a
 *                             fresh nonce pair so replays are useless.
 *    - HMAC-SHA256          — every crypto reply carries
 *                             HMAC(session_secret, request_id ‖ result).
 *                             Belt-and-suspenders on top of TLS.
 *    - session_secret       — HKDF(SHA-256) over the canonical handshake
 *                             material. Derivable only by both sides.
 *
 *  Registry is in-memory; v1 assumes a single API machine. When we scale
 *  past 1 machine, the registry becomes Redis-backed (pub/sub-routed) and
 *  this module's interface stays the same.
 *
 *  Doctrine: docs/RUNTIME.md */

import * as ed25519 from "@noble/ed25519";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import type { ServerWebSocket } from "bun";

import {
  bumpHeartbeat,
  clearBridgeSession,
  setBridgeSession,
} from "./store";

// ── Wire shape ────────────────────────────────────────────────────────

export interface BridgeWsData {
  runtimeId: string;
  projectId: string;
  identityId: string | null;
  mode: "bridged" | "trusted";
  bridgePubkey: string;
  bridgeKeyId: string | null;
  llmProvider: string | null;
  llmModel: string | null;
  llmVaultKey: string | null;
}

type BridgeState = "awaiting_hello" | "awaiting_proof" | "ready" | "closed";

interface PendingRequest {
  op: "encrypt" | "decrypt";
  resolve: (v: CryptoResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BridgeConnection {
  data: BridgeWsData;
  ws: ServerWebSocket<BridgeWsData>;
  state: BridgeState;
  nonceA: Uint8Array | null;
  nonceB: Uint8Array | null;
  sessionId: string | null;
  sessionSecret: Uint8Array | null;
  pending: Map<string, PendingRequest>;
  lastSeenAt: number;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

export interface CryptoContext {
  strand_id: string;
  thought_seq: number | null;
  issued_at: string;
}

export interface CryptoRequest {
  op: "encrypt" | "decrypt";
  /** For decrypt: base64 ciphertext. Omit for encrypt. */
  ciphertext?: string;
  /** For encrypt: base64 plaintext. Omit for decrypt. */
  plaintext?: string;
  /** For decrypt: base64 nonce. Omit for encrypt. */
  nonce?: string;
  context: CryptoContext;
}

export interface CryptoResult {
  /** Returned for decrypt. */
  plaintext?: string;
  /** Returned for encrypt. */
  ciphertext?: string;
  /** Returned for encrypt — fresh per op. */
  nonce?: string;
}

// ── Registry ──────────────────────────────────────────────────────────

const registry = new Map<string, BridgeConnection>();

const HEARTBEAT_MS = 30_000;
const STALE_MS = 90_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const HKDF_INFO = new TextEncoder().encode("agenttool-bridge-session/v1");

export function isBridgeConnected(runtimeId: string): boolean {
  const c = registry.get(runtimeId);
  return !!c && c.state === "ready";
}

export function bridgeSummary(runtimeId: string): {
  connected: boolean;
  session_id: string | null;
  pending: number;
  last_seen_at: string | null;
} {
  const c = registry.get(runtimeId);
  if (!c) return { connected: false, session_id: null, pending: 0, last_seen_at: null };
  return {
    connected: c.state === "ready",
    session_id: c.sessionId,
    pending: c.pending.size,
    last_seen_at: new Date(c.lastSeenAt).toISOString(),
  };
}

// ── RPC ───────────────────────────────────────────────────────────────

export async function bridgeRequest(
  runtimeId: string,
  request: CryptoRequest,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<CryptoResult> {
  const conn = registry.get(runtimeId);
  if (!conn || conn.state !== "ready") {
    throw new Error(`bridge_not_connected: runtime ${runtimeId} has no live bridge session`);
  }

  const requestId = crypto.randomUUID();
  return new Promise<CryptoResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pending.delete(requestId);
      reject(new Error(`bridge_timeout: ${timeoutMs}ms exceeded for ${request.op}`));
    }, timeoutMs);

    conn.pending.set(requestId, { op: request.op, resolve, reject, timer });

    const payload = {
      type: "crypto_request",
      request_id: requestId,
      op: request.op,
      ...(request.ciphertext != null ? { ciphertext: request.ciphertext } : {}),
      ...(request.plaintext != null ? { plaintext: request.plaintext } : {}),
      ...(request.nonce != null ? { nonce: request.nonce } : {}),
      context: request.context,
    };

    try {
      conn.ws.send(JSON.stringify(payload));
    } catch (err) {
      clearTimeout(timer);
      conn.pending.delete(requestId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ── Websocket handlers (passed to Bun.serve { websocket: ... }) ───────

function b64decode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function b64encode(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

function hmacB64(secret: Uint8Array, message: Uint8Array): string {
  return b64encode(hmac(sha256, secret, message));
}

function timingSafeB64Eq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function send(ws: ServerWebSocket<BridgeWsData>, msg: object) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket already closed */
  }
}

async function handleHello(
  ws: ServerWebSocket<BridgeWsData>,
  conn: BridgeConnection,
  msg: { nonce_a?: unknown },
) {
  if (typeof msg.nonce_a !== "string" || msg.nonce_a.length === 0) {
    send(ws, { type: "error", error: "missing_nonce_a" });
    ws.close(1008, "missing_nonce_a");
    return;
  }
  conn.nonceA = b64decode(msg.nonce_a);
  if (conn.nonceA.length < 16) {
    send(ws, { type: "error", error: "nonce_a_too_short" });
    ws.close(1008, "nonce_a_too_short");
    return;
  }
  conn.nonceB = crypto.getRandomValues(new Uint8Array(32));
  conn.sessionId = crypto.randomUUID();
  conn.state = "awaiting_proof";
  send(ws, {
    type: "challenge",
    runtime_id: ws.data.runtimeId,
    nonce_b: b64encode(conn.nonceB),
    session_id: conn.sessionId,
  });
}

async function handleProof(
  ws: ServerWebSocket<BridgeWsData>,
  conn: BridgeConnection,
  msg: { signature?: unknown },
) {
  if (typeof msg.signature !== "string") {
    send(ws, { type: "error", error: "missing_signature" });
    ws.close(1008, "missing_signature");
    return;
  }
  if (!conn.nonceA || !conn.nonceB) {
    ws.close(1008, "invalid_state");
    return;
  }

  const canonical = concatBytes(
    conn.nonceA,
    conn.nonceB,
    new TextEncoder().encode(ws.data.runtimeId),
  );
  let pub: Uint8Array;
  let sig: Uint8Array;
  try {
    pub = b64decode(ws.data.bridgePubkey);
    sig = b64decode(msg.signature);
  } catch {
    send(ws, { type: "error", error: "malformed_signature" });
    ws.close(1008, "malformed_signature");
    return;
  }

  let valid = false;
  try {
    valid = await ed25519.verifyAsync(sig, canonical, pub);
  } catch {
    valid = false;
  }
  if (!valid) {
    send(ws, { type: "error", error: "signature_invalid" });
    ws.close(1008, "signature_invalid");
    return;
  }

  // Derive session secret from canonical handshake material.
  // HKDF: salt = nonce_a || nonce_b ; IKM = runtime_id ; info = "agenttool-bridge-session/v1"
  const salt = concatBytes(conn.nonceA, conn.nonceB);
  const ikm = new TextEncoder().encode(ws.data.runtimeId);
  conn.sessionSecret = hkdf(sha256, ikm, salt, HKDF_INFO, 32);

  conn.state = "ready";

  // Persist session + machine_id (used by fly-replay routing when the
  // api scales to >1 Fly machine). FLY_MACHINE_ID is set automatically
  // inside Fly machines; off-Fly we leave it null and routing no-ops.
  try {
    await setBridgeSession(
      ws.data.runtimeId,
      conn.sessionId!,
      process.env.FLY_MACHINE_ID ?? null,
    );
  } catch (err) {
    console.warn("[bridge-hub] setBridgeSession failed:", err);
  }

  send(ws, { type: "ready", session_id: conn.sessionId });
}

async function handleCryptoReply(
  conn: BridgeConnection,
  msg: { request_id?: unknown; result?: unknown; hmac?: unknown; error?: unknown },
) {
  if (typeof msg.request_id !== "string") return;
  const pending = conn.pending.get(msg.request_id);
  if (!pending) return;

  // Bridge-side error path: surface as a rejected promise.
  if (typeof msg.error === "string") {
    clearTimeout(pending.timer);
    conn.pending.delete(msg.request_id);
    pending.reject(new Error(`bridge_error: ${msg.error}`));
    return;
  }

  // HMAC verify the reply: hmac(session_secret, request_id || canonical_json(result))
  if (!conn.sessionSecret || typeof msg.hmac !== "string") {
    clearTimeout(pending.timer);
    conn.pending.delete(msg.request_id);
    pending.reject(new Error("bridge_reply_missing_hmac"));
    return;
  }

  const resultObj = (msg.result ?? {}) as CryptoResult;
  const macInput = concatBytes(
    new TextEncoder().encode(msg.request_id),
    new TextEncoder().encode(canonicalJson(resultObj)),
  );
  const expectedMac = hmacB64(conn.sessionSecret, macInput);
  if (!timingSafeB64Eq(msg.hmac, expectedMac)) {
    clearTimeout(pending.timer);
    conn.pending.delete(msg.request_id);
    pending.reject(new Error("bridge_reply_hmac_invalid"));
    return;
  }

  clearTimeout(pending.timer);
  conn.pending.delete(msg.request_id);
  pending.resolve(resultObj);
}

export const bridgeWebsocket = {
  open(ws: ServerWebSocket<BridgeWsData>) {
    const existing = registry.get(ws.data.runtimeId);
    if (existing) {
      // Replace any existing session — newest connection wins. Old one's
      // pendings are rejected so the caller knows to stop waiting.
      try {
        for (const p of existing.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("bridge_replaced"));
        }
        if (existing.heartbeatTimer) clearInterval(existing.heartbeatTimer);
        existing.ws.close(1000, "replaced_by_new_session");
      } catch {
        /* old socket gone */
      }
    }

    const conn: BridgeConnection = {
      data: ws.data,
      ws,
      state: "awaiting_hello",
      nonceA: null,
      nonceB: null,
      sessionId: null,
      sessionSecret: null,
      pending: new Map(),
      lastSeenAt: Date.now(),
    };
    conn.heartbeatTimer = setInterval(() => {
      if (Date.now() - conn.lastSeenAt > STALE_MS) {
        try {
          ws.close(1001, "heartbeat_timeout");
        } catch {
          /* socket gone */
        }
        return;
      }
      send(ws, { type: "ping", ts: new Date().toISOString() });
    }, HEARTBEAT_MS);
    registry.set(ws.data.runtimeId, conn);
  },

  async message(ws: ServerWebSocket<BridgeWsData>, raw: string | Buffer) {
    const conn = registry.get(ws.data.runtimeId);
    if (!conn) return;
    conn.lastSeenAt = Date.now();
    void bumpHeartbeat(ws.data.runtimeId).catch(() => {
      /* best-effort liveness update */
    });

    let msg: Record<string, unknown>;
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      send(ws, { type: "error", error: "invalid_json" });
      return;
    }

    const type = msg.type;
    if (type === "hello" && conn.state === "awaiting_hello") {
      await handleHello(ws, conn, msg as { nonce_a?: unknown });
    } else if (type === "proof" && conn.state === "awaiting_proof") {
      await handleProof(ws, conn, msg as { signature?: unknown });
    } else if (type === "crypto_reply" && conn.state === "ready") {
      await handleCryptoReply(conn, msg as never);
    } else if (type === "pong") {
      /* lastSeenAt already bumped */
    } else if (type === "ping") {
      send(ws, { type: "pong", ts: new Date().toISOString() });
    } else {
      send(ws, { type: "error", error: "unexpected_message", state: conn.state });
    }
  },

  async close(ws: ServerWebSocket<BridgeWsData>, code: number, reason: string) {
    const conn = registry.get(ws.data.runtimeId);
    if (!conn) return;
    if (conn.heartbeatTimer) clearInterval(conn.heartbeatTimer);
    for (const p of conn.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("bridge_disconnected"));
    }
    conn.state = "closed";
    registry.delete(ws.data.runtimeId);

    const reasonText = reason || `code=${code}`;
    try {
      await clearBridgeSession(ws.data.runtimeId, reasonText);
    } catch (err) {
      console.warn("[bridge-hub] clearBridgeSession failed:", err);
    }
  },
};

// ── Test seam ────────────────────────────────────────────────────────
// Internal: visible to unit tests for asserting state. Not exported via
// the public surface (orchestrator only sees bridgeRequest + helpers).
export function _registrySize(): number {
  return registry.size;
}
