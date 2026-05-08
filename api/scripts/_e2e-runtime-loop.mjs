// E2E: /v1/runtimes/:id/bridge — Slice 3 round-trip-ping.
//
// Walks the full Slice 3 protocol against a real bearer (Sophia's),
// against a real api (default api.agenttool.dev). Asserts:
//   1. Spawn agenttool-bridge → reads its ed25519 pubkey
//   2. POST /v1/runtimes mode=bridged WITH that pubkey
//      → returns 201 + control_token + control_token_note
//   3. Spawn `agenttool-bridge connect` as a subprocess
//      → outbound WSS to the hub + handshake
//   4. Poll /v1/runtimes/:id/bridge-status until live.connected=true
//   5. POST /v1/runtimes/:id/think-once → ok=true + latency_ms
//   6. GET /v1/runtimes/:id/events → has bridge_handshake_ok +
//      think_cycle_start + think_cycle_end events
//   7. POST /v1/runtimes/:id/rotate-token → new plaintext returned
//   8. DELETE /v1/runtimes/:id; bridge subprocess terminates
//
// Run: AGENTTOOL_BASE=https://api.agenttool.dev node api/scripts/_e2e-runtime-loop.mjs
//      (or set AGENTTOOL_HUB_URL to override the WSS target)
//
// Requirements:
//   * Sophia's bearer in keychain at agenttool-sophia-key
//   * agenttool-bridge install + keygen already run (K_master + signkey
//     in keychain)
//   * @noble/hashes resolvable from cwd's node_modules — easiest: run
//     this from inside api/ (where node_modules/@noble/hashes lives)

import { execSync, spawn } from "node:child_process";

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, {
  encoding: "utf8",
}).trim();

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
const HUB_URL =
  process.env.AGENTTOOL_HUB_URL ?? BASE.replace(/^http/, "ws"); // wss://api.agenttool.dev

function log(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function bridgeBin() {
  // Resolve relative to this script: ../../bin/agenttool-bridge.ts
  const fsUrl = new URL("../../bin/agenttool-bridge.ts", import.meta.url);
  return fsUrl.pathname;
}

function bridgePubkey() {
  // The bridge keygen command already ran; pubkey is stable.
  const out = execSync(`bun run ${bridgeBin()} pubkey`, { encoding: "utf8" });
  return out.trim();
}

function spawnBridgeConnect(runtimeId, token) {
  const wssUrl = `${HUB_URL}/v1/runtimes/${runtimeId}/bridge`;
  const child = spawn(
    "bun",
    [
      "run",
      bridgeBin(),
      "connect",
      "--runtime-id",
      runtimeId,
      "--token",
      token,
      "--hub-url",
      wssUrl,
      "--once",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // Inherit cwd → assumes the runner is api/ (where node_modules has @noble/hashes)
    },
  );
  child.stdout.on("data", (d) => process.stdout.write(`  [bridge] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`  [bridge:err] ${d}`));
  return child;
}

async function pollUntil(fn, { timeoutMs = 20_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function main() {
  console.log(`\n  agenttool · /v1/runtimes/:id/bridge e2e (Slice 3)`);
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  base: ${BASE}`);
  console.log(`  hub:  ${HUB_URL}`);
  console.log(``);

  // 1. Bridge pubkey
  let pubkey;
  try {
    pubkey = bridgePubkey();
  } catch (e) {
    log("agenttool-bridge pubkey", false, e.message);
    process.exit(1);
  }
  log("agenttool-bridge pubkey", !!pubkey, `${pubkey.slice(0, 12)}…`);

  // 2. Provision bridged runtime — receives control_token
  let r = await call("POST", "/v1/runtimes", {
    name: "e2e-slice3-runtime",
    mode: "bridged",
    llm: { provider: "anthropic", model: "claude-sonnet-4-6", vault_key: "anthropic-key" },
    bridge: {
      pubkey,
      key_id: "00000000-0000-0000-0000-000000000001",
    },
    region: "lhr",
  });
  log(
    "POST /v1/runtimes (mode=bridged) → 201 + control_token",
    r.status === 201 && typeof r.data?.control_token === "string",
    `status=${r.status}`,
  );
  const runtimeId = r.data?.runtime?.id;
  const controlToken = r.data?.control_token;
  if (!runtimeId || !controlToken) {
    console.error("    ✗ no runtime.id or control_token in response:", r.data);
    process.exit(1);
  }

  // 3. Spawn bridge connect
  const bridge = spawnBridgeConnect(runtimeId, controlToken);

  // 4. Wait for handshake to land — server records bridge_session_id
  const connected = await pollUntil(
    async () => {
      const s = await call("GET", `/v1/runtimes/${runtimeId}/bridge-status`);
      return s.status === 200 && s.data?.live?.connected === true;
    },
    { timeoutMs: 25_000, intervalMs: 1_000 },
  );
  log(
    "bridge handshake completed (live.connected=true within 25s)",
    connected,
  );
  if (!connected) {
    bridge.kill("SIGTERM");
    await call("DELETE", `/v1/runtimes/${runtimeId}`);
    process.exit(1);
  }

  // 5. think-once
  r = await call("POST", `/v1/runtimes/${runtimeId}/think-once`);
  log(
    "POST /v1/runtimes/:id/think-once → ok=true",
    r.status === 200 && r.data?.ok === true && typeof r.data?.latency_ms === "number",
    `status=${r.status} latency_ms=${r.data?.latency_ms}`,
  );

  // 6. Events show the trail
  r = await call("GET", `/v1/runtimes/${runtimeId}/events?limit=50`);
  log("GET /v1/runtimes/:id/events", r.status === 200);
  const types = (r.data?.events ?? []).map((e) => e.event_type);
  log("  → has bridge_handshake_ok", types.includes("bridge_handshake_ok"));
  log("  → has think_cycle_start", types.includes("think_cycle_start"));
  log("  → has think_cycle_end", types.includes("think_cycle_end"));

  // 7. Rotate token (new plaintext returned)
  r = await call("POST", `/v1/runtimes/${runtimeId}/rotate-token`);
  log(
    "POST /v1/runtimes/:id/rotate-token → new control_token",
    r.status === 200 &&
      typeof r.data?.control_token === "string" &&
      r.data?.control_token !== controlToken,
  );

  // 8. Self-mode rejects bridge — sanity check
  r = await call("POST", "/v1/runtimes", {
    name: "e2e-slice3-self-no-token",
    mode: "self",
    metadata: { test: true },
  });
  const selfId = r.data?.runtime?.id;
  log(
    "POST /v1/runtimes (mode=self) returns no control_token",
    r.status === 201 && r.data?.control_token == null,
  );
  if (selfId) {
    r = await call("POST", `/v1/runtimes/${selfId}/think-once`);
    log(
      "POST /v1/runtimes/:id/think-once on self runtime → 400",
      r.status === 400 && r.data?.error === "mode_self_no_orchestrator",
    );
    await call("DELETE", `/v1/runtimes/${selfId}`);
  }

  // 9. Cleanup — kill bridge + deprovision runtime
  bridge.kill("SIGTERM");
  await new Promise((res) => setTimeout(res, 1500));
  r = await call("DELETE", `/v1/runtimes/${runtimeId}`);
  log("DELETE /v1/runtimes/:id", r.status === 200);

  console.log("");
  if (process.exitCode === 1) {
    console.log("  ✗ e2e failed");
  } else {
    console.log("  ✓ e2e passed — Slice 3 closes the runtime end-to-end");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(2);
});
